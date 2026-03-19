/* 3C Panel — Zone list (/cf/zones) */

const Zones = {
    allZones: [],

    async render() {
        const content = $('#content');
        content.innerHTML = `
            <div class="page-header">
                <h1>Zones</h1>
                <button class="btn btn-accent" id="add-zone-btn">+ Add Zone</button>
            </div>
            <div class="toolbar">
                <input type="text" class="search-input" id="zone-search" placeholder="Search zones...">
                <select class="form-select" id="zone-filter" style="width:160px">
                    <option value="">All statuses</option>
                    <option value="active">Active</option>
                    <option value="pending">Pending</option>
                    <option value="moved">Moved</option>
                </select>
            </div>
            <div id="zones-table-container"><div class="loading">Loading zones...</div></div>`;

        await this.loadZones();
        this.bindEvents();
    },

    async loadZones() {
        try {
            const data = await API.get('/api/cf/zones?per_page=50');
            this.allZones = data.result || [];
            ZoneCache.zones = this.allZones;
            this.renderTable(this.allZones);
        } catch (err) {
            $('#zones-table-container').innerHTML =
                `<div class="error-message">Failed to load zones: ${escapeHtml(err.message)}</div>`;
        }
    },

    renderTable(zones) {
        if (!zones.length) {
            $('#zones-table-container').innerHTML =
                '<div class="info-message">No zones found.</div>';
            return;
        }

        const rows = zones.map(z => {
            const statusClass = z.status === 'active' ? 'badge-active'
                : z.status === 'pending' ? 'badge-pending' : 'badge-moved';
            const rowClass = (z.status === 'pending' || z.status === 'moved') ? 'warning-row' : '';
            const ns = (z.status !== 'active' && z.name_servers)
                ? `<div class="mono" style="margin-top:4px;font-size:11px">${z.name_servers.join(', ')}</div>` : '';
            const plan = z.plan ? z.plan.name : '—';

            return `<tr class="${rowClass}">
                <td><a href="/cf/zones/${z.name}">${escapeHtml(z.name)}</a></td>
                <td><span class="badge ${statusClass}">${z.status}</span></td>
                <td class="text-muted">${escapeHtml(plan)}</td>
                <td>${ns}</td>
            </tr>`;
        }).join('');

        $('#zones-table-container').innerHTML = `
            <table class="data-table">
                <thead><tr>
                    <th>Domain</th><th>Status</th><th>Plan</th><th>Nameservers</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    },

    filterZones() {
        const search = ($('#zone-search')?.value || '').toLowerCase();
        const status = $('#zone-filter')?.value || '';
        const filtered = this.allZones.filter(z => {
            if (search && !z.name.toLowerCase().includes(search)) return false;
            if (status && z.status !== status) return false;
            return true;
        });
        this.renderTable(filtered);
    },

    bindEvents() {
        $('#zone-search')?.addEventListener('input', () => this.filterZones());
        $('#zone-filter')?.addEventListener('change', () => this.filterZones());
        $('#add-zone-btn')?.addEventListener('click', () => this.showAddModal());
    },

    async showAddModal() {
        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>Add Zone</h2>
            <div class="form-group">
                <label>Domain Name</label>
                <div id="zone-select-container"><div class="loading" style="font-size:12px">Loading domains...</div></div>
            </div>
            <div id="add-zone-msg"></div>
            <div class="btn-row">
                <button class="btn btn-accent" id="add-zone-submit">Create Zone</button>
            </div>
            <div id="add-zone-result" class="hidden"></div>`);

        const selectContainer = overlay.querySelector('#zone-select-container');

        // Try to load Porkbun domains for dropdown, fall back to text input
        let usePorkbun = false;
        try {
            const pb = await API.get('/api/porkbun/available');
            if (pb.available) {
                const domains = await DomainCache.get();
                // Filter out domains that already have CF zones
                const existingZones = new Set(this.allZones.map(z => z.name));
                const available = domains.filter(d => !existingZones.has(d.domain));

                if (available.length) {
                    usePorkbun = true;
                    const options = available
                        .sort((a, b) => a.domain.localeCompare(b.domain))
                        .map(d => `<option value="${escapeHtml(d.domain)}">${escapeHtml(d.domain)}</option>`)
                        .join('');

                    selectContainer.innerHTML = `
                        <input type="text" class="form-input" id="zone-domain-search" placeholder="Type to filter..." style="margin-bottom:6px">
                        <select class="form-select" id="new-zone-name" size="8" style="width:100%;height:auto">
                            ${options}
                        </select>
                        <p class="text-muted" style="font-size:10px;margin-top:4px">${available.length} domains not yet on Cloudflare</p>`;

                    // Wire up search filter
                    const searchInput = overlay.querySelector('#zone-domain-search');
                    const select = overlay.querySelector('#new-zone-name');
                    searchInput.addEventListener('input', () => {
                        const q = searchInput.value.toLowerCase();
                        const filtered = available.filter(d => d.domain.toLowerCase().includes(q));
                        select.innerHTML = filtered
                            .map(d => `<option value="${escapeHtml(d.domain)}">${escapeHtml(d.domain)}</option>`)
                            .join('');
                    });
                    // Auto-select first
                    if (select.options.length) select.options[0].selected = true;
                } else {
                    // All domains already on CF
                    selectContainer.innerHTML = `
                        <input type="text" class="form-input" id="new-zone-name" placeholder="example.com">
                        <p class="text-muted" style="font-size:10px;margin-top:4px">All Porkbun domains already on Cloudflare</p>`;
                }
            } else {
                selectContainer.innerHTML = '<input type="text" class="form-input" id="new-zone-name" placeholder="example.com">';
            }
        } catch {
            selectContainer.innerHTML = '<input type="text" class="form-input" id="new-zone-name" placeholder="example.com">';
        }

        overlay.querySelector('#add-zone-submit').addEventListener('click', async () => {
            const nameEl = overlay.querySelector('#new-zone-name');
            const name = nameEl.value.trim();
            const msg = overlay.querySelector('#add-zone-msg');
            const result = overlay.querySelector('#add-zone-result');
            if (!name) { msg.innerHTML = '<div class="error-message">Select or enter a domain name</div>'; return; }

            msg.innerHTML = '<div class="loading">Creating zone...</div>';
            overlay.querySelector('#add-zone-submit').disabled = true;

            try {
                const data = await API.post('/api/cf/zones', { name });
                const zone = data.result;
                const ns = zone.name_servers || [];

                msg.innerHTML = `<div class="success-message">Zone created! Nameservers: ${ns.join(', ')}</div>`;

                // Offer to update NS on Porkbun if available
                if (usePorkbun) {
                    result.classList.remove('hidden');
                    result.innerHTML = `
                        <div class="mt-16">
                            <p class="mb-12">Update nameservers on Porkbun now?</p>
                            <div class="info-message mono" style="font-size:12px">${ns.join('<br>')}</div>
                            <div class="btn-row">
                                <button class="btn btn-accent" id="porkbun-ns-btn">Update on Porkbun</button>
                            </div>
                            <div id="porkbun-ns-msg"></div>
                        </div>`;
                    result.querySelector('#porkbun-ns-btn').addEventListener('click', async () => {
                        const pbMsg = result.querySelector('#porkbun-ns-msg');
                        pbMsg.innerHTML = '<div class="loading">Updating nameservers...</div>';
                        try {
                            await API.post(`/api/porkbun/ns/${name}`, { nameservers: ns });
                            pbMsg.innerHTML = '<div class="success-message">Nameservers updated on Porkbun!</div>';
                            DomainCache.invalidate();
                        } catch (e) {
                            pbMsg.innerHTML = `<div class="error-message">Porkbun error: ${escapeHtml(e.message)}</div>`;
                        }
                    });
                } else {
                    result.classList.remove('hidden');
                    result.innerHTML = '<div class="info-message mt-16">Update these nameservers manually at your registrar.</div>';
                }

                ZoneCache.invalidate();
            } catch (err) {
                msg.innerHTML = `<div class="error-message">Failed: ${escapeHtml(err.message)}</div>`;
                overlay.querySelector('#add-zone-submit').disabled = false;
            }
        });
    },
};

Router.register('/cf/zones', () => Zones.render());
