/* 3C Panel — Apps module (/apps) */

const Apps = {
    apps: [],
    activeTab: 'apps',
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
            <div class="toolbar" style="gap:0;border-bottom:1px solid var(--border);margin-bottom:16px;padding-bottom:0">
                <button class="btn btn-sm tab-btn active" data-tab="apps" style="border-bottom:2px solid var(--accent);margin-bottom:-1px">Apps</button>
                <button class="btn btn-sm tab-btn" data-tab="containers" style="margin-bottom:-1px">Containers</button>
            </div>
            <div id="apps-container"><div class="loading">Loading apps...</div></div>
            <div id="log-panel" class="hidden"></div>`;

        this.load3cStatus();
        await this.loadApps();
        this.bindHeaderEvents();
    },

    async load3cStatus() {
        try {
            const status = await API.get('/api/3c/git-status');
            const bar = document.getElementById('3c-status-bar');
            if (!bar) return;
            const dirty = status.dirty ? ' <span class="text-danger">(dirty)</span>' : '';
            const behind = status.behind > 0 ? ` <span class="text-accent">\u2193 ${status.behind} behind</span>` : '';
            bar.innerHTML = `
                <div class="info-message" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
                    <span>3C Panel: <strong>${escapeHtml(status.branch || '?')}</strong> \u00b7 ${escapeHtml(status.last_commit || '')}${dirty}${behind}</span>
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
            const c = document.getElementById('apps-container');
            if (c) c.innerHTML = `<div class="error-message">Failed to load apps: ${escapeHtml(err.message)}</div>`;
        }
    },

    renderApps() {
        const container = document.getElementById('apps-container');
        if (!container) return;

        if (!this.apps.length) {
            container.innerHTML = '<div class="info-message">No apps registered. Click "+ Add App" to get started.</div>';
            return;
        }

        const cards = this.apps.map(a => {
            const safeName = a.name.replace(/[^a-zA-Z0-9_-]/g, '_');
            const running = a.running;
            const deployed = (a.containers || []).length > 0;
            const statusDot = running
                ? '<span class="badge badge-active">RUNNING</span>'
                : deployed
                    ? '<span class="badge badge-moved">STOPPED</span>'
                    : '<span class="badge badge-free">NOT DEPLOYED</span>';
            const typeBadge = `<span class="badge badge-pending" style="font-size:10px">${(a.type || 'stack').toUpperCase()}</span>`;
            const domain = a.domain
                ? `<div class="meta">Domain: <a href="https://${escapeHtml(a.domain)}" data-external target="_blank">${escapeHtml(a.domain)}</a></div>` : '';
            const repo = a.repo
                ? `<div class="meta">Repo: <a href="${escapeHtml(a.repo)}" data-external target="_blank">${escapeHtml(a.repo.replace('https://github.com/', ''))}</a></div>` : '';
            const containerList = (a.containers || [])
                .map(c => `<span class="mono" style="font-size:10px">${escapeHtml(c.name)} (${c.running ? 'up' : 'down'})</span>`)
                .join(', ');
            const containersHtml = containerList
                ? `<div class="meta" style="margin-top:6px">Containers: ${containerList}</div>` : '';

            return `<div class="project-card" data-app="${escapeHtml(a.name)}">
                <div style="display:flex;justify-content:space-between;align-items:start">
                    <h3>${escapeHtml(a.name)}</h3>
                    <div style="display:flex;gap:4px">${typeBadge} ${statusDot}</div>
                </div>
                ${domain}
                ${repo}
                ${containersHtml}
                <div id="app-msg-${safeName}" class="mt-8"></div>
                <div class="card-actions" style="flex-wrap:wrap">
                    <button class="btn btn-sm btn-accent" data-action="deploy" data-app="${escapeHtml(a.name)}">Deploy</button>
                    <button class="btn btn-sm" data-action="pull-restart" data-app="${escapeHtml(a.name)}">Pull & Restart</button>
                    <button class="btn btn-sm" data-action="restart" data-app="${escapeHtml(a.name)}"${!running ? ' disabled' : ''}>Restart</button>
                    <button class="btn btn-sm" data-action="stop" data-app="${escapeHtml(a.name)}"${!running ? ' disabled' : ''}>Stop</button>
                    <button class="btn btn-sm" data-action="logs" data-app="${escapeHtml(a.name)}">Logs</button>
                    <button class="btn btn-sm btn-danger" data-action="delete" data-app="${escapeHtml(a.name)}">Del</button>
                </div>
            </div>`;
        }).join('');

        container.innerHTML = `<div class="project-cards">${cards}</div>`;

        // Bind action buttons
        container.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const name = btn.dataset.app;
                if (action === 'deploy') this.actionDeploy(name);
                else if (action === 'pull-restart') this.actionPullRestart(name);
                else if (action === 'restart') this.actionRestart(name);
                else if (action === 'stop') this.actionStop(name);
                else if (action === 'logs') this.showLogs(name);
                else if (action === 'delete') this.showDeleteModal(name);
            });
        });
    },

    bindHeaderEvents() {
        document.getElementById('add-app-btn')?.addEventListener('click', () => this.showAddModal());
        document.getElementById('3c-update-btn')?.addEventListener('click', () => this.update3c());

        // Tab switching
        $$('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                $$('.tab-btn').forEach(b => {
                    b.classList.toggle('active', b === btn);
                    b.style.borderBottom = b === btn ? '2px solid var(--accent)' : 'none';
                });
                this.activeTab = btn.dataset.tab;
                if (this.activeTab === 'containers') {
                    this.loadContainers();
                } else {
                    this.loadApps();
                }
            });
        });
    },

    _getAppMsg(name) {
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
        return document.getElementById(`app-msg-${safeName}`);
    },

    // ============================================================
    // App actions
    // ============================================================

    async actionDeploy(name) {
        const msg = this._getAppMsg(name);
        if (msg) msg.innerHTML = '<div class="loading">Deploying (clone \u2192 build \u2192 run)...</div>';

        try {
            const data = await API.post(`/api/apps/${encodeURIComponent(name)}/deploy`);
            const stepsHtml = (data.steps || []).map(s =>
                `<div class="${s.success ? 'text-success' : 'text-danger'}">${s.success ? '\u2705' : '\u274c'} ${escapeHtml(s.step)}: ${escapeHtml(s.message)}</div>`
            ).join('');
            if (msg) msg.innerHTML = `<div class="${data.success ? 'success-message' : 'error-message'}" style="font-size:11px">${stepsHtml}</div>`;
            await this.loadApps();
        } catch (err) {
            if (msg) msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }
    },

    async actionPullRestart(name) {
        const msg = this._getAppMsg(name);
        if (msg) msg.innerHTML = '<div class="loading">Pulling & restarting...</div>';

        try {
            const data = await API.post(`/api/apps/${encodeURIComponent(name)}/pull-restart`);
            const stepsHtml = (data.steps || []).map(s =>
                `<div class="${s.success ? 'text-success' : 'text-danger'}">${s.success ? '\u2705' : '\u274c'} ${escapeHtml(s.step)}: ${escapeHtml(s.message)}</div>`
            ).join('');
            if (msg) msg.innerHTML = `<div class="${data.success ? 'success-message' : 'error-message'}" style="font-size:11px">${stepsHtml}</div>`;
            await this.loadApps();
        } catch (err) {
            if (msg) msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }
    },

    async actionRestart(name) {
        const msg = this._getAppMsg(name);
        if (msg) msg.innerHTML = '<div class="loading">Restarting...</div>';

        try {
            const data = await API.post(`/api/apps/${encodeURIComponent(name)}/restart`);
            if (msg) msg.innerHTML = `<div class="${data.success ? 'success-message' : 'error-message'}">${escapeHtml(data.message)}</div>`;
            await this.loadApps();
        } catch (err) {
            if (msg) msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }
    },

    async actionStop(name) {
        const msg = this._getAppMsg(name);
        if (msg) msg.innerHTML = '<div class="loading">Stopping...</div>';

        try {
            const data = await API.post(`/api/apps/${encodeURIComponent(name)}/stop`);
            if (msg) msg.innerHTML = `<div class="${data.success ? 'success-message' : 'error-message'}">${escapeHtml(data.message)}</div>`;
            await this.loadApps();
        } catch (err) {
            if (msg) msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }
    },

    // ============================================================
    // Containers tab
    // ============================================================

    async loadContainers() {
        const container = document.getElementById('apps-container');
        if (!container) return;
        container.innerHTML = '<div class="loading">Loading containers...</div>';

        try {
            const data = await API.get('/api/containers');
            const all = data.containers || [];
            this.renderContainers(all);
        } catch (err) {
            container.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }
    },

    renderContainers(containers) {
        const container = document.getElementById('apps-container');
        if (!container) return;

        if (!containers.length) {
            container.innerHTML = '<div class="info-message">No containers found.</div>';
            return;
        }

        const groups = { core: [], app: [], other: [] };
        containers.forEach(c => {
            (groups[c.group] || groups.other).push(c);
        });

        let html = '';
        const renderGroup = (label, list) => {
            if (!list.length) return '';
            const rows = list.map(c => {
                const statusBadge = c.running
                    ? '<span class="badge badge-active">RUNNING</span>'
                    : '<span class="badge badge-moved">STOPPED</span>';
                return `<tr>
                    <td><strong>${escapeHtml(c.name)}</strong></td>
                    <td class="mono text-muted" style="font-size:11px">${escapeHtml(c.image)}</td>
                    <td>${statusBadge}</td>
                    <td class="text-muted" style="font-size:11px">${escapeHtml(c.status_text)}</td>
                    <td class="actions">
                        ${c.running
                            ? `<button class="btn btn-sm" data-ct-action="restart" data-ct="${escapeHtml(c.name)}">Restart</button>
                               <button class="btn btn-sm" data-ct-action="stop" data-ct="${escapeHtml(c.name)}">Stop</button>`
                            : `<button class="btn btn-sm btn-accent" data-ct-action="start" data-ct="${escapeHtml(c.name)}">Start</button>`
                        }
                        <button class="btn btn-sm" data-ct-action="logs" data-ct="${escapeHtml(c.name)}">Logs</button>
                    </td>
                </tr>`;
            }).join('');

            return `
                <h3 style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-secondary);margin:16px 0 8px">${label}</h3>
                <table class="data-table">
                    <thead><tr><th>Name</th><th>Image</th><th>Status</th><th>Uptime</th><th>Actions</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>`;
        };

        html += renderGroup('Core Infrastructure', groups.core);
        html += renderGroup('App Containers', groups.app);
        html += renderGroup('Other', groups.other);

        html += '<div id="ct-action-msg" class="mt-12"></div>';

        container.innerHTML = html;

        // Bind container action buttons
        container.querySelectorAll('[data-ct-action]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const action = btn.dataset.ctAction;
                const name = btn.dataset.ct;
                if (action === 'logs') {
                    this.showContainerLogs(name);
                    return;
                }
                const msg = document.getElementById('ct-action-msg');
                if (msg) msg.innerHTML = `<div class="loading">${action}ing ${escapeHtml(name)}...</div>`;
                try {
                    const data = await API.post(`/api/containers/${encodeURIComponent(name)}/${action}`);
                    if (msg) msg.innerHTML = `<div class="${data.success ? 'success-message' : 'error-message'}">${escapeHtml(data.message)}</div>`;
                    await this.loadContainers();
                } catch (err) {
                    if (msg) msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
                }
            });
        });
    },

    showContainerLogs(name) {
        const panel = document.getElementById('log-panel');
        if (!panel) return;
        panel.classList.remove('hidden');
        panel.innerHTML = `
            <div class="log-viewer">
                <div class="log-header">
                    <h3>Logs: ${escapeHtml(name)}</h3>
                    <div>
                        <button class="btn btn-sm" id="log-refresh">Refresh</button>
                        <button class="btn btn-sm" id="log-close">\u00d7 Close</button>
                    </div>
                </div>
                <pre class="log-output" id="log-output"><span class="text-muted">Loading logs...</span></pre>
            </div>`;

        panel.querySelector('#log-close').addEventListener('click', () => {
            panel.classList.add('hidden');
            panel.innerHTML = '';
        });

        const fetchCt = async () => {
            const output = document.getElementById('log-output');
            if (!output) return;
            try {
                const data = await API.get(`/api/containers/${encodeURIComponent(name)}/logs?tail=300`);
                output.textContent = data.logs || 'No logs available.';
                output.scrollTop = output.scrollHeight;
            } catch (err) {
                output.textContent = `Error: ${err.message}`;
            }
        };

        panel.querySelector('#log-refresh').addEventListener('click', fetchCt);
        fetchCt();
    },

    // ============================================================
    // Log viewer (for apps)
    // ============================================================

    async showLogs(name) {
        const panel = document.getElementById('log-panel');
        if (!panel) return;
        panel.classList.remove('hidden');
        panel.innerHTML = `
            <div class="log-viewer">
                <div class="log-header">
                    <h3>Logs: ${escapeHtml(name)}</h3>
                    <div>
                        <button class="btn btn-sm" id="log-refresh">Refresh</button>
                        <button class="btn btn-sm" id="log-close">\u00d7 Close</button>
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
        const output = document.getElementById('log-output');
        if (!output) return;

        try {
            const data = await API.get(`/api/apps/${encodeURIComponent(name)}/logs?tail=300`);
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
                await API.post(`/api/apps/${encodeURIComponent(name)}/delete`);
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
        const msg = document.getElementById('3c-update-msg');
        if (msg) msg.innerHTML = '<span class="loading">Pulling...</span>';

        try {
            const data = await API.post('/api/3c/pull-restart');
            if (msg) {
                if (data.restart_required || data.restart) {
                    msg.innerHTML = '<span class="text-accent">Updated \u2014 restarting panel...</span>';
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
