/* 3C Panel — Apps module (/apps) */

const Apps = {
    apps: [],
    logInterval: null,

    async render() {
        const content = $('#content');
        content.innerHTML = `
            <div class="page-header">
                <h1>Apps</h1>
                <div style="display:flex;gap:8px">
                    <button class="btn" id="3c-update-btn">Update 3C</button>
                    <button class="btn btn-accent" id="add-app-btn">+ Add App</button>
                </div>
            </div>
            <div id="3c-status-bar"></div>
            <div id="apps-container"><div class="loading">Loading apps...</div></div>
            <div id="log-panel" class="hidden"></div>`;

        this.load3cStatus();
        await this.loadApps();
        this.bindHeaderEvents();
    },

    async load3cStatus() {
        try {
            const status = await API.get('/api/3c/git-status');
            const bar = $('#3c-status-bar');
            if (!bar) return;
            const dirty = status.dirty ? ' <span class="text-danger">(dirty)</span>' : '';
            const behind = status.behind > 0 ? ` <span class="text-accent">${status.behind} behind</span>` : '';
            bar.innerHTML = `
                <div class="info-message" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
                    <span>3C: <strong>${escapeHtml(status.branch || '?')}</strong> · ${escapeHtml(status.last_commit || '')}${dirty}${behind}</span>
                    <span id="3c-update-msg"></span>
                </div>`;
        } catch { /* ignore */ }
    },

    async loadApps() {
        try {
            const data = await API.get('/api/apps');
            this.apps = data.apps || [];
            this.renderApps();
        } catch (err) {
            $('#apps-container').innerHTML =
                `<div class="error-message">Failed to load apps: ${escapeHtml(err.message)}</div>`;
        }
    },

    renderApps() {
        if (!this.apps.length) {
            $('#apps-container').innerHTML = `
                <div class="info-message">No apps registered. Click "+ Add App" to get started.</div>`;
            return;
        }

        const cards = this.apps.map(a => {
            const running = a.running;
            const statusDot = running
                ? '<span class="dot dot-success"></span> Running'
                : '<span class="dot dot-failed"></span> Stopped';
            const typeBadge = `<span class="badge badge-free">${a.type}</span>`;
            const enabledBadge = a.enabled
                ? '' : ' <span class="badge badge-pending">disabled</span>';
            const domain = a.domain
                ? `<div class="meta">Domain: <a href="https://${escapeHtml(a.domain)}" data-external target="_blank">${escapeHtml(a.domain)}</a></div>` : '';
            const repo = a.repo
                ? `<div class="meta">Repo: <a href="${escapeHtml(a.repo)}" data-external target="_blank">${escapeHtml(a.repo.replace('https://github.com/', ''))}</a></div>` : '';
            const containers = (a.containers || [])
                .map(c => `<span class="mono" style="font-size:11px">${escapeHtml(c.name)} (${c.running ? 'up' : 'down'})</span>`)
                .join(', ');
            const containersHtml = containers
                ? `<div class="meta mt-12">Containers: ${containers}</div>` : '';

            return `<div class="project-card" data-app="${escapeHtml(a.name)}">
                <div style="display:flex;justify-content:space-between;align-items:start">
                    <h3>${escapeHtml(a.name)}</h3>
                    <div>${typeBadge}${enabledBadge}</div>
                </div>
                <div class="meta deploy-status">${statusDot}</div>
                ${domain}
                ${repo}
                ${containersHtml}
                <div id="app-msg-${escapeHtml(a.name)}"></div>
                <div class="card-actions" style="flex-wrap:wrap">
                    <button class="btn btn-sm btn-accent" data-action="deploy" data-app="${escapeHtml(a.name)}">Deploy</button>
                    <button class="btn btn-sm" data-action="pull-restart" data-app="${escapeHtml(a.name)}">Pull & Restart</button>
                    <button class="btn btn-sm" data-action="stop" data-app="${escapeHtml(a.name)}"${!running ? ' disabled' : ''}>Stop</button>
                    <button class="btn btn-sm" data-action="logs" data-app="${escapeHtml(a.name)}">Logs</button>
                    <button class="btn btn-sm btn-danger" data-action="delete" data-app="${escapeHtml(a.name)}">Delete</button>
                </div>
            </div>`;
        }).join('');

        $('#apps-container').innerHTML = `<div class="project-cards">${cards}</div>`;

        // Bind action buttons
        $$('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const name = btn.dataset.app;
                if (action === 'deploy') this.actionDeploy(name);
                else if (action === 'pull-restart') this.actionPullRestart(name);
                else if (action === 'stop') this.actionStop(name);
                else if (action === 'logs') this.showLogs(name);
                else if (action === 'delete') this.showDeleteModal(name);
            });
        });
    },

    bindHeaderEvents() {
        $('#add-app-btn')?.addEventListener('click', () => this.showAddModal());
        $('#3c-update-btn')?.addEventListener('click', () => this.update3c());
    },

    // ============================================================
    // App actions
    // ============================================================

    async actionDeploy(name) {
        const msg = $(`#app-msg-${CSS.escape(name)}`);
        if (msg) msg.innerHTML = '<div class="loading">Deploying (clone → build → run)...</div>';

        try {
            const data = await API.post(`/api/apps/${name}/deploy`);
            const stepsHtml = data.steps.map(s =>
                `<span class="${s.success ? 'text-success' : 'text-danger'}">${s.step}: ${escapeHtml(s.message)}</span>`
            ).join('<br>');
            if (msg) msg.innerHTML = `<div class="${data.success ? 'success-message' : 'error-message'}">${stepsHtml}</div>`;
            await this.loadApps();
        } catch (err) {
            if (msg) msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }
    },

    async actionPullRestart(name) {
        const msg = $(`#app-msg-${CSS.escape(name)}`);
        if (msg) msg.innerHTML = '<div class="loading">Pulling & restarting...</div>';

        try {
            const data = await API.post(`/api/apps/${name}/pull-restart`);
            const stepsHtml = data.steps.map(s =>
                `<span class="${s.success ? 'text-success' : 'text-danger'}">${s.step}: ${escapeHtml(s.message)}</span>`
            ).join('<br>');
            if (msg) msg.innerHTML = `<div class="${data.success ? 'success-message' : 'error-message'}">${stepsHtml}</div>`;
            await this.loadApps();
        } catch (err) {
            if (msg) msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }
    },

    async actionStop(name) {
        const msg = $(`#app-msg-${CSS.escape(name)}`);
        if (msg) msg.innerHTML = '<div class="loading">Stopping...</div>';

        try {
            const data = await API.post(`/api/apps/${name}/stop`);
            if (msg) msg.innerHTML = `<div class="${data.success ? 'success-message' : 'error-message'}">${escapeHtml(data.message)}</div>`;
            await this.loadApps();
        } catch (err) {
            if (msg) msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }
    },

    // ============================================================
    // Log viewer
    // ============================================================

    async showLogs(name) {
        const panel = $('#log-panel');
        panel.classList.remove('hidden');
        panel.innerHTML = `
            <div class="log-viewer">
                <div class="log-header">
                    <h3>Logs: ${escapeHtml(name)}</h3>
                    <div>
                        <button class="btn btn-sm" id="log-refresh">Refresh</button>
                        <button class="btn btn-sm" id="log-close">&times; Close</button>
                    </div>
                </div>
                <pre class="log-output" id="log-output"><span class="text-muted">Loading logs...</span></pre>
            </div>`;

        panel.querySelector('#log-close').addEventListener('click', () => {
            panel.classList.add('hidden');
            panel.innerHTML = '';
            if (this.logInterval) { clearInterval(this.logInterval); this.logInterval = null; }
        });

        panel.querySelector('#log-refresh').addEventListener('click', () => this.fetchLogs(name));
        await this.fetchLogs(name);
    },

    async fetchLogs(name) {
        const output = $('#log-output');
        if (!output) return;

        try {
            const data = await API.get(`/api/apps/${name}/logs?tail=300`);
            output.textContent = data.logs || 'No logs available.';
            output.scrollTop = output.scrollHeight;
        } catch (err) {
            output.textContent = `Error: ${err.message}`;
        }
    },

    // ============================================================
    // Add app modal
    // ============================================================

    showAddModal() {
        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>Add App</h2>
            <div class="form-group">
                <label>Name</label>
                <input type="text" class="form-input" id="app-name" placeholder="my-app">
            </div>
            <div class="form-group">
                <label>Type</label>
                <select class="form-select" id="app-type">
                    <option value="stack">stack — has docker-compose.yml</option>
                    <option value="web">web — single container, HTTP routed</option>
                    <option value="worker">worker — background, no routing</option>
                </select>
            </div>
            <div class="form-group">
                <label>Git Repo URL</label>
                <input type="text" class="form-input" id="app-repo" placeholder="https://github.com/user/repo">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Branch</label>
                    <input type="text" class="form-input" id="app-branch" value="main">
                </div>
                <div class="form-group">
                    <label>Port</label>
                    <input type="number" class="form-input" id="app-port" value="8000">
                </div>
            </div>
            <div class="form-group">
                <label>Domain (optional)</label>
                <input type="text" class="form-input" id="app-domain" placeholder="app.example.com">
            </div>
            <div id="add-app-msg"></div>
            <div class="btn-row">
                <button class="btn" onclick="closeModal()">Cancel</button>
                <button class="btn btn-accent" id="add-app-submit">Add</button>
            </div>`);

        overlay.querySelector('#add-app-submit').addEventListener('click', async () => {
            const name = overlay.querySelector('#app-name').value.trim();
            const type = overlay.querySelector('#app-type').value;
            const repo = overlay.querySelector('#app-repo').value.trim();
            const branch = overlay.querySelector('#app-branch').value.trim() || 'main';
            const port = parseInt(overlay.querySelector('#app-port').value) || 8000;
            const domain = overlay.querySelector('#app-domain').value.trim() || null;
            const msg = overlay.querySelector('#add-app-msg');

            if (!name) {
                msg.innerHTML = '<div class="error-message">Name is required</div>';
                return;
            }

            msg.innerHTML = '<div class="loading">Adding app...</div>';

            try {
                await API.post('/api/apps/registry/add', {
                    name, type, repo: repo || null, branch, port, domain,
                });
                closeModal();
                await this.loadApps();
            } catch (err) {
                msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
            }
        });
    },

    // ============================================================
    // Delete modal
    // ============================================================

    showDeleteModal(name) {
        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>Delete App</h2>
            <p>This will stop all containers, remove them, and delete the app directory for <strong>${escapeHtml(name)}</strong>.</p>
            <div id="del-app-msg"></div>
            <div class="btn-row">
                <button class="btn" onclick="closeModal()">Cancel</button>
                <button class="btn btn-danger" id="del-app-confirm">Delete</button>
            </div>`);

        overlay.querySelector('#del-app-confirm').addEventListener('click', async () => {
            const msg = overlay.querySelector('#del-app-msg');
            msg.innerHTML = '<div class="loading">Deleting...</div>';

            try {
                await API.post(`/api/apps/${name}/delete`);
                closeModal();
                await this.loadApps();
            } catch (err) {
                msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
            }
        });
    },

    // ============================================================
    // 3C self-update
    // ============================================================

    async update3c() {
        const msg = $('#3c-update-msg');
        if (msg) msg.innerHTML = '<span class="loading">Pulling...</span>';

        try {
            const data = await API.post('/api/3c/pull-restart');
            if (msg) {
                if (data.restart_required) {
                    msg.innerHTML = '<span class="text-accent">Updated — restarting panel...</span>';
                } else if (data.message === 'Already up to date') {
                    msg.innerHTML = '<span class="text-muted">Already up to date</span>';
                } else {
                    msg.innerHTML = '<span class="text-success">Updated (no restart needed)</span>';
                }
            }
            // Refresh status bar
            setTimeout(() => this.load3cStatus(), 3000);
        } catch (err) {
            if (msg) msg.innerHTML = `<span class="text-danger">${escapeHtml(err.message)}</span>`;
        }
    },
};

Router.register('/apps', () => Apps.render());
