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

    async loadDomains() {
        try {
            const data = await API.get('/api/domains');
            this.allDomains = data.domains || [];
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
            const nsDisplay = d.ns_error
                ? `Error: ${d.ns_error}`
                : (d.nameservers || []).join(', ') || '—';
            const nsClass = d.ns_error ? 'text-danger' : 'text-muted';
            const expiry = this.formatExpiry(d.expire_date);
            const cost = d.renewal_cost ? `$${parseFloat(d.renewal_cost).toFixed(2)}/yr` : '—';

            const actions = [];
            if (d.cf_status === 'cf_pending' || d.cf_status === 'not_on_cf') {
                if (d.cf_status === 'cf_pending') {
                    actions.push(`<button class="btn btn-sm btn-accent" data-fix-cf="${d.domain}">Fix NS</button>`);
                }
            }
            actions.push(`<button class="btn btn-sm" data-edit-ns="${d.domain}">Edit NS</button>`);

            return `<tr>
                <td><strong>${escapeHtml(d.domain)}</strong></td>
                <td><span class="text-muted">.${escapeHtml(d.tld)}</span></td>
                <td>${statusBadge}</td>
                <td class="${nsClass} mono" style="font-size:11px" title="${escapeHtml(nsDisplay)}">${escapeHtml(this.truncateNs(nsDisplay))}</td>
                <td class="${expiry.warn ? 'text-danger' : ''}">${expiry.text}</td>
                <td>${cost}</td>
                <td class="actions">${actions.join(' ')}</td>
            </tr>`;
        }).join('');

        container.innerHTML = `
            <table class="data-table">
                <thead><tr>
                    <th>Domain</th><th>TLD</th><th>Status</th><th>Nameservers</th><th>Expires</th><th>Renewal</th><th>Actions</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;

        // Bind action buttons
        container.querySelectorAll('[data-fix-cf]').forEach(btn => {
            btn.addEventListener('click', () => this.showFixCfModal(btn.dataset.fixCf));
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
                return '<span class="badge badge-moved">NOT ON CF</span>';
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

    truncateNs(ns) {
        return ns.length > 50 ? ns.substring(0, 47) + '...' : ns;
    },

    bindEvents() {
        $('#domain-search')?.addEventListener('input', () => this.applyFilters());
        $('#domain-filter')?.addEventListener('change', () => this.applyFilters());
        $('#domain-sort')?.addEventListener('change', (e) => {
            this.sortField = e.target.value;
            this.applyFilters();
        });
    },

    showFixCfModal(domain) {
        const d = this.allDomains.find(x => x.domain === domain);
        if (!d) return;

        const currentNs = (d.nameservers || []).join('\n') || '(none)';
        const cfNs = (d.cf_nameservers || []).join('\n') || '(unknown)';

        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>Fix Nameservers</h2>
            <p>Update <strong>${escapeHtml(domain)}</strong> to use Cloudflare nameservers?</p>
            <div class="form-group">
                <label>Current nameservers</label>
                <div class="info-message mono" style="font-size:12px;white-space:pre-line">${escapeHtml(currentNs)}</div>
            </div>
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
                await API.post(`/api/domains/${domain}/fix-cf`);
                msg.innerHTML = '<div class="success-message">Nameservers updated on Porkbun!</div>';
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
        const ns = d.nameservers || [];

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
                await API.post(`/api/domains/${domain}/update-ns`, { nameservers: [ns1, ns2] });
                msg.innerHTML = '<div class="success-message">Nameservers updated!</div>';
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
