/* 3C Panel — Migadu email manager (/email) */

// ================================================================
// EmailDomains — domain list + add domain flow
// ================================================================
const EmailDomains = {
    domains: [],

    async render() {
        const content = $('#content');
        content.innerHTML = `
            <div class="page-header">
                <h1>Email Domains</h1>
                <button class="btn btn-accent" id="add-email-domain-btn">+ Add Domain</button>
            </div>
            <div id="email-domains-container"><div class="loading">Loading domains...</div></div>`;

        await this.loadDomains();
        $('#add-email-domain-btn')?.addEventListener('click', () => this.showAddDomainModal());
    },

    async loadDomains() {
        const container = $('#email-domains-container');
        try {
            const data = await API.get('/api/email/domains');
            // Migadu returns either an array or {domains: [...]}
            this.domains = Array.isArray(data) ? data : (data.domains || []);
            this.renderTable();
        } catch (err) {
            container.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }
    },

    renderTable() {
        const container = $('#email-domains-container');
        if (!this.domains.length) {
            container.innerHTML = '<div class="info-message">No email domains configured. Add one to get started.</div>';
            return;
        }

        const rows = this.domains.map(d => {
            const name = d.name || d.domain || '';
            const confirmed = d.confirmed || d.state === 'active';
            const badge = confirmed
                ? '<span class="badge badge-active">ACTIVE</span>'
                : '<span class="badge badge-pending">INACTIVE</span>';
            const sendRecv = `
                <span class="badge ${d.can_send ? 'badge-active' : 'badge-moved'}" style="font-size:10px">${d.can_send ? 'SEND' : 'NO SEND'}</span>
                <span class="badge ${d.can_receive ? 'badge-active' : 'badge-moved'}" style="font-size:10px">${d.can_receive ? 'RECV' : 'NO RECV'}</span>`;
            const catchall = (d.catchall_destinations || []);
            const catchallHtml = catchall.length
                ? `<span class="text-muted mono" style="font-size:10px" title="${escapeHtml(catchall.join(', '))}">*@ &rarr; ${escapeHtml(catchall[0])}${catchall.length > 1 ? ' +' + (catchall.length - 1) : ''}</span>`
                : '<span class="text-muted" style="font-size:10px">no catchall</span>';

            return `<tr>
                <td>
                    <a href="/email/domains/${encodeURIComponent(name)}" style="color:var(--text-primary);font-weight:600">${escapeHtml(name)}</a>
                    <div style="margin-top:2px">${catchallHtml}</div>
                </td>
                <td>${badge}</td>
                <td>${sendRecv}</td>
                <td class="actions">
                    <button class="btn btn-sm" data-catchall-domain="${escapeHtml(name)}">Catchall</button>
                    <a href="/email/domains/${encodeURIComponent(name)}/dns" class="btn btn-sm">DNS</a>
                    <button class="btn btn-sm" data-diag-domain="${escapeHtml(name)}">Diagnostics</button>
                </td>
            </tr>`;
        }).join('');

        container.innerHTML = `
            <p class="text-muted" style="font-size:11px;margin-bottom:12px">Domain deletion is not available via API — use the Migadu admin panel to delete domains.</p>
            <table class="data-table">
                <thead><tr>
                    <th>Domain</th><th>Status</th><th>Send / Receive</th><th>Actions</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;

        $$('[data-diag-domain]').forEach(btn => {
            btn.addEventListener('click', () => this.showDiagnosticsModal(btn.dataset.diagDomain));
        });
        $$('[data-catchall-domain]').forEach(btn => {
            btn.addEventListener('click', () => this.showCatchallModal(btn.dataset.catchallDomain));
        });
    },

    async renderDetail(match) {
        const domain = decodeURIComponent(match[1]);
        const content = $('#content');
        content.innerHTML = `
            <div class="page-header">
                <h1>${escapeHtml(domain)}</h1>
                <div>
                    <a href="/email/domains/${encodeURIComponent(domain)}/dns" class="btn btn-sm">DNS Setup</a>
                    <a href="/email/mailboxes/${encodeURIComponent(domain)}" class="btn btn-sm">Mailboxes</a>
                </div>
            </div>
            <div id="email-domain-detail"><div class="loading">Loading domain details...</div></div>`;

        try {
            const data = await API.get(`/api/email/domains/${encodeURIComponent(domain)}`);
            const confirmed = data.confirmed || data.state === 'active';
            const detail = $('#email-domain-detail');
            detail.innerHTML = `
                <table class="data-table">
                    <tbody>
                        <tr><td style="width:160px"><strong>Status</strong></td><td>${confirmed ? '<span class="badge badge-active">ACTIVE</span>' : '<span class="badge badge-pending">INACTIVE</span>'}</td></tr>
                        <tr><td><strong>Can Send</strong></td><td>${data.can_send ? 'Yes' : 'No'}</td></tr>
                        <tr><td><strong>Can Receive</strong></td><td>${data.can_receive ? 'Yes' : 'No'}</td></tr>
                    </tbody>
                </table>
                <div class="mt-16">
                    <button class="btn" id="run-diag-btn">Run Diagnostics</button>
                    ${!confirmed ? '<button class="btn btn-accent ml-8" id="activate-btn">Activate Domain</button>' : ''}
                </div>
                <div id="domain-action-msg" class="mt-12"></div>`;

            detail.querySelector('#run-diag-btn')?.addEventListener('click', async () => {
                const msg = detail.querySelector('#domain-action-msg');
                msg.innerHTML = '<div class="loading">Running diagnostics...</div>';
                try {
                    const diag = await API.get(`/api/email/domains/${encodeURIComponent(domain)}/diagnostics`);
                    msg.innerHTML = EmailDNS.renderDiagnostics(diag);
                } catch (e) {
                    msg.innerHTML = `<div class="error-message">${escapeHtml(e.message)}</div>`;
                }
            });

            detail.querySelector('#activate-btn')?.addEventListener('click', async () => {
                const msg = detail.querySelector('#domain-action-msg');
                msg.innerHTML = '<div class="loading">Activating domain...</div>';
                try {
                    await API.post(`/api/email/domains/${encodeURIComponent(domain)}/activate`);
                    msg.innerHTML = '<div class="success-message">Domain activated successfully.</div>';
                    setTimeout(() => this.renderDetail(match), 1200);
                } catch (e) {
                    msg.innerHTML = `<div class="error-message">${escapeHtml(e.message)}</div>`;
                }
            });
        } catch (err) {
            $('#email-domain-detail').innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }
    },

    showDiagnosticsModal(domain) {
        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>Diagnostics: ${escapeHtml(domain)}</h2>
            <div id="diag-result"><div class="loading">Running diagnostics...</div></div>`);

        API.get(`/api/email/domains/${encodeURIComponent(domain)}/diagnostics`)
            .then(diag => {
                overlay.querySelector('#diag-result').innerHTML = EmailDNS.renderDiagnostics(diag);
            })
            .catch(err => {
                overlay.querySelector('#diag-result').innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
            });
    },

    async showCatchallModal(domain) {
        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>Catchall: ${escapeHtml(domain)}</h2>
            <p class="text-muted" style="font-size:12px">All unmatched incoming email will be forwarded to these addresses.</p>
            <div id="catchall-body"><div class="loading">Loading...</div></div>`);

        const body = overlay.querySelector('#catchall-body');

        try {
            const [catchData, mbData] = await Promise.all([
                API.get(`/api/email/domains/${encodeURIComponent(domain)}/catchall`),
                API.get(`/api/email/mailboxes/${encodeURIComponent(domain)}`).catch(() => []),
            ]);

            const current = (catchData.catchall_destinations || []).join(', ');
            const mailboxes = Array.isArray(mbData) ? mbData : (mbData.mailboxes || []);
            const hasCatchall = (catchData.catchall_destinations || []).length > 0;

            let mbOptions = '';
            if (mailboxes.length) {
                const opts = mailboxes.map(m => {
                    const addr = `${m.local_part || m.address}@${domain}`;
                    return `<option value="${escapeHtml(addr)}">${escapeHtml(addr)}</option>`;
                }).join('');
                mbOptions = `
                    <div class="form-group">
                        <label>Quick add from mailboxes</label>
                        <div style="display:flex;gap:6px">
                            <select class="form-select" id="catchall-quick" style="flex:1">${opts}</select>
                            <button class="btn btn-sm" id="catchall-quick-add">Add</button>
                        </div>
                    </div>`;
            }

            body.innerHTML = `
                <div class="form-group">
                    <label>Destination addresses (comma-separated)</label>
                    <input type="text" class="form-input" id="catchall-input" value="${escapeHtml(current)}" placeholder="user@${escapeHtml(domain)}, other@example.com">
                </div>
                ${mbOptions}
                <div id="catchall-msg"></div>
                <div class="btn-row">
                    ${hasCatchall ? '<button class="btn btn-danger" id="catchall-disable">Disable Catchall</button>' : ''}
                    <button class="btn btn-accent" id="catchall-save">Save</button>
                </div>`;

            // Quick add from dropdown
            overlay.querySelector('#catchall-quick-add')?.addEventListener('click', () => {
                const sel = overlay.querySelector('#catchall-quick');
                const input = overlay.querySelector('#catchall-input');
                const val = input.value.trim();
                const addr = sel.value;
                if (val && !val.split(',').map(s => s.trim()).includes(addr)) {
                    input.value = val + ', ' + addr;
                } else if (!val) {
                    input.value = addr;
                }
            });

            // Save
            overlay.querySelector('#catchall-save').addEventListener('click', async () => {
                const msg = overlay.querySelector('#catchall-msg');
                const raw = overlay.querySelector('#catchall-input').value.trim();
                const destinations = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
                msg.innerHTML = '<div class="loading">Saving...</div>';
                try {
                    await API.post(`/api/email/domains/${encodeURIComponent(domain)}/catchall`, { destinations });
                    msg.innerHTML = '<div class="success-message">Catchall updated.</div>';
                    setTimeout(() => { closeModal(); this.loadDomains(); }, 800);
                } catch (e) {
                    msg.innerHTML = `<div class="error-message">${escapeHtml(e.message)}</div>`;
                }
            });

            // Disable
            overlay.querySelector('#catchall-disable')?.addEventListener('click', async () => {
                const msg = overlay.querySelector('#catchall-msg');
                msg.innerHTML = '<div class="loading">Disabling catchall...</div>';
                try {
                    await API.del(`/api/email/domains/${encodeURIComponent(domain)}/catchall`);
                    msg.innerHTML = '<div class="success-message">Catchall disabled.</div>';
                    setTimeout(() => { closeModal(); this.loadDomains(); }, 800);
                } catch (e) {
                    msg.innerHTML = `<div class="error-message">${escapeHtml(e.message)}</div>`;
                }
            });
        } catch (err) {
            body.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }
    },

    async showAddDomainModal() {
        let step = 1;
        let selectedDomain = '';
        let dnsRecords = null;

        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>Add Email Domain</h2>
            <div class="step-indicator">
                <div class="step active" data-step="1">1. Select</div>
                <div class="step" data-step="2">2. DNS</div>
                <div class="step" data-step="3">3. Setup</div>
                <div class="step" data-step="4">4. Catchall</div>
                <div class="step" data-step="5">5. Verify</div>
            </div>
            <div id="add-domain-body"><div class="loading">Loading zones...</div></div>`);

        const body = overlay.querySelector('#add-domain-body');
        const steps = overlay.querySelectorAll('.step-indicator .step');

        function setStep(n) {
            step = n;
            steps.forEach(s => {
                const sn = parseInt(s.dataset.step);
                s.classList.toggle('active', sn === n);
                s.classList.toggle('done', sn < n);
            });
        }

        // Step 1: Select domain from CF zones
        try {
            const zones = await ZoneCache.get();
            // Fetch existing migadu domains to filter
            let existingDomains = [];
            try {
                const mgData = await API.get('/api/email/domains');
                const mgDomains = Array.isArray(mgData) ? mgData : (mgData.domains || []);
                existingDomains = mgDomains.map(d => d.name || d.domain);
            } catch (e) { /* ignore */ }

            const available = zones.filter(z => !existingDomains.includes(z.name));
            if (!available.length) {
                body.innerHTML = '<div class="info-message">All Cloudflare zones already have email domains configured, or no zones available.</div>';
                return;
            }

            const options = available.map(z => `<option value="${escapeHtml(z.name)}">${escapeHtml(z.name)}</option>`).join('');
            body.innerHTML = `
                <div class="form-group">
                    <label>Domain</label>
                    <select class="form-select" id="add-domain-select" style="width:100%">${options}</select>
                </div>
                <div id="add-domain-msg"></div>
                <div class="btn-row">
                    <button class="btn" onclick="closeModal()">Cancel</button>
                    <button class="btn btn-accent" id="add-domain-next">Next</button>
                </div>`;

            overlay.querySelector('#add-domain-next').addEventListener('click', async () => {
                selectedDomain = overlay.querySelector('#add-domain-select').value;
                if (!selectedDomain) return;
                const msg = overlay.querySelector('#add-domain-msg');
                msg.innerHTML = '<div class="loading">Creating domain on Migadu...</div>';

                try {
                    await API.post('/api/email/domains', { name: selectedDomain });
                } catch (e) {
                    // Domain may already exist on Migadu — that's ok, continue
                    if (!e.message.includes('already exists') && !e.message.includes('409') && !e.message.includes('422')) {
                        msg.innerHTML = `<div class="error-message">Failed to create domain: ${escapeHtml(e.message)}</div>`;
                        return;
                    }
                }

                // Fetch DNS records — wait=2 gives Migadu time to provision, backend retries on 404
                msg.innerHTML = '<div class="loading">Fetching DNS records (this may take a moment)...</div>';
                try {
                    dnsRecords = await API.get(`/api/email/domains/${encodeURIComponent(selectedDomain)}/dns-records?wait=2`);
                    renderStep2();
                } catch (e) {
                    msg.innerHTML = `<div class="error-message">Failed to fetch DNS records: ${escapeHtml(e.message)}</div>
                        <div class="btn-row mt-8"><button class="btn btn-sm" id="retry-dns-fetch">Retry</button></div>`;
                    overlay.querySelector('#retry-dns-fetch')?.addEventListener('click', async () => {
                        msg.innerHTML = '<div class="loading">Retrying...</div>';
                        try {
                            dnsRecords = await API.get(`/api/email/domains/${encodeURIComponent(selectedDomain)}/dns-records`);
                            renderStep2();
                        } catch (e2) {
                            msg.innerHTML = `<div class="error-message">${escapeHtml(e2.message)}</div>`;
                        }
                    });
                }
            });
        } catch (err) {
            body.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }

        function renderStep2() {
            setStep(2);
            const entries = dnsRecords.entries || dnsRecords.records || [];
            if (!entries.length) {
                body.innerHTML = `
                    <div class="info-message">No DNS records returned by Migadu for ${escapeHtml(selectedDomain)}. The domain may need manual configuration.</div>
                    <div class="btn-row mt-12">
                        <button class="btn" onclick="closeModal()">Close</button>
                    </div>`;
                return;
            }

            // Categorize records into 5 groups
            const categories = {
                verification: { label: 'Verification Record', icon: '&#10003;', note: 'Links your Migadu account to this domain uniquely', required: true, records: [] },
                mx:           { label: 'MX Records',          icon: '&#10003;', note: null, required: true, records: [] },
                dkim:         { label: 'DKIM Public Keys',     icon: '&#10003;', note: 'All keys required for key rotation without failures', required: true, records: [] },
                spf:          { label: 'SPF Policy',           icon: '&#10003;', note: null, required: true, records: [] },
                dmarc:        { label: 'DMARC Policy',         icon: '&#9888;',  note: 'Easy to implement and highly effective — skipping not recommended', required: false, records: [] },
            };

            entries.forEach((r, i) => {
                const t = (r.type || '').toUpperCase();
                const n = (r.name || '').toLowerCase();
                const c = (r.content || '').toLowerCase();
                r._idx = i;
                if (t === 'MX') categories.mx.records.push(r);
                else if (n.includes('_domainkey')) categories.dkim.records.push(r);
                else if (n.includes('_dmarc') || c.includes('dmarc')) categories.dmarc.records.push(r);
                else if (c.includes('spf')) categories.spf.records.push(r);
                else categories.verification.records.push(r);
            });

            let checklist = '';
            for (const [key, cat] of Object.entries(categories)) {
                if (!cat.records.length) continue;
                const isDmarc = key === 'dmarc';
                const iconCls = isDmarc ? 'check-pending' : 'check-ok';
                const reqLabel = cat.required ? 'required' : 'recommended';

                checklist += `<li style="flex-direction:column;align-items:stretch">
                    <div style="display:flex;align-items:center;gap:8px">
                        <input type="checkbox" checked data-cat="${key}" id="dns-cat-${key}">
                        <span class="check-icon ${iconCls}">${cat.icon}</span>
                        <strong style="font-size:12px">${escapeHtml(cat.label)}</strong>
                        <span class="text-muted" style="font-size:10px">(${reqLabel})</span>
                    </div>
                    <div class="record-info" style="margin-left:52px;margin-top:4px">`;

                cat.records.forEach(r => {
                    const prio = r.priority != null ? ` ${r.priority}` : '';
                    checklist += `<div><span class="record-type">${escapeHtml(r.type || '')}</span>${prio} ${escapeHtml(r.name || selectedDomain)} &rarr; ${escapeHtml(r.content || '')}</div>`;
                });

                if (cat.note) {
                    checklist += `<div class="${isDmarc ? 'text-danger' : 'text-muted'}" style="font-size:10px;margin-top:4px;font-style:italic">${escapeHtml(cat.note)}</div>`;
                }

                checklist += `</div></li>`;
            }

            // Also include any uncategorized leftovers (shouldn't happen, but safe)
            body.innerHTML = `
                <p class="text-muted" style="font-size:12px">DNS records to add to Cloudflare for <strong>${escapeHtml(selectedDomain)}</strong>:</p>
                <ul class="dns-checklist">${checklist}</ul>
                <div id="add-domain-msg"></div>
                <div class="btn-row">
                    <button class="btn" id="skip-dns-btn">Skip DNS</button>
                    <button class="btn btn-accent" id="setup-dns-btn">Add to Cloudflare</button>
                </div>`;

            // Warn on DMARC uncheck
            overlay.querySelector('#dns-cat-dmarc')?.addEventListener('change', (e) => {
                const msg = overlay.querySelector('#add-domain-msg');
                if (!e.target.checked) {
                    msg.innerHTML = '<div class="error-message" style="font-size:11px">DMARC is highly recommended. Without it, spoofed emails from your domain won\'t be rejected.</div>';
                } else {
                    msg.innerHTML = '';
                }
            });

            overlay.querySelector('#skip-dns-btn').addEventListener('click', () => {
                const msg = overlay.querySelector('#add-domain-msg');
                msg.innerHTML = '<div class="error-message" style="font-size:11px">Skipping DNS setup means your domain won\'t be able to send or receive email until records are added.</div><div class="btn-row mt-8"><button class="btn btn-sm btn-danger" id="confirm-skip-dns">Skip Anyway</button></div>';
                overlay.querySelector('#confirm-skip-dns')?.addEventListener('click', () => renderStep4Catchall());
            });

            overlay.querySelector('#setup-dns-btn').addEventListener('click', () => {
                renderStep3();
            });
        }

        async function renderStep3() {
            setStep(3);
            const msg = overlay.querySelector('#add-domain-msg') || body;
            body.innerHTML = '<div class="loading">Adding DNS records to Cloudflare...</div>';

            try {
                const result = await API.post(`/api/email/domains/${encodeURIComponent(selectedDomain)}/setup-dns`);
                const created = result.created || [];
                const failed = result.failed || [];

                let html = '<ul class="dns-checklist">';
                created.forEach(r => {
                    const rec = r.result || r;
                    html += `<li>
                        <span class="check-icon check-ok">&#10003;</span>
                        <div class="record-info">
                            <span class="record-type">${escapeHtml(rec.type || '')}</span> ${escapeHtml(rec.name || '')} &rarr; ${escapeHtml(rec.content || '')}
                        </div>
                    </li>`;
                });
                failed.forEach(f => {
                    const rec = f.record || {};
                    html += `<li>
                        <span class="check-icon check-fail">&#10007;</span>
                        <div class="record-info">
                            <span class="record-type">${escapeHtml(rec.type || '')}</span> ${escapeHtml(rec.name || '')} &rarr; ${escapeHtml(rec.content || '')}
                            <br><span class="text-danger" style="font-size:10px">${escapeHtml(f.error || 'Unknown error')}</span>
                        </div>
                    </li>`;
                });
                html += '</ul>';

                const summary = failed.length
                    ? `<div class="error-message">${created.length} created, ${failed.length} failed</div>`
                    : `<div class="success-message">All ${created.length} records created successfully.</div>`;

                body.innerHTML = `
                    ${summary}
                    ${html}
                    <div class="btn-row mt-12">
                        <button class="btn btn-accent" id="goto-catchall-btn">Next: Catchall</button>
                    </div>`;

                overlay.querySelector('#goto-catchall-btn').addEventListener('click', () => renderStep4Catchall());
            } catch (err) {
                body.innerHTML = `
                    <div class="error-message">${escapeHtml(err.message)}</div>
                    <div class="btn-row mt-12">
                        <button class="btn" onclick="closeModal()">Close</button>
                        <button class="btn btn-accent" id="retry-dns-btn">Retry</button>
                    </div>`;
                overlay.querySelector('#retry-dns-btn')?.addEventListener('click', () => renderStep3());
            }
        }

        async function renderStep4Catchall() {
            setStep(4);
            // Load existing mailboxes for the quick-add dropdown
            let mbOptions = '';
            try {
                const mbData = await API.get(`/api/email/mailboxes/${encodeURIComponent(selectedDomain)}`).catch(() => []);
                const mailboxes = Array.isArray(mbData) ? mbData : (mbData.mailboxes || []);
                if (mailboxes.length) {
                    const opts = mailboxes.map(m => {
                        const addr = `${m.local_part || m.address}@${selectedDomain}`;
                        return `<option value="${escapeHtml(addr)}">${escapeHtml(addr)}</option>`;
                    }).join('');
                    mbOptions = `
                        <div class="form-group">
                            <label>Quick add from mailboxes</label>
                            <div style="display:flex;gap:6px">
                                <select class="form-select" id="catchall-quick" style="flex:1">${opts}</select>
                                <button class="btn btn-sm" id="catchall-quick-add">Add</button>
                            </div>
                        </div>`;
                }
            } catch { /* ignore */ }

            body.innerHTML = `
                <p class="text-muted" style="font-size:12px">Set up a catchall address? Unmatched email to *@${escapeHtml(selectedDomain)} will be forwarded here.</p>
                <div class="form-group">
                    <label>Destination addresses (comma-separated)</label>
                    <input type="text" class="form-input" id="catchall-input" placeholder="user@${escapeHtml(selectedDomain)}">
                </div>
                ${mbOptions}
                <div id="catchall-msg"></div>
                <div class="btn-row">
                    <button class="btn" id="skip-catchall-btn">Skip</button>
                    <button class="btn btn-accent" id="save-catchall-btn">Save Catchall</button>
                </div>`;

            overlay.querySelector('#catchall-quick-add')?.addEventListener('click', () => {
                const sel = overlay.querySelector('#catchall-quick');
                const input = overlay.querySelector('#catchall-input');
                const val = input.value.trim();
                const addr = sel.value;
                if (val && !val.split(',').map(s => s.trim()).includes(addr)) {
                    input.value = val + ', ' + addr;
                } else if (!val) {
                    input.value = addr;
                }
            });

            overlay.querySelector('#skip-catchall-btn').addEventListener('click', () => renderStep5());

            overlay.querySelector('#save-catchall-btn').addEventListener('click', async () => {
                const msg = overlay.querySelector('#catchall-msg');
                const raw = overlay.querySelector('#catchall-input').value.trim();
                if (!raw) { msg.innerHTML = '<div class="error-message">Enter at least one address or click Skip</div>'; return; }
                const destinations = raw.split(',').map(s => s.trim()).filter(Boolean);
                msg.innerHTML = '<div class="loading">Saving catchall...</div>';
                try {
                    await API.post(`/api/email/domains/${encodeURIComponent(selectedDomain)}/catchall`, { destinations });
                    msg.innerHTML = '<div class="success-message">Catchall configured.</div>';
                    setTimeout(() => renderStep5(), 800);
                } catch (e) {
                    msg.innerHTML = `<div class="error-message">${escapeHtml(e.message)}</div>`;
                }
            });
        }

        async function renderStep5() {
            setStep(5);
            body.innerHTML = '<div class="loading">Running diagnostics...</div>';

            try {
                const diag = await API.get(`/api/email/domains/${encodeURIComponent(selectedDomain)}/diagnostics`);
                const diagHtml = EmailDNS.renderDiagnostics(diag);
                body.innerHTML = `
                    ${diagHtml}
                    <div id="activate-msg" class="mt-12"></div>
                    <div class="btn-row mt-12">
                        <button class="btn" onclick="closeModal()">Close</button>
                        <button class="btn btn-accent" id="final-activate-btn">Activate Domain</button>
                        <button class="btn" id="rerun-diag-btn">Re-run</button>
                    </div>`;

                overlay.querySelector('#final-activate-btn').addEventListener('click', async () => {
                    const amsg = overlay.querySelector('#activate-msg');
                    amsg.innerHTML = '<div class="loading">Activating...</div>';
                    try {
                        await API.post(`/api/email/domains/${encodeURIComponent(selectedDomain)}/activate`);
                        amsg.innerHTML = '<div class="success-message">Domain activated successfully!</div>';
                        ZoneCache.invalidate();
                    } catch (e) {
                        amsg.innerHTML = `<div class="error-message">${escapeHtml(e.message)}</div>`;
                    }
                });

                overlay.querySelector('#rerun-diag-btn').addEventListener('click', () => renderStep5());
            } catch (err) {
                body.innerHTML = `
                    <div class="error-message">${escapeHtml(err.message)}</div>
                    <p class="text-muted" style="font-size:11px">DNS propagation may take a few minutes. Try again shortly.</p>
                    <div class="btn-row mt-12">
                        <button class="btn" onclick="closeModal()">Close</button>
                        <button class="btn" id="retry-diag-btn">Retry</button>
                    </div>`;
                overlay.querySelector('#retry-diag-btn')?.addEventListener('click', () => renderStep5());
            }
        }
    },
};

