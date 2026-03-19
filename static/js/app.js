/* 3C Panel — SPA core: router, sidebars, shared utilities */

// ================================================================
// API helper
// ================================================================
const API = {
    async get(path) {
        const resp = await fetch(path);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: resp.statusText }));
            throw new Error(err.error || err.detail || resp.statusText);
        }
        return resp.json();
    },

    async post(path, body) {
        const resp = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: resp.statusText }));
            throw new Error(err.error || err.detail || resp.statusText);
        }
        return resp.json();
    },

    async patch(path, body) {
        const resp = await fetch(path, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: resp.statusText }));
            throw new Error(err.error || err.detail || resp.statusText);
        }
        return resp.json();
    },

    async put(path, body) {
        const resp = await fetch(path, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: resp.statusText }));
            throw new Error(err.error || err.detail || resp.statusText);
        }
        return resp.json();
    },

    async del(path, body) {
        const opts = { method: 'DELETE' };
        if (body) {
            opts.headers = { 'Content-Type': 'application/json' };
            opts.body = JSON.stringify(body);
        }
        const resp = await fetch(path, opts);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: resp.statusText }));
            throw new Error(err.error || err.detail || resp.statusText);
        }
        return resp.json();
    },
};

// ================================================================
// DOM helpers
// ================================================================
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

// ================================================================
// Zone cache
// ================================================================
const ZoneCache = {
    zones: null,

    async get() {
        if (!this.zones) {
            const data = await API.get('/api/cf/zones?per_page=50');
            this.zones = data.result || [];
        }
        return this.zones;
    },

    invalidate() { this.zones = null; },

    findByName(name) {
        return this.zones ? this.zones.find(z => z.name === name) : null;
    },
};

// ================================================================
// Porkbun domain cache
// ================================================================
const DomainCache = {
    data: null,
    loading: null,

    async get() {
        if (this.data) return this.data;
        if (this.loading) return this.loading;
        this.loading = API.get('/api/domains').then(resp => {
            this.data = resp.domains || [];
            this.loading = null;
            return this.data;
        }).catch(err => {
            this.loading = null;
            throw err;
        });
        return this.loading;
    },

    invalidate() { this.data = null; this.loading = null; },
};

// ================================================================
// Utility functions
// ================================================================
function formatBytes(bytes) {
    if (bytes == null) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function showModal(html) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal">${html}</div>`;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
    // Close button
    const close = overlay.querySelector('.modal-close');
    if (close) close.addEventListener('click', () => overlay.remove());
    return overlay;
}

function closeModal() {
    const m = document.querySelector('.modal-overlay');
    if (m) m.remove();
}

// ================================================================
// Zone context bar (analytics / dns sub-pages)
// ================================================================
async function renderZoneContextBar(domain, activeTab) {
    let zones = ZoneCache.zones;
    if (!zones) {
        try { zones = await ZoneCache.get(); } catch { zones = []; }
    }
    const options = zones
        .map(z => `<option value="${z.name}" ${z.name === domain ? 'selected' : ''}>${z.name}</option>`)
        .join('');

    return `
        <div class="zone-context-bar">
            <div class="zone-selector">
                <select id="zone-switcher">${options}</select>
            </div>
            <div class="zone-tabs">
                <a href="/cf/zones/${domain}/analytics"
                   class="${activeTab === 'analytics' ? 'active' : ''}">Analytics</a>
                <a href="/cf/zones/${domain}/dns"
                   class="${activeTab === 'dns' ? 'active' : ''}">DNS</a>
            </div>
        </div>`;
}

function bindZoneSwitcher() {
    const sel = $('#zone-switcher');
    if (sel) {
        sel.addEventListener('change', () => {
            const path = location.pathname;
            const tab = path.includes('/dns') ? 'dns' : 'analytics';
            Router.navigate(`/cf/zones/${sel.value}/${tab}`);
        });
    }
}

// ================================================================
// Placeholder renderer
// ================================================================
function renderPlaceholder(emoji, title, description) {
    $('#content').innerHTML = `
        <div class="placeholder">
            <span class="placeholder-emoji">${emoji}</span>
            <h2>${title}</h2>
            <p>${description}</p>
        </div>`;
}

// ================================================================
// Router
// ================================================================
const Router = {
    routes: [],

    register(pattern, handler) {
        this.routes.push({ pattern: new RegExp('^' + pattern + '$'), handler });
    },

    async navigate(path, pushState = true) {
        if (pushState) history.pushState(null, '', path);
        await this.resolve(path);
    },

    async resolve(path) {
        // Update sidebars
        Sidebar.update(path);

        for (const route of this.routes) {
            const match = path.match(route.pattern);
            if (match) {
                try {
                    await route.handler(match);
                } catch (err) {
                    $('#content').innerHTML = `<div class="error-message">Error: ${escapeHtml(err.message)}</div>`;
                }
                return;
            }
        }

        // 404
        $('#content').innerHTML = '<div class="placeholder"><span class="placeholder-emoji">🔍</span><h2>404</h2><p>Page not found</p></div>';
    },

    init() {
        window.addEventListener('popstate', () => this.resolve(location.pathname));

        // Intercept internal link clicks
        document.addEventListener('click', (e) => {
            const a = e.target.closest('a[href]');
            if (!a) return;
            const href = a.getAttribute('href');
            if (!href || href.startsWith('http') || href.startsWith('//') || a.hasAttribute('data-external')) return;
            e.preventDefault();
            this.navigate(href);
        });

        this.resolve(location.pathname);
    },
};

