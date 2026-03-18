/* 3C Panel — Cloudflare Pages manager (/cf/pages) */

const Pages = {
    projects: [],
    pollingTimers: {},

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
            <div id="pages-container"><div class="loading">Loading Pages projects...</div></div>`;

        await this.loadProjects();
        $('#new-project-btn')?.addEventListener('click', () => this.showNewProjectModal());
    },

    async loadProjects() {
        try {
            const data = await API.get('/api/cf/pages/projects');
            this.projects = data.result || [];
            this.renderProjects();
        } catch (err) {
            $('#pages-container').innerHTML =
                `<div class="error-message">Failed to load projects: ${escapeHtml(err.message)}</div>`;
        }
    },

    renderProjects() {
        if (!this.projects.length) {
            $('#pages-container').innerHTML = '<div class="info-message">No Pages projects found.</div>';
            return;
        }

        const cards = this.projects.map(p => {
            const latest = p.latest_deployment;
            let statusHtml = '<span class="text-muted">No deployments</span>';
            if (latest) {
                const stage = latest.latest_stage || {};
                const status = stage.status || 'unknown';
                const dotClass = status === 'success' ? 'dot-success'
                    : status === 'active' ? 'dot-building'
                    : status === 'failure' ? 'dot-failed' : '';
                const time = latest.created_on ? new Date(latest.created_on).toLocaleString() : '';
                statusHtml = `<span class="deploy-status">
                    <span class="dot ${dotClass}"></span>
                    ${escapeHtml(stage.name || status)} · ${time}
                </span>`;
            }

            const repo = p.source?.config?.repo_name
                ? `<div class="meta">Repo: ${escapeHtml(p.source.config.repo_name)}</div>` : '';
            const domains = (p.domains || []).map(d => escapeHtml(d)).join(', ');
            const domainsHtml = domains
                ? `<div class="meta">Domains: ${domains}</div>` : '';
            const subdomain = `${p.subdomain || p.name + '.pages.dev'}`;

            return `<div class="project-card" data-project="${escapeHtml(p.name)}">
                <h3>${escapeHtml(p.name)}</h3>
                <div class="meta"><a href="https://${escapeHtml(subdomain)}" data-external target="_blank">${escapeHtml(subdomain)}</a></div>
                ${repo}
                ${domainsHtml}
                <div class="meta mt-12">${statusHtml}</div>
                <div id="deploy-status-${escapeHtml(p.name)}"></div>
                <div class="card-actions">
                    <button class="btn btn-sm btn-accent" data-deploy="${escapeHtml(p.name)}">D Deploy</button>
                </div>
            </div>`;
        }).join('');

        $('#pages-container').innerHTML = `<div class="project-cards">${cards}</div>`;

        // Bind deploy buttons
        $$('[data-deploy]').forEach(btn => {
            btn.addEventListener('click', () => this.triggerDeploy(btn.dataset.deploy));
        });
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
        // Clear existing timer for this project
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

                // Offer CNAME record
                const cnameOffer = overlay.querySelector('#pages-cname-offer');
                cnameOffer.classList.remove('hidden');
                cnameOffer.innerHTML = `
                    <div class="mt-16">
                        <p class="mb-12">Add a CNAME record for a custom domain?</p>
                        <div class="form-group">
                            <label>Domain (e.g. www.example.com)</label>
                            <input type="text" class="form-input" id="cname-domain" placeholder="www.example.com">
                        </div>
                        <div class="info-message">Will create: CNAME → ${escapeHtml(subdomain)} (proxied)</div>
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

                    // Need to find the zone for this domain
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
