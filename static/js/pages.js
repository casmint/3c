/* 3C Panel — Cloudflare Pages manager (/cf/pages) */

const Pages = {
    projects: [],
    notes: {},
    pollingTimers: {},
    sortBy: 'updated',
    perPage: 15,
    currentPage: 1,
    cfAccountId: null,

    async render() {
        const content = $('#content');
        content.innerHTML = `
            <div class="page-header">
                <h1>Pages</h1>
                <a href="#" id="new-project-link" target="_blank" rel="noopener" class="btn btn-accent">New Project ↗</a>
            </div>
            <div class="notice">
                <strong>Note:</strong> Initial GitHub repository connection requires a one-time visit to the Cloudflare dashboard.
                <a href="https://dash.cloudflare.com/?to=/:account/pages" data-external target="_blank">Open CF Pages Setup &rarr;</a><br>
                Subsequent deployments are fully API-driven.
            </div>
            <div class="toolbar" style="margin-bottom:12px">
                <input type="text" class="search-input" id="pages-search" placeholder="Search projects...">
                <select class="form-select" id="pages-sort" style="width:180px">
                    <option value="updated">Last deployed</option>
                    <option value="name">Name A-Z</option>
                    <option value="created">Date created</option>
                </select>
            </div>
            <div id="pages-container"><div class="loading">Loading Pages projects...</div></div>`;

        // Fetch account ID for the "New Project" link
        API.get('/api/cf/account-id').then(data => {
            this.cfAccountId = data.account_id;
            const link = $('#new-project-link');
            if (link && this.cfAccountId) {
                link.href = `https://dash.cloudflare.com/${this.cfAccountId}/workers-and-pages/create/pages`;
            }
        }).catch(() => {});

        // Load notes and projects in parallel
        const [, ] = await Promise.all([
            this.loadNotes(),
            this.loadProjects(),
        ]);

        $('#pages-sort')?.addEventListener('change', (e) => {
            this.sortBy = e.target.value;
            this.currentPage = 1;
            this.renderProjects();
        });

        $('#pages-search')?.addEventListener('input', () => {
            this.currentPage = 1;
            this.renderProjects();
        });
    },

    async loadNotes() {
        try {
            this.notes = await API.get('/api/notes/pages');
        } catch { this.notes = {}; }
    },

    async loadProjects() {
        try {
            const data = await API.get('/api/cf/pages/projects');
            this.projects = data.result || [];
            this.renderProjects();
        } catch (err) {
            const c = $('#pages-container');
            if (c) c.innerHTML = `<div class="error-message">Failed to load projects: ${escapeHtml(err.message)}</div>`;
        }
    },

    getSorted() {
        const query = ($('#pages-search')?.value || '').toLowerCase().trim();
        let filtered = this.projects;
        if (query) {
            filtered = filtered.filter(p =>
                p.name.toLowerCase().includes(query) ||
                (p.subdomain || '').toLowerCase().includes(query) ||
                (p.domains || []).some(d => d.toLowerCase().includes(query)) ||
                (p.source?.config?.repo_name || '').toLowerCase().includes(query) ||
                (this.notes[p.name] || '').toLowerCase().includes(query)
            );
        }

        const sorted = [...filtered];
        if (this.sortBy === 'name') {
            sorted.sort((a, b) => a.name.localeCompare(b.name));
        } else if (this.sortBy === 'created') {
            sorted.sort((a, b) => new Date(b.created_on || 0) - new Date(a.created_on || 0));
        } else {
            sorted.sort((a, b) => {
                const aDate = a.latest_deployment?.created_on || a.created_on || '';
                const bDate = b.latest_deployment?.created_on || b.created_on || '';
                return new Date(bDate) - new Date(aDate);
            });
        }
        return sorted;
    },

    renderProjects() {
        const container = $('#pages-container');
        if (!container) return;

        const sorted = this.getSorted();
        if (!sorted.length) {
            container.innerHTML = this.projects.length
                ? '<div class="info-message">No projects match your search.</div>'
                : '<div class="info-message">No Pages projects found.</div>';
            return;
        }

        const totalPages = Math.ceil(sorted.length / this.perPage);
        if (this.currentPage > totalPages) this.currentPage = totalPages;
        const start = (this.currentPage - 1) * this.perPage;
        const page = sorted.slice(start, start + this.perPage);

        const rows = page.map(p => this.renderRow(p)).join('');
        const paginationHtml = totalPages > 1 ? this.renderPagination(totalPages) : '';

        container.innerHTML = `
            <div class="text-muted" style="font-size:11px;margin-bottom:8px">${sorted.length} project${sorted.length !== 1 ? 's' : ''}</div>
            <div class="pages-list">${rows}</div>
            ${paginationHtml}`;

        // Bind deploy buttons
        $$('[data-deploy]').forEach(btn => {
            btn.addEventListener('click', () => this.triggerDeploy(btn.dataset.deploy));
        });

        // Bind note edit buttons
        $$('[data-edit-note]').forEach(btn => {
            btn.addEventListener('click', () => this.editNote(btn.dataset.editNote));
        });

        // Bind project name links (detail view)
        $$('[data-project-detail]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                Router.navigate(`/cf/pages/${link.dataset.projectDetail}`);
            });
        });

        // Bind pagination
        $$('[data-pages-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentPage = parseInt(btn.dataset.pagesPage);
                this.renderProjects();
            });
        });
    },

    renderRow(p) {
        const latest = p.latest_deployment;
        const subdomain = p.subdomain || `${p.name}.pages.dev`;
        const repo = p.source?.config?.repo_name || '';
        const owner = p.source?.config?.owner || '';
        const githubUrl = repo && owner ? `https://github.com/${owner}/${repo}` : (repo ? `https://github.com/${repo}` : '');

        // Custom domains: filter out the default .pages.dev
        const customDomains = (p.domains || []).filter(d => !d.endsWith('.pages.dev'));

        // Deploy status
        let statusDot = '', statusText = '', timeText = '';
        if (latest) {
            const stage = latest.latest_stage || {};
            const status = stage.status || 'unknown';
            statusDot = status === 'success' ? 'dot-success'
                : status === 'active' ? 'dot-building'
                : status === 'failure' ? 'dot-failed' : '';
            statusText = stage.name || status;
            timeText = latest.created_on ? this.timeAgo(latest.created_on) : '';
        }

        // Commit info with date
        let commitHtml = '';
        if (latest?.deployment_trigger?.metadata) {
            const meta = latest.deployment_trigger.metadata;
            const msg = meta.commit_message || '';
            const branch = meta.branch || '';
            const commitDate = latest.created_on ? this.formatShortDate(latest.created_on) : '';
            const parts = [];
            if (branch) parts.push(`<span class="mono">${escapeHtml(branch)}</span>`);
            if (commitDate) parts.push(commitDate);
            if (msg) parts.push(escapeHtml(msg.substring(0, 60)) + (msg.length > 60 ? '...' : ''));
            if (parts.length) {
                commitHtml = `<span class="text-muted" style="font-size:11px">${parts.join(' — ')}</span>`;
            }
        }

        // Repo link
        const repoHtml = repo
            ? `<span style="font-size:11px">Repo: <a href="${escapeHtml(githubUrl)}" target="_blank" rel="noopener" style="color:var(--accent)">${escapeHtml(repo)}</a></span>`
            : '';

        // Custom domains
        let domainsHtml = '';
        if (customDomains.length) {
            const domLinks = customDomains.map(d =>
                `<a href="https://${escapeHtml(d)}" target="_blank" rel="noopener" style="color:var(--accent)">${escapeHtml(d)}</a>`
            ).join(', ');
            domainsHtml = `<span class="text-muted" style="font-size:11px;margin-left:12px">Domains: ${domLinks}</span>`;
        }

        // Note
        const note = this.notes[p.name] || '';
        const noteHtml = note
            ? `<span class="pages-note" title="${escapeHtml(note)}">${escapeHtml(note.length > 30 ? note.substring(0, 30) + '...' : note)}</span>`
            : '';

        return `
            <div class="pages-row">
                <div class="pages-row-main">
                    <div class="pages-row-info">
                        <div class="pages-row-title">
                            <a href="/cf/pages/${encodeURIComponent(p.name)}" data-project-detail="${escapeHtml(p.name)}" style="color:var(--text);font-weight:600;text-decoration:none">${escapeHtml(p.name)}</a>
                            <a href="https://${escapeHtml(subdomain)}" data-external target="_blank" class="text-muted mono" style="font-size:11px;margin-left:8px">${escapeHtml(subdomain)}</a>
                        </div>
                        <div class="pages-row-meta">
                            ${repoHtml}
                            ${domainsHtml}
                        </div>
                        ${commitHtml ? `<div style="margin-top:2px">${commitHtml}</div>` : ''}
                    </div>
                    <div class="pages-row-right">
                        ${noteHtml}
                        <button class="btn btn-sm" data-edit-note="${escapeHtml(p.name)}" title="Edit note" style="font-size:10px;padding:2px 6px">✏</button>
                        ${latest ? `
                            <div class="pages-row-status">
                                <span class="dot ${statusDot}"></span>
                                <span style="font-size:11px">${escapeHtml(statusText)}</span>
                                <span class="text-muted" style="font-size:11px;margin-left:4px">${timeText}</span>
                            </div>
                        ` : '<span class="text-muted" style="font-size:11px">No deployments</span>'}
                        <button class="btn btn-sm btn-accent" data-deploy="${escapeHtml(p.name)}">Deploy</button>
                    </div>
                </div>
                <div id="deploy-status-${escapeHtml(p.name)}"></div>
            </div>`;
    },

    renderPagination(totalPages) {
        const pages = [];
        for (let i = 1; i <= totalPages; i++) {
            const cls = i === this.currentPage ? 'btn btn-sm btn-accent' : 'btn btn-sm';
            pages.push(`<button class="${cls}" data-pages-page="${i}">${i}</button>`);
        }
        return `<div style="display:flex;gap:4px;justify-content:center;margin-top:16px">${pages.join('')}</div>`;
    },

    timeAgo(dateStr) {
        const now = Date.now();
        const then = new Date(dateStr).getTime();
        const diff = now - then;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 30) return `${days}d ago`;
        const months = Math.floor(days / 30);
        return `${months}mo ago`;
    },

    formatShortDate(dateStr) {
        const d = new Date(dateStr);
        const yy = String(d.getFullYear()).slice(2);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return `${yy}/${mm}/${dd} ${hh}:${mi}`;
    },

    editNote(projectName) {
        const current = this.notes[projectName] || '';
        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>Note: ${escapeHtml(projectName)}</h2>
            <div class="form-group">
                <label>Custom note <span class="text-muted" style="font-size:10px;font-weight:normal">(Enter to save)</span></label>
                <input type="text" class="form-input" id="note-input" placeholder="What does this project do?" value="${escapeHtml(current)}">
            </div>
            <div id="note-msg"></div>
            <div class="btn-row">
                ${current ? '<button class="btn btn-danger" id="note-del">Remove</button>' : ''}
                <button class="btn btn-accent" id="note-save">Save</button>
            </div>`);

        const saveNote = async () => {
            const val = overlay.querySelector('#note-input').value.trim();
            const msg = overlay.querySelector('#note-msg');
            try {
                await API.put(`/api/notes/pages/${encodeURIComponent(projectName)}`, { note: val });
                this.notes[projectName] = val;
                closeModal();
                this.renderProjects();
            } catch (e) {
                msg.innerHTML = `<div class="error-message">${escapeHtml(e.message)}</div>`;
            }
        };

        overlay.querySelector('#note-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); saveNote(); }
        });

        overlay.querySelector('#note-save').addEventListener('click', saveNote);

        overlay.querySelector('#note-del')?.addEventListener('click', async () => {
            try {
                await API.del(`/api/notes/pages/${encodeURIComponent(projectName)}`);
                delete this.notes[projectName];
                closeModal();
                this.renderProjects();
            } catch (e) {
                overlay.querySelector('#note-msg').innerHTML = `<div class="error-message">${escapeHtml(e.message)}</div>`;
            }
        });
    },

    // ------------------------------------------------------------------
    // Project detail view
    // ------------------------------------------------------------------

    async renderDetail(match) {
        const projectName = decodeURIComponent(match[1]);
        const content = $('#content');
        content.innerHTML = `
            <div class="page-header">
                <div style="display:flex;align-items:center;gap:12px">
                    <a href="/cf/pages" class="btn btn-sm">← Back</a>
                    <h1>${escapeHtml(projectName)}</h1>
                </div>
            </div>
            <div id="project-detail"><div class="loading">Loading project...</div></div>`;

        try {
            const data = await API.get('/api/cf/pages/projects');
            const project = (data.result || []).find(p => p.name === projectName);
            if (!project) {
                $('#project-detail').innerHTML = '<div class="error-message">Project not found.</div>';
                return;
            }
            this.renderDetailContent(project);
        } catch (err) {
            $('#project-detail').innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }
    },

    renderDetailContent(p) {
        const container = $('#project-detail');
        if (!container) return;

        const subdomain = p.subdomain || `${p.name}.pages.dev`;
        const repo = p.source?.config?.repo_name || '';
        const owner = p.source?.config?.owner || '';
        const githubUrl = repo && owner ? `https://github.com/${owner}/${repo}` : '';
        const customDomains = (p.domains || []).filter(d => !d.endsWith('.pages.dev'));
        const allDomains = p.domains || [];
        const latest = p.latest_deployment;

        // Recent deployments
        let deploymentsHtml = '<div class="info-message">No deployments yet.</div>';
        if (latest) {
            const stage = latest.latest_stage || {};
            const status = stage.status || 'unknown';
            const dotClass = status === 'success' ? 'dot-success' : status === 'failure' ? 'dot-failed' : 'dot-building';
            deploymentsHtml = `
                <div style="padding:10px 0;border-bottom:1px solid var(--border)">
                    <span class="dot ${dotClass}"></span>
                    <strong>${escapeHtml(stage.name || status)}</strong>
                    <span class="text-muted" style="margin-left:8px">${latest.created_on ? this.formatShortDate(latest.created_on) : ''}</span>
                    ${latest.deployment_trigger?.metadata?.commit_message ? `<span class="text-muted" style="margin-left:8px;font-size:11px">${escapeHtml(latest.deployment_trigger.metadata.commit_message.substring(0, 80))}</span>` : ''}
                </div>`;
        }

        container.innerHTML = `
            <table class="data-table" style="margin-bottom:24px">
                <tbody>
                    <tr><td style="width:160px"><strong>Subdomain</strong></td><td><a href="https://${escapeHtml(subdomain)}" target="_blank" rel="noopener">${escapeHtml(subdomain)}</a></td></tr>
                    ${githubUrl ? `<tr><td><strong>Repository</strong></td><td><a href="${escapeHtml(githubUrl)}" target="_blank" rel="noopener" style="color:var(--accent)">${escapeHtml(owner)}/${escapeHtml(repo)}</a></td></tr>` : ''}
                    <tr><td><strong>Branch</strong></td><td>${escapeHtml(p.production_branch || 'main')}</td></tr>
                    <tr><td><strong>Created</strong></td><td>${p.created_on ? new Date(p.created_on).toLocaleString() : '—'}</td></tr>
                </tbody>
            </table>

            <h3 style="font-size:14px;margin-bottom:10px">Custom Domains</h3>
            <div id="domains-section" style="margin-bottom:24px">
                ${allDomains.length ? allDomains.map(d => {
                    const isDefault = d.endsWith('.pages.dev');
                    return `<div style="padding:6px 0;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border)">
                        <a href="https://${escapeHtml(d)}" target="_blank" rel="noopener" style="color:${isDefault ? 'var(--text-muted)' : 'var(--accent)'}">${escapeHtml(d)}</a>
                        ${isDefault ? '<span class="text-muted" style="font-size:10px">default</span>' : ''}
                    </div>`;
                }).join('') : '<div class="text-muted">No custom domains</div>'}
                <div style="margin-top:10px">
                    <button class="btn btn-sm btn-accent" id="add-domain-btn">+ Add Custom Domain</button>
                </div>
                <div id="add-domain-form" class="hidden" style="margin-top:10px;max-width:420px">
                    <div style="display:flex;gap:8px;align-items:center">
                        <div style="position:relative;flex:1">
                            <input type="text" class="form-input" id="custom-domain-input" placeholder="Type or select a zone..." autocomplete="off">
                            <div id="domain-suggestions" style="
                                display:none;position:absolute;top:100%;left:0;right:0;z-index:10;
                                max-height:180px;overflow-y:auto;
                                background:var(--bg-tertiary);border:1px solid var(--border);border-top:none;
                                font-size:12px;font-family:var(--font-mono);
                            "></div>
                        </div>
                        <button class="btn btn-sm btn-accent" id="custom-domain-save">Add</button>
                    </div>
                    <div id="custom-domain-msg" class="mt-8"></div>
                </div>
            </div>

            <h3 style="font-size:14px;margin-bottom:10px">Latest Deployment</h3>
            ${deploymentsHtml}

            <div class="mt-16" style="display:flex;gap:8px">
                <button class="btn btn-accent" id="detail-deploy-btn">Deploy Now</button>
            </div>
            <div id="detail-deploy-msg" class="mt-8"></div>`;

        // Add domain button
        container.querySelector('#add-domain-btn')?.addEventListener('click', () => {
            container.querySelector('#add-domain-form').classList.toggle('hidden');
        });

        // Searchable zone dropdown for custom domain input
        const domInput = container.querySelector('#custom-domain-input');
        const sugBox = container.querySelector('#domain-suggestions');
        let zones = [];

        // Load zones in background
        ZoneCache.get().then(z => { zones = z; }).catch(() => {});

        function showDomainSuggestions(query) {
            if (!zones.length) { sugBox.style.display = 'none'; return; }
            const q = query.toLowerCase();
            const matches = q
                ? zones.filter(z => z.name.includes(q))
                : zones.slice(0, 15);
            if (!matches.length) { sugBox.style.display = 'none'; return; }
            sugBox.innerHTML = matches.slice(0, 20).map(z =>
                `<div style="padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--border)" data-zone="${escapeHtml(z.name)}">${escapeHtml(z.name)}</div>`
            ).join('');
            sugBox.style.display = 'block';
        }

        domInput.addEventListener('input', () => showDomainSuggestions(domInput.value.trim()));
        domInput.addEventListener('focus', () => { if (!domInput.value.trim()) showDomainSuggestions(''); });

        sugBox.addEventListener('click', (e) => {
            const item = e.target.closest('[data-zone]');
            if (item) {
                domInput.value = item.dataset.zone;
                sugBox.style.display = 'none';
            }
        });

        sugBox.addEventListener('mouseover', (e) => {
            const item = e.target.closest('[data-zone]');
            if (item) {
                sugBox.querySelectorAll('[data-zone]').forEach(el => el.style.background = '');
                item.style.background = 'var(--bg-secondary)';
            }
        });

        container.addEventListener('click', (e) => {
            if (!e.target.closest('#custom-domain-input') && !e.target.closest('#domain-suggestions')) {
                sugBox.style.display = 'none';
            }
        });

        // Save custom domain — create CNAME record pointing to pages.dev subdomain
        container.querySelector('#custom-domain-save')?.addEventListener('click', async () => {
            const domain = domInput.value.trim();
            const msg = container.querySelector('#custom-domain-msg');
            if (!domain) { msg.innerHTML = '<div class="error-message">Enter a domain</div>'; return; }

            msg.innerHTML = '<div class="loading">Setting up domain...</div>';

            // Extract zone name from domain
            const parts = domain.split('.');
            const zoneName = parts.slice(-2).join('.');

            try {
                const zoneData = await API.get(`/api/cf/zones/resolve/${zoneName}`);
                const zoneId = zoneData.result.id;

                await API.post(`/api/cf/zones/${zoneId}/dns`, {
                    type: 'CNAME',
                    name: domain,
                    content: subdomain,
                    proxied: true,
                    ttl: 1,
                });

                msg.innerHTML = `<div class="success-message">CNAME record created: ${escapeHtml(domain)} → ${escapeHtml(subdomain)}</div>`;
            } catch (err) {
                msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
            }
        });

        // Deploy button
        container.querySelector('#detail-deploy-btn')?.addEventListener('click', async () => {
            const msg = container.querySelector('#detail-deploy-msg');
            msg.innerHTML = '<div class="loading">Triggering deployment...</div>';
            try {
                const data = await API.post(`/api/cf/pages/projects/${p.name}/deploy`, {});
                const depId = data.result?.id;
                if (depId) {
                    msg.innerHTML = '<div class="loading">Deploying...</div>';
                    this.pollDeployment(p.name, depId, msg);
                } else {
                    msg.innerHTML = '<div class="success-message">Deployment triggered!</div>';
                }
            } catch (err) {
                msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
            }
        });
    },

    // ------------------------------------------------------------------
    // Deploy
    // ------------------------------------------------------------------

    async triggerDeploy(projectName) {
        const statusEl = $(`#deploy-status-${CSS.escape(projectName)}`);
        if (!statusEl) return;

        statusEl.innerHTML = '<div class="loading">Triggering deployment...</div>';

        try {
            const data = await API.post(`/api/cf/pages/projects/${projectName}/deploy`, {});
            const depId = data.result?.id;
            if (!depId) {
                statusEl.innerHTML = '<div class="success-message">Deployment triggered!</div>';
                return;
            }

            statusEl.innerHTML = '<div class="loading">Deploying...</div>';
            this.pollDeployment(projectName, depId, statusEl);
        } catch (err) {
            statusEl.innerHTML = `<div class="error-message">Deploy failed: ${escapeHtml(err.message)}</div>`;
        }
    },

    pollDeployment(projectName, depId, statusEl) {
        if (this.pollingTimers[projectName]) clearInterval(this.pollingTimers[projectName]);

        this.pollingTimers[projectName] = setInterval(async () => {
            try {
                const data = await API.get(`/api/cf/pages/projects/${projectName}/deployments/${depId}`);
                const dep = data.result;
                const stage = dep?.latest_stage || {};
                const status = stage.status || 'unknown';

                if (status === 'success') {
                    clearInterval(this.pollingTimers[projectName]);
                    statusEl.innerHTML = '<div class="success-message">Deployment succeeded!</div>';
                    await this.loadProjects();
                } else if (status === 'failure') {
                    clearInterval(this.pollingTimers[projectName]);
                    statusEl.innerHTML = '<div class="error-message">Deployment failed.</div>';
                    await this.loadProjects();
                } else {
                    statusEl.innerHTML = `<div class="loading">Deploying... (${escapeHtml(stage.name || 'building')})</div>`;
                }
            } catch {
                clearInterval(this.pollingTimers[projectName]);
                statusEl.innerHTML = '<div class="error-message">Lost connection to deployment status.</div>';
            }
        }, 5000);
    },
};

Router.register('/cf/pages', () => Pages.render());
Router.register('/cf/pages/([^/]+)', (m) => Pages.renderDetail(m));
