// src/modules/quotes.js
// Gestione Preventivi: Elenco, Editor Completo, Voci con immagini affiancate, Bozza automatica IndexedDB e Stampa PDF

import { store } from '../services/store.js';
import { formatCurrency, formatDate, sanitizeFileName } from '../utils/formatters.js';
import { calculateItemTotal, calculateQuoteTotals } from '../utils/calculations.js';
import { generateId } from '../utils/id.js';
import { saveQuoteDraft, getQuoteDraft, deleteQuoteDraft } from '../utils/indexed-db.js';
import { openPdfPrintWindow } from '../services/pdf.js';
import { openQuoteManagerModal } from './quote-manager.js';

let quotesSearchQuery = '';
let quotesStatusFilter = 'all';

export function renderQuotes(container, router, options = {}) {
  // Se richiesto nuovo preventivo per un cliente specifico
  if (options?.newForClient) {
    openQuoteEditorModal({ client_id: options.newForClient }, container, router);
  }

  const quotes = store.getAll('quotes');
  const clients = store.getAll('clients');

  const filteredQuotes = quotes.filter(q => {
    if (quotesStatusFilter !== 'all' && q.status !== quotesStatusFilter) return false;
    if (quotesSearchQuery) {
      const query = quotesSearchQuery.toLowerCase();
      const numMatch = (q.quote_number || '').toLowerCase().includes(query);
      const titleMatch = (q.title || '').toLowerCase().includes(query);
      const client = clients.find(c => c.id === q.client_id);
      const clientMatch = client && `${client.first_name} ${client.last_name} ${client.company_name}`.toLowerCase().includes(query);
      return numMatch || titleMatch || clientMatch;
    }
    return true;
  });

  container.innerHTML = `
    <!-- Barra Superiore Filtri e Azioni -->
    <div class="card" style="margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; gap: 10px; flex-wrap: wrap; flex: 1;">
          <input
            type="text"
            id="quotes-search-input"
            class="form-input"
            placeholder="Cerca per numero, titolo, cliente..."
            value="${quotesSearchQuery}"
            style="max-width: 280px;"
          />
          <select id="quotes-status-filter" class="form-select" style="max-width: 180px;">
            <option value="all" ${quotesStatusFilter === 'all' ? 'selected' : ''}>Tutti gli stati</option>
            <option value="bozza" ${quotesStatusFilter === 'bozza' ? 'selected' : ''}>Bozza</option>
            <option value="inviato" ${quotesStatusFilter === 'inviato' ? 'selected' : ''}>Inviato</option>
            <option value="accettato" ${quotesStatusFilter === 'accettato' ? 'selected' : ''}>Accettato</option>
            <option value="rifiutato" ${quotesStatusFilter === 'rifiutato' ? 'selected' : ''}>Rifiutato</option>
            <option value="scaduto" ${quotesStatusFilter === 'scaduto' ? 'selected' : ''}>Scaduto</option>
          </select>
        </div>

        <button id="new-quote-btn" class="btn btn-primary">
          + Nuovo Preventivo
        </button>
      </div>
    </div>

    <!-- Tabella / Schede Preventivi -->
    <div class="card" style="padding: 0; overflow: hidden;">
      ${filteredQuotes.length === 0 ? `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          Nessun preventivo trovato.
        </div>
      ` : `
        <div class="data-table-wrapper">
          <table class="data-table mobile-cards-table">
            <thead>
              <tr>
                <th>Numero</th>
                <th>Titolo</th>
                <th>Cliente / Destinatario</th>
                <th>Data</th>
                <th>Totale</th>
                <th>Stato</th>
                <th>Lavoro</th>
                <th style="text-align: right;">Azioni</th>
              </tr>
            </thead>
            <tbody>
              ${filteredQuotes.map(q => {
                const client = q.client_id ? clients.find(c => c.id === q.client_id) : null;
                const recipientText = client
                  ? (client.company_name || `${client.first_name} ${client.last_name}`)
                  : (q.recipient_manual?.company_name || `${q.recipient_manual?.first_name || ''} ${q.recipient_manual?.last_name || ''}`.trim() || 'Destinatario manuale');

                let statusBadge = 'badge-gray';
                if (q.status === 'accettato') statusBadge = 'badge-green';
                else if (q.status === 'inviato') statusBadge = 'badge-blue';
                else if (q.status === 'rifiutato') statusBadge = 'badge-red';
                else if (q.status === 'scaduto') statusBadge = 'badge-yellow';

                return `
                  <tr>
                    <td data-label="Numero" style="font-weight: 700; color: var(--accent);">N. ${q.quote_number}</td>
                    <td data-label="Titolo" style="font-weight: 600;">${q.title}</td>
                    <td data-label="Destinatario">${recipientText}</td>
                    <td data-label="Data">${formatDate(q.issue_date)}</td>
                    <td data-label="Totale" style="font-weight: 700;">${formatCurrency(q.agreed_total || 0)}</td>
                    <td data-label="Stato"><span class="badge ${statusBadge}">${q.status}</span></td>
                    <td data-label="Lavoro"><span class="badge badge-gray">${q.work_status || 'Da iniziare'}</span></td>
                    <td data-label="Azioni" style="text-align: right;">
                      <div style="display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap;">
                        <button class="btn btn-sm btn-primary quote-manage-btn" data-id="${q.id}" title="Pannello Gestione Economica">
                          💼 Gestisci
                        </button>
                        <button class="btn btn-sm btn-secondary quote-edit-btn" data-id="${q.id}" title="Modifica Preventivo">
                          ✏️ Modifica
                        </button>
                        <button class="btn btn-sm btn-secondary quote-pdf-btn" data-id="${q.id}" title="Stampa o Salva PDF">
                          📄 PDF
                        </button>
                        <button class="btn btn-sm btn-danger quote-trash-btn" data-id="${q.id}" title="Cestina">
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>

    <div id="quotes-modal-container"></div>
  `;

  // Search & Filter listeners
  container.querySelector('#quotes-search-input')?.addEventListener('input', (e) => {
    quotesSearchQuery = e.target.value;
    renderQuotes(container, router);
  });
  container.querySelector('#quotes-status-filter')?.addEventListener('change', (e) => {
    quotesStatusFilter = e.target.value;
    renderQuotes(container, router);
  });

  // Nuovo preventivo
  container.querySelector('#new-quote-btn')?.addEventListener('click', () => {
    openQuoteEditorModal(null, container, router);
  });

  // Gestisci
  container.querySelectorAll('.quote-manage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const qId = btn.getAttribute('data-id');
      openQuoteManagerModal(qId, container, router, () => renderQuotes(container, router));
    });
  });

  // Modifica
  container.querySelectorAll('.quote-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const qId = btn.getAttribute('data-id');
      const details = store.getQuoteWithDetails(qId);
      if (details) openQuoteEditorModal(details, container, router);
    });
  });

  // PDF Rapido
  container.querySelectorAll('.quote-pdf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const qId = btn.getAttribute('data-id');
      const details = store.getQuoteWithDetails(qId);
      if (details) {
        openPdfChoiceModal(details, container);
      }
    });
  });

  // Cestina
  container.querySelectorAll('.quote-trash-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const qId = btn.getAttribute('data-id');
      if (confirm('Vuoi spostare questo preventivo nel cestino?')) {
        store.moveToTrash('quotes', qId);
        renderQuotes(container, router);
      }
    });
  });
}