// ================================================================
// Sidebar
// ================================================================
const Sidebar = {
    sections: [
        { emoji: '☁️',  label: 'Cloudflare', route: '/cf/zones', prefix: '/cf' },
        { emoji: '🐷', label: 'Porkbun',    route: '/domains',  prefix: '/domains' },
        { emoji: '✉️',  label: 'Migadu',     route: '/email',    prefix: '/email' },
        { emoji: '🌱', label: 'Apps',       route: '/apps',     prefix: '/apps' },
        { emoji: '🖥️',  label: 'Server',     route: '/server',   prefix: '/server' },
    ],

    cfSubs: [
        { emoji: '🌐', label: 'Zones',     route: '/cf/zones',     prefix: '/cf/zones' },
        { emoji: '🔗', label: 'Redirects', route: '/cf/redirects', prefix: '/cf/redirects' },
        { emoji: '🌍', label: 'Pages',     route: '/cf/pages',     prefix: '/cf/pages' },
    ],

    emailSubs: [
        { emoji: '🌐', label: 'Domains',   route: '/email/domains',   prefix: '/email/domains' },
        { emoji: '📬', label: 'Mailboxes', route: '/email/mailboxes', prefix: '/email/mailboxes' },
        { emoji: '🌍', label: 'Webmail',   href: 'https://webmail.migadu.com', external: true },
    ],

    render() {
        const primary = $('#sidebar-primary');
        primary.innerHTML = this.sections
            .map(s => `<button class="sidebar-btn" data-route="${s.route}" data-prefix="${s.prefix}" data-tooltip="${s.label}">${s.emoji}</button>`)
            .join('');

        primary.addEventListener('click', (e) => {
            const btn = e.target.closest('.sidebar-btn');
            if (btn) Router.navigate(btn.dataset.route);
        });

        const secondary = $('#sidebar-secondary');
        const cfHtml = this.cfSubs
            .map(s => `<a class="sidebar2-item cf-sub" href="${s.route}" data-prefix="${s.prefix}"><span>${s.emoji}</span> ${s.label}</a>`)
            .join('');
        const emailHtml = this.emailSubs
            .map(s => {
                if (s.external) {
                    return `<a class="sidebar2-item email-sub" href="${s.href}" target="_blank" data-external><span>${s.emoji}</span> ${s.label}</a>`;
                }
                return `<a class="sidebar2-item email-sub" href="${s.route}" data-prefix="${s.prefix}"><span>${s.emoji}</span> ${s.label}</a>`;
            })
            .join('');
        secondary.innerHTML = cfHtml + emailHtml;
    },

    update(path) {
        // Primary sidebar active state
        $$('.sidebar-btn').forEach(btn => {
            btn.classList.toggle('active', path.startsWith(btn.dataset.prefix));
        });

        const sec = $('#sidebar-secondary');
        if (path.startsWith('/cf')) {
            sec.classList.remove('hidden');
            $$('.cf-sub').forEach(el => el.style.display = '');
            $$('.email-sub').forEach(el => el.style.display = 'none');
            $$('.sidebar2-item.cf-sub').forEach(item => {
                item.classList.toggle('active', path.startsWith(item.dataset.prefix));
            });
        } else if (path.startsWith('/email')) {
            sec.classList.remove('hidden');
            $$('.cf-sub').forEach(el => el.style.display = 'none');
            $$('.email-sub').forEach(el => el.style.display = '');
            $$('.sidebar2-item.email-sub').forEach(item => {
                if (item.dataset.prefix) {
                    item.classList.toggle('active', path.startsWith(item.dataset.prefix));
                }
            });
        } else {
            sec.classList.add('hidden');
        }
    },
};

// ================================================================
// Route registration
// ================================================================

// Redirects
Router.register('/', () => Router.navigate('/cf/zones'));
Router.register('/cf/?', () => Router.navigate('/cf/zones'));

// Redirect bare zone to analytics
Router.register('/cf/zones/([^/]+)/?', (m) => Router.navigate(`/cf/zones/${m[1]}/analytics`));

// Feature routes (registered by their respective JS files on load)
// Zones, DNS, Analytics, Redirects, Pages — see zones.js, dns.js, etc.

// Placeholder routes (apps.js registers /apps route itself)
// /domains route registered by domains.js
Router.register('/email/?', () => Router.navigate('/email/domains'));
Router.register('/server', () => renderPlaceholder('🖥️', 'Server', 'Server console — coming soon. Web terminal, systemctl management, system stats, filesystem explorer.'));

// ================================================================
// Boot
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
    Sidebar.render();
    Router.init();
});