// ================================================================
// EmailDNS — DNS records status + auto-setup
// ================================================================
const EmailDNS = {
    async render(match) {
        const domain = decodeURIComponent(match[1]);
        const content = $('#content');
        content.innerHTML = `
            <div class="page-header">
                <h1>DNS: ${escapeHtml(domain)}</h1>
                <div>
                    <a href="/email/domains/${encodeURIComponent(domain)}" class="btn btn-sm">Back</a>
                </div>
            </div>
            <div id="email-dns-container"><div class="loading">Loading DNS records...</div></div>`;

        const container = $('#email-dns-container');
        try {
            const [dnsData, diagData] = await Promise.all([
                API.get(`/api/email/domains/${encodeURIComponent(domain)}/dns-records`),
                API.get(`/api/email/domains/${encodeURIComponent(domain)}/diagnostics`).catch(() => null),
            ]);

            const entries = dnsData.entries || dnsData.records || [];
            let html = '';

            if (entries.length) {
                const rows = entries.map(r => {
                    const prio = r.priority != null ? r.priority : '';
                    return `<tr>
                        <td><span class="badge badge-free">${escapeHtml(r.type || '')}</span></td>
                        <td class="mono" style="font-size:11px">${escapeHtml(r.name || domain)}</td>
                        <td class="mono truncate" style="font-size:11px;max-width:300px" title="${escapeHtml(r.content || '')}">${escapeHtml(r.content || '')}</td>
                        <td>${prio}</td>
                    </tr>`;
                }).join('');

                html += `
                    <h3 style="font-size:13px;margin-bottom:8px">Required DNS Records</h3>
                    <table class="data-table">
                        <thead><tr><th>Type</th><th>Name</th><th>Content</th><th>Priority</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>`;
            } else {
                html += '<div class="info-message">No DNS records returned by Migadu.</div>';
            }

            if (diagData) {
                html += `<div class="mt-16"><h3 style="font-size:13px;margin-bottom:8px">Diagnostics</h3>${this.renderDiagnostics(diagData)}</div>`;
            }

            html += `
                <div class="mt-16" style="display:flex;gap:8px">
                    <button class="btn btn-accent" id="setup-dns-btn">Add Missing Records to Cloudflare</button>
                    <button class="btn" id="rerun-diag-btn">Re-run Diagnostics</button>
                </div>
                <div id="dns-action-msg" class="mt-12"></div>`;

            container.innerHTML = html;

            container.querySelector('#setup-dns-btn').addEventListener('click', async () => {
                const msg = container.querySelector('#dns-action-msg');
                msg.innerHTML = '<div class="loading">Adding DNS records...</div>';
                try {
                    const result = await API.post(`/api/email/domains/${encodeURIComponent(domain)}/setup-dns`);
                    const created = result.created || [];
                    const failed = result.failed || [];
                    if (failed.length) {
                        msg.innerHTML = `<div class="error-message">${created.length} created, ${failed.length} failed. ${failed.map(f => escapeHtml(f.error || '')).join('; ')}</div>`;
                    } else {
                        msg.innerHTML = `<div class="success-message">All ${created.length} records created.</div>`;
                    }
                } catch (e) {
                    msg.innerHTML = `<div class="error-message">${escapeHtml(e.message)}</div>`;
                }
            });

            container.querySelector('#rerun-diag-btn').addEventListener('click', async () => {
                const msg = container.querySelector('#dns-action-msg');
                msg.innerHTML = '<div class="loading">Running diagnostics...</div>';
                try {
                    const diag = await API.get(`/api/email/domains/${encodeURIComponent(domain)}/diagnostics`);
                    msg.innerHTML = this.renderDiagnostics(diag);
                } catch (e) {
                    msg.innerHTML = `<div class="error-message">${escapeHtml(e.message)}</div>`;
                }
            });
        } catch (err) {
            container.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }
    },

    renderDiagnostics(diag) {
        // Migadu diagnostics response varies — handle common shapes
        const checks = diag.checks || diag.diagnostics || [];
        if (Array.isArray(checks) && checks.length) {
            const items = checks.map(c => {
                const ok = c.passed || c.ok || c.status === 'ok';
                const warn = c.warning || c.status === 'warning';
                const cls = ok ? 'diag-ok' : warn ? 'diag-warn' : 'diag-fail';
                const icon = ok ? '&#10003;' : warn ? '&#9888;' : '&#10007;';
                return `<li><span class="${cls}">${icon}</span> ${escapeHtml(c.name || c.type || '')} — ${escapeHtml(c.message || c.detail || (ok ? 'Passed' : 'Failed'))}</li>`;
            }).join('');
            return `<ul class="diag-list">${items}</ul>`;
        }

        // Fallback: render as key-value pairs
        const keys = Object.keys(diag).filter(k => k !== 'domain');
        if (keys.length) {
            const items = keys.map(k => {
                const val = diag[k];
                const isOk = val === true || val === 'ok' || val === 'passed';
                const cls = isOk ? 'diag-ok' : 'diag-fail';
                const icon = isOk ? '&#10003;' : '&#10007;';
                const display = typeof val === 'object' ? JSON.stringify(val) : String(val);
                return `<li><span class="${cls}">${icon}</span> <strong>${escapeHtml(k)}</strong>: ${escapeHtml(display)}</li>`;
            }).join('');
            return `<ul class="diag-list">${items}</ul>`;
        }

        return '<div class="info-message">No diagnostic data returned.</div>';
    },
};

