# 3C - Cloud Control Center — Project Prompt

## Overview
Build a self-hosted personal operations dashboard called **3C Panel**,
running at `3c.lol`. It is a lightweight web-based control panel for
managing a personal internet infrastructure stack — Cloudflare zones, DNS,
Pages deployments, and bulk redirects — with stubs for future modules
including Porkbun domain management, Migadu email, app management, and
a full web server console.

The north star use case: from a single authenticated URL, manage every
aspect of a personal domain and hosting setup without ever opening the
Cloudflare dashboard, Porkbun, or Migadu in a browser.

The app runs **on** an Oracle Cloud server. It does not SSH into anything —
it is the server. It is protected by **Cloudflare Access** (Google OAuth),
so the app itself needs no authentication code. All routes assume the user
is already authenticated.

---

## Aesthetic & Design Direction

**Brutalist minimal. Esoteric. Retro but not nostalgic.**

- Square design language throughout — no rounded corners, no soft shadows,
  no gradients, no web3 energy, no glassmorphism
- Left sidebar uses large square emoji icon buttons as navigation — no
  text labels in the rail itself, only a tooltip on hover showing the
  section name
- Dark theme, high contrast, monospace or semi-monospace typography
- Feels like a tool built for one person who knows exactly what they want
- Think: terminal aesthetics translated into a web UI. Dense but not
  cluttered. Every pixel intentional.