function openPdfChoiceModal(details, parentContainer) {
  const modalContainer = parentContainer.querySelector('#quotes-modal-container') || document.body;
  const div = document.createElement('div');
  div.innerHTML = `
    <div class="modal-overlay" id="pdf-choice-overlay">
      <div class="modal-dialog" style="max-width: 400px;">
        <div class="modal-header">
          <div class="modal-title">Genera Preventivo PDF</div>
          <button type="button" class="btn btn-sm btn-secondary" id="close-pdf-choice">✕</button>
        </div>
        <div class="modal-body" style="text-align: center; display: flex; flex-direction: column; gap: 14px; padding: 24px;">
          <p style="font-size: 13px; color: var(--text-muted);">Scegli la versione desiderata:</p>
          <button id="pdf-btn-print" class="btn btn-primary" style="padding: 12px;">
            🖨️ Versione Stampa (Sfondo bianco, risparmio inchiostro)
          </button>
          <button id="pdf-btn-digital" class="btn btn-secondary" style="padding: 12px;">
            💻 Versione Digitale (Tema colore aziendale ad alto contrasto)
          </button>
        </div>
      </div>
    </div>
  `;
  modalContainer.appendChild(div);

  const close = () => div.remove();
  div.querySelector('#close-pdf-choice').addEventListener('click', close);
  div.querySelector('#pdf-btn-print').addEventListener('click', () => {
    close();
    openPdfPrintWindow({ ...details, mode: 'stampa' });
  });
  div.querySelector('#pdf-btn-digital').addEventListener('click', () => {
    close();
    openPdfPrintWindow({ ...details, mode: 'digitale' });
  });
}

/**
 * Editor Preventivo Completo
 */
