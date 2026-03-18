/* 3C Panel — Bulk redirects manager (/cf/redirects) */

const Redirects = {
    lists: [],
    items: [],
    activeListId: null,

    async render() {
        const content = $('#content');
        content.innerHTML = `
            <div class="page-header">
                <h1>Bulk Redirects</h1>
                <button class="btn btn-accent" id="add-redirect-btn">+ Add Redirect</button>
            </div>
            <div class="toolbar">
                <select class="form-select" id="redirect-list-select" style="width:300px">
                    <option value="">Loading lists...</option>
                </select>
            </div>
            <div id="redirects-table-container"><div class="loading">Loading redirect lists...</div></div>`;

        await this.loadLists();
        this.bindEvents();
    },

    _el(id) {
        return document.getElementById(id);
    },

    _setHtml(el, html) {
        if (typeof el === 'string') el = this._el(el) || $(el);
        if (el) el.innerHTML = html;
    },

    _showError(msg) {
        const el = this._el('redirects-table-container');
        if (el) {
            el.innerHTML = `<div class="error-message">${escapeHtml(msg)}</div>`;
        } else {
            // Container hasn't rendered — write error to main content area
            const content = $('#content');
            if (content) content.innerHTML = `<div class="error-message">${escapeHtml(msg)}</div>`;
        }
    },

    async loadLists() {
        try {
            const data = await API.get('/api/cf/redirects/lists');
            this.lists = (data.result || []).filter(l => l.kind === 'redirect');

            const sel = this._el('redirect-list-select');
            if (!this.lists.length) {
                this._setHtml(sel, '<option value="">No redirect lists found</option>');
                this._setHtml(this._el('redirects-table-container'),
                    '<div class="info-message">No redirect lists found. Create one in the Cloudflare dashboard first.</div>');
                return;
            }

            this._setHtml(sel, this.lists
                .map(l => `<option value="${l.id}">${escapeHtml(l.name)} (${l.num_items} items)</option>`)
                .join(''));

            this.activeListId = this.lists[0].id;
            await this.loadItems();
        } catch (err) {
            this._showError(`Failed to load lists: ${err.message}`);
        }
    },

    async loadItems() {
        if (!this.activeListId) return;
        const container = this._el('redirects-table-container');
        this._setHtml(container, '<div class="loading">Loading redirects...</div>');

        try {
            const data = await API.get(`/api/cf/redirects/lists/${this.activeListId}/items`);
            this.items = data.result || [];
            this.renderTable();
        } catch (err) {
            this._showError(`Failed to load items: ${err.message}`);
        }
    },

    renderTable() {
        const container = this._el('redirects-table-container');
        if (!this.items.length) {
            this._setHtml(container, '<div class="info-message">No redirects in this list.</div>');
            return;
        }

        const rows = this.items.map(item => {
            const r = item.redirect || {};
            const code = r.status_code || 301;
            return `<tr>
                <td class="truncate" title="${escapeHtml(r.source_url || '')}">${escapeHtml(r.source_url || '—')}</td>
                <td class="truncate" title="${escapeHtml(r.target_url || '')}">${escapeHtml(r.target_url || '—')}</td>
                <td><span class="badge badge-free">${code}</span></td>
                <td class="actions">
                    <button class="btn btn-sm btn-danger" data-del-redirect="${item.id}">D</button>
                </td>
            </tr>`;
        }).join('');

        this._setHtml(container, `
            <table class="data-table">
                <thead><tr>
                    <th>Source URL</th><th>Target URL</th><th>Status</th><th>Actions</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`);

        // Bind delete buttons
        $$('[data-del-redirect]').forEach(btn => {
            btn.addEventListener('click', () => this.showDeleteModal(btn.dataset.delRedirect));
        });
    },

    bindEvents() {
        $('#redirect-list-select')?.addEventListener('change', (e) => {
            this.activeListId = e.target.value;
            this.loadItems();
        });

        $('#add-redirect-btn')?.addEventListener('click', () => this.showAddModal());
    },

    showAddModal() {
        if (!this.activeListId) {
            showModal(`
                <button class="modal-close">&times;</button>
                <h2>Add Redirect</h2>
                <div class="error-message">No redirect list selected. Create a list in the Cloudflare dashboard first.</div>`);
            return;
        }

        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>Add Redirect</h2>
            <div class="form-group">
                <label>Source URL</label>
                <input type="text" class="form-input" id="redir-source" placeholder="https://example.com/old-path">
            </div>
            <div class="form-group">
                <label>Target URL</label>
                <input type="text" class="form-input" id="redir-target" placeholder="https://example.com/new-path">
            </div>
            <div class="form-group">
                <label>Status Code</label>
                <select class="form-select" id="redir-code">
                    <option value="301">301 — Permanent</option>
                    <option value="302">302 — Temporary</option>
                </select>
            </div>
            <div id="redir-msg"></div>
            <div class="btn-row">
                <button class="btn" onclick="closeModal()">Cancel</button>
                <button class="btn btn-accent" id="redir-save-btn">Create</button>
            </div>`);

        overlay.querySelector('#redir-save-btn').addEventListener('click', async () => {
            const source = overlay.querySelector('#redir-source').value.trim();
            const target = overlay.querySelector('#redir-target').value.trim();
            const code = parseInt(overlay.querySelector('#redir-code').value);
            const msg = overlay.querySelector('#redir-msg');

            if (!source || !target) {
                msg.innerHTML = '<div class="error-message">Source and target URLs are required</div>';
                return;
            }

            msg.innerHTML = '<div class="loading">Creating redirect...</div>';

            try {
                await API.post(`/api/cf/redirects/lists/${this.activeListId}/items`, [{
                    redirect: { source_url: source, target_url: target, status_code: code },
                }]);
                closeModal();
                await this.loadItems();
            } catch (err) {
                msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
            }
        });
    },

    showDeleteModal(itemId) {
        const item = this.items.find(i => i.id === itemId);
        const source = item?.redirect?.source_url || 'this redirect';

        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>Delete Redirect</h2>
            <p>Delete redirect from <strong>${escapeHtml(source)}</strong>?</p>
            <div id="redir-del-msg"></div>
            <div class="btn-row">
                <button class="btn" onclick="closeModal()">Cancel</button>
                <button class="btn btn-danger" id="redir-del-btn">Delete</button>
            </div>`);

        overlay.querySelector('#redir-del-btn').addEventListener('click', async () => {
            const msg = overlay.querySelector('#redir-del-msg');
            msg.innerHTML = '<div class="loading">Deleting...</div>';
            try {
                await API.del(`/api/cf/redirects/lists/${this.activeListId}/items`, { item_ids: [itemId] });
                closeModal();
                await this.loadItems();
            } catch (err) {
                msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
            }
        });
    },
};

Router.register('/cf/redirects', () => Redirects.render());
