/* 3C Panel — DNS manager (/cf/zones/:domain/dns) */

const DNS = {
    zoneId: null,
    domain: null,
    records: [],

    // Record types and their field configurations
    typeFields: {
        A:     { content: 'IPv4 Address', proxied: true },
        AAAA:  { content: 'IPv6 Address', proxied: true },
        CNAME: { content: 'Target',       proxied: true },
        TXT:   { content: 'Value',        proxied: false },
        MX:    { content: 'Mail Server',  proxied: false, priority: true },
        NS:    { content: 'Nameserver',   proxied: false },
        SRV:   { content: 'Target',       proxied: false, priority: true, srv: true },
    },

    async render(match) {
        this.domain = match[1];
        const content = $('#content');

        // Resolve zone
        let zone = ZoneCache.findByName(this.domain);
        if (!zone) {
            try {
                await ZoneCache.get();
                zone = ZoneCache.findByName(this.domain);
            } catch { /* fallback below */ }
        }
        if (!zone) {
            try {
                const data = await API.get(`/api/cf/zones/resolve/${this.domain}`);
                zone = data.result;
            } catch (err) {
                content.innerHTML = `<div class="error-message">Zone not found: ${escapeHtml(this.domain)}</div>`;
                return;
            }
        }
        this.zoneId = zone.id;

        const bar = await renderZoneContextBar(this.domain, 'dns');
        content.innerHTML = bar + `
            <div class="page-header">
                <h1>DNS Records</h1>
                <button class="btn btn-accent" id="add-dns-btn">+ Add Record</button>
            </div>
            <div id="dns-table-container"><div class="loading">Loading DNS records...</div></div>`;

        bindZoneSwitcher();
        await this.loadRecords();
        $('#add-dns-btn')?.addEventListener('click', () => this.showRecordModal());
    },

    async loadRecords() {
        try {
            const data = await API.get(`/api/cf/zones/${this.zoneId}/dns`);
            this.records = data.result || [];
            this.renderTable();
        } catch (err) {
            $('#dns-table-container').innerHTML =
                `<div class="error-message">Failed to load DNS records: ${escapeHtml(err.message)}</div>`;
        }
    },

    renderTable() {
        if (!this.records.length) {
            $('#dns-table-container').innerHTML = '<div class="info-message">No DNS records found.</div>';
            return;
        }

        const rows = this.records.map(r => {
            const proxied = r.proxied
                ? '<span class="proxy-on" title="Proxied">🟠</span>'
                : '<span class="proxy-off" title="DNS only">⚫</span>';
            const ttl = r.ttl === 1 ? 'Auto' : r.ttl + 's';
            const content = r.type === 'MX'
                ? `${r.priority} ${escapeHtml(r.content)}`
                : escapeHtml(r.content);

            return `<tr>
                <td><span class="badge badge-free">${r.type}</span></td>
                <td>${escapeHtml(r.name)}</td>
                <td class="truncate" title="${escapeHtml(r.content)}">${content}</td>
                <td class="mono">${ttl}</td>
                <td>${proxied}</td>
                <td class="actions">
                    <button class="btn btn-sm" data-edit="${r.id}">E</button>
                    <button class="btn btn-sm btn-danger" data-delete="${r.id}">D</button>
                </td>
            </tr>`;
        }).join('');

        $('#dns-table-container').innerHTML = `
            <table class="data-table">
                <thead><tr>
                    <th>Type</th><th>Name</th><th>Content</th><th>TTL</th><th>Proxy</th><th>Actions</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;

        // Bind action buttons
        $$('[data-edit]').forEach(btn => {
            btn.addEventListener('click', () => {
                const rec = this.records.find(r => r.id === btn.dataset.edit);
                if (rec) this.showRecordModal(rec);
            });
        });

        $$('[data-delete]').forEach(btn => {
            btn.addEventListener('click', () => {
                const rec = this.records.find(r => r.id === btn.dataset.delete);
                if (rec) this.showDeleteModal(rec);
            });
        });
    },

    showRecordModal(existing) {
        const isEdit = !!existing;
        const title = isEdit ? 'Edit DNS Record' : 'Add DNS Record';
        const types = Object.keys(this.typeFields);
        const currentType = existing ? existing.type : 'A';

        const typeOptions = types
            .map(t => `<option value="${t}" ${t === currentType ? 'selected' : ''}>${t}</option>`)
            .join('');

        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>${title}</h2>
            <div class="form-group">
                <label>Type</label>
                <select class="form-select" id="dns-type" ${isEdit ? 'disabled' : ''}>${typeOptions}</select>
            </div>
            <div class="form-group">
                <label>Name</label>
                <input type="text" class="form-input" id="dns-name" placeholder="@ or subdomain" value="${existing ? escapeHtml(existing.name) : ''}">
            </div>
            <div class="form-group">
                <label id="dns-content-label">${this.typeFields[currentType].content}</label>
                <input type="text" class="form-input" id="dns-content" value="${existing ? escapeHtml(existing.content) : ''}">
            </div>
            <div class="form-group ${this.typeFields[currentType].priority ? '' : 'hidden'}" id="dns-priority-group">
                <label>Priority</label>
                <input type="number" class="form-input" id="dns-priority" value="${existing?.priority || 10}">
            </div>
            <div class="form-row" id="dns-srv-group" class="${this.typeFields[currentType].srv ? '' : 'hidden'}">
                <div class="form-group">
                    <label>Port</label>
                    <input type="number" class="form-input" id="dns-port" value="${existing?.data?.port || ''}">
                </div>
                <div class="form-group">
                    <label>Weight</label>
                    <input type="number" class="form-input" id="dns-weight" value="${existing?.data?.weight || 0}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>TTL</label>
                    <select class="form-select" id="dns-ttl">
                        <option value="1" ${(!existing || existing.ttl === 1) ? 'selected' : ''}>Auto</option>
                        <option value="300" ${existing?.ttl === 300 ? 'selected' : ''}>5 min</option>
                        <option value="3600" ${existing?.ttl === 3600 ? 'selected' : ''}>1 hour</option>
                        <option value="86400" ${existing?.ttl === 86400 ? 'selected' : ''}>1 day</option>
                    </select>
                </div>
                <div class="form-group" id="dns-proxied-group" style="${this.typeFields[currentType].proxied ? '' : 'display:none'}">
                    <label>&nbsp;</label>
                    <label class="form-check">
                        <input type="checkbox" id="dns-proxied" ${existing?.proxied ? 'checked' : ''}>
                        Proxied
                    </label>
                </div>
            </div>
            <div id="dns-modal-msg"></div>
            <div class="btn-row">
                <button class="btn" onclick="closeModal()">Cancel</button>
                <button class="btn btn-accent" id="dns-save-btn">${isEdit ? 'Update' : 'Create'}</button>
            </div>`);

        // Type change handler
        const typeSelect = overlay.querySelector('#dns-type');
        typeSelect?.addEventListener('change', () => {
            const t = typeSelect.value;
            const cfg = this.typeFields[t];
            overlay.querySelector('#dns-content-label').textContent = cfg.content;
            const prioGroup = overlay.querySelector('#dns-priority-group');
            if (cfg.priority) prioGroup.classList.remove('hidden');
            else prioGroup.classList.add('hidden');
            const srvGroup = overlay.querySelector('#dns-srv-group');
            if (cfg.srv) srvGroup.classList.remove('hidden');
            else srvGroup.classList.add('hidden');
            const proxGroup = overlay.querySelector('#dns-proxied-group');
            proxGroup.style.display = cfg.proxied ? '' : 'none';
        });

        // Save handler
        overlay.querySelector('#dns-save-btn').addEventListener('click', async () => {
            const type = overlay.querySelector('#dns-type').value;
            const name = overlay.querySelector('#dns-name').value.trim();
            const content = overlay.querySelector('#dns-content').value.trim();
            const ttl = parseInt(overlay.querySelector('#dns-ttl').value);
            const proxied = overlay.querySelector('#dns-proxied')?.checked || false;
            const msg = overlay.querySelector('#dns-modal-msg');

            if (!name || !content) {
                msg.innerHTML = '<div class="error-message">Name and content are required</div>';
                return;
            }

            const record = { type, name, content, ttl };
            const cfg = this.typeFields[type];

            if (cfg.proxied) record.proxied = proxied;
            if (cfg.priority) record.priority = parseInt(overlay.querySelector('#dns-priority').value) || 10;

            msg.innerHTML = '<div class="loading">Saving...</div>';

            try {
                if (isEdit) {
                    await API.patch(`/api/cf/zones/${this.zoneId}/dns/${existing.id}`, record);
                } else {
                    await API.post(`/api/cf/zones/${this.zoneId}/dns`, record);
                }
                closeModal();
                await this.loadRecords();
            } catch (err) {
                msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
            }
        });
    },

    showDeleteModal(record) {
        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>Delete DNS Record</h2>
            <p>Delete <strong>${record.type}</strong> record <strong>${escapeHtml(record.name)}</strong>?</p>
            <p class="text-muted mt-12">${escapeHtml(record.content)}</p>
            <div id="dns-del-msg"></div>
            <div class="btn-row">
                <button class="btn" onclick="closeModal()">Cancel</button>
                <button class="btn btn-danger" id="dns-del-btn">Delete</button>
            </div>`);

        overlay.querySelector('#dns-del-btn').addEventListener('click', async () => {
            const msg = overlay.querySelector('#dns-del-msg');
            msg.innerHTML = '<div class="loading">Deleting...</div>';
            try {
                await API.del(`/api/cf/zones/${this.zoneId}/dns/${record.id}`);
                closeModal();
                await this.loadRecords();
            } catch (err) {
                msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
            }
        });
    },
};

Router.register('/cf/zones/([^/]+)/dns', (m) => DNS.render(m));