// ================================================================
// Mailboxes — mailbox manager
// ================================================================
const Mailboxes = {
    domains: [],
    currentDomain: null,
    mailboxes: [],
    expanded: {},  // track expanded rows

    async render() {
        const content = $('#content');
        content.innerHTML = `
            <div class="page-header">
                <h1>Mailboxes</h1>
                <button class="btn btn-accent" id="add-mailbox-btn">+ Add Mailbox</button>
            </div>
            <div class="email-domain-header">
                <label style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-secondary)">Domain</label>
                <select id="email-domain-select"><option value="">Loading...</option></select>
            </div>
            <div id="mailboxes-container"><div class="loading">Loading...</div></div>`;

        try {
            const data = await API.get('/api/email/domains');
            this.domains = Array.isArray(data) ? data : (data.domains || []);
        } catch (err) {
            $('#mailboxes-container').innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
            return;
        }

        const sel = $('#email-domain-select');
        if (!this.domains.length) {
            sel.innerHTML = '<option value="">No email domains</option>';
            $('#mailboxes-container').innerHTML = '<div class="info-message">No email domains configured. Add one first.</div>';
            return;
        }

        sel.innerHTML = this.domains
            .map(d => {
                const name = d.name || d.domain;
                return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
            })
            .join('');

        this.currentDomain = this.domains[0].name || this.domains[0].domain;
        await this.loadMailboxes();

        sel.addEventListener('change', (e) => {
            this.currentDomain = e.target.value;
            this.expanded = {};
            this.loadMailboxes();
        });

        $('#add-mailbox-btn')?.addEventListener('click', () => this.showAddMailboxModal());
    },

    async renderDomain(match) {
        const domain = decodeURIComponent(match[1]);
        await this.render();
        // Select the domain in dropdown
        const sel = $('#email-domain-select');
        if (sel) {
            sel.value = domain;
            this.currentDomain = domain;
            this.expanded = {};
            await this.loadMailboxes();
        }
    },

    async loadMailboxes() {
        if (!this.currentDomain) return;
        const container = $('#mailboxes-container');
        container.innerHTML = '<div class="loading">Loading mailboxes...</div>';
        try {
            const data = await API.get(`/api/email/mailboxes/${encodeURIComponent(this.currentDomain)}`);
            this.mailboxes = Array.isArray(data) ? data : (data.mailboxes || []);
            this.renderTable();
        } catch (err) {
            container.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
        }
    },

    renderTable() {
        const container = $('#mailboxes-container');
        if (!this.mailboxes.length) {
            container.innerHTML = '<div class="info-message">No mailboxes for this domain.</div>';
            return;
        }

        const rows = this.mailboxes.map(m => {
            const local = m.local_part || m.address || '';
            const addr = `${local}@${this.currentDomain}`;
            const name = m.name || m.display_name || '';

            const badges = [];
            if (m.may_send !== false) badges.push('<span class="badge badge-active" style="font-size:10px">SEND</span>');
            if (m.may_receive !== false) badges.push('<span class="badge badge-active" style="font-size:10px">RECV</span>');
            if (m.may_access_imap !== false) badges.push('<span class="badge badge-free" style="font-size:10px">IMAP</span>');

            const isExpanded = this.expanded[local];

            return `<tr>
                <td><strong>${escapeHtml(addr)}</strong></td>
                <td>${escapeHtml(name)}</td>
                <td>${badges.join(' ')}</td>
                <td class="actions">
                    <button class="btn btn-sm" data-edit-mb="${escapeHtml(local)}">Edit</button>
                    <button class="btn btn-sm btn-danger" data-del-mb="${escapeHtml(local)}">Del</button>
                    <button class="btn btn-sm" data-expand-mb="${escapeHtml(local)}">${isExpanded ? '▼' : '▶'} More</button>
                </td>
            </tr>
            ${isExpanded ? `<tr><td colspan="4" style="padding:0"><div class="mailbox-expand" id="expand-${escapeHtml(local)}">${this.expanded[local] || '<div class="loading">Loading...</div>'}</div></td></tr>` : ''}`;
        }).join('');

        container.innerHTML = `
            <table class="data-table">
                <thead><tr>
                    <th>Address</th><th>Name</th><th>Status</th><th>Actions</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;

        // Bind events
        $$('[data-edit-mb]').forEach(btn => {
            btn.addEventListener('click', () => this.showEditMailboxModal(btn.dataset.editMb));
        });
        $$('[data-del-mb]').forEach(btn => {
            btn.addEventListener('click', () => this.showDeleteMailboxModal(btn.dataset.delMb));
        });
        $$('[data-expand-mb]').forEach(btn => {
            btn.addEventListener('click', () => this.toggleExpand(btn.dataset.expandMb));
        });
    },

    async toggleExpand(localPart) {
        if (this.expanded[localPart]) {
            delete this.expanded[localPart];
            this.renderTable();
            return;
        }

        // Mark as expanded with loading placeholder
        this.expanded[localPart] = '<div class="loading">Loading...</div>';
        this.renderTable();

        try {
            const domain = this.currentDomain;
            const [aliasData, identData] = await Promise.all([
                API.get(`/api/email/aliases/${encodeURIComponent(domain)}`).catch(() => []),
                API.get(`/api/email/identities/${encodeURIComponent(domain)}/${encodeURIComponent(localPart)}`).catch(() => []),
            ]);

            const aliases = Array.isArray(aliasData) ? aliasData : (aliasData.aliases || aliasData.address_aliases || []);
            const identities = Array.isArray(identData) ? identData : (identData.identities || []);

            let html = '';

            // Aliases section
            html += '<h4>Aliases</h4>';
            if (aliases.length) {
                const aliasRows = aliases.map(a => {
                    const lp = a.local_part || a.address || '';
                    const dests = (a.destinations || []).join(', ') || '—';
                    return `<tr>
                        <td class="mono">${escapeHtml(lp)}@${escapeHtml(domain)}</td>
                        <td class="mono text-muted">${escapeHtml(dests)}</td>
                        <td class="actions"><button class="btn btn-sm btn-danger" data-del-alias="${escapeHtml(lp)}">Del</button></td>
                    </tr>`;
                }).join('');
                html += `<table class="sub-table"><tbody>${aliasRows}</tbody></table>`;
            } else {
                html += '<p class="text-muted" style="font-size:11px">No aliases.</p>';
            }

            html += `<div class="inline-form" id="add-alias-form">
                <input type="text" placeholder="local_part" id="alias-local" style="width:120px">
                <input type="text" placeholder="dest@example.com" id="alias-dest" style="flex:1">
                <button class="btn btn-sm btn-accent" id="add-alias-btn">Add Alias</button>
            </div>`;

            // Identities section
            html += '<h4 class="mt-12">Identities</h4>';
            if (identities.length) {
                const idRows = identities.map(id => {
                    const lp = id.local_part || '';
                    const nm = id.name || '';
                    return `<tr>
                        <td class="mono">${escapeHtml(lp)}@${escapeHtml(domain)}</td>
                        <td>${escapeHtml(nm)}</td>
                        <td class="actions"><button class="btn btn-sm btn-danger" data-del-identity="${escapeHtml(lp)}">Del</button></td>
                    </tr>`;
                }).join('');
                html += `<table class="sub-table"><tbody>${idRows}</tbody></table>`;
            } else {
                html += '<p class="text-muted" style="font-size:11px">No identities.</p>';
            }

            html += `<div class="inline-form" id="add-identity-form">
                <input type="text" placeholder="local_part" id="identity-local" style="width:120px">
                <input type="text" placeholder="Display Name" id="identity-name" style="flex:1">
                <button class="btn btn-sm btn-accent" id="add-identity-btn">Add Identity</button>
            </div>`;

            html += '<div id="expand-msg" class="mt-8"></div>';

            this.expanded[localPart] = html;
            this.renderTable();

            // Bind sub-actions after render
            const expandEl = document.getElementById(`expand-${localPart}`);
            if (!expandEl) return;

            // Delete alias buttons
            expandEl.querySelectorAll('[data-del-alias]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        await API.del(`/api/email/aliases/${encodeURIComponent(domain)}/${encodeURIComponent(btn.dataset.delAlias)}`);
                        this.toggleExpand(localPart);
                        setTimeout(() => this.toggleExpand(localPart), 100);
                    } catch (e) {
                        const msg = expandEl.querySelector('#expand-msg');
                        if (msg) msg.innerHTML = `<div class="error-message">${escapeHtml(e.message)}</div>`;
                    }
                });
            });

            // Delete identity buttons
            expandEl.querySelectorAll('[data-del-identity]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        await API.del(`/api/email/identities/${encodeURIComponent(domain)}/${encodeURIComponent(localPart)}/${encodeURIComponent(btn.dataset.delIdentity)}`);
                        this.toggleExpand(localPart);
                        setTimeout(() => this.toggleExpand(localPart), 100);
                    } catch (e) {
                        const msg = expandEl.querySelector('#expand-msg');
                        if (msg) msg.innerHTML = `<div class="error-message">${escapeHtml(e.message)}</div>`;
                    }
                });
            });

            // Add alias
            expandEl.querySelector('#add-alias-btn')?.addEventListener('click', async () => {
                const lp = expandEl.querySelector('#alias-local').value.trim();
                const dest = expandEl.querySelector('#alias-dest').value.trim();
                const msg = expandEl.querySelector('#expand-msg');
                if (!lp || !dest) { msg.innerHTML = '<div class="error-message">Both fields required</div>'; return; }
                try {
                    await API.post(`/api/email/aliases/${encodeURIComponent(domain)}`, {
                        local_part: lp,
                        destinations: dest.split(',').map(s => s.trim()),
                    });
                    this.toggleExpand(localPart);
                    setTimeout(() => this.toggleExpand(localPart), 100);
                } catch (e) {
                    msg.innerHTML = `<div class="error-message">${escapeHtml(e.message)}</div>`;
                }
            });

            // Add identity
            expandEl.querySelector('#add-identity-btn')?.addEventListener('click', async () => {
                const lp = expandEl.querySelector('#identity-local').value.trim();
                const nm = expandEl.querySelector('#identity-name').value.trim();
                const msg = expandEl.querySelector('#expand-msg');
                if (!lp) { msg.innerHTML = '<div class="error-message">Local part required</div>'; return; }
                try {
                    await API.post(`/api/email/identities/${encodeURIComponent(domain)}/${encodeURIComponent(localPart)}`, {
                        local_part: lp,
                        name: nm,
                    });
                    this.toggleExpand(localPart);
                    setTimeout(() => this.toggleExpand(localPart), 100);
                } catch (e) {
                    msg.innerHTML = `<div class="error-message">${escapeHtml(e.message)}</div>`;
                }
            });
        } catch (err) {
            this.expanded[localPart] = `<div class="error-message">${escapeHtml(err.message)}</div>`;
            this.renderTable();
        }
    },

    showAddMailboxModal() {
        if (!this.currentDomain) return;
        const domain = this.currentDomain;

        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>Add Mailbox</h2>
            <p class="text-muted" style="font-size:12px">Creating mailbox on <strong>${escapeHtml(domain)}</strong></p>
            <div class="form-group">
                <label>Local Part (before @)</label>
                <input type="text" class="form-input" id="mb-local" placeholder="john">
            </div>
            <div class="form-group">
                <label>Display Name</label>
                <input type="text" class="form-input" id="mb-name" placeholder="John Doe">
            </div>
            <div class="form-group">
                <label>Password</label>
                <input type="password" class="form-input" id="mb-password" placeholder="Password">
            </div>
            <div class="form-group">
                <label>Password Recovery Email (optional)</label>
                <input type="email" class="form-input" id="mb-recovery" placeholder="recovery@example.com">
            </div>
            <div id="mb-msg"></div>
            <div class="btn-row">
                <button class="btn" onclick="closeModal()">Cancel</button>
                <button class="btn btn-accent" id="mb-save-btn">Create</button>
            </div>`);

        overlay.querySelector('#mb-save-btn').addEventListener('click', async () => {
            const local = overlay.querySelector('#mb-local').value.trim();
            const name = overlay.querySelector('#mb-name').value.trim();
            const password = overlay.querySelector('#mb-password').value;
            const recovery = overlay.querySelector('#mb-recovery').value.trim();
            const msg = overlay.querySelector('#mb-msg');

            if (!local || !password) {
                msg.innerHTML = '<div class="error-message">Local part and password are required</div>';
                return;
            }

            msg.innerHTML = '<div class="loading">Creating mailbox...</div>';
            const data = { local_part: local, name: name, password: password };
            if (recovery) data.password_recovery_email = recovery;

            try {
                await API.post(`/api/email/mailboxes/${encodeURIComponent(domain)}`, data);
                closeModal();
                await this.loadMailboxes();
            } catch (err) {
                msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
            }
        });
    },

    showEditMailboxModal(localPart) {
        const mb = this.mailboxes.find(m => (m.local_part || m.address) === localPart);
        if (!mb) return;
        const domain = this.currentDomain;

        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>Edit Mailbox</h2>
            <p class="text-muted" style="font-size:12px">${escapeHtml(localPart)}@${escapeHtml(domain)}</p>
            <div class="form-group">
                <label>Display Name</label>
                <input type="text" class="form-input" id="mb-edit-name" value="${escapeHtml(mb.name || mb.display_name || '')}">
            </div>
            <div class="form-group">
                <label>New Password (leave blank to keep current)</label>
                <input type="password" class="form-input" id="mb-edit-password" placeholder="">
            </div>
            <div class="form-row">
                <div class="form-check">
                    <input type="checkbox" id="mb-edit-send" ${mb.may_send !== false ? 'checked' : ''}>
                    <label for="mb-edit-send">May Send</label>
                </div>
                <div class="form-check">
                    <input type="checkbox" id="mb-edit-recv" ${mb.may_receive !== false ? 'checked' : ''}>
                    <label for="mb-edit-recv">May Receive</label>
                </div>
                <div class="form-check">
                    <input type="checkbox" id="mb-edit-imap" ${mb.may_access_imap !== false ? 'checked' : ''}>
                    <label for="mb-edit-imap">IMAP Access</label>
                </div>
            </div>
            <div id="mb-edit-msg"></div>
            <div class="btn-row">
                <button class="btn" onclick="closeModal()">Cancel</button>
                <button class="btn btn-accent" id="mb-edit-save">Save</button>
            </div>`);

        overlay.querySelector('#mb-edit-save').addEventListener('click', async () => {
            const msg = overlay.querySelector('#mb-edit-msg');
            const data = {
                name: overlay.querySelector('#mb-edit-name').value.trim(),
                may_send: overlay.querySelector('#mb-edit-send').checked,
                may_receive: overlay.querySelector('#mb-edit-recv').checked,
                may_access_imap: overlay.querySelector('#mb-edit-imap').checked,
            };
            const pw = overlay.querySelector('#mb-edit-password').value;
            if (pw) data.password = pw;

            msg.innerHTML = '<div class="loading">Saving...</div>';
            try {
                await API.put(`/api/email/mailboxes/${encodeURIComponent(domain)}/${encodeURIComponent(localPart)}`, data);
                closeModal();
                await this.loadMailboxes();
            } catch (err) {
                msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
            }
        });
    },

    showDeleteMailboxModal(localPart) {
        const domain = this.currentDomain;

        const overlay = showModal(`
            <button class="modal-close">&times;</button>
            <h2>Delete Mailbox</h2>
            <p>Delete <strong>${escapeHtml(localPart)}@${escapeHtml(domain)}</strong>? This is irreversible.</p>
            <div id="mb-del-msg"></div>
            <div class="btn-row">
                <button class="btn" onclick="closeModal()">Cancel</button>
                <button class="btn btn-danger" id="mb-del-confirm">Delete</button>
            </div>`);

        overlay.querySelector('#mb-del-confirm').addEventListener('click', async () => {
            const msg = overlay.querySelector('#mb-del-msg');
            msg.innerHTML = '<div class="loading">Deleting...</div>';
            try {
                await API.del(`/api/email/mailboxes/${encodeURIComponent(domain)}/${encodeURIComponent(localPart)}`);
                closeModal();
                await this.loadMailboxes();
            } catch (err) {
                msg.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
            }
        });
    },
};

// ================================================================
// Route registration
// ================================================================
Router.register('/email/domains', () => EmailDomains.render());
Router.register('/email/domains/([^/]+)/dns', (m) => EmailDNS.render(m));
Router.register('/email/domains/([^/]+)', (m) => EmailDomains.renderDetail(m));
Router.register('/email/mailboxes', () => Mailboxes.render());
Router.register('/email/mailboxes/([^/]+)', (m) => Mailboxes.renderDomain(m));