- Color palette: dark background (#0e0e0e or similar), bright accent for
  active states (something unexpected — not blue, not purple), muted
  secondary text
- No animations for the sake of it — only functional transitions
  (panel slides, dropdown appears)
- Icons are emojis throughout — embrace this, don't fight it

---

## Tech Stack

- **Backend:** Python 3.11+, FastAPI, async throughout
- **Frontend:** Vanilla HTML + CSS + JavaScript — no framework, no build
  step, no node_modules. Single-page app feel via vanilla JS routing.
- **HTTP client:** httpx (async)
- **Charts:** Chart.js (CDN, no install)
- **Config:** `~/.config/3c/config.toml`, permissions `600`
- **Dependencies:** `pyproject.toml`
- **Target:** Linux (Oracle Cloud, Ubuntu), nginx reverse proxy,
  systemd service
- **Auth:** Cloudflare Access handles everything. The app trusts that any
  request reaching it is authenticated. No login code needed.

---

## Routing

```
/                          → redirect to /cf/zones (default landing)
/cf/zones                  → zone list (default view)
/cf/zones/<domain>         → redirect to /cf/zones/<domain>/analytics
/cf/zones/<domain>/analytics → zone analytics view
/cf/zones/<domain>/dns     → zone DNS manager
/cf/redirects              → bulk redirects manager
/cf/pages                  → Cloudflare Pages manager
/domains                   → Porkbun placeholder
/email                     → Migadu placeholder
/apps                      → Apps panel placeholder
/server                    → Server console placeholder
```

Domain name is used as the slug (e.g. `/cf/zones/example.com`), resolved
to a Cloudflare zone ID internally.

---

## Layout

### Primary Sidebar (leftmost rail)
Large square emoji icon buttons, vertically stacked, full height.
No text. Tooltip on hover shows section name.
Active section highlighted with accent color border or background.

| Emoji | Section | Route |
|-------|---------|-------|
| ☁️ | Cloudflare | /cf/zones |
| 🐷 | Porkbun | /domains |
| ✉️ | Migadu | /email |
| 🌱 | Apps | /apps |
| 🖥️ | Server | /server |

### Secondary Sidebar (appears when Cloudflare is selected)
A second rail appears to the right of the primary sidebar, showing
Cloudflare sub-sections with icon + label:

| Emoji | Label | Route |
|-------|-------|-------|
| 🌐 | Zones | /cf/zones |
| 🔗 | Redirects | /cf/redirects |
| 🌍 | Pages | /cf/pages |

### Main Content Panel
Takes up remaining width. Changes based on active route.

### Zone Context Bar (when a zone is selected)
When a zone is selected, a horizontal bar appears above the main content
containing:
- A searchable zone dropdown (to switch zones without going back to list)
- Horizontal tab navigation: **Analytics** | **DNS**

---

## Feature Specifications

### /cf/zones — Zone List

- Fetch all zones via `GET /client/v4/zones`
- Display as a clean table or card list:
  - Domain name
  - Status badge: `active` (green), `pending` (yellow), `moved` (red)
  - Plan (free/pro/etc)
  - Nameservers (if pending/moved)
- Searchable, filterable by status, orderable by name/status
- Pending/moved zones show a highlighted warning row
- **Add Zone button** opens a modal:
  1. Input: domain name
  2. App calls CF API to create zone, retrieves assigned nameservers
  3. If Porkbun credentials configured: shows prompt
     "Update nameservers on Porkbun now?" with the two nameservers
     displayed and a confirm button — one extra deliberate click,
     not automatic
  4. On confirm: calls Porkbun `updateNs` API
  5. Shows success/failure inline
  6. If no Porkbun credentials: shows nameservers for manual update

### /cf/zones/<domain>/dns — DNS Manager

- Fetch all DNS records: `GET /client/v4/zones/{zone_id}/dns_records`
- Scrollable table:
  - Type, Name, Content, TTL, Proxied (🟠 proxied / ⚫ DNS only)
- Actions:
  - `A` — Add record (modal form, fields adapt to record type)
  - `E` — Edit selected record
  - `D` — Delete selected record (confirmation modal)
- Record types handled: A, AAAA, CNAME, TXT, MX, NS, SRV
- Form intelligently shows relevant fields per record type
- **Backend note:** implement a reusable internal function
  `add_dns_records(zone_id, records[])` that accepts a list of DNS record
  objects and creates them via the CF API. This function will be called
  by the future Migadu module to auto-add MX, SPF, DKIM, DMARC records
  when a domain is configured for email. The Migadu UI does not need to
  exist yet — just the backend function, well-commented, ready to be wired
  up later.

### /cf/zones/<domain>/analytics — Zone Analytics

- Query Cloudflare GraphQL Analytics API:
  `POST https://api.cloudflare.com/client/v4/graphql`
- Dataset: `httpRequests1dGroups` (free tier compatible, daily granularity)
- Display for last 7 days:
  - Total requests
  - Bandwidth (human-readable: KB/MB/GB)
  - Unique visitors
  - Cached vs uncached ratio (visual bar or percentage)
  - Threats blocked
- Chart.js bar or line chart for requests over 7 days
- Clean data table below chart with per-day breakdown
- Note: free tier does not support real-time analytics — label the
  time range clearly in the UI

### /cf/redirects — Bulk Redirects Manager

- Fetch redirect lists: `GET /client/v4/accounts/{account_id}/rules/lists`
- Scrollable table: Source URL, Target URL, Status code (301/302)
- Actions:
  - `A` — Add redirect
  - `E` — Edit selected
  - `D` — Delete selected (confirmation modal)
- Account-scoped, not zone-scoped

### /cf/pages — Cloudflare Pages Manager

- List all Pages projects:
  `GET /client/v4/accounts/{account_id}/pages/projects`
- Per project:
  - Project name
  - Connected GitHub repo (if any)
  - Custom domains
  - Latest deployment status + timestamp
  - Deployment status color: building (yellow), success (green),
    failed (red)
- Actions:
  - `D` — Trigger new deployment (polls status every 5s until done)
  - `N` — New project (name + GitHub repo URL)
- **Known limitation:** Initial GitHub repo OAuth connection requires
  a one-time visit to the Cloudflare dashboard. Document this clearly
  in the UI with a helper message and a direct link to the CF Pages
  setup page. Subsequent deployments are fully API-driven.
- After project creation, offer to add a CNAME DNS record pointing
  the domain to `projectname.pages.dev` — shows a pre-filled form
  in a modal, user confirms before any DNS change is made

---

## Placeholder Modules

The following routes must exist and render a clean placeholder view.
The primary sidebar icon must be present and clickable for all of them.
Clicking renders a centered message like "Porkbun module — coming soon"
with the section emoji large, and a subtle note about what it will do.
No dead routes. No crashes. Graceful empty states.

### /domains — Porkbun
Placeholder: "Domain management via Porkbun API — coming soon"
Will eventually list all API-accessible domains, nameservers, renewal
dates and costs.

### /email — Migadu
Placeholder: "Email management via Migadu API — coming soon"
Will eventually provide mailbox, alias, and identity management,
with automatic DNS record provisioning via the CF DNS backend function.

### /apps — Apps Panel
Placeholder: "App management — coming soon"
Will eventually allow restarting apps, pulling git repos, managing
Docker containers running on the server.

### /server — Server Console
Placeholder: "Server console — coming soon"
Will eventually provide a full web terminal (xterm.js + WebSocket),
systemctl service management, system stats (CPU/RAM/disk/uptime),
and a filesystem explorer.

---

## Configuration

On first run, if `~/.config/3c/config.toml` does not exist, the app
should print clear instructions to the terminal and exit gracefully,
telling the user to create the config file with the following structure:

```toml
[cloudflare]
api_token = "your-cf-token"
account_id = "your-account-id"

[porkbun]
api_key = "your-porkbun-api-key"
secret_api_key = "your-porkbun-secret-key"
# Porkbun section is optional — remove if not using
```

Config is loaded once at startup. Never log or expose tokens anywhere.
File must be created manually by the user with `chmod 600`.

---

## Cloudflare API Token Scopes Required

The token needs the following permissions:
- Zone — Read
- Zone Settings — Edit
- DNS — Edit
- Account Analytics — Read
- Cloudflare Pages — Edit
- Account Rulesets — Edit

Set Zone Resources to: All zones

---

## Project Structure

```
├── pyproject.toml
├── README.md
├── static/
│   ├── css/
│   │   └── main.css
│   ├── js/
│   │   ├── app.js        # routing, sidebar logic
│   │   ├── zones.js
│   │   ├── dns.js
│   │   ├── analytics.js
│   │   ├── redirects.js
│   │   └── pages.js
│   └── index.html        # single HTML shell, JS handles routing
├── panel/
│   ├── __main__.py
│   ├── app.py            # FastAPI app, static file serving, API routes
│   ├── config.py         # config loading
│   └── api/
│       ├── cloudflare.py # all CF API calls
│       └── porkbun.py    # Porkbun API calls
```

---

## Code Quality

- Fully async (FastAPI + httpx)
- All API calls wrapped in try/except, return clean JSON error responses
- Frontend handles API errors gracefully — shows inline error messages,
  never blank screens or JS exceptions
- Backend and frontend cleanly separated — FastAPI serves static files
  and exposes a REST API at `/api/*`, frontend calls it via fetch()
- Well commented throughout, especially the `add_dns_records` backend
  function and any Cloudflare GraphQL queries

---

## Running the App

```bash
python3 -m venv venv
source venv/bin/activate
pip install -e .
python -m panel
```

Runs on `0.0.0.0:8000` by default. Intended to be reverse proxied via
nginx and protected by Cloudflare Access.

---

## Environment Setup
The app must be containerized via Docker. Include:
- Dockerfile (Python 3.11 slim base)
- docker-compose.yml exposing port 8000
- config mounted as a volume from ~/.config/3c/config.toml
- README instructions using docker compose up

---

## Out of Scope for V1

- Any authentication code — Cloudflare Access handles this entirely
- Porkbun domain listing UI (backend Porkbun API module should still
  exist for the nameserver update feature)
- Migadu UI (backend `add_dns_records` function should exist and be
  ready to wire up)
- xterm.js terminal
- Docker/service management
- Filesystem explorer
- Real-time analytics (free tier limitation)
- Non-Porkbun registrar integrations (structure for future modules)

---

## Deliverable

A fully working Python + vanilla JS project ready to run on Ubuntu
(Oracle Cloud) with Python 3.11+. Include a `README.md` with:
- Setup instructions
- nginx reverse proxy config snippet
- systemd service file snippet
- Required Cloudflare API token permission scopes
- Porkbun API setup steps
- Note about Cloudflare Access setup
