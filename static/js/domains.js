/* 3C Panel — Porkbun domain manager (/domains) */

const Domains = {
    allDomains: [],
    sortField: 'domain',
    sortAsc: true,

    async render() {
        const content = $('#content');
        content.innerHTML = `
            <div class="page-header">
                <h1>Domains</h1>
                <a href="https://porkbun.com/account/domainsSpeedy" target="_blank" rel="noopener" class="btn btn-sm" style="margin-left:12px">Open Porkbun ↗</a>
                <button class="btn btn-accent" id="refresh-domains-btn" style="margin-left:auto">Refresh All</button>
            </div>
            <div class="toolbar">
                <input type="text" class="search-input" id="domain-search" placeholder="Search domains...">
                <select class="form-select" id="domain-filter" style="width:180px">
                    <option value="">All domains</option>
                    <option value="cf_active">On Cloudflare</option>
                    <option value="cf_pending">Pending</option>
                    <option value="not_on_cf">Not on CF</option>
                </select>
                <select class="form-select" id="domain-sort" style="width:160px">
                    <option value="domain">Sort: Name</option>
                    <option value="expire_date">Sort: Expiry</option>
                    <option value="cf_status">Sort: Status</option>
                </select>
            </div>
            <div id="domains-table-container"><div class="loading">Loading domains...</div></div>`;

        await this.loadDomains();
        this.bindEvents();
    },

    async loadDomains(forceRefresh = false) {
        if (forceRefresh) DomainCache.invalidate();
        try {
            this.allDomains = await DomainCache.get();
            this.applyFilters();
        } catch (err) {
            const container = document.getElementById('domains-table-container');
            if (container) {
                container.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
            }
        }
    },

    applyFilters() {
        const search = ($('#domain-search')?.value || '').toLowerCase();
        const filter = $('#domain-filter')?.value || '';

        let filtered = this.allDomains.filter(d => {
            if (search && !d.domain.toLowerCase().includes(search)) return false;
            if (filter && d.cf_status !== filter) return false;
            return true;
        });

        filtered.sort((a, b) => {
            let va = a[this.sortField] || '';
            let vb = b[this.sortField] || '';
            if (typeof va === 'string') va = va.toLowerCase();
            if (typeof vb === 'string') vb = vb.toLowerCase();
            if (va < vb) return this.sortAsc ? -1 : 1;
            if (va > vb) return this.sortAsc ? 1 : -1;
            return 0;
        });

        this.renderTable(filtered);
    },

    renderTable(domains) {
        const container = document.getElementById('domains-table-container');
        if (!container) return;

        if (!domains.length) {
            container.innerHTML = '<div class="info-message">No domains found.</div>';
            return;
        }

        const rows = domains.map(d => {
            const statusBadge = this.statusBadge(d.cf_status);
            const expiry = this.formatExpiry(d.expire_date);
            const cost = d.renewal_cost ? `$${parseFloat(d.renewal_cost).toFixed(2)}/yr` : '—';

            const actions = [];
            if (d.cf_status === 'cf_pending') {
                actions.push(`<button class="btn btn-sm btn-accent" data-fix-cf="${d.domain}">Fix NS</button>`);
            } else if (d.cf_status === 'not_on_cf') {
                actions.push(`<button class="btn btn-sm btn-accent" data-add-zone="${d.domain}">Add Zone</button>`);
            }
            actions.push(`<button class="btn btn-sm" data-edit-ns="${d.domain}">Edit NS</button>`);

            return `<tr>
                <td><strong>${escapeHtml(d.domain)}</strong></td>
                <td><span class="text-muted">.${escapeHtml(d.tld)}</span></td>
                <td>${statusBadge}</td>
                <td class="${expiry.warn ? 'text-danger' : ''}">${expiry.text}</td>
                <td>${cost}</td>
                <td class="actions">${actions.join(' ')}</td>
            </tr>`;
        }).join('');

        container.innerHTML = `
            <table class="data-table">
                <thead><tr>
                    <th>Domain</th><th>TLD</th><th>Status</th><th>Expires</th><th>Renewal</th><th>Actions</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;

        // Bind action buttons
        container.querySelectorAll('[data-fix-cf]').forEach(btn => {
            btn.addEventListener('click', () => this.showFixCfModal(btn.dataset.fixCf));
        });
        container.querySelectorAll('[data-add-zone]').forEach(btn => {
            btn.addEventListener('click', () => this.addZoneAndFixNs(btn.dataset.addZone, btn));
        });
        container.querySelectorAll('[data-edit-ns]').forEach(btn => {
            btn.addEventListener('click', () => this.showEditNsModal(btn.dataset.editNs));
        });
    },

    statusBadge(status) {
        switch (status) {
            case 'cf_active':
                return '<span class="badge badge-active">ON CLOUDFLARE</span>';
            case 'cf_pending':
                return '<span class="badge badge-pending">PENDING</span>';
            default:
                return '<span class="badge badge-neutral">NOT ON CF</span>';
        }
    },

    formatExpiry(dateStr) {
        if (!dateStr) return { text: '—', warn: false };
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return { text: dateStr, warn: false };
        const now = new Date();
        const daysLeft = Math.floor((d - now) / (1000 * 60 * 60 * 24));
        const text = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        return { text, warn: daysLeft < 30 };
    },

    bindEvents() {
        $('#domain-search')?.addEventListener('input', () => this.applyFilters());
        $('#domain-filter')?.addEventListener('change', () => this.applyFilters());
        $('#domain-sort')?.addEventListener('change', (e) => {
            this.sortField = e.target.value;
            this.applyFilters();
        });
        $('#refresh-domains-btn')?.addEventListener('click', async () => {
            const btn = $('#refresh-domains-btn');
            btn.disabled = true;
            btn.textContent = 'Refreshing...';
            const container = document.getElementById('domains-table-container');
            if (container) container.innerHTML = '<div class="loading">Refreshing domains...</div>';
            await this.loadDomains(true);
            btn.disabled = false;
            btn.textContent = 'Refresh All';
        });
    },

    // Add Zone on CF + update NS on Porkbun in one flow
    async addZoneAndFixNs(domain, btn) {
        const row = btn.closest('tr');
        const msgSpan = document.createElement('span');
        msgSpan.style.cssText = 'font-size:11px;margin-left:8px';
        btn.parentElement.appendChild(msgSpan);

        btn.disabled = true;
        btn.textContent = 'Creating...';

        try {
            // Step 1: Create zone on CF
            const data = await API.post('/api/cf/zones', { name: domain });
            const zone = data.result;
            const ns = zone.name_servers || [];

            btn.textContent = 'Updating NS...';

            // Step 2: Update NS on Porkbun
            try {
                await API.post(`/api/porkbun/ns/${domain}`, { nameservers: ns });
                btn.textContent = 'Done';
                btn.classList.remove('btn-accent');
                btn.classList.add('btn-success');
                btn.disabled = true;
                msgSpan.className = 'text-success';
                msgSpan.textContent = `NS → ${ns.join(', ')}`;
                DomainCache.invalidate();
                ZoneCache.invalidate();
            } catch (nsErr) {
                // Zone created but NS update failed
                btn.textContent = 'Zone Added';
                btn.classList.remove('btn-accent');
                btn.classList.add('btn-success');
                btn.disabled = true;
                msgSpan.className = 'text-warning';
                msgSpan.textContent = `NS update failed: ${nsErr.message}`;
                DomainCache.invalidate();
                ZoneCache.invalidate();
            }
        } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Add Zone';
            msgSpan.className = 'text-danger';
            msgSpan.textContent = err.message;
        }
    },

    showFixCfModal(domain) {
        const d = this.allDomains.find(x => x.domain === domain);
        if (!d) return;

        const cfNs = (d.cf_nameservers || []).join('\n') || '(unknown)';

        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>Fix Nameservers</h2>
            <p>Update <strong>${escapeHtml(domain)}</strong> to use Cloudflare nameservers on Porkbun?</p>
            <div class="form-group">
                <label>Cloudflare assigned nameservers</label>
                <div class="info-message mono" style="font-size:12px;white-space:pre-line;border-color:var(--accent)">${escapeHtml(cfNs)}</div>
            </div>
            <div id="fix-cf-msg"></div>
            <div class="btn-row">
                <button class="btn" onclick="closeModal()">Cancel</button>
                <button class="btn btn-accent" id="fix-cf-confirm">Update on Porkbun</button>
            </div>`);

        overlay.querySelector('#fix-cf-confirm').addEventListener('click', async () => {
            const msg = overlay.querySelector('#fix-cf-msg');
            const btn = overlay.querySelector('#fix-cf-confirm');
            msg.innerHTML = '<div class="loading">Updating nameservers...</div>';
            btn.disabled = true;

            try {
                await API.post(`/api/porkbun/ns/${domain}`, { nameservers: d.cf_nameservers });
                msg.innerHTML = '<div class="success-message">Nameservers updated on Porkbun!</div>';
                DomainCache.invalidate();
                setTimeout(() => {
                    closeModal();
                    this.loadDomains();
                }, 1200);
            } catch (err) {
                msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
                btn.disabled = false;
            }
        });
    },

    showEditNsModal(domain) {
        const d = this.allDomains.find(x => x.domain === domain);
        if (!d) return;
        // Pre-fill with CF nameservers if available, otherwise empty
        const ns = d.cf_nameservers && d.cf_nameservers.length ? d.cf_nameservers : [];

        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>Edit Nameservers</h2>
            <p><strong>${escapeHtml(domain)}</strong></p>
            <div class="form-group">
                <label>NS 1</label>
                <input type="text" class="form-input" id="edit-ns-1" value="${escapeHtml(ns[0] || '')}">
            </div>
            <div class="form-group">
                <label>NS 2</label>
                <input type="text" class="form-input" id="edit-ns-2" value="${escapeHtml(ns[1] || '')}">
            </div>
            <div id="edit-ns-msg"></div>
            <div class="btn-row">
                <button class="btn" onclick="closeModal()">Cancel</button>
                <button class="btn btn-accent" id="edit-ns-confirm">Update Nameservers</button>
            </div>`);

        overlay.querySelector('#edit-ns-confirm').addEventListener('click', async () => {
            const ns1 = overlay.querySelector('#edit-ns-1').value.trim();
            const ns2 = overlay.querySelector('#edit-ns-2').value.trim();
            const msg = overlay.querySelector('#edit-ns-msg');
            const btn = overlay.querySelector('#edit-ns-confirm');

            if (!ns1 || !ns2) {
                msg.innerHTML = '<div class="error-message">Both nameservers are required</div>';
                return;
            }

            msg.innerHTML = '<div class="loading">Updating nameservers...</div>';
            btn.disabled = true;

            try {
                await API.post(`/api/porkbun/ns/${domain}`, { nameservers: [ns1, ns2] });
                msg.innerHTML = '<div class="success-message">Nameservers updated!</div>';
                DomainCache.invalidate();
                setTimeout(() => {
                    closeModal();
                    this.loadDomains();
                }, 1200);
            } catch (err) {
                msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
                btn.disabled = false;
            }
        });
    },
};

Router.register('/domains', () => Domains.render());
