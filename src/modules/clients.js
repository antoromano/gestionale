// src/modules/clients.js
// Gestione anagrafica Clienti (persone/aziende) e Scheda Cliente Completa

import { store } from '../services/store.js';
import { formatCurrency, formatDate, formatDateTime, formatMonthYear } from '../utils/formatters.js';
import { calculateQuoteTotals, calculatePaymentBalance } from '../utils/calculations.js';
import { openTodoModal } from './todos.js';
import { openAiModal } from './ai-assistant.js';
import { icon } from '../utils/icons.js';
import { attachSpringTiltCards } from '../utils/three-scenes.js';

let activeClientId = null;
let clientSearchQuery = '';
let activeClientTab = 'all'; // 'all' | 'todos' | 'tech' | 'billing' | 'events'

export function renderClients(container, router) {
  if (activeClientId) {
    renderClientProfile(container, activeClientId, router);
    return;
  }

  const clients = store.getAll('clients');

  const filtered = clients.filter(c => {
    if (!clientSearchQuery) return true;
    const q = clientSearchQuery.toLowerCase();
    const nameMatch = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase().includes(q);
    const companyMatch = (c.company_name || '').toLowerCase().includes(q);
    const vatMatch = (c.vat_number || '').toLowerCase().includes(q);
    const emailMatch = (c.email || '').toLowerCase().includes(q);
    return nameMatch || companyMatch || vatMatch || emailMatch;
  });

  container.innerHTML = `
    <div class="card" style="margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; gap: 10px; flex: 1; max-width: 400px;">
          <input
            type="text"
            id="clients-search-input"
            class="form-input"
            placeholder="Cerca per nome, azienda, P.IVA, email..."
            value="${clientSearchQuery}"
          />
        </div>
        <button id="new-client-btn" class="btn btn-primary">
          + Nuovo Cliente
        </button>
      </div>
    </div>

    ${filtered.length === 0 ? `
      <div class="card" style="text-align: center; padding: 40px; color: var(--text-muted);">
        Nessun cliente registrato. Inizia creandone uno!
      </div>
    ` : `
      <div class="grid-3">
        ${filtered.map(c => {
          const isCompany = c.type === 'company';
          const title = isCompany ? (c.company_name || 'Azienda senza nome') : `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Senza nome';
          const sub = isCompany && c.contact_person ? `Ref: ${c.contact_person}` : (!isCompany && c.company_name ? c.company_name : '');

          return `
            <div class="card client-card kpi-card-3d" data-id="${c.id}" style="cursor: pointer; margin-bottom: 0;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                <span class="badge ${isCompany ? 'badge-blue' : 'badge-gray'}">
                  ${isCompany ? icon('building', 12) : icon('user', 12)}
                  <span>${isCompany ? 'Azienda' : 'Persona'}</span>
                </span>
                <div style="display: flex; gap: 4px;">
                  <button class="btn btn-sm btn-secondary client-quick-edit-btn" data-id="${c.id}" title="Modifica">${icon('edit', 13)}</button>
                </div>
              </div>

              <div style="font-weight: 600; font-size: 15px; letter-spacing: -0.015em; margin-bottom: 2px; color: var(--text-main);">${title}</div>
              ${sub ? `<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">${sub}</div>` : ''}

              <div style="font-size: 12px; color: var(--text-muted); display: flex; flex-direction: column; gap: 4px; margin-top: 8px;">
                ${c.email ? `<div>${c.email}</div>` : ''}
                ${c.phone ? `<div class="mono">${c.phone}</div>` : ''}
                ${c.city ? `<div>${c.city}</div>` : ''}
              </div>

              ${c.tags && c.tags.length > 0 ? `
                <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 10px;">
                  ${c.tags.map(t => `<span class="badge badge-gray" style="font-size: 10px;">${t}</span>`).join('')}
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `}

    <div id="client-modal-container"></div>
  `;

  // Search input
  container.querySelector('#clients-search-input')?.addEventListener('input', (e) => {
    clientSearchQuery = e.target.value;
    renderClients(container, router);
  });

  // Apri scheda cliente
  container.querySelectorAll('.client-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.client-quick-edit-btn')) return;
      activeClientId = card.getAttribute('data-id');
      renderClients(container, router);
    });
  });

  // Edit rapido
  container.querySelectorAll('.client-quick-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const client = store.getById('clients', id);
      openClientModal(client, container, router);
    });
  });

  // Nuovo cliente
  container.querySelector('#new-client-btn')?.addEventListener('click', () => {
    openClientModal(null, container, router);
  });

  attachSpringTiltCards(container);
}

/**
 * Scheda Dettagliata Cliente (il centro operativo)
 */
function renderClientProfile(container, clientId, router) {
  const profile = store.getClientFullProfile(clientId);
  if (!profile || !profile.client) {
    activeClientId = null;
    renderClients(container, router);
    return;
  }

  const { client, todos, appointments, quotes, payments, maintenance_contracts = [], activeMRR = 0 } = profile;
  const isCompany = client.type === 'company';
  const displayName = isCompany ? (client.company_name || 'Azienda') : `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Cliente';

  // Calcolo finanziario totale cliente
  let totalAgreed = 0;
  let totalPaid = 0;

  quotes.forEach(q => {
    if (q.status !== 'rifiutato') {
      totalAgreed += Number(q.agreed_total) || 0;
    }
  });

  // Somma to-do autonomi
  todos.forEach(t => {
    if (t.compensation_mode === 'autonomous' || t.compensation_mode === 'extra') {
      totalAgreed += Number(t.compensation_amount) || 0;
    }
  });

  payments.forEach(p => {
    if (p.status === 'incassato') {
      if (p.type === 'rimborso') {
        totalPaid -= Number(p.amount) || 0;
      } else {
        totalPaid += Number(p.amount) || 0;
      }
    }
  });

  const residualClient = Math.max(0, totalAgreed - totalPaid);

  // Raggruppamento to-do per mese
  const groupedTodos = {};
  todos.forEach(t => {
    const m = formatMonthYear(t.due_date || t.created_at);
    if (!groupedTodos[m]) groupedTodos[m] = { pending: [], completed: [] };
    if (t.is_completed) groupedTodos[m].completed.push(t);
    else groupedTodos[m].pending.push(t);
  });

  container.innerHTML = `
    <!-- Intestazione Scheda Cliente + Striscia KPI in JetBrains Mono -->
    <div class="card" style="margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;">
        <div>
          <button id="back-to-clients-btn" class="btn btn-sm btn-secondary" style="margin-bottom: 10px;">
            ${icon('arrowLeft', 14)}
            <span>Clienti</span>
          </button>
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <h2 style="font-size: 20px; font-weight: 700; letter-spacing: -0.02em;">${displayName}</h2>
            <span class="badge ${isCompany ? 'badge-blue' : 'badge-gray'}">${isCompany ? 'Azienda' : 'Privato'}</span>
            ${client.staging_url ? `<a href="${client.staging_url}" target="_blank" rel="noopener" class="badge badge-gray" style="text-decoration:none;">Staging ↗</a>` : ''}
            ${client.production_url ? `<a href="${client.production_url}" target="_blank" rel="noopener" class="badge badge-blue" style="text-decoration:none;">Produzione ↗</a>` : ''}
          </div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 6px; display: flex; gap: 14px; flex-wrap: wrap;">
            ${client.contact_person ? `<span>Ref: <strong>${client.contact_person}</strong></span>` : ''}
            ${client.email ? `<span>${client.email}</span>` : ''}
            ${client.phone ? `<span class="mono">${client.phone}</span>` : ''}
            ${client.address ? `<span>${client.address}, ${client.postal_code || ''} ${client.city || ''}</span>` : ''}
            ${client.vat_number ? `<span class="mono">P.IVA: ${client.vat_number}</span>` : ''}
            ${client.fiscal_code ? `<span class="mono">C.F.: ${client.fiscal_code}</span>` : ''}
            ${client.sdi_code ? `<span class="mono">SDI: ${client.sdi_code}</span>` : ''}
          </div>
        </div>

        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button id="client-ai-btn" class="btn btn-sm btn-ai">
            ${icon('sparkles', 14)}
            <span>Chiedi all'IA</span>
          </button>
          <button id="client-edit-profile-btn" class="btn btn-sm btn-secondary">
            ${icon('edit', 14)}
            <span>Modifica</span>
          </button>
          <button id="client-trash-btn" class="btn btn-sm btn-danger">
            ${icon('trash', 14)}
            <span>Cestina</span>
          </button>
        </div>
      </div>

      <!-- Scheda Sintesi Economica Cliente (JetBrains Mono Tabular) -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border);">
        <div class="kpi-card-3d" style="background: #fafafa; padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border);">
          <div style="font-size: 10.5px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; letter-spacing: 0.04em;">Totale Concordato</div>
          <div class="mono" style="font-size: 18px; font-weight: 700; color: var(--text-main); margin-top: 4px;">${formatCurrency(totalAgreed)}</div>
        </div>
        <div class="kpi-card-3d" style="background: #fafafa; padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border);">
          <div style="font-size: 10.5px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; letter-spacing: 0.04em;">Incassato Effettivo</div>
          <div class="mono" style="font-size: 18px; font-weight: 700; color: var(--success); margin-top: 4px;">${formatCurrency(totalPaid)}</div>
        </div>
        <div class="kpi-card-3d" style="background: #fafafa; padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border);">
          <div style="font-size: 10.5px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; letter-spacing: 0.04em;">Residuo da Incassare</div>
          <div class="mono" style="font-size: 18px; font-weight: 700; color: ${residualClient > 0 ? 'var(--danger)' : 'var(--text-muted)'}; margin-top: 4px;">${formatCurrency(residualClient)}</div>
        </div>
        <div class="kpi-card-3d" style="background: #ecfdf5; padding: 12px 14px; border-radius: 8px; border: 1px solid rgba(5, 150, 105, 0.22);">
          <div style="font-size: 10.5px; text-transform: uppercase; color: #047857; font-weight: 600; letter-spacing: 0.04em;">Canone Ricorrente (MRR)</div>
          <div class="mono" style="font-size: 18px; font-weight: 700; color: #047857; margin-top: 4px;">${formatCurrency(activeMRR)}/mese</div>
        </div>
      </div>
    </div>

    <!-- Segmented Control (Tab a Pillola per navigare senza caos) -->
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 16px;">
      <div class="segmented-tabs">
        <button type="button" class="segmented-tab-btn client-tab-btn ${activeClientTab === 'all' ? 'active' : ''}" data-client-tab="all">
          Vista Completa
        </button>
        <button type="button" class="segmented-tab-btn client-tab-btn ${activeClientTab === 'todos' ? 'active' : ''}" data-client-tab="todos">
          Attività & To-do <span class="badge badge-gray mono" style="padding:0 5px;font-size:10px;">${todos.length}</span>
        </button>
        <button type="button" class="segmented-tab-btn client-tab-btn ${activeClientTab === 'tech' ? 'active' : ''}" data-client-tab="tech">
          Ambienti & GitHub
        </button>
        <button type="button" class="segmented-tab-btn client-tab-btn ${activeClientTab === 'billing' ? 'active' : ''}" data-client-tab="billing">
          Preventivi & Canoni MRR <span class="badge badge-gray mono" style="padding:0 5px;font-size:10px;">${quotes.length + maintenance_contracts.length}</span>
        </button>
        <button type="button" class="segmented-tab-btn client-tab-btn ${activeClientTab === 'events' ? 'active' : ''}" data-client-tab="events">
          Agenda & Rilasci <span class="badge badge-gray mono" style="padding:0 5px;font-size:10px;">${appointments.length}</span>
        </button>
      </div>
    </div>

    <!-- Ambienti, Git & Manutenzioni -->
    <div class="grid-2" style="margin-bottom: 18px; display: ${(activeClientTab === 'all' || activeClientTab === 'tech' || activeClientTab === 'billing') ? 'grid' : 'none'};">
      <!-- Ambienti Dev & GitHub -->
      <div class="card" style="margin-bottom: 0; display: ${(activeClientTab === 'all' || activeClientTab === 'tech') ? 'block' : 'none'};">
        <div class="card-header">
          <div class="card-title">${icon('git', 15)} <span>Ambienti & Repository Git</span></div>
          <button id="edit-tech-btn" class="btn btn-sm btn-secondary">Modifica</button>
        </div>

        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;">
          ${client.staging_url ? `
            <a href="${client.staging_url}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary" style="display: inline-flex; align-items: center; gap: 4px;">
              🌐 Apri Staging ↗
            </a>
          ` : '<span style="font-size: 12px; color: var(--text-muted);">Nessun URL Staging</span>'}
          
          ${client.production_url ? `
            <a href="${client.production_url}" target="_blank" rel="noopener" class="btn btn-sm btn-primary" style="display: inline-flex; align-items: center; gap: 4px;">
              🚀 Apri Produzione ↗
            </a>
          ` : '<span style="font-size: 12px; color: var(--text-muted);">Nessun URL Produzione</span>'}
        </div>

        ${client.stack ? `
          <div style="margin-bottom: 12px;">
            <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 4px;">STACK TECNOLOGICO</div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              ${client.stack.split(',').map(s => `<span class="badge badge-blue" style="font-size: 11px;">${s.trim()}</span>`).join('')}
            </div>
          </div>
        ` : ''}

        ${client.infra_notes ? `
          <div style="font-size: 12px; background: #f8fafc; padding: 8px; border-radius: var(--radius); border: 1px solid var(--border); margin-bottom: 12px;">
            <strong>Infrastruttura:</strong> ${client.infra_notes}
          </div>
        ` : ''}

        <!-- GitHub Live Widget -->
        <div id="github-widget-container" style="background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius); padding: 10px;">
          ${client.github_repo ? `
            <div id="github-widget-content" data-repo="${client.github_repo}">
              <div style="font-size: 11px; color: var(--text-muted);">Caricamento commits GitHub...</div>
            </div>
          ` : `
            <div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 6px;">
              Nessun repository GitHub collegato. Aggiungi il repository (es. <code>utente/progetto</code>) per visualizzare commits e PR aperte.
            </div>
          `}
        </div>
      </div>

      <!-- Canoni di Manutenzione Ricorrenti (MRR) -->
      <div class="card" style="margin-bottom: 0; display: ${(activeClientTab === 'all' || activeClientTab === 'billing') ? 'block' : 'none'};">
        <div class="card-header">
          <div class="card-title">Canoni di Manutenzione & SLA (<span class="mono">${maintenance_contracts.length}</span>)</div>
          <button id="add-contract-btn" class="btn btn-sm btn-primary">+ Aggiungi Canone</button>
        </div>

        ${maintenance_contracts.length === 0 ? `
          <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">
            Nessun canone di manutenzione o SLA registrato.<br>
            <span style="font-size: 11px;">Aggiungi un canone per tracciare il fatturato ricorrente mensile (MRR).</span>
          </div>
        ` : `
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${maintenance_contracts.map((c, idx) => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #fafafa; border: 1px solid var(--border); border-radius: var(--radius);">
                <div>
                  <div style="font-weight: 600; font-size: 13px;">${c.title || 'Canone Manutenzione'}</div>
                  <div style="font-size: 11px; color: var(--text-muted);">
                    <span class="mono" style="font-weight: 600; color: var(--text-main);">${formatCurrency(c.amount)}</span> / ${c.frequency === 'annual' ? 'anno' : (c.frequency === 'quarterly' ? 'trimestre' : 'mese')}
                    ${c.billing_day ? ` • Fatturazione il <span class="mono">${c.billing_day}</span> del mese` : ''}
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span class="badge ${c.status === 'active' ? 'badge-green' : 'badge-gray'}">
                    ${c.status === 'active' ? 'Attivo' : 'In pausa'}
                  </span>
                  <button class="btn btn-sm btn-danger delete-contract-btn" data-index="${idx}" title="Elimina canone" style="padding: 2px 6px;">✕</button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>

    <!-- Griglia Operativa Cliente -->
    <div class="${activeClientTab === 'all' ? 'grid-2' : ''}" style="display: ${activeClientTab === 'tech' ? 'none' : (activeClientTab === 'all' ? 'grid' : 'block')};">
      <!-- Colonna To-do del Cliente raggruppati per Mese -->
      <div class="card" style="display: ${(activeClientTab === 'all' || activeClientTab === 'todos') ? 'block' : 'none'};">
        <div class="card-header">
          <div class="card-title">${icon('todos', 15)} <span>To-do & Lavori del Cliente (<span class="mono">${todos.length}</span>)</span></div>
          <button id="client-add-todo-btn" class="btn btn-sm btn-primary">+ Aggiungi To-do</button>
        </div>

        ${Object.keys(groupedTodos).length === 0 ? `
          <div style="text-align: center; padding: 30px; color: var(--text-muted);">
            Nessun to-do registrato per questo cliente.
          </div>
        ` : Object.entries(groupedTodos).map(([month, group]) => `
          <div style="margin-bottom: 18px; border-bottom: 1px solid var(--border); padding-bottom: 12px;">
            <div style="font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 8px;">${month}</div>

            <!-- Da fare -->
            ${group.pending.length > 0 ? `
              <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px;">
                ${group.pending.map(t => `
                  <div style="display: flex; justify-content: space-between; align-items: center; padding: 9px 11px; background: #ffffff; border: 1px solid var(--border); border-radius: var(--radius);">
                    <div style="min-width: 0;">
                      <div style="font-weight: 600; font-size: 13px;">${t.title}</div>
                      <div style="font-size: 11px; color: var(--text-muted);">
                        ${t.due_date ? `Scadenza: <span class="mono">${formatDateTime(t.due_date)}</span> • ` : ''}
                        ${t.compensation_amount > 0 ? `Compenso: <span class="mono" style="font-weight:600;color:var(--text-main);">${formatCurrency(t.compensation_amount)}</span>` : ''}
                      </div>
                    </div>
                    <span class="badge ${t.priority === 'urgente' ? 'badge-red' : 'badge-gray'}">${t.priority}</span>
                  </div>
                `).join('')}
              </div>
            ` : '<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">Nessuna attività pendente</div>'}

            <!-- Fatti -->
            ${group.completed.length > 0 ? `
              <div style="display: flex; flex-direction: column; gap: 6px;">
                ${group.completed.map(t => `
                  <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 11px; background: #fafafa; border: 1px solid var(--border); border-radius: var(--radius); opacity: 0.75;">
                    <div style="font-weight: 500; font-size: 13px; text-decoration: line-through;">${t.title}</div>
                    <span class="badge badge-green">Fatto</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>

      <!-- Colonna Preventivi & Appuntamenti/Shooting -->
      <div>
        <!-- Preventivi del Cliente -->
        <div class="card" style="margin-bottom: 20px; display: ${(activeClientTab === 'all' || activeClientTab === 'billing') ? 'block' : 'none'};">
          <div class="card-header">
            <div class="card-title">${icon('quotes', 15)} <span>Preventivi (<span class="mono">${quotes.length}</span>)</span></div>
            <button id="client-create-quote-btn" class="btn btn-sm btn-primary">+ Nuovo Preventivo</button>
          </div>

          ${quotes.length === 0 ? `
            <div style="text-align: center; padding: 20px; color: var(--text-muted);">
              Nessun preventivo creato.
            </div>
          ` : `
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${quotes.map(q => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #fafafa; border: 1px solid var(--border); border-radius: var(--radius);">
                  <div>
                    <div style="font-weight: 600;"><span class="mono">N. ${q.quote_number}</span> - ${q.title}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">
                      Data: <span class="mono">${formatDate(q.issue_date)}</span> • Totale: <strong class="mono" style="color:var(--text-main);">${formatCurrency(q.agreed_total || 0)}</strong>
                    </div>
                  </div>
                  <span class="badge badge-blue">${q.status}</span>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <!-- Appuntamenti, Rilasci & Scadenze -->
        <div class="card" style="display: ${(activeClientTab === 'all' || activeClientTab === 'events') ? 'block' : 'none'};">
          <div class="card-header">
            <div class="card-title">${icon('calendar', 15)} <span>Appuntamenti, Rilasci & Scadenze (<span class="mono">${appointments.length}</span>)</span></div>
          </div>

          ${appointments.length === 0 ? `
            <div style="text-align: center; padding: 20px; color: var(--text-muted);">
              Nessun evento in agenda.
            </div>
          ` : `
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${appointments.map(a => {
                let badgeHtml = '<span class="badge badge-gray">Incontro</span>';
                if (a.activity_type === 'deploy') badgeHtml = '<span class="badge badge-blue">Deploy</span>';
                else if (a.activity_type === 'demo') badgeHtml = '<span class="badge badge-green">Demo Sprint</span>';
                else if (a.activity_type === 'call') badgeHtml = '<span class="badge badge-yellow">Call Tecnica</span>';
                else if (a.activity_type === 'server_deadline') badgeHtml = '<span class="badge badge-red">Scadenza Server</span>';
                else if (a.is_shooting) badgeHtml = '<span class="badge badge-blue">Shooting</span>';

                return `
                  <div style="padding: 10px 12px; background: #fafafa; border: 1px solid var(--border); border-radius: var(--radius);">
                    <div style="display: flex; justify-content: space-between;">
                      <div style="font-weight: 600;">${a.title}</div>
                      ${badgeHtml}
                    </div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                      <span class="mono">${formatDateTime(a.start_time)}</span> ${a.location ? `• ${a.location}` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
      </div>
    </div>

    <div id="client-modal-container"></div>
  `;

  // Listener per Segmented Control (Tab)
  container.querySelectorAll('.client-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeClientTab = btn.getAttribute('data-client-tab') || 'all';
      renderClientProfile(container, clientId, router);
    });
  });

  attachSpringTiltCards(container);

  // Caricamento asincrono GitHub Widget
  const ghWidgetContent = container.querySelector('#github-widget-content');
  if (ghWidgetContent && client.github_repo) {
    loadGithubWidget(client.github_repo, ghWidgetContent);
  }

  // Modifica Dati Tecnici
  container.querySelector('#edit-tech-btn')?.addEventListener('click', () => {
    openClientModal(client, container, router);
  });

  // Aggiungi Canone di Manutenzione
  container.querySelector('#add-contract-btn')?.addEventListener('click', () => {
    const title = prompt('Nome del canone (es. SLA Manutenzione & Hosting):', 'Canone Assistenza & Manutenzione');
    if (!title) return;
    const amountStr = prompt('Importo periodico in € (es. 300):', '300');
    const amount = parseFloat(amountStr) || 0;
    const freqInput = prompt('Frequenza: "mensile", "trimestrale" o "annuale"', 'mensile');
    let frequency = 'monthly';
    if (freqInput?.toLowerCase().includes('anno') || freqInput?.toLowerCase().includes('annua')) frequency = 'annual';
    if (freqInput?.toLowerCase().includes('tri')) frequency = 'quarterly';

    const existingContracts = Array.isArray(client.maintenance_contracts) ? client.maintenance_contracts : [];
    const newContracts = [...existingContracts, {
      title,
      amount,
      frequency,
      status: 'active',
      created_at: new Date().toISOString(),
    }];

    store.update('clients', clientId, { maintenance_contracts: newContracts });
    renderClientProfile(container, clientId, router);
  });

  // Elimina Canone
  container.querySelectorAll('.delete-contract-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      if (confirm('Vuoi rimuovere questo canone di manutenzione?')) {
        const contracts = [...(client.maintenance_contracts || [])];
        contracts.splice(idx, 1);
        store.update('clients', clientId, { maintenance_contracts: contracts });
        renderClientProfile(container, clientId, router);
      }
    });
  });

  // Torna alla lista
  container.querySelector('#back-to-clients-btn')?.addEventListener('click', () => {
    activeClientId = null;
    renderClients(container, router);
  });

  // Edit cliente
  container.querySelector('#client-edit-profile-btn')?.addEventListener('click', () => {
    openClientModal(client, container, router);
  });

  // Cestina cliente
  container.querySelector('#client-trash-btn')?.addEventListener('click', () => {
    if (confirm(`Sei sicuro di voler spostare ${displayName} nel cestino?`)) {
      store.moveToTrash('clients', clientId);
      activeClientId = null;
      renderClients(container, router);
    }
  });

  // IA contestuale per questo cliente
  container.querySelector('#client-ai-btn')?.addEventListener('click', () => {
    openAiModal({
      preselectedClientId: clientId,
      onSaved: () => renderClientProfile(container, clientId, router),
    });
  });

  // Aggiungi To-do per questo cliente
  container.querySelector('#client-add-todo-btn')?.addEventListener('click', () => {
    openTodoModal(null, container, router, clientId);
  });

  // Nuovo preventivo
  container.querySelector('#client-create-quote-btn')?.addEventListener('click', () => {
    router.navigate('quotes', { newForClient: clientId });
  });
}

export function openClientModal(client, parentContainer, router) {
  const modalContainer = parentContainer.querySelector('#client-modal-container') || document.body;
  const isEdit = Boolean(client);

  const modalHtml = `
    <div class="modal-overlay" id="client-modal-overlay">
      <div class="modal-dialog modal-lg">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Modifica Cliente' : 'Nuovo Cliente'}</div>
          <button type="button" class="btn btn-sm btn-secondary" id="close-client-modal-btn">✕</button>
        </div>

        <form id="client-modal-form">
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Tipologia Cliente *</label>
                <select id="c-type" class="form-select">
                  <option value="company" ${client?.type === 'company' ? 'selected' : ''}>Azienda / Società</option>
                  <option value="person" ${client?.type === 'person' ? 'selected' : ''}>Persona Fisica / Privato</option>
                </select>
              </div>

              <div class="form-group" style="flex: 2;">
                <label class="form-label" id="c-company-label">Ragione Sociale</label>
                <input type="text" id="c-company-name" class="form-input" value="${client?.company_name || ''}" placeholder="Nome Azienda o Studio" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Nome</label>
                <input type="text" id="c-first-name" class="form-input" value="${client?.first_name || ''}" placeholder="Mario" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Cognome</label>
                <input type="text" id="c-last-name" class="form-input" value="${client?.last_name || ''}" placeholder="Rossi" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Referente Interno</label>
                <input type="text" id="c-contact-person" class="form-input" value="${client?.contact_person || ''}" placeholder="es. Dott.ssa Bianchi" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Email</label>
                <input type="email" id="c-email" class="form-input" value="${client?.email || ''}" placeholder="cliente@esempio.it" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Telefono</label>
                <input type="tel" id="c-phone" class="form-input" value="${client?.phone || ''}" placeholder="+39 333 1234567" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 2;">
                <label class="form-label">Indirizzo</label>
                <input type="text" id="c-address" class="form-input" value="${client?.address || ''}" placeholder="Via Roma 10" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">CAP</label>
                <input type="text" id="c-cap" class="form-input" value="${client?.postal_code || ''}" placeholder="00100" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Città</label>
                <input type="text" id="c-city" class="form-input" value="${client?.city || ''}" placeholder="Roma" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Partita IVA</label>
                <input type="text" id="c-vat" class="form-input" value="${client?.vat_number || ''}" placeholder="IT12345678901" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Codice Fiscale</label>
                <input type="text" id="c-fiscal-code" class="form-input" value="${client?.fiscal_code || ''}" placeholder="RSSMRA80A01H501U" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">PEC</label>
                <input type="email" id="c-pec" class="form-input" value="${client?.pec || ''}" placeholder="azienda@pec.it" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Codice Destinatario (SDI)</label>
                <input type="text" id="c-sdi" class="form-input" value="${client?.sdi_code || ''}" placeholder="M5UXCR1" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Tag (separati da virgola)</label>
                <input type="text" id="c-tags" class="form-input" value="${(client?.tags || []).join(', ')}" placeholder="SaaS, E-Commerce, Mobile App, VIP" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Provenienza / Origine</label>
                <input type="text" id="c-origin" class="form-input" value="${client?.origin || ''}" placeholder="Passaparola, LinkedIn, GitHub, Referral" />
              </div>
            </div>

            <!-- Dati Tecnici & Ambienti Dev -->
            <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; margin-bottom: 14px;">
              <div style="font-weight: 700; font-size: 13px; color: var(--accent); margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                💻 Ambienti & Repository Git (Configurazione Dev)
              </div>
              
              <div class="form-row">
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Ambiente Staging / Test (URL)</label>
                  <input type="url" id="c-staging-url" class="form-input" value="${client?.staging_url || ''}" placeholder="https://staging.tuocliente.it" />
                </div>
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Ambiente Produzione (URL)</label>
                  <input type="url" id="c-production-url" class="form-input" value="${client?.production_url || ''}" placeholder="https://www.tuocliente.it" />
                </div>
              </div>

              <div class="form-row">
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Repository GitHub (owner/repo)</label>
                  <input type="text" id="c-github-repo" class="form-input" value="${client?.github_repo || ''}" placeholder="es. antoromano/nome-progetto" />
                </div>
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Stack Tecnologico</label>
                  <input type="text" id="c-stack" class="form-input" value="${client?.stack || ''}" placeholder="es. Next.js, Supabase, Tailwind, Vercel" />
                </div>
              </div>

              <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label">Note Infrastruttura & Hosting</label>
                <input type="text" id="c-infra-notes" class="form-input" value="${client?.infra_notes || ''}" placeholder="es. Vercel Pro + Hetzner VPS (Docker), DNS su Cloudflare" />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Note Generali</label>
              <textarea id="c-notes" class="form-textarea" rows="2" placeholder="Note operative, preferenze o accordi contrattuali...">${client?.notes || ''}</textarea>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" id="cancel-client-modal-btn">Annulla</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Salva Modifiche' : 'Registra Cliente'}</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const div = document.createElement('div');
  div.innerHTML = modalHtml;
  modalContainer.appendChild(div);

  const overlay = div.querySelector('#client-modal-overlay');
  const form = div.querySelector('#client-modal-form');

  const closeModal = () => div.remove();
  div.querySelector('#close-client-modal-btn').addEventListener('click', closeModal);
  div.querySelector('#cancel-client-modal-btn').addEventListener('click', closeModal);

  // Safe backdrop click
  let mouseDownOnBackdrop = false;
  overlay.addEventListener('mousedown', (e) => {
    mouseDownOnBackdrop = (e.target === overlay);
  });
  overlay.addEventListener('mouseup', (e) => {
    if (mouseDownOnBackdrop && e.target === overlay) {
      closeModal();
    }
    mouseDownOnBackdrop = false;
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const type = div.querySelector('#c-type').value;
    const company_name = div.querySelector('#c-company-name').value.trim();
    const first_name = div.querySelector('#c-first-name').value.trim();
    const last_name = div.querySelector('#c-last-name').value.trim();

    if (type === 'company' && !company_name && !first_name && !last_name) {
      alert('Inserisci almeno la Ragione Sociale o un Referente.');
      return;
    }

    const tagsRaw = div.querySelector('#c-tags').value;
    const tags = tagsRaw.split(',').map(s => s.trim()).filter(Boolean);

    const payload = {
      type,
      company_name,
      first_name,
      last_name,
      contact_person: div.querySelector('#c-contact-person').value.trim(),
      email: div.querySelector('#c-email').value.trim(),
      phone: div.querySelector('#c-phone').value.trim(),
      address: div.querySelector('#c-address').value.trim(),
      postal_code: div.querySelector('#c-cap').value.trim(),
      city: div.querySelector('#c-city').value.trim(),
      vat_number: div.querySelector('#c-vat').value.trim(),
      fiscal_code: div.querySelector('#c-fiscal-code').value.trim(),
      pec: div.querySelector('#c-pec').value.trim(),
      sdi_code: div.querySelector('#c-sdi').value.trim(),
      tags,
      origin: div.querySelector('#c-origin').value.trim(),
      staging_url: div.querySelector('#c-staging-url').value.trim(),
      production_url: div.querySelector('#c-production-url').value.trim(),
      github_repo: div.querySelector('#c-github-repo').value.trim(),
      stack: div.querySelector('#c-stack').value.trim(),
      infra_notes: div.querySelector('#c-infra-notes').value.trim(),
      notes: div.querySelector('#c-notes').value.trim(),
    };

    if (isEdit) {
      store.update('clients', client.id, payload);
    } else {
      store.create('clients', payload);
    }

    closeModal();
    renderClients(parentContainer, router);
  });
}

/**
 * Caricamento widget GitHub (commits e pull request recenti)
 */
async function loadGithubWidget(repoString, containerEl) {
  if (!containerEl || !repoString) return;
  const clean = repoString.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').trim();
  if (!clean.includes('/')) return;

  containerEl.innerHTML = `<div style="font-size: 11px; color: var(--text-muted);">Caricamento dati GitHub (${clean})...</div>`;
  try {
    const settings = store.getSettings();
    const headers = { Accept: 'application/vnd.github.v3+json' };
    if (settings.github_token) {
      headers.Authorization = `token ${settings.github_token}`;
    }

    const [commitsRes, pullsRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${clean}/commits?per_page=3`, { headers }),
      fetch(`https://api.github.com/repos/${clean}/pulls?state=open&per_page=3`, { headers }),
    ]);

    if (!commitsRes.ok && (commitsRes.status === 404 || commitsRes.status === 403)) {
      containerEl.innerHTML = `
        <div style="font-size: 12px; color: var(--text-muted); display: flex; align-items: center; justify-content: space-between;">
          <span>Repo: <a href="https://github.com/${clean}" target="_blank" rel="noopener" style="font-weight: 600; color: var(--accent);">${clean}</a></span>
          <span class="badge badge-gray">${commitsRes.status === 403 ? 'Rate limit o privato' : 'Repo non trovato'}</span>
        </div>
      `;
      return;
    }

    const commits = commitsRes.ok ? await commitsRes.json() : [];
    const pulls = pullsRes.ok ? await pullsRes.json() : [];

    let commitsHtml = '';
    if (Array.isArray(commits) && commits.length > 0) {
      commitsHtml = `
        <div style="margin-top: 6px;">
          <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 4px;">ULTIMI COMMITS</div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${commits.map(c => `
              <div style="font-size: 12px; display: flex; justify-content: space-between; align-items: center; background: #ffffff; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border);">
                <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 75%;">
                  <span style="font-family: monospace; font-size: 10px; color: var(--accent); font-weight: bold;">${c.sha ? c.sha.substring(0, 7) : ''}</span>
                  <span>${c.commit?.message?.split('\n')[0] || 'Commit'}</span>
                </div>
                <span style="font-size: 10px; color: var(--text-muted);">${c.commit?.author?.name || ''}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    let pullsHtml = '';
    if (Array.isArray(pulls) && pulls.length > 0) {
      pullsHtml = `
        <div style="margin-top: 8px;">
          <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 4px;">PULL REQUEST APERTE (${pulls.length})</div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${pulls.map(p => `
              <div style="font-size: 12px; display: flex; justify-content: space-between; align-items: center; background: #ffffff; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border);">
                <a href="${p.html_url}" target="_blank" rel="noopener" style="color: var(--accent); font-weight: 600; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%;">
                  #${p.number} ${p.title}
                </a>
                <span class="badge badge-green" style="font-size: 10px;">Aperta</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    containerEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <div style="font-size: 12px; font-weight: 600;">
          🐙 <a href="https://github.com/${clean}" target="_blank" rel="noopener" style="color: var(--text-main);">${clean}</a>
        </div>
        <a href="https://github.com/${clean}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary" style="font-size: 10px; padding: 2px 6px;">Apri GitHub ↗</a>
      </div>
      ${commitsHtml || '<div style="font-size: 11px; color: var(--text-muted);">Nessun commit recente recuperabile.</div>'}
      ${pullsHtml}
    `;
  } catch (err) {
    containerEl.innerHTML = `
      <div style="font-size: 12px; color: var(--text-muted);">
        Repo: <a href="https://github.com/${clean}" target="_blank" rel="noopener">${clean}</a> (Non raggiungibile al momento)
      </div>
    `;
  }
}
