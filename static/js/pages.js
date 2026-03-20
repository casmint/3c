/* 3C Panel — Cloudflare Pages manager (/cf/pages) */

const Pages = {
    projects: [],
    pollingTimers: {},
    sortBy: 'updated',   // updated | name | created
    perPage: 15,
    currentPage: 1,

    async render() {
        const content = $('#content');
        content.innerHTML = `
            <div class="page-header">
                <h1>Pages</h1>
                <button class="btn btn-accent" id="new-project-btn">+ New Project</button>
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

        await this.loadProjects();
        $('#new-project-btn')?.addEventListener('click', () => this.showNewProjectModal());

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
                (p.source?.config?.repo_name || '').toLowerCase().includes(query)
            );
        }

        const sorted = [...filtered];
        if (this.sortBy === 'name') {
            sorted.sort((a, b) => a.name.localeCompare(b.name));
        } else if (this.sortBy === 'created') {
            sorted.sort((a, b) => new Date(b.created_on || 0) - new Date(a.created_on || 0));
        } else {
            // updated = last deployed
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

        // Pagination
        const totalPages = Math.ceil(sorted.length / this.perPage);
        if (this.currentPage > totalPages) this.currentPage = totalPages;
        const start = (this.currentPage - 1) * this.perPage;
        const page = sorted.slice(start, start + this.perPage);

        const rows = page.map(p => this.renderRow(p)).join('');

        const paginationHtml = totalPages > 1 ? this.renderPagination(sorted.length, totalPages) : '';

        container.innerHTML = `
            <div class="text-muted" style="font-size:11px;margin-bottom:8px">${sorted.length} project${sorted.length !== 1 ? 's' : ''}</div>
            <div class="pages-list">${rows}</div>
            ${paginationHtml}`;

        // Bind deploy buttons
        $$('[data-deploy]').forEach(btn => {
            btn.addEventListener('click', () => this.triggerDeploy(btn.dataset.deploy));
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
        const domains = (p.domains || []).join(', ');

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

        // Commit info
        let commitHtml = '';
        if (latest?.deployment_trigger?.metadata) {
            const meta = latest.deployment_trigger.metadata;
            const msg = meta.commit_message || '';
            const branch = meta.branch || '';
            if (msg || branch) {
                commitHtml = `<span class="text-muted" style="font-size:11px">
                    ${branch ? `<span class="mono">${escapeHtml(branch)}</span>` : ''}
                    ${msg ? ` — ${escapeHtml(msg.substring(0, 60))}${msg.length > 60 ? '...' : ''}` : ''}
                </span>`;
            }
        }

        return `
            <div class="pages-row" data-project="${escapeHtml(p.name)}">
                <div class="pages-row-main">
                    <div class="pages-row-info">
                        <div class="pages-row-title">
                            <strong>${escapeHtml(p.name)}</strong>
                            <a href="https://${escapeHtml(subdomain)}" data-external target="_blank" class="text-muted mono" style="font-size:11px;margin-left:8px">${escapeHtml(subdomain)}</a>
                        </div>
                        <div class="pages-row-meta">
                            ${repo ? `<span class="text-muted" style="font-size:11px">Repo: <span class="mono">${escapeHtml(repo)}</span></span>` : ''}
                            ${domains ? `<span class="text-muted" style="font-size:11px;margin-left:12px">Domains: ${escapeHtml(domains)}</span>` : ''}
                        </div>
                        ${commitHtml ? `<div style="margin-top:2px">${commitHtml}</div>` : ''}
                    </div>
                    <div class="pages-row-right">
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

    renderPagination(total, totalPages) {
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

    showNewProjectModal() {
        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>New Pages Project</h2>
            <div class="form-group">
                <label>Project Name</label>
                <input type="text" class="form-input" id="pages-name" placeholder="my-project">
            </div>
            <div class="form-group">
                <label>Production Branch</label>
                <input type="text" class="form-input" id="pages-branch" placeholder="main" value="main">
            </div>
            <div id="pages-modal-msg"></div>
            <div class="btn-row">
                <button class="btn" onclick="closeModal()">Cancel</button>
                <button class="btn btn-accent" id="pages-create-btn">Create</button>
            </div>
            <div id="pages-cname-offer" class="hidden"></div>`);

        overlay.querySelector('#pages-create-btn').addEventListener('click', async () => {
            const name = overlay.querySelector('#pages-name').value.trim();
            const branch = overlay.querySelector('#pages-branch').value.trim() || 'main';
            const msg = overlay.querySelector('#pages-modal-msg');

            if (!name) {
                msg.innerHTML = '<div class="error-message">Project name is required</div>';
                return;
            }

            msg.innerHTML = '<div class="loading">Creating project...</div>';

            try {
                const data = await API.post('/api/cf/pages/projects', { name, production_branch: branch });
                const subdomain = `${name}.pages.dev`;
                msg.innerHTML = `<div class="success-message">Project created! Subdomain: ${subdomain}</div>`;

                const cnameOffer = overlay.querySelector('#pages-cname-offer');
                cnameOffer.classList.remove('hidden');
                cnameOffer.innerHTML = `
                    <div class="mt-16">
                        <p class="mb-12">Add a CNAME record for a custom domain?</p>
                        <div class="form-group">
                            <label>Domain (e.g. www.example.com)</label>
                            <input type="text" class="form-input" id="cname-domain" placeholder="www.example.com">
                        </div>
                        <div class="info-message">Will create: CNAME &rarr; ${escapeHtml(subdomain)} (proxied)</div>
                        <div class="btn-row">
                            <button class="btn" id="cname-skip">Skip</button>
                            <button class="btn btn-accent" id="cname-add">Add CNAME</button>
                        </div>
                        <div id="cname-msg"></div>
                    </div>`;

                cnameOffer.querySelector('#cname-skip').addEventListener('click', () => {
                    closeModal();
                    this.loadProjects();
                });

                cnameOffer.querySelector('#cname-add').addEventListener('click', async () => {
                    const domain = cnameOffer.querySelector('#cname-domain').value.trim();
                    const cnameMsg = cnameOffer.querySelector('#cname-msg');
                    if (!domain) {
                        cnameMsg.innerHTML = '<div class="error-message">Enter a domain</div>';
                        return;
                    }

                    const parts = domain.split('.');
                    const zoneName = parts.slice(-2).join('.');
                    cnameMsg.innerHTML = '<div class="loading">Looking up zone...</div>';

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

                        cnameMsg.innerHTML = '<div class="success-message">CNAME record added!</div>';
                        setTimeout(() => {
                            closeModal();
                            this.loadProjects();
                        }, 1500);
                    } catch (err) {
                        cnameMsg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
                    }
                });
            } catch (err) {
                msg.innerHTML = `<div class="error-message">Failed: ${escapeHtml(err.message)}</div>`;
            }
        });
    },
};

Router.register('/cf/pages', () => Pages.render());
