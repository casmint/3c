/* 3C Panel — Zone analytics (/cf/zones/:domain/analytics) */

const Analytics = {
    chart: null,
    domain: null,

    async render(match) {
        this.domain = match[1];
        const content = $('#content');

        // Resolve zone
        let zone = ZoneCache.findByName(this.domain);
        if (!zone) {
            try { await ZoneCache.get(); zone = ZoneCache.findByName(this.domain); } catch {}
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

        const bar = await renderZoneContextBar(this.domain, 'analytics');
        content.innerHTML = bar + `
            <div class="page-header">
                <h1>Analytics</h1>
                <span class="text-muted">Last 7 days · daily granularity (free tier)</span>
            </div>
            <div class="stats-grid" id="stats-summary"><div class="loading">Loading analytics...</div></div>
            <div class="chart-container"><canvas id="requests-chart"></canvas></div>
            <div id="analytics-table-container"></div>`;

        bindZoneSwitcher();

        try {
            const data = await API.get(`/api/cf/zones/${zone.id}/analytics`);
            const groups = data?.data?.viewer?.zones?.[0]?.httpRequests1dGroups || [];
            this.renderSummary(groups);
            this.renderChart(groups);
            this.renderTable(groups);
        } catch (err) {
            $('#stats-summary').innerHTML =
                `<div class="error-message">Failed to load analytics: ${escapeHtml(err.message)}</div>`;
        }
    },

    renderSummary(groups) {
        let totalRequests = 0, totalBytes = 0, totalCached = 0, totalThreats = 0, totalUniques = 0;

        for (const g of groups) {
            totalRequests += g.sum.requests || 0;
            totalBytes += g.sum.bytes || 0;
            totalCached += g.sum.cachedBytes || 0;
            totalThreats += g.sum.threats || 0;
            totalUniques += g.uniq.uniques || 0;
        }

        const cacheRatio = totalBytes > 0 ? ((totalCached / totalBytes) * 100).toFixed(1) : 0;

        $('#stats-summary').innerHTML = `
            <div class="stat-card">
                <div class="stat-label">Total Requests</div>
                <div class="stat-value accent">${totalRequests.toLocaleString()}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Bandwidth</div>
                <div class="stat-value">${formatBytes(totalBytes)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Unique Visitors</div>
                <div class="stat-value">${totalUniques.toLocaleString()}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Cached</div>
                <div class="stat-value">${cacheRatio}%</div>
                <div class="cache-bar"><div class="cache-bar-fill" style="width:${cacheRatio}%"></div></div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Threats Blocked</div>
                <div class="stat-value">${totalThreats.toLocaleString()}</div>
            </div>`;
    },

    renderChart(groups) {
        if (this.chart) { this.chart.destroy(); this.chart = null; }

        const canvas = document.getElementById('requests-chart');
        if (!canvas) return;

        const labels = groups.map(g => g.dimensions.date);
        const data = groups.map(g => g.sum.requests || 0);

        this.chart = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Requests',
                    data,
                    backgroundColor: '#ff5f1f',
                    borderWidth: 0,
                    borderRadius: 0,
                    borderSkipped: false,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1a1a1a',
                        borderColor: '#333',
                        borderWidth: 1,
                        titleFont: { family: "'JetBrains Mono', monospace" },
                        bodyFont: { family: "'JetBrains Mono', monospace" },
                    },
                },
                scales: {
                    x: {
                        grid: { color: '#333' },
                        ticks: { color: '#888', font: { family: "'JetBrains Mono', monospace", size: 11 } },
                    },
                    y: {
                        grid: { color: '#333' },
                        ticks: { color: '#888', font: { family: "'JetBrains Mono', monospace", size: 11 } },
                    },
                },
            },
        });
    },

    renderTable(groups) {
        if (!groups.length) {
            $('#analytics-table-container').innerHTML = '<div class="info-message">No data for this period.</div>';
            return;
        }

        const rows = groups.map(g => {
            const cached = g.sum.bytes > 0
                ? ((g.sum.cachedBytes / g.sum.bytes) * 100).toFixed(1) + '%'
                : '—';
            return `<tr>
                <td>${g.dimensions.date}</td>
                <td>${(g.sum.requests || 0).toLocaleString()}</td>
                <td>${formatBytes(g.sum.bytes)}</td>
                <td>${(g.uniq.uniques || 0).toLocaleString()}</td>
                <td>${cached}</td>
                <td>${(g.sum.threats || 0).toLocaleString()}</td>
            </tr>`;
        }).join('');

        $('#analytics-table-container').innerHTML = `
            <table class="data-table">
                <thead><tr>
                    <th>Date</th><th>Requests</th><th>Bandwidth</th><th>Visitors</th><th>Cached</th><th>Threats</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    },
};

Router.register('/cf/zones/([^/]+)/analytics', (m) => Analytics.render(m));
