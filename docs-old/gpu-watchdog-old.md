# GPU Watchdog (game/AI GPU balancer) — spec

Status: live on the home GPU machine, about to be refactored. This doc
describes the *current* behavior in full so the refactor has a clean
baseline to diverge from.

Location: `/opt/gpu-watchdog/gpu_watchdog.py` + `gpu-watchdog.service`
(systemd unit) on the home GPU machine — **not** in this repo, since it
runs on bare metal on a machine this repo doesn't deploy to. Only reachable
today by asking the user to paste file contents/terminal output.

## Purpose

The home GPU machine (RTX 4070 Ti) runs two categories of GPU consumer that
were never designed to coexist:

1. **Games / interactive local use** — whatever the user is doing at the
   keyboard. Always wins. Zero tolerance for OOM, stutter, or a crashed game
   because a background service was holding VRAM.
2. **The AI stack** — Ollama (LLM, shared across cchannel, genquest/eldquest,
   and opencode), Kokoro (TTS, Docker), Bark (TTS, Docker). Runs unattended,
   in the background, all day, feeding cchannel's live broadcast.

Nothing native to any of these tools arbitrates between the two. The
watchdog is the arbiter: it treats games as strictly higher priority and
will stop the entire AI stack the moment something else needs the GPU, then
bring it back once that pressure is gone.

## Why VRAM specifically, and why stop instead of throttle

VRAM doesn't degrade gracefully under contention the way CPU time does.
There's no "nice -19" for GPU memory — once it's oversubscribed you get an
OOM error or a driver-level hang, not slower rendering. That rules out any
soft-priority / cgroup-style scheme. The only real prevention is freeing
VRAM proactively, before the game actually needs it, which means something
has to *fully stop* the AI stack's GPU processes rather than merely
deprioritizing them.

## High-level loop

Runs as `main()`, polling every `POLL_INTERVAL = 5` seconds, forever:

1. Query every GPU compute process currently running (PID → VRAM MiB) via
   `nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader,nounits`.
2. Compute the set of PIDs belonging to our *own* AI stack (see below).
3. Any process that is (a) not in that known-PID set and (b) using
   ≥ `FOREIGN_VRAM_THRESHOLD_MIB` (1024 MiB) counts as "foreign heavy usage."
4. Debounce that signal over several consecutive polls (see below) before
   actually acting.
5. On a sustained foreign-heavy verdict while the stack is up: stop it.
   On a sustained all-clear verdict while the stack is down: start it.

State kept across iterations: `ai_stack_running` (bool),
`consecutive_foreign` / `consecutive_clear` counters.

## Identifying "our own" GPU processes

This is the hardest part of the current implementation and the one most
likely to need rethinking in the refactor. `get_known_ai_pids()` unions
three sources:

- **Docker containers** (`kokoro-fastapi`, `bark-server`): `docker top
  <name> -o pid` — every PID in the container, not just PID 1. Necessary
  because a Python/PyTorch server can spawn separate worker subprocesses
  that hold the actual CUDA context; `docker inspect`'s `.State.Pid` only
  gives the top-level entrypoint PID and misses those, which was an
  earlier bug (own containers got misidentified as foreign the moment they
  did real work, causing the watchdog to stop its own services mid-request).
- **Ollama's systemd MainPID**: `systemctl show --property=MainPID --value
  ollama`.
- **Ollama's ephemeral runner subprocess**: `pgrep -f ollama`. Ollama
  spawns a separate runner process per model load — distinct from the
  `ollama serve` daemon PID systemd reports — and *that* runner is what
  `nvidia-smi` actually shows using VRAM. Matched by command-line
  substring rather than a fixed parent PID relationship.

Known unsolved edge case: the runner subprocess can be so short-lived that
it exits before even a same-iteration `pgrep` call observes it (confirmed
via `ps -p <pid>` returning empty immediately after `nvidia-smi` reported
it). This is treated as fundamentally unwinnable through pure PID
identification — see debounce below, which sidesteps it entirely rather
than solving it.

## Debounce

`DEBOUNCE_POLLS = 3` (~15s at the default 5s poll interval). Foreign-heavy
usage must be observed on 3 consecutive polls before the stack is stopped;
all-clear must likewise persist for 3 consecutive polls before the stack is
restarted. This exists for two independent reasons:

1. It absorbs the PID-identification gap above — a transient, unidentified
   spike from the AI stack's own short-lived processes disappears within a
   poll or two and never accumulates 3 in a row.
2. It prevents disruptive stop/start flapping from momentary blips in
   either direction (e.g. a game's launcher briefly touching the GPU, or a
   desktop compositor spike).

Any single poll below the VRAM threshold, or matched to a known PID,
doesn't count toward `consecutive_foreign` at all — the counters are
mutually exclusive and each foreign-heavy poll resets `consecutive_clear`
to 0 and vice versa.

## Ignoring desktop chrome

`FOREIGN_VRAM_THRESHOLD_MIB = 1024`. Ordinary desktop GPU-accelerated
rendering (Xorg, Discord, Steam's Chromium-based UI, VSCode, browsers)
routinely shows up in `nvidia-smi`'s compute-app list for tens of MB —
constantly present, never real contention. Without this threshold, Steam's
idle `steamwebhelper` alone (8 MiB) tripped a full stack stop with no game
actually running. A real game allocates several GB, so 1024 MiB cleanly
separates "the desktop exists" from "something is seriously using the
GPU."

## Stop / start actions

`stop_ai_stack()`:
1. `docker stop kokoro-fastapi bark-server`
2. `systemctl stop ollama`
3. `_call_admin("/api/admin/pause")` — best-effort POST to cchannel so the
   live station shows "paused" instead of listeners hitting silent
   generation failures.

`start_ai_stack()`: same three actions in start order (`systemctl start
ollama`; `docker start` both containers; `_call_admin("/api/admin/resume")`).

`_call_admin()` specifics:
- HTTP Basic auth (`admin` / the cchannel admin password) against
  `https://cchannel.org<path>`.
