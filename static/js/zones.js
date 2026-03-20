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
                <div style="position:relative">
                    <input type="text" class="form-input" id="new-zone-name" placeholder="example.com" autocomplete="off">
                    <div id="zone-suggestions" style="
                        display:none;position:absolute;top:100%;left:0;right:0;z-index:10;
                        max-height:200px;overflow-y:auto;
                        background:var(--bg-tertiary);border:1px solid var(--border);border-top:none;
                        font-size:12px;font-family:var(--font-mono);
                    "></div>
                </div>
                <p id="zone-hint" class="text-muted" style="font-size:10px;margin-top:4px"></p>
            </div>
            <div id="add-zone-msg"></div>
            <div class="btn-row">
                <button class="btn btn-accent" id="add-zone-submit">Create Zone</button>
            </div>
            <div id="add-zone-result" class="hidden"></div>`);

        // Set up searchable autocomplete — loads Porkbun domains in background
        const input = overlay.querySelector('#new-zone-name');
        const sugBox = overlay.querySelector('#zone-suggestions');
        const hint = overlay.querySelector('#zone-hint');
        let pbAvailable = [];
        let usePorkbun = false;

        // Load domains in background — modal is immediately usable
        (async () => {
            try {
                const pb = await API.get('/api/porkbun/available');
                if (!pb.available) return;
                const domains = await DomainCache.get();
                const existingZones = new Set(this.allZones.map(z => z.name));
                pbAvailable = domains
                    .filter(d => !existingZones.has(d.domain))
                    .map(d => d.domain)
                    .sort();
                usePorkbun = true;
                if (hint) hint.textContent = `${pbAvailable.length} Porkbun domains not yet on Cloudflare`;
                // If input is focused and empty, show suggestions
                if (document.activeElement === input && !input.value.trim()) {
                    showSuggestions('');
                }
            } catch { /* Porkbun unavailable — input works as plain text */ }
        })();

        function showSuggestions(query) {
            if (!pbAvailable.length) { sugBox.style.display = 'none'; return; }
            const q = query.toLowerCase();
            const matches = q
                ? pbAvailable.filter(d => d.includes(q))
                : pbAvailable.slice(0, 20);
            if (!matches.length) { sugBox.style.display = 'none'; return; }
            sugBox.innerHTML = matches.slice(0, 30).map(d =>
                `<div class="zone-sug-item" style="padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--border)" data-domain="${escapeHtml(d)}">${escapeHtml(d)}</div>`
            ).join('');
            if (matches.length > 30) {
                sugBox.innerHTML += `<div class="text-muted" style="padding:4px 10px;font-size:10px">${matches.length - 30} more...</div>`;
            }
            sugBox.style.display = 'block';
        }

        input.addEventListener('input', () => showSuggestions(input.value.trim()));
        input.addEventListener('focus', () => { if (!input.value.trim()) showSuggestions(''); });

        sugBox.addEventListener('click', (e) => {
            const item = e.target.closest('[data-domain]');
            if (item) {
                input.value = item.dataset.domain;
                sugBox.style.display = 'none';
            }
        });

        // Hide suggestions on outside click
        overlay.addEventListener('click', (e) => {
            if (!e.target.closest('#new-zone-name') && !e.target.closest('#zone-suggestions')) {
                sugBox.style.display = 'none';
            }
        });

        // Hover highlight
        sugBox.addEventListener('mouseover', (e) => {
            const item = e.target.closest('[data-domain]');
            if (item) {
                sugBox.querySelectorAll('.zone-sug-item').forEach(el => el.style.background = '');
                item.style.background = 'var(--bg-secondary)';
            }
        });

        overlay.querySelector('#add-zone-submit').addEventListener('click', async () => {
            const name = input.value.trim();
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

                // Offer to update NS on Porkbun if domain is on Porkbun
                const allPbDomains = usePorkbun ? (await DomainCache.get()).map(d => d.domain) : [];
                const isOnPorkbun = usePorkbun && allPbDomains.includes(name);
                if (isOnPorkbun) {
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
