// src/modules/clients.js
// Gestione anagrafica Clienti (persone/aziende) e Scheda Cliente Completa

import { store } from '../services/store.js';
import { formatCurrency, formatDate, formatDateTime, formatMonthYear } from '../utils/formatters.js';
import { calculateQuoteTotals, calculatePaymentBalance } from '../utils/calculations.js';
import { openTodoModal } from './todos.js';
import { openAiModal } from './ai-assistant.js';

let activeClientId = null;
let clientSearchQuery = '';

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
            <div class="card client-card" data-id="${c.id}" style="cursor: pointer; transition: transform 0.15s, box-shadow 0.15s; margin-bottom: 0;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                <span class="badge ${isCompany ? 'badge-blue' : 'badge-gray'}">
                  ${isCompany ? '🏢 Azienda' : '👤 Persona'}
                </span>
                <div style="display: flex; gap: 4px;">
                  <button class="btn btn-sm btn-secondary client-quick-edit-btn" data-id="${c.id}" title="Modifica">✏️</button>
                </div>
              </div>

              <div style="font-weight: 700; font-size: 15px; margin-bottom: 2px;">${title}</div>
              ${sub ? `<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">${sub}</div>` : ''}

              <div style="font-size: 12px; color: var(--text-muted); display: flex; flex-direction: column; gap: 4px; margin-top: 8px;">
                ${c.email ? `<div>✉️ ${c.email}</div>` : ''}
                ${c.phone ? `<div>📞 ${c.phone}</div>` : ''}
                ${c.city ? `<div>📍 ${c.city}</div>` : ''}
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

  const { client, todos, appointments, quotes, payments } = profile;
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
    <!-- Intestazione Scheda Cliente -->
    <div class="card" style="margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;">
        <div>
          <button id="back-to-clients-btn" class="btn btn-sm btn-secondary" style="margin-bottom: 8px;">
            ← Torna ai Clienti
          </button>
          <div style="display: flex; align-items: center; gap: 10px;">
            <h2 style="font-size: 22px; font-weight: 800;">${displayName}</h2>
            <span class="badge ${isCompany ? 'badge-blue' : 'badge-gray'}">${isCompany ? 'Azienda' : 'Privato'}</span>
          </div>
          <div style="font-size: 13px; color: var(--text-muted); margin-top: 4px; display: flex; gap: 14px; flex-wrap: wrap;">
            ${client.contact_person ? `<span>Ref: ${client.contact_person}</span>` : ''}
            ${client.email ? `<span>✉️ ${client.email}</span>` : ''}
            ${client.phone ? `<span>📞 ${client.phone}</span>` : ''}
            ${client.address ? `<span>📍 ${client.address}, ${client.postal_code || ''} ${client.city || ''}</span>` : ''}
            ${client.vat_number ? `<span>P.IVA: ${client.vat_number}</span>` : ''}
            ${client.fiscal_code ? `<span>C.F.: ${client.fiscal_code}</span>` : ''}
            ${client.sdi_code ? `<span>SDI: ${client.sdi_code}</span>` : ''}
          </div>
        </div>

        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button id="client-ai-btn" class="btn btn-ai">
            ✨ Chiedi all'IA per questo cliente
          </button>
          <button id="client-edit-profile-btn" class="btn btn-secondary">
            ✏️ Modifica Dati
          </button>
          <button id="client-trash-btn" class="btn btn-danger">
            🗑️ Cestina
          </button>
        </div>
      </div>

      <!-- Scheda Sintesi Economica Cliente -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border);">
        <div style="background: #f8fafc; padding: 12px; border-radius: var(--radius); border: 1px solid var(--border);">
          <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">Totale Concordato</div>
          <div style="font-size: 18px; font-weight: 800; color: var(--text-main); margin-top: 4px;">${formatCurrency(totalAgreed)}</div>
        </div>
        <div style="background: #f8fafc; padding: 12px; border-radius: var(--radius); border: 1px solid var(--border);">
          <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">Incassato Effettivo</div>
          <div style="font-size: 18px; font-weight: 800; color: var(--success); margin-top: 4px;">${formatCurrency(totalPaid)}</div>
        </div>
        <div style="background: #f8fafc; padding: 12px; border-radius: var(--radius); border: 1px solid var(--border);">
          <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">Residuo da Incassare</div>
          <div style="font-size: 18px; font-weight: 800; color: ${residualClient > 0 ? 'var(--danger)' : 'var(--text-muted)'}; margin-top: 4px;">${formatCurrency(residualClient)}</div>
        </div>
      </div>
    </div>

    <!-- Griglia Operativa Cliente -->
    <div class="grid-2">
      <!-- Colonna To-do del Cliente raggruppati per Mese -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">To-do & Lavori del Cliente (${todos.length})</div>
          <button id="client-add-todo-btn" class="btn btn-sm btn-primary">+ Aggiungi To-do</button>
        </div>

        ${Object.keys(groupedTodos).length === 0 ? `
          <div style="text-align: center; padding: 30px; color: var(--text-muted);">
            Nessun to-do registrato per questo cliente.
          </div>
        ` : Object.entries(groupedTodos).map(([month, group]) => `
          <div style="margin-bottom: 18px; border-bottom: 1px solid var(--border); padding-bottom: 12px;">
            <div style="font-size: 13px; font-weight: 700; color: var(--accent); margin-bottom: 8px;">📅 ${month}</div>

            <!-- Da fare -->
            ${group.pending.length > 0 ? `
              <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px;">
                ${group.pending.map(t => `
                  <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; background: #ffffff; border: 1px solid var(--border); border-radius: var(--radius);">
                    <div style="min-width: 0;">
                      <div style="font-weight: 600; font-size: 13px;">${t.title}</div>
                      <div style="font-size: 11px; color: var(--text-muted);">
                        ${t.due_date ? `Scadenza: ${formatDateTime(t.due_date)} • ` : ''}
                        ${t.compensation_amount > 0 ? `Compenso: ${formatCurrency(t.compensation_amount)}` : ''}
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
                  <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius); opacity: 0.75;">
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
        <div class="card" style="margin-bottom: 20px;">
          <div class="card-header">
            <div class="card-title">Preventivi (${quotes.length})</div>
            <button id="client-create-quote-btn" class="btn btn-sm btn-primary">+ Nuovo Preventivo</button>
          </div>

          ${quotes.length === 0 ? `
            <div style="text-align: center; padding: 20px; color: var(--text-muted);">
              Nessun preventivo creato.
            </div>
          ` : `
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${quotes.map(q => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius);">
                  <div>
                    <div style="font-weight: 600;">N. ${q.quote_number} - ${q.title}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">
                      Data: ${formatDate(q.issue_date)} • Totale: <strong>${formatCurrency(q.agreed_total || 0)}</strong>
                    </div>
                  </div>
                  <span class="badge badge-blue">${q.status}</span>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <!-- Appuntamenti & Shooting Fotografici -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Appuntamenti & Shooting (${appointments.length})</div>
          </div>

          ${appointments.length === 0 ? `
            <div style="text-align: center; padding: 20px; color: var(--text-muted);">
              Nessun appuntamento in agenda.
            </div>
          ` : `
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${appointments.map(a => `
                <div style="padding: 10px; background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius);">
                  <div style="display: flex; justify-content: space-between;">
                    <div style="font-weight: 600;">${a.title}</div>
                    <span class="badge ${a.is_shooting ? 'badge-blue' : 'badge-gray'}">${a.is_shooting ? '📸 Shooting' : 'Incontro'}</span>
                  </div>
                  <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                    🕒 ${formatDateTime(a.start_time)} ${a.location ? `• 📍 ${a.location}` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    </div>

    <div id="client-modal-container"></div>
  `;

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
                <input type="text" id="c-tags" class="form-input" value="${(client?.tags || []).join(', ')}" placeholder="VIP, Fotografia, Consulenza" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Provenienza / Origine</label>
                <input type="text" id="c-origin" class="form-input" value="${client?.origin || ''}" placeholder="Passaparola, Sito Web, Instagram" />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Note</label>
              <textarea id="c-notes" class="form-textarea" rows="2" placeholder="Note operative, preferenze o dettagli contrattuali...">${client?.notes || ''}</textarea>
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