- Explicitly sets `User-Agent: curl/8.5.0`. Cloudflare's bot rules block
  Python's default `Python-urllib/x.y` UA on this exact endpoint; curl's UA
  passes. Confirmed by direct comparison (`curl` succeeded, `urllib`
  didn't, against the same endpoint with the same credentials).
- Wrapped in try/except and never raises — a network hiccup here must
  never block the actual GPU-freeing action, which is the part that
  actually matters for the game.

## Startup reality-check

`is_ai_stack_running()` queries actual current state
(`systemctl is-active ollama` + `docker inspect --format
'{{.State.Running}}'` for both containers) rather than assuming a starting
value. `main()` uses this for the *initial* value of `ai_stack_running`,
then — if that initial check says "not running" — immediately re-evaluates
foreign GPU usage once and calls `start_ai_stack()` right away if clear,
rather than waiting for the next natural state transition.

This exists because of a real incident: `systemctl restart
gpu-watchdog` while a *previous* instance had already stopped everything
(and no game was running at that moment) left the stack stuck stopped
forever — a fresh process that hardcoded `ai_stack_running = True` at
startup would never notice it needed to start anything, since nothing
would trip the "foreign usage went from present to absent" transition it
was waiting for.

## Constants (current values)

| Name | Value | Meaning |
|---|---|---|
| `POLL_INTERVAL` | 5s | How often `nvidia-smi` is polled |
| `DEBOUNCE_POLLS` | 3 | Consecutive polls required before acting, either direction |
| `FOREIGN_VRAM_THRESHOLD_MIB` | 1024 | Minimum VRAM (MiB) for a process to count as real contention |
| `DOCKER_CONTAINERS` | `["kokoro-fastapi", "bark-server"]` | Containers considered part of "our own" stack |
| `OLLAMA_SERVICE` | `"ollama"` | systemd unit name |
| `CCHANNEL_URL` | `https://cchannel.org` | Admin API base for pause/resume calls |

## Known limitations / open questions for the refactor

- **PID identification is inherently racy** for Ollama's runner subprocess;
  debounce papers over it rather than solving it. A refactor could
  instead key off Ollama's own `/api/ps` (which cchannel's scheduler
  already queries indirectly) to know when a model is loaded/loading,
  rather than inferring it from `nvidia-smi` + `pgrep`.
- **No distinction between "Ollama is busy serving a request" and "Ollama
  is idle but resident."** Since the recent cchannel change to stop
  force-unloading Ollama (see cchannel's own recent fixes), Ollama sits
  GPU-resident nearly all the time — meaning its own idle VRAM footprint
  is now part of the baseline the watchdog must not conflate with "foreign"
  usage. Worth confirming the threshold/known-PID logic still cleanly
  separates "Ollama resident but idle" from "a game is running" under this
  new steady state.
- **All-or-nothing stop.** The watchdog cannot stop just Bark (the most
  VRAM-hungry, least latency-sensitive piece) while leaving Ollama +
  Kokoro up. A refactor aimed at giving Bark headroom without touching
  Ollama (the user's explicit ask in the current cchannel work) may want
  a tiered stop policy instead of the current single on/off switch for
  the whole stack.
- **Single-machine, single-GPU assumption** baked in throughout (no
  multi-GPU awareness, no per-process priority beyond the binary
  known/foreign split).
- **Admin pause/resume coupling is cchannel-specific** — if this watchdog
  is ever meant to generalize beyond cchannel, `_call_admin` would need to
  become pluggable rather than a hardcoded cchannel endpoint.