export async function openQuoteEditorModal(initialData, parentContainer, router) {
  const modalContainer = parentContainer.querySelector('#quotes-modal-container') || document.body;
  const settings = store.getSettings();
  const clients = store.getAll('clients');

  const isEdit = Boolean(initialData?.quote?.id || initialData?.id);
  const quoteId = initialData?.quote?.id || initialData?.id || generateId();
  const draftKey = `quote_draft_${quoteId}`;

  // Controlla se esiste una bozza locale non salvata su IndexedDB
  const localDraft = await getQuoteDraft(draftKey);
  const hasDraft = Boolean(localDraft);

  // Dati di partenza
  let quote = (hasDraft ? localDraft.quote : (initialData?.quote || initialData)) || {
    id: quoteId,
    quote_number: `PREV-${new Date().getFullYear()}-${String(store.getAll('quotes').length + 1).padStart(3, '0')}`,
    title: '',
    issue_date: new Date().toISOString().split('T')[0],
    valid_until: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    client_id: initialData?.client_id || '',
    status: 'bozza',
    show_total_in_pdf: true,
    global_discount_percent: 0,
    agreed_total: '',
    fiscal_levy_enabled: settings.fiscal_levy_enabled || false,
    fiscal_levy_name: settings.fiscal_levy_name || 'Cassa Previdenziale',
    fiscal_levy_percent: settings.fiscal_levy_percent || 4.0,
    vat_enabled: settings.vat_enabled || false,
    vat_percent: settings.vat_percent || 22.0,
    conditions: settings.quote_default_conditions || '',
    internal_notes: '',
    work_status: 'Da iniziare',
  };

  let items = (hasDraft ? localDraft.items : (initialData?.items || []));
  if (items.length === 0) {
    items = [{
      id: generateId(),
      description: 'Prestazione professionale',
      quantity: 1,
      unit: 'pz',
      unit_price: 0,
      discount_percent: 0,
      is_freebie: false,
      visible_details: '',
      internal_notes: '',
      images: [],
    }];
  }

  const modalHtml = `
    <div class="modal-overlay" id="quote-editor-overlay">
      <div class="modal-dialog modal-lg" style="max-width: 1050px; height: 92vh;">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="modal-title">${isEdit ? 'Modifica Preventivo' : 'Nuovo Preventivo'}</div>
            <span id="draft-autosave-indicator" class="badge badge-gray" style="font-size: 11px;">
              ${hasDraft ? '⚠️ Bozza locale ripristinata' : 'Bozza pronta'}
            </span>
          </div>
          <div style="display: flex; gap: 8px;">
            ${hasDraft ? `<button type="button" id="discard-draft-btn" class="btn btn-sm btn-danger">Scarta bozza</button>` : ''}
            <button type="button" class="btn btn-sm btn-secondary" id="close-quote-editor-btn">✕</button>
          </div>
        </div>

        <form id="quote-editor-form" style="display: flex; flex-direction: column; flex: 1; min-height: 0;">
          <div class="modal-body" style="flex: 1; overflow-y: auto; padding: 20px;">

            <!-- Testata Documento -->
            <div class="card" style="padding: 16px; margin-bottom: 16px;">
              <div class="form-row">
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Numero Preventivo *</label>
                  <input type="text" id="qe-number" class="form-input" value="${quote.quote_number || ''}" required />
                </div>
                <div class="form-group" style="flex: 2;">
                  <label class="form-label">Titolo / Oggetto *</label>
                  <input type="text" id="qe-title" class="form-input" value="${quote.title || ''}" placeholder="es. Servizio fotografico e consulenza immagine" required />
                </div>
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Stato</label>
                  <select id="qe-status" class="form-select">
                    <option value="bozza" ${quote.status === 'bozza' ? 'selected' : ''}>Bozza</option>
                    <option value="inviato" ${quote.status === 'inviato' ? 'selected' : ''}>Inviato</option>
                    <option value="accettato" ${quote.status === 'accettato' ? 'selected' : ''}>Accettato</option>
                    <option value="rifiutato" ${quote.status === 'rifiutato' ? 'selected' : ''}>Rifiutato</option>
                    <option value="scaduto" ${quote.status === 'scaduto' ? 'selected' : ''}>Scaduto</option>
                  </select>
                </div>
              </div>

              <div class="form-row">
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Data Emissione</label>
                  <input type="date" id="qe-date" class="form-input" value="${quote.issue_date || ''}" required />
                </div>
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Validità Fino al</label>
                  <input type="date" id="qe-valid" class="form-input" value="${quote.valid_until || ''}" />
                </div>
                <div class="form-group" style="flex: 2;">
                  <label class="form-label">Cliente Selezionato</label>
                  <select id="qe-client" class="form-select">
                    <option value="">Destinatario manuale</option>
                    ${clients.map(c => `
                      <option value="${c.id}" ${quote.client_id === c.id ? 'selected' : ''}>
                        ${c.company_name || `${c.first_name} ${c.last_name}`}
                      </option>
                    `).join('')}
                  </select>
                </div>
              </div>

              <!-- Destinatario Manuale (se nessun cliente selezionato) -->
              <div id="qe-manual-recipient-pane" style="display: ${quote.client_id ? 'none' : 'block'}; margin-top: 10px; padding: 12px; background: #f8fafc; border: 1px dashed var(--border); border-radius: var(--radius);">
                <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">Dati Destinatario Manuale (per PDF)</div>
                <div class="form-row">
                  <input type="text" id="qe-m-company" class="form-input" placeholder="Azienda / Ragione Sociale" value="${quote.recipient_manual?.company_name || ''}" style="flex: 2;" />
                  <input type="text" id="qe-m-name" class="form-input" placeholder="Nome e Cognome Referente" value="${quote.recipient_manual?.first_name || ''}" style="flex: 2;" />
                  <input type="text" id="qe-m-city" class="form-input" placeholder="Città e Indirizzo" value="${quote.recipient_manual?.city || ''}" style="flex: 2;" />
                  <input type="text" id="qe-m-vat" class="form-input" placeholder="P.IVA o Cod. Fiscale" value="${quote.recipient_manual?.vat_number || ''}" style="flex: 1;" />
                </div>
              </div>
            </div>

            <!-- VOCI DEL PREVENTIVO (Con immagini affiancate per singola voce) -->
            <div class="card" style="padding: 16px; margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
                <div style="font-weight: 700; font-size: 15px;">Voci di Preventivo</div>
                <button type="button" id="qe-add-item-btn" class="btn btn-sm btn-secondary">+ Aggiungi Voce</button>
              </div>

              <div id="qe-items-container" style="display: flex; flex-direction: column; gap: 14px;">
                <!-- Righe generate dinamicamente -->
              </div>
            </div>

            <!-- Opzioni Economiche, Oneri Fiscali e Totali -->
            <div class="grid-2">
              <div class="card" style="padding: 16px;">
                <div style="font-weight: 700; font-size: 14px; margin-bottom: 12px;">Oneri Fiscali & Opzioni PDF</div>

                <div class="form-group">
                  <label style="display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer;">
                    <input type="checkbox" id="qe-show-total-pdf" ${quote.show_total_in_pdf !== false ? 'checked' : ''} />
                    Mostra totale nel PDF (attivo di default)
                  </label>
                  <div style="font-size: 11px; color: var(--text-muted); margin-left: 24px;">Se disattivato, il PDF mostra le singole voci e prezzi senza riepilogo totale finale.</div>
                </div>

                <div class="form-row">
                  <div class="form-group" style="flex: 1;">
                    <label class="form-label">Sconto Globale (%)</label>
                    <input type="number" id="qe-global-discount" class="form-input" min="0" max="100" step="0.1" value="${quote.global_discount_percent || 0}" />
                  </div>
                  <div class="form-group" style="flex: 1;">
                    <label class="form-label">Totale Concordato (€)</label>
                    <input type="number" id="qe-agreed-total" class="form-input" step="0.01" placeholder="Opzionale (sovrascrive)" value="${quote.agreed_total !== undefined && quote.agreed_total !== null ? quote.agreed_total : ''}" />
                  </div>
                </div>

                <!-- Oneri previdenziali configurabili -->
                <div class="form-row" style="align-items: center;">
                  <div style="flex: 1;">
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;">
                      <input type="checkbox" id="qe-levy-enabled" ${quote.fiscal_levy_enabled ? 'checked' : ''} />
                      Applica Oneri / Cassa
                    </label>
                  </div>
                  <div style="flex: 2;">
                    <input type="text" id="qe-levy-name" class="form-input" value="${quote.fiscal_levy_name || 'Cassa Previdenziale'}" />
                  </div>
                  <div style="flex: 1;">
                    <input type="number" id="qe-levy-percent" class="form-input" step="0.1" value="${quote.fiscal_levy_percent || 4.0}" />
                  </div>
                </div>

                <!-- IVA -->
                <div class="form-row" style="align-items: center; margin-top: 8px;">
                  <div style="flex: 1;">
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;">
                      <input type="checkbox" id="qe-vat-enabled" ${quote.vat_enabled ? 'checked' : ''} />
                      Applica IVA
                    </label>
                  </div>
                  <div style="flex: 1;">
                    <input type="number" id="qe-vat-percent" class="form-input" step="0.1" value="${quote.vat_percent || 22.0}" />
                  </div>
                </div>
              </div>

              <!-- Riepilogo Economico Live -->
              <div class="card" style="padding: 16px; background: #f8fafc;">
                <div style="font-weight: 700; font-size: 14px; margin-bottom: 12px;">Riepilogo Calcoli Live</div>
                <div id="qe-live-summary">
                  <!-- Calcoli calcolati dinamicamente -->
                </div>
              </div>
            </div>

            <!-- Condizioni Contrattuali e Note Interne -->
            <div class="card" style="padding: 16px;">
              <div class="form-group">
                <label class="form-label">Condizioni Contrattuali e di Pagamento (visibili nel PDF)</label>
                <textarea id="qe-conditions" class="form-textarea" rows="2">${quote.conditions || ''}</textarea>
              </div>
              <div class="form-group">
                <label class="form-label">Note Interne (escluse dal PDF)</label>
                <textarea id="qe-internal-notes" class="form-textarea" rows="2" placeholder="Accordi verbali, dettagli riservati...">${quote.internal_notes || ''}</textarea>
              </div>
            </div>
          </div>

          <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; gap: 8px;">
              <button type="button" id="qe-print-preview-btn" class="btn btn-secondary">🖨️ Stampa PDF</button>
              <button type="button" id="qe-digital-preview-btn" class="btn btn-secondary">💻 PDF Digitale</button>
            </div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="btn btn-secondary" id="qe-cancel-btn">Annulla</button>
              <button type="submit" class="btn btn-primary" id="qe-save-btn">Salva Preventivo</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;

  const div = document.createElement('div');
  div.innerHTML = modalHtml;
  modalContainer.appendChild(div);

  const overlay = div.querySelector('#quote-editor-overlay');
  const form = div.querySelector('#quote-editor-form');
  const itemsContainer = div.querySelector('#qe-items-container');
  const clientSelect = div.querySelector('#qe-client');
  const manualRecipientPane = div.querySelector('#qe-manual-recipient-pane');
  const autosaveIndicator = div.querySelector('#draft-autosave-indicator');

  // Toggle manual recipient pane
  clientSelect.addEventListener('change', () => {
    manualRecipientPane.style.display = clientSelect.value ? 'none' : 'block';
    triggerAutosave();
  });

  // Funzione rendering voci
  function renderItemsList() {
    itemsContainer.innerHTML = '';
    items.forEach((item, index) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'quote-item-editor-card';
      itemEl.style.cssText = 'border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; background: #ffffff;';

      const itemTotal = calculateItemTotal(item);
      const grossVal = (Number(item.quantity) || 1) * (Number(item.unit_price) || 0);

      itemEl.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-weight: 700; font-size: 13px; color: var(--accent);">Voce #${index + 1}</span>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn btn-sm btn-secondary qe-duplicate-item" data-index="${index}" title="Duplica voce">
              📋 Duplica
            </button>
            <button type="button" class="btn btn-sm btn-danger qe-remove-item" data-index="${index}" title="Elimina voce">
              ✕
            </button>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group" style="flex: 3;">
            <label class="form-label">Descrizione *</label>
            <input type="text" class="form-input it-desc" data-index="${index}" value="${item.description || ''}" required placeholder="Nome del servizio o prodotto" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label class="form-label">Q.tà</label>
            <input type="number" class="form-input it-qty" data-index="${index}" step="0.5" min="0.1" value="${item.quantity || 1}" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label class="form-label">U.M.</label>
            <input type="text" class="form-input it-unit" data-index="${index}" value="${item.unit || 'pz'}" />
          </div>
          <div class="form-group" style="flex: 1.5;">
            <label class="form-label">Prezzo Unit. (€)</label>
            <input type="number" class="form-input it-price" data-index="${index}" step="0.01" value="${item.unit_price || 0}" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label class="form-label">Sconto (%)</label>
            <input type="number" class="form-input it-discount" data-index="${index}" min="0" max="100" value="${item.discount_percent || 0}" />
          </div>
        </div>

        <!-- Prezzo finale evidente e nota sconto -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #f8fafc; border-radius: var(--radius); margin-bottom: 8px;">
          <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
            <input type="checkbox" class="it-freebie" data-index="${index}" ${item.is_freebie ? 'checked' : ''} />
            🎁 Voce omaggio
          </label>
          <div style="text-align: right;">
            <span style="font-size: 15px; font-weight: 800; color: ${item.is_freebie ? 'var(--success)' : 'var(--text-main)'};">
              ${item.is_freebie ? 'Omaggio (0,00 €)' : formatCurrency(itemTotal)}
            </span>
            ${(!item.is_freebie && item.discount_percent > 0) ? `
              <div style="font-size: 11px; color: var(--danger);">Sconto del ${item.discount_percent}% su totale di ${formatCurrency(grossVal)}</div>
            ` : ''}
          </div>
        </div>

        <div class="form-row">
          <div class="form-group" style="flex: 1;">
            <label class="form-label">Dettagli visibili nel PDF</label>
            <textarea class="form-textarea it-details" data-index="${index}" rows="1" placeholder="Specifiche tecniche visibili al cliente">${item.visible_details || ''}</textarea>
          </div>
          <div class="form-group" style="flex: 1;">
            <label class="form-label">Note interne (escluse dal PDF)</label>
            <textarea class="form-textarea it-notes" data-index="${index}" rows="1" placeholder="Appunti privati o fornitore">${item.internal_notes || ''}</textarea>
          </div>
        </div>

        <!-- Sezione Immagini collegate a QUESTA voce -->
        <div style="margin-top: 8px; border-top: 1px dashed var(--border); padding-top: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 12px; font-weight: 600; color: var(--text-muted);">Immagini di riferimento per questa voce (${(item.images || []).length})</span>
            <label class="btn btn-sm btn-secondary" style="cursor: pointer;">
              📷 Aggiungi Foto
              <input type="file" class="it-img-upload" data-index="${index}" accept="image/jpeg,image/png,image/webp" multiple style="display: none;" />
            </label>
          </div>

          <div class="it-images-gallery" style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${(item.images || []).map((img, imgIdx) => `
              <div style="width: 100px; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; background: #ffffff;">
                <img src="${img.file_url}" style="width: 100%; height: 75px; object-fit: cover;" alt="Foto" />
                <input type="text" class="form-input it-img-caption" data-item-idx="${index}" data-img-idx="${imgIdx}" value="${img.caption || ''}" placeholder="Didascalia" style="font-size: 10px; padding: 2px 4px; border: none; border-top: 1px solid var(--border);" />
                <button type="button" class="btn btn-sm btn-danger it-img-delete" data-item-idx="${index}" data-img-idx="${imgIdx}" style="width: 100%; border-radius: 0; padding: 2px; font-size: 10px;">Rimuovi</button>
              </div>
            `).join('')}
          </div>
        </div>
      `;

      itemsContainer.appendChild(itemEl);
    });

    attachItemsEvents();
    updateLiveSummary();
  }

  function attachItemsEvents() {
    // Inputs cambio valori voce
    itemsContainer.querySelectorAll('.it-desc').forEach(el => {
      el.addEventListener('input', (e) => {
        items[e.target.dataset.index].description = e.target.value;
        triggerAutosave();
      });
    });
    itemsContainer.querySelectorAll('.it-qty').forEach(el => {
      el.addEventListener('input', (e) => {
        items[e.target.dataset.index].quantity = parseFloat(e.target.value) || 1;
        renderItemsList();
        triggerAutosave();
      });
    });
    itemsContainer.querySelectorAll('.it-unit').forEach(el => {
      el.addEventListener('input', (e) => {
        items[e.target.dataset.index].unit = e.target.value;
        triggerAutosave();
      });
    });
    itemsContainer.querySelectorAll('.it-price').forEach(el => {
      el.addEventListener('input', (e) => {
        items[e.target.dataset.index].unit_price = parseFloat(e.target.value) || 0;
        renderItemsList();
        triggerAutosave();
      });
    });
    itemsContainer.querySelectorAll('.it-discount').forEach(el => {
      el.addEventListener('input', (e) => {
        items[e.target.dataset.index].discount_percent = parseFloat(e.target.value) || 0;
        renderItemsList();
        triggerAutosave();
      });
    });
    itemsContainer.querySelectorAll('.it-freebie').forEach(el => {
      el.addEventListener('change', (e) => {
        items[e.target.dataset.index].is_freebie = e.target.checked;
        renderItemsList();
        triggerAutosave();
      });
    });
    itemsContainer.querySelectorAll('.it-details').forEach(el => {
      el.addEventListener('input', (e) => {
        items[e.target.dataset.index].visible_details = e.target.value;
        triggerAutosave();
      });
    });
    itemsContainer.querySelectorAll('.it-notes').forEach(el => {
      el.addEventListener('input', (e) => {
        items[e.target.dataset.index].internal_notes = e.target.value;
        triggerAutosave();
      });
    });

    // Duplica voce (Crea copia indipendente)
    itemsContainer.querySelectorAll('.qe-duplicate-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.index, 10);
        const source = items[idx];
        const clone = {
          ...source,
          id: generateId(),
          description: `${source.description} (Copia)`,
          images: (source.images || []).map(img => ({ ...img, id: generateId() })),
        };
        items.splice(idx + 1, 0, clone);
        renderItemsList();
        triggerAutosave();
      });
    });

    // Elimina voce
    itemsContainer.querySelectorAll('.qe-remove-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.index, 10);
        if (items.length <= 1) {
          alert('Il preventivo deve contenere almeno una voce.');
          return;
        }
        items.splice(idx, 1);
        renderItemsList();
        triggerAutosave();
      });
    });

    // Caricamento immagini voce (JPG, PNG, WebP max 5MB)
    itemsContainer.querySelectorAll('.it-img-upload').forEach(input => {
      input.addEventListener('change', async (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        const files = Array.from(e.target.files);

        for (const file of files) {
          if (file.size > 5 * 1024 * 1024) {
            alert(`Il file ${file.name} supera il limite massimo di 5 MB.`);
            continue;
          }
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            alert(`Formato non supportato per ${file.name}. Usa JPG, PNG o WebP.`);
            continue;
          }

          const reader = new FileReader();
          reader.onload = () => {
            if (!items[idx].images) items[idx].images = [];
            items[idx].images.push({
              id: generateId(),
              file_url: reader.result,
              caption: '',
              file_name: file.name,
              file_size: file.size,
            });
            renderItemsList();
            triggerAutosave();
          };
          reader.readAsDataURL(file);
        }
      });
    });

    // Didascalia immagine
    itemsContainer.querySelectorAll('.it-img-caption').forEach(input => {
      input.addEventListener('input', (e) => {
        const itemIdx = e.target.dataset.itemIdx;
        const imgIdx = e.target.dataset.imgIdx;
        items[itemIdx].images[imgIdx].caption = e.target.value;
        triggerAutosave();
      });
    });

    // Cancella immagine
    itemsContainer.querySelectorAll('.it-img-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const itemIdx = e.target.dataset.itemIdx;
        const imgIdx = e.target.dataset.imgIdx;
        items[itemIdx].images.splice(imgIdx, 1);
        renderItemsList();
        triggerAutosave();
      });
    });
  }

  function updateLiveSummary() {
    const summaryContainer = div.querySelector('#qe-live-summary');
    const dummyQuote = collectFormData();
    const totals = calculateQuoteTotals(dummyQuote, items);

    summaryContainer.innerHTML = `
      <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px;">
        <span>Subtotale voci:</span>
        <strong>${formatCurrency(totals.itemsSubtotal)}</strong>
      </div>
      ${dummyQuote.global_discount_percent > 0 ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px; color: var(--danger);">
          <span>Sconto Globale (${dummyQuote.global_discount_percent}%):</span>
          <strong>-${formatCurrency(totals.globalDiscountAmount)}</strong>
        </div>
      ` : ''}
      ${totals.fiscalLevyAmount > 0 ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px;">
          <span>${dummyQuote.fiscal_levy_name} (${dummyQuote.fiscal_levy_percent}%):</span>
          <strong>+${formatCurrency(totals.fiscalLevyAmount)}</strong>
        </div>
      ` : ''}
      ${totals.vatAmount > 0 ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px;">
          <span>IVA (${dummyQuote.vat_percent}%):</span>
          <strong>+${formatCurrency(totals.vatAmount)}</strong>
        </div>
      ` : ''}
      <div style="display: flex; justify-content: space-between; padding-top: 8px; margin-top: 8px; border-top: 2px solid var(--border); font-size: 16px; font-weight: 800; color: var(--accent);">
        <span>${totals.hasManualAgreedTotal ? 'Totale Concordato:' : 'Totale Calcolato:'}</span>
        <span>${formatCurrency(totals.agreedBaseTotal)}</span>
      </div>
    `;
  }

  function collectFormData() {
    const agreedVal = div.querySelector('#qe-agreed-total').value;
    return {
      id: quoteId,
      quote_number: div.querySelector('#qe-number').value.trim(),
      title: div.querySelector('#qe-title').value.trim(),
      issue_date: div.querySelector('#qe-date').value,
      valid_until: div.querySelector('#qe-valid').value || null,
      client_id: clientSelect.value || null,
      recipient_manual: {
        company_name: div.querySelector('#qe-m-company').value.trim(),
        first_name: div.querySelector('#qe-m-name').value.trim(),
        city: div.querySelector('#qe-m-city').value.trim(),
        vat_number: div.querySelector('#qe-m-vat').value.trim(),
      },
      status: div.querySelector('#qe-status').value,
      show_total_in_pdf: div.querySelector('#qe-show-total-pdf').checked,
      global_discount_percent: parseFloat(div.querySelector('#qe-global-discount').value) || 0,
      agreed_total: agreedVal !== '' ? parseFloat(agreedVal) : null,
      fiscal_levy_enabled: div.querySelector('#qe-levy-enabled').checked,
      fiscal_levy_name: div.querySelector('#qe-levy-name').value.trim(),
      fiscal_levy_percent: parseFloat(div.querySelector('#qe-levy-percent').value) || 0,
      vat_enabled: div.querySelector('#qe-vat-enabled').checked,
      vat_percent: parseFloat(div.querySelector('#qe-vat-percent').value) || 0,
      conditions: div.querySelector('#qe-conditions').value.trim(),
      internal_notes: div.querySelector('#qe-internal-notes').value.trim(),
      work_status: quote.work_status || 'Da iniziare',
    };
  }

  // Salvataggio automatico bozza su IndexedDB (debounced)
  let autosaveTimeout = null;
  function triggerAutosave() {
    if (autosaveIndicator) autosaveIndicator.textContent = 'Salvataggio bozza...';
    clearTimeout(autosaveTimeout);
    autosaveTimeout = setTimeout(async () => {
      const currentQuoteData = collectFormData();
      await saveQuoteDraft(draftKey, { quote: currentQuoteData, items });
      if (autosaveIndicator) {
        autosaveIndicator.textContent = `Bozza salvata ${new Date().toLocaleTimeString()}`;
        autosaveIndicator.className = 'badge badge-green';
      }
    }, 600);
  }

  // Listeners campi globali per aggiornare summary e autosave
  div.querySelectorAll('#qe-global-discount, #qe-agreed-total, #qe-levy-enabled, #qe-levy-percent, #qe-vat-enabled, #qe-vat-percent, #qe-show-total-pdf').forEach(el => {
    el.addEventListener('input', () => {
      updateLiveSummary();
      triggerAutosave();
    });
    el.addEventListener('change', () => {
      updateLiveSummary();
      triggerAutosave();
    });
  });

  // Aggiungi nuova voce
  div.querySelector('#qe-add-item-btn').addEventListener('click', () => {
    items.push({
      id: generateId(),
      description: 'Nuova voce',
      quantity: 1,
      unit: 'pz',
      unit_price: 0,
      discount_percent: 0,
      is_freebie: false,
      visible_details: '',
      internal_notes: '',
      images: [],
    });
    renderItemsList();
    triggerAutosave();
  });

  // Scarta bozza
  div.querySelector('#discard-draft-btn')?.addEventListener('click', async () => {
    if (confirm('Vuoi davvero scartare la bozza locale e ripristinare i dati originali?')) {
      await deleteQuoteDraft(draftKey);
      div.remove();
      renderQuotes(parentContainer, router);
    }
  });

  // Safe backdrop click
  const closeModal = () => div.remove();
  div.querySelector('#close-quote-editor-btn').addEventListener('click', closeModal);
  div.querySelector('#qe-cancel-btn').addEventListener('click', closeModal);

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

  // Anteprime PDF
  div.querySelector('#qe-print-preview-btn').addEventListener('click', () => {
    const qData = collectFormData();
    const cl = qData.client_id ? store.getById('clients', qData.client_id) : null;
    openPdfPrintWindow({ quote: qData, items, extraServices: [], client: cl, mode: 'stampa' });
  });

  div.querySelector('#qe-digital-preview-btn').addEventListener('click', () => {
    const qData = collectFormData();
    const cl = qData.client_id ? store.getById('clients', qData.client_id) : null;
    openPdfPrintWindow({ quote: qData, items, extraServices: [], client: cl, mode: 'digitale' });
  });

  // Submit salvataggio definitivo
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const finalQuoteData = collectFormData();
    if (!finalQuoteData.quote_number || !finalQuoteData.title) {
      alert('Compila il numero e il titolo del preventivo.');
      return;
    }

    // Se non è stato impostato un totale manuale, calcola quello matematico e salvalo
    if (finalQuoteData.agreed_total === null || isNaN(finalQuoteData.agreed_total)) {
      const computed = calculateQuoteTotals(finalQuoteData, items);
      finalQuoteData.agreed_total = computed.computedMathematicalTotal;
    }

    try {
      store.saveFullQuote({
        quote: finalQuoteData,
        items,
        extraServices: initialData?.extraServices || [],
      });

      // Cancella la bozza locale ora che è salvato online/nel db
      await deleteQuoteDraft(draftKey);

      closeModal();
      renderQuotes(parentContainer, router);
    } catch (err) {
      alert('Errore durante il salvataggio. La bozza locale è stata preservata.');
      console.error(err);
    }
  });

  // Avvio iniziale render voci
  renderItemsList();
}
