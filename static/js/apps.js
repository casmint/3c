/* 3C Panel — Apps module (/apps): unified core/shared/app dashboard */

const Apps = {
    data: { core: [], shared: [], apps: [], other: [] },
    stats: {},

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
            <div id="svc-msg"></div>
            <div id="apps-root"><div class="loading">Loading...</div></div>
            <div id="log-panel" class="hidden"></div>`;

        this.load3cStatus();
        this.bindHeaderEvents();
        await this.loadAll();
        this.loadStats();
    },

    async load3cStatus() {
        try {
            const status = await API.get('/api/3c/git-status');
            const bar = document.getElementById('3c-status-bar');
            if (!bar) return;
            const dirty = status.dirty ? ' <span class="text-danger">(dirty)</span>' : '';
            const behind = status.behind > 0 ? ` <span class="text-accent">↓ ${status.behind} behind</span>` : '';
            bar.innerHTML = `
                <div class="info-message" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
                    <span>3C Panel: <strong>${escapeHtml(status.branch || '?')}</strong> · ${escapeHtml(status.last_commit || '')}${dirty}${behind}</span>
                    <span id="3c-update-msg"></span>
                </div>`;
        } catch { /* ignore */ }
    },

    bindHeaderEvents() {
        document.getElementById('add-app-btn')?.addEventListener('click', () => this.showAddModal());
        document.getElementById('3c-update-btn')?.addEventListener('click', () => this.update3c());
    },

    // ============================================================
    // Load + render
    // ============================================================

    async loadAll() {
        const root = document.getElementById('apps-root');
        try {
            this.data = await API.get('/api/apps');
            this.renderAll();
        } catch (err) {
            if (root) root.innerHTML = `<div class="error-message">Failed to load: ${escapeHtml(err.message)}</div>`;
        }
    },

    async loadStats() {
        try {
            const data = await API.get('/api/stats');
            this.stats = data.stats || {};
            this.applyStats();
        } catch { /* live stats are a nice-to-have; ignore failures */ }
    },

    applyStats() {
        document.querySelectorAll('[data-stats-for]').forEach(el => {
            const s = this.stats[el.dataset.statsFor];
            el.innerHTML = s
                ? `${escapeHtml(s.mem_usage)} <span class="text-muted">(${escapeHtml(s.mem_pct)})</span> · ${escapeHtml(s.cpu_pct)} CPU`
                : '<span class="text-muted">—</span>';
        });
    },

    renderAll() {
        const root = document.getElementById('apps-root');
        if (!root) return;

        const apps = this.data.apps || [];
        const appsHtml = apps.length
            ? `<div class="app-list">${apps.map(a => this.renderAppRow(a)).join('')}</div>`
            : '<div class="info-message">No apps in apps/. Click "+ Add App" to clone one.</div>';

        root.innerHTML = `
            ${this.renderServiceSection('Core Infrastructure', this.data.core)}
            ${this.renderServiceSection('Shared Services', this.data.shared)}
            <h2 class="section-title">Apps</h2>
            ${appsHtml}
            ${this.data.other && this.data.other.length ? this.renderServiceSection('Other Containers', this.data.other) : ''}
        `;

        this.bindServiceActions();
        this.bindAppActions();
        this.applyStats();
    },

    // ============================================================
    // Core / Shared / Other — compact table
    // ============================================================

    renderServiceSection(title, list) {
        if (!list || !list.length) return '';
        const rows = list.map(c => {
            const badge = c.running
                ? '<span class="badge badge-active">RUNNING</span>'
                : '<span class="badge badge-moved">STOPPED</span>';
            const actions = c.running
                ? `<button class="btn btn-sm" data-svc-action="restart" data-svc="${escapeHtml(c.name)}">Restart</button>
                   <button class="btn btn-sm" data-svc-action="stop" data-svc="${escapeHtml(c.name)}">Stop</button>`
                : `<button class="btn btn-sm btn-accent" data-svc-action="start" data-svc="${escapeHtml(c.name)}">Start</button>`;
            return `<tr>
                <td><strong>${escapeHtml(c.name)}</strong></td>
                <td class="mono text-muted" style="font-size:11px">${escapeHtml(c.image)}</td>
                <td>${badge}</td>
                <td class="text-muted" style="font-size:11px">${escapeHtml(c.status_text)}</td>
                <td class="mono text-muted" style="font-size:11px" data-stats-for="${escapeHtml(c.name)}">&hellip;</td>
                <td class="actions">
                    ${actions}
                    <button class="btn btn-sm" data-svc-action="logs" data-svc="${escapeHtml(c.name)}">Logs</button>
                </td>
            </tr>`;
        }).join('');

        return `
            <h2 class="section-title">${escapeHtml(title)}</h2>
            <table class="data-table" style="margin-bottom:24px">
                <thead><tr><th>Name</th><th>Image</th><th>Status</th><th>Uptime</th><th>Resources</th><th>Actions</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    },

    bindServiceActions() {
        document.querySelectorAll('[data-svc-action]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const action = btn.dataset.svcAction;
                const name = btn.dataset.svc;
                if (action === 'logs') { this.showLogs(name, `/api/containers/${encodeURIComponent(name)}/logs`); return; }

                const msg = document.getElementById('svc-msg');
                if (msg) msg.innerHTML = `<div class="loading">${action}ing ${escapeHtml(name)}...</div>`;
                try {
                    const data = await API.post(`/api/containers/${encodeURIComponent(name)}/${action}`);
                    if (msg) msg.innerHTML = `<div class="${data.success ? 'success-message' : 'error-message'}">${escapeHtml(data.message)}</div>`;
                    await this.loadAll();
                    this.loadStats();
                } catch (err) {
                    if (msg) msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
                }
            });
        });
    },

    // ============================================================
    // Apps — rich cards
    // ============================================================

    _statusBadge(status) {
        return {
            running: '<span class="badge badge-active">RUNNING</span>',
            partial: '<span class="badge badge-pending">PARTIAL</span>',
            stopped: '<span class="badge badge-moved">STOPPED</span>',
            not_deployed: '<span class="badge badge-free">NOT DEPLOYED</span>',
        }[status] || '';
    },

    _renderGit(git) {
        if (!git || !git.is_repo) return '';
        const dirty = git.dirty ? ' <span class="text-danger">(dirty)</span>' : '';
        const ahead = git.ahead > 0 ? ` <span class="text-accent">↑${git.ahead}</span>` : '';
        const behind = git.behind > 0 ? ` <span class="text-accent">↓${git.behind}</span>` : '';
        return `<div class="app-row-git">${escapeHtml(git.branch || '?')} · ${escapeHtml(git.last_commit || '')}${dirty}${ahead}${behind}</div>`;
    },

    _renderContainers(containers) {
        if (!containers.length) return '<div class="app-row-git text-muted">Not deployed yet</div>';
        return `<div class="app-row-containers">${containers.map(c => `
            <div class="app-row-container">
                <span class="mono">${escapeHtml(c.name)}</span>
                <span class="mono text-muted">${escapeHtml(c.image)}</span>
                ${c.running ? '<span class="badge badge-active">UP</span>' : '<span class="badge badge-moved">DOWN</span>'}
                <span class="mono text-muted" data-stats-for="${escapeHtml(c.name)}">&hellip;</span>
            </div>`).join('')}</div>`;
    },

    renderAppRow(a) {
        const safeName = a.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const domain = a.domain
            ? `Domain: <a href="https://${escapeHtml(a.domain)}" data-external target="_blank">${escapeHtml(a.domain)}</a>${a.port ? ` <span class="text-muted">:${escapeHtml(a.port)}</span>` : ''}`
            : '<span class="text-muted">No domain routed</span>';
        const ollamaTag = a.uses_ollama ? ' <span class="badge badge-neutral" style="font-size:9px">uses ollama</span>' : '';

        const running = a.running;
        const startOrRestart = running
            ? `<button class="btn btn-sm" data-app-action="restart" data-app="${escapeHtml(a.name)}">Restart</button>
               <button class="btn btn-sm" data-app-action="stop" data-app="${escapeHtml(a.name)}">Stop</button>`
            : `<button class="btn btn-sm" data-app-action="start" data-app="${escapeHtml(a.name)}"${a.status === 'not_deployed' ? ' disabled title="Deploy first"' : ''}>Start</button>`;

        return `<div class="app-row" data-app="${escapeHtml(a.name)}">
            <div class="app-row-top">
                <div class="app-row-title">
                    <h3>${escapeHtml(a.name)}</h3>
                    ${this._statusBadge(a.status)}${ollamaTag}
                </div>
                <div class="app-row-domain">${domain}</div>
                <div class="app-row-actions">
                    <button class="btn btn-sm btn-accent" data-app-action="deploy" data-app="${escapeHtml(a.name)}">Deploy</button>
                    <button class="btn btn-sm" data-app-action="pull-restart" data-app="${escapeHtml(a.name)}">Pull & Rebuild</button>
                    ${startOrRestart}
                    <button class="btn btn-sm" data-app-action="logs" data-app="${escapeHtml(a.name)}">Logs</button>
                    <button class="btn btn-sm btn-danger" data-app-action="delete" data-app="${escapeHtml(a.name)}">Delete</button>
                </div>
            </div>
            ${this._renderGit(a.git)}
            ${this._renderContainers(a.containers)}
            <div id="app-msg-${safeName}" class="mt-8"></div>
        </div>`;
    },

    _getAppMsg(name) {
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
        return document.getElementById(`app-msg-${safeName}`);
    },

    bindAppActions() {
        document.querySelectorAll('[data-app-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.appAction;
                const name = btn.dataset.app;
                if (action === 'deploy') this.actionSimple(name, 'deploy');
                else if (action === 'start') this.actionSimple(name, 'start');
                else if (action === 'stop') this.actionSimple(name, 'stop');
                else if (action === 'restart') this.actionSimple(name, 'restart');
                else if (action === 'pull-restart') this.actionPullRestart(name);
                else if (action === 'logs') this.showLogs(name, `/api/apps/${encodeURIComponent(name)}/logs`);
                else if (action === 'delete') this.showDeleteModal(name);
            });
        });
    },

    async actionSimple(name, action) {
        const msg = this._getAppMsg(name);
        if (msg) msg.innerHTML = `<div class="loading">${action}ing...</div>`;
        try {
            const data = await API.post(`/api/apps/${encodeURIComponent(name)}/${action}`);
            if (msg) msg.innerHTML = `<div class="${data.success ? 'success-message' : 'error-message'}">${escapeHtml(data.message)}</div>`;
            await this.loadAll();
            this.loadStats();
        } catch (err) {
            if (msg) msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }
    },

    async actionPullRestart(name) {
        const msg = this._getAppMsg(name);
        if (msg) msg.innerHTML = '<div class="loading">Pulling & rebuilding...</div>';
        try {
            const data = await API.post(`/api/apps/${encodeURIComponent(name)}/pull-restart`);
            const stepsHtml = (data.steps || []).map(s =>
                `<div class="${s.success ? 'text-success' : 'text-danger'}">${s.success ? '✅' : '❌'} ${escapeHtml(s.step)}: ${escapeHtml(s.message)}</div>`
            ).join('');
            if (msg) msg.innerHTML = `<div class="${data.success ? 'success-message' : 'error-message'}" style="font-size:11px">${stepsHtml}</div>`;
            await this.loadAll();
            this.loadStats();
        } catch (err) {
            if (msg) msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }
    },

    // ============================================================
    // Log viewer (shared by apps + core/shared containers)
    // ============================================================

    showLogs(name, url) {
        const panel = document.getElementById('log-panel');
        if (!panel) return;
        panel.classList.remove('hidden');
        panel.innerHTML = `
            <div class="log-viewer">
                <div class="log-header">
                    <h3>Logs: ${escapeHtml(name)}</h3>
                    <div>
                        <button class="btn btn-sm" id="log-refresh">Refresh</button>
                        <button class="btn btn-sm" id="log-close">× Close</button>
                    </div>
                </div>
                <pre class="log-output" id="log-output"><span class="text-muted">Loading logs...</span></pre>
            </div>`;

        panel.querySelector('#log-close').addEventListener('click', () => {
            panel.classList.add('hidden');
            panel.innerHTML = '';
        });

        const fetchLogs = async () => {
            const output = document.getElementById('log-output');
            if (!output) return;
            try {
                const data = await API.get(`${url}?tail=300`);
                output.textContent = data.logs || 'No logs available.';
                output.scrollTop = output.scrollHeight;
            } catch (err) {
                output.textContent = `Error: ${err.message}`;
            }
        };

        panel.querySelector('#log-refresh').addEventListener('click', fetchLogs);
        fetchLogs();
    },

    // ============================================================
    // Add app modal
    // ============================================================

    showAddModal() {
        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>Add App</h2>
            <p class="text-muted" style="font-size:12px;margin-bottom:12px">
                Clones a git repo into apps/{name}. The repo must already have its own
                docker-compose.yml (see docs/adding-an-app.md) — domain, port, and routing
                are read from that file, not entered here.
            </p>
            <div class="form-group">
                <label>Name</label>
                <input type="text" class="form-input" id="app-name" placeholder="my-app">
            </div>
            <div class="form-group">
                <label>Git Repo URL</label>
                <input type="text" class="form-input" id="app-repo" placeholder="https://github.com/user/repo">
            </div>
            <div class="form-group">
                <label>Branch</label>
                <input type="text" class="form-input" id="app-branch" value="main">
            </div>
            <div id="add-app-msg"></div>
            <div class="btn-row">
                <button class="btn" onclick="closeModal()">Cancel</button>
                <button class="btn btn-accent" id="add-app-submit">Clone</button>
            </div>`);

        overlay.querySelector('#add-app-submit').addEventListener('click', async () => {
            const name = overlay.querySelector('#app-name').value.trim();
            const repo = overlay.querySelector('#app-repo').value.trim();
            const branch = overlay.querySelector('#app-branch').value.trim() || 'main';
            const msg = overlay.querySelector('#add-app-msg');

            if (!name || !repo) {
                msg.innerHTML = '<div class="error-message">Name and repo are required</div>';
                return;
            }

            msg.innerHTML = '<div class="loading">Cloning...</div>';
            try {
                const data = await API.post('/api/apps', { name, repo, branch });
                if (!data.success) {
                    msg.innerHTML = `<div class="error-message">${escapeHtml(data.message)}</div>`;
                    return;
                }
                closeModal();
                await this.loadAll();
                this.loadStats();
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
                await API.post(`/api/apps/${encodeURIComponent(name)}/delete`);
                closeModal();
                await this.loadAll();
            } catch (err) {
                msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
            }
        });
    },

    // ============================================================
    // 3C self-update
    // ============================================================

    async update3c() {
        const msg = document.getElementById('3c-update-msg');
        if (msg) msg.innerHTML = '<span class="loading">Pulling...</span>';

        try {
            const data = await API.post('/api/3c/pull-restart');
            if (msg) {
                if (data.restart_required || data.restart) {
                    msg.innerHTML = '<span class="text-accent">Updated — restarting panel...</span>';
                    setTimeout(() => location.reload(), 5000);
                } else if (data.message === 'Already up to date') {
                    msg.innerHTML = '<span class="text-muted">Already up to date</span>';
                } else {
                    msg.innerHTML = '<span class="text-success">Updated (no restart needed)</span>';
                }
            }
            setTimeout(() => this.load3cStatus(), 3000);
        } catch (err) {
            if (msg) msg.innerHTML = `<span class="text-danger">${escapeHtml(err.message)}</span>`;
        }
    },
};

Router.register('/apps', () => Apps.render());
