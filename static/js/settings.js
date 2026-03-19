/* 3C Panel — Settings (/settings) */

const Settings = {
    accents: [
        { color: '#ff5f1f', label: 'Orange' },
        { color: '#00c896', label: 'Teal' },
        { color: '#4fc3f7', label: 'Sky' },
        { color: '#a78bfa', label: 'Violet' },
        { color: '#f472b6', label: 'Pink' },
        { color: '#facc15', label: 'Yellow' },
        { color: '#86efac', label: 'Mint' },
        { color: '#f87171', label: 'Red' },
    ],

    render() {
        const currentTheme = localStorage.getItem('3c-theme') || 'dark';
        const currentAccent = localStorage.getItem('3c-accent') || '#ff5f1f';

        const swatches = this.accents.map(a => {
            const active = a.color.toLowerCase() === currentAccent.toLowerCase() ? ' active' : '';
            return `<button class="accent-swatch${active}" data-color="${a.color}" title="${a.label}" style="background:${a.color}"></button>`;
        }).join('');

        const content = $('#content');
        content.innerHTML = `
            <div class="page-header"><h1>Settings</h1></div>

            <div class="settings-section">
                <h2>Appearance</h2>
                <div class="settings-row">
                    <label>Theme</label>
                    <div class="theme-toggle">
                        <button id="theme-dark" class="${currentTheme === 'dark' ? 'active' : ''}">DARK</button>
                        <button id="theme-light" class="${currentTheme === 'light' ? 'active' : ''}">LIGHT</button>
                    </div>
                </div>
                <div class="settings-row">
                    <label>Accent Color</label>
                    <div class="accent-swatches">${swatches}</div>
                </div>
            </div>

            <div class="settings-section">
                <h2>Integrations</h2>
                <div id="integrations-container"><div class="loading">Checking connections...</div></div>
            </div>`;

        this.bindEvents();
        this.loadIntegrations();
    },

    bindEvents() {
        document.getElementById('theme-dark')?.addEventListener('click', () => this.setTheme('dark'));
        document.getElementById('theme-light')?.addEventListener('click', () => this.setTheme('light'));

        $$('.accent-swatch').forEach(btn => {
            btn.addEventListener('click', () => this.setAccent(btn.dataset.color));
        });
    },

    setTheme(theme) {
        localStorage.setItem('3c-theme', theme);
        if (theme === 'light') {
            document.documentElement.classList.add('theme-light');
        } else {
            document.documentElement.classList.remove('theme-light');
        }
        // Update toggle buttons
        const dark = document.getElementById('theme-dark');
        const light = document.getElementById('theme-light');
        if (dark) dark.classList.toggle('active', theme === 'dark');
        if (light) light.classList.toggle('active', theme === 'light');
    },

    setAccent(color) {
        localStorage.setItem('3c-accent', color);
        document.documentElement.style.setProperty('--accent', color);

        $$('.accent-swatch').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.color === color);
        });
    },

    async loadIntegrations() {
        const container = document.getElementById('integrations-container');
        if (!container) return;

        try {
            const status = await API.get('/api/settings/status');

            const services = [
                { key: 'cloudflare', label: 'Cloudflare', emoji: '☁️' },
                { key: 'porkbun', label: 'Porkbun', emoji: '🐷' },
                { key: 'migadu', label: 'Migadu', emoji: '✉️' },
            ];

            const rows = services.map(s => {
                const connected = status[s.key];
                const badge = connected
                    ? '<span class="badge badge-active">Connected</span>'
                    : '<span class="badge badge-moved">Not configured</span>';
                return `<div class="integration-row">
                    <span class="int-name">${s.emoji} ${escapeHtml(s.label)}</span>
                    <span class="int-status">${badge}</span>
                    <span class="int-result" id="int-result-${s.key}"></span>
                    <button class="btn btn-sm" data-test="${s.key}" ${!connected ? 'disabled' : ''}>Test</button>
                </div>`;
            }).join('');

            container.innerHTML = rows;

            container.querySelectorAll('[data-test]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const svc = btn.dataset.test;
                    const result = document.getElementById(`int-result-${svc}`);
                    if (result) result.innerHTML = '<span class="loading" style="font-size:11px">Testing...</span>';
                    btn.disabled = true;

                    try {
                        const data = await API.post(`/api/settings/test/${svc}`);
                        if (result) {
                            result.innerHTML = data.success
                                ? `<span class="text-success">${escapeHtml(data.message)}</span>`
                                : `<span class="text-danger">${escapeHtml(data.message)}</span>`;
                        }
                    } catch (err) {
                        if (result) result.innerHTML = `<span class="text-danger">${escapeHtml(err.message)}</span>`;
                    }
                    btn.disabled = false;
                });
            });
        } catch (err) {
            container.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }
    },
};

Router.register('/settings', () => Settings.render());
