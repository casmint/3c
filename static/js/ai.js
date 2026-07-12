/* 3C Panel — AI backend status (/ai) */

const AI = {
    activeTab: 'oracle', data: null,
    async render() {
        $('#content').innerHTML = `<div class="page-header"><h1>AI</h1><button class="btn" id="ai-refresh">Refresh</button></div><p class="text-muted ai-intro">Read-only checks from the 3C panel. No backend URLs or credentials are exposed.</p><div class="ai-tabs"><button class="ai-tab active" data-ai-tab="oracle">Oracle-Ollama</button><button class="ai-tab" data-ai-tab="compgate">Tailscale-CompGate</button></div><div id="ai-status"><div class="loading">Checking AI backends...</div></div>`;
        this.bindEvents(); await this.refresh();
    },
    bindEvents() {
        $('#ai-refresh')?.addEventListener('click', () => this.refresh());
        $$('.ai-tab').forEach(tab => tab.addEventListener('click', () => { this.activeTab = tab.dataset.aiTab; $$('.ai-tab').forEach(item => item.classList.toggle('active', item === tab)); this.renderActiveTab(); }));
    },
    async refresh() {
        const root = $('#ai-status'); if (root) root.innerHTML = '<div class="loading">Checking AI backends...</div>';
        try { this.data = await API.get('/api/ai/status'); this.renderActiveTab(); }
        catch (err) { if (root) root.innerHTML = `<div class="error-message">Failed to check AI backends: ${escapeHtml(err.message)}</div>`; }
    },
    badge(state) {
        const labels = { available: ['badge-active', 'AVAILABLE'], paused_or_busy: ['badge-pending', 'PAUSED / BUSY'], unreachable: ['badge-moved', 'UNREACHABLE'], error: ['badge-moved', 'ERROR'], unknown: ['badge-neutral', 'UNKNOWN'] };
        const [klass, label] = labels[state] || labels.unknown; return `<span class="badge ${klass}">${label}</span>`;
    },
    renderActiveTab() {
        const root = $('#ai-status'); if (!root || !this.data) return;
        if (this.activeTab === 'oracle') {
            const status = this.data.oracle_ollama;
            const model = status.model_present ? '<span class="badge badge-active">PRESENT</span>' : '<span class="badge badge-pending">NOT FOUND</span>';
            root.innerHTML = `<section class="ai-card"><div class="ai-card-header"><h2>Oracle-Ollama</h2>${this.badge(status.state)}</div><p>Always-on, CPU-only inference on the Oracle server.</p><dl class="ai-details"><div><dt>Service</dt><dd>oracle-ollama</dd></div><div><dt>Expected model</dt><dd>${escapeHtml(status.expected_model)} ${model}</dd></div><div><dt>Consumers</dt><dd>${status.apps.map(escapeHtml).join(', ')}</dd></div></dl></section>`;
            return;
        }
        const status = this.data.tailscale_compgate;
        root.innerHTML = `<section class="ai-card"><div class="ai-card-header"><h2>Tailscale-CompGate</h2>${this.badge(status.state)}</div><p>Home-PC gateway reached through the private Tailscale bridge. A 503 means the GPU is intentionally paused or busy, not that the bridge is down.</p><dl class="ai-details"><div><dt>Gateway</dt><dd>CompGate via Tailscale</dd></div><div><dt>Expected LLM</dt><dd>${escapeHtml(status.expected_model)}</dd></div><div><dt>Consumers</dt><dd>${status.apps.map(escapeHtml).join(', ')}</dd></div></dl><h3 class="ai-services-title">Home services</h3><div class="ai-service-grid">${Object.entries(status.services).map(([name, state]) => `<div><span>${escapeHtml(name.replace('_', ' '))}</span>${this.badge(state)}</div>`).join('')}</div><p class="text-muted ai-note">Detailed home-service state remains on the home PC’s local CompGate status page. A future machine-readable CompGate status endpoint can populate these fields.</p></section>`;
    },
};

Router.register('/ai', () => AI.render());
