// src/modules/quote-manager.js
// Pannello "Gestisci" Preventivo: Servizi Extra, Pagamenti, Stato Lavoro, Consegna e To-do collegati

import { store } from '../services/store.js';
import { formatCurrency, formatDate } from '../utils/formatters.js';
import { calculateQuoteTotals, calculatePaymentBalance } from '../utils/calculations.js';
import { generateId } from '../utils/id.js';

export function openQuoteManagerModal(quoteId, parentContainer, router, onUpdated) {
  const modalContainer = parentContainer.querySelector('#quotes-modal-container') || document.body;
  const quoteDetails = store.getQuoteWithDetails(quoteId);
  if (!quoteDetails || !quoteDetails.quote) return;

  const { quote, items, extraServices, payments, client } = quoteDetails;
  const linkedTodos = store.getAll('todos').filter(t => t.quote_id === quoteId);

  // Calcolo totale con extra approvati e residuo
  const quoteTotals = calculateQuoteTotals(quote, items, extraServices);
  const paymentBalance = calculatePaymentBalance(quoteTotals.finalEffectiveTotal, payments);

  const clientName = client
    ? (client.company_name || `${client.first_name} ${client.last_name}`)
    : (quote.recipient_manual?.company_name || `${quote.recipient_manual?.first_name || ''} ${quote.recipient_manual?.last_name || ''}`.trim() || 'Destinatario');

  const modalHtml = `
    <div class="modal-overlay" id="quote-manager-overlay">
      <div class="modal-dialog modal-lg" style="max-width: 950px; max-height: 90vh;">
        <div class="modal-header">
          <div>
            <div class="modal-title">Gestisci Preventivo N. ${quote.quote_number}</div>
            <div style="font-size: 12px; color: var(--text-muted);">${quote.title} • Cliente: <strong>${clientName}</strong></div>
          </div>
          <button type="button" class="btn btn-sm btn-secondary" id="close-quote-mgr-btn">✕</button>
        </div>

        <div class="modal-body" style="padding: 20px; overflow-y: auto;">
          <!-- Schede Sintesi Economica -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px;">
            <div style="background: #f8fafc; padding: 12px; border-radius: var(--radius); border: 1px solid var(--border);">
              <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">Totale Concordato Base</div>
              <div style="font-size: 17px; font-weight: 800; color: var(--text-main); margin-top: 4px;">${formatCurrency(quoteTotals.agreedBaseTotal)}</div>
            </div>

            <div style="background: #f8fafc; padding: 12px; border-radius: var(--radius); border: 1px solid var(--border);">
              <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">Extra Approvati</div>
              <div style="font-size: 17px; font-weight: 800; color: var(--accent); margin-top: 4px;">+${formatCurrency(quoteTotals.extraApprovedTotal)}</div>
              ${quoteTotals.extraProposedTotal > 0 ? `<div style="font-size: 10px; color: var(--warning); margin-top: 2px;">(${formatCurrency(quoteTotals.extraProposedTotal)} proposti)</div>` : ''}
            </div>

            <div style="background: #f8fafc; padding: 12px; border-radius: var(--radius); border: 1px solid var(--border);">
              <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">Totale Effettivo Lavoro</div>
              <div style="font-size: 17px; font-weight: 800; color: var(--primary); margin-top: 4px;">${formatCurrency(quoteTotals.finalEffectiveTotal)}</div>
            </div>

            <div style="background: #f8fafc; padding: 12px; border-radius: var(--radius); border: 1px solid var(--border);">
              <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">Incassato Reale</div>
              <div style="font-size: 17px; font-weight: 800; color: var(--success); margin-top: 4px;">${formatCurrency(paymentBalance.collectedAmount)}</div>
            </div>

            <div style="background: #f8fafc; padding: 12px; border-radius: var(--radius); border: 1px solid var(--border);">
              <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600;">Residuo da Incassare</div>
              <div style="font-size: 17px; font-weight: 800; color: ${paymentBalance.residualAmount > 0 ? 'var(--danger)' : 'var(--text-muted)'}; margin-top: 4px;">
                ${formatCurrency(paymentBalance.residualAmount)}
              </div>
            </div>
          </div>

          <!-- Stato Lavoro e Consegna Prevista -->
          <div class="card" style="padding: 16px; margin-bottom: 20px;">
            <div style="font-weight: 700; font-size: 14px; margin-bottom: 12px;">Avanzamento e Consegna Lavoro</div>
            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Stato del Lavoro</label>
                <select id="qm-work-status" class="form-select">
                  <option value="Da iniziare" ${quote.work_status === 'Da iniziare' ? 'selected' : ''}>Da iniziare</option>
                  <option value="In lavorazione" ${quote.work_status === 'In lavorazione' ? 'selected' : ''}>In lavorazione</option>
                  <option value="In revisione" ${quote.work_status === 'In revisione' ? 'selected' : ''}>In revisione cliente</option>
                  <option value="Completato" ${quote.work_status === 'Completato' ? 'selected' : ''}>Completato</option>
                  <option value="Consegnato" ${quote.work_status === 'Consegnato' ? 'selected' : ''}>Consegnato</option>
                </select>
              </div>

              <div class="form-group" style="flex: 1;">
                <label class="form-label">Consegna Prevista</label>
                <input type="date" id="qm-expected-delivery" class="form-input" value="${quote.expected_delivery || ''}" />
              </div>

              <div style="display: flex; align-items: flex-end; padding-bottom: 16px;">
                <button type="button" id="qm-save-status-btn" class="btn btn-secondary">Aggiorna Stato</button>
              </div>
            </div>
          </div>

          <!-- SEZIONE PAGAMENTI REGISTRATI E ACCONTI -->
          <div class="card" style="padding: 16px; margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <div style="font-weight: 700; font-size: 14px;">Piano Pagamenti & Acconti</div>
              <button type="button" id="qm-add-payment-btn" class="btn btn-sm btn-primary">+ Registra Pagamento / Acconto</button>
            </div>

            <!-- Form Registrazione Rapida Pagamento (incluso acconto) -->
            <div id="qm-payment-form-pane" style="display: none; padding: 14px; background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 14px;">
              <div style="font-weight: 700; font-size: 13px; margin-bottom: 10px;">Nuovo Movimento Pagamento</div>
              <div class="form-row">
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Tipo Movimento *</label>
                  <select id="p-type" class="form-select">
                    <option value="acconto">Acconto</option>
                    <option value="saldo">Saldo</option>
                    <option value="extra">Extra / Integrazione</option>
                    <option value="rimborso">Rimborso (diminuisce incassato)</option>
                    <option value="altro">Altro</option>
                  </select>
                </div>
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Importo (€) *</label>
                  <input type="number" id="p-amount" class="form-input" step="0.01" placeholder="0.00" required />
                </div>
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Stato Pagamento</label>
                  <select id="p-status" class="form-select">
                    <option value="incassato">Incassato (Effettivo)</option>
                    <option value="previsto">Previsto (Non aumenta incassato)</option>
                    <option value="annullato">Annullato</option>
                  </select>
                </div>
              </div>

              <div class="form-row">
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Data Effettiva / Prevista</label>
                  <input type="date" id="p-date" class="form-input" value="${new Date().toISOString().split('T')[0]}" />
                </div>
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Metodo di Pagamento</label>
                  <select id="p-method" class="form-select">
                    <option value="Bonifico">Bonifico Bancario</option>
                    <option value="Carta / POS">Carta / POS</option>
                    <option value="Contanti">Contanti</option>
                    <option value="PayPal / Stripe">PayPal / Stripe</option>
                    <option value="Altro">Altro</option>
                  </select>
                </div>
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Rif. Operazione / CRO</label>
                  <input type="text" id="p-ref" class="form-input" placeholder="TRN / CRO / ID Transazione" />
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Note Pagamento</label>
                <input type="text" id="p-notes" class="form-input" placeholder="Dettagli ricevuta o note..." />
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 8px;">
                <button type="button" id="p-cancel-btn" class="btn btn-sm btn-secondary">Annulla</button>
                <button type="button" id="p-save-btn" class="btn btn-sm btn-primary">Salva Pagamento</button>
              </div>
            </div>

            <!-- Elenco Pagamenti -->
            ${payments.length === 0 ? `
              <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 13px;">
                Nessun pagamento o acconto ancora registrato per questo preventivo.
              </div>
            ` : `
              <div style="display: flex; flex-direction: column; gap: 8px;">
                ${payments.map(p => {
                  const isCollected = p.status === 'incassato';
                  const isRefund = p.type === 'rimborso';
                  return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #ffffff; border: 1px solid var(--border); border-radius: var(--radius);">
                      <div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                          <span style="font-weight: 700; text-transform: uppercase; font-size: 12px; color: ${isRefund ? 'var(--danger)' : 'var(--text-main)'};">
                            ${isRefund ? '↩️ Rimborso' : p.type}
                          </span>
                          <span class="badge ${isCollected ? 'badge-green' : 'badge-yellow'}">${p.status}</span>
                          ${p.method ? `<span style="font-size: 11px; color: var(--text-muted);">via ${p.method}</span>` : ''}
                        </div>
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                          Data: ${formatDate(p.payment_date || p.due_date)} ${p.reference_number ? `• Rif: ${p.reference_number}` : ''} ${p.notes ? `• ${p.notes}` : ''}
                        </div>
                      </div>

                      <div style="display: flex; align-items: center; gap: 12px;">
                        <span style="font-size: 16px; font-weight: 800; color: ${isRefund ? 'var(--danger)' : isCollected ? 'var(--success)' : 'var(--text-muted)'};">
                          ${isRefund ? '-' : ''}${formatCurrency(p.amount)}
                        </span>
                        <button type="button" class="btn btn-sm btn-danger qm-delete-payment-btn" data-id="${p.id}" title="Elimina pagamento">✕</button>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>

          <!-- SEZIONE SERVIZI AGGIUNTIVI (EXTRA PROPOSTI VS APPROVATI) -->
          <div class="card" style="padding: 16px; margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <div>
                <div style="font-weight: 700; font-size: 14px;">Servizi Aggiuntivi / Extra</div>
                <div style="font-size: 11px; color: var(--text-muted);">Gli extra proposti non aumentano il totale; quelli approvati aggiornano totale e residuo.</div>
              </div>
              <button type="button" id="qm-add-extra-btn" class="btn btn-sm btn-primary">+ Proponi Extra</button>
            </div>

            <!-- Form Nuovo Extra -->
            <div id="qm-extra-form-pane" style="display: none; padding: 14px; background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 14px;">
              <div class="form-row">
                <div class="form-group" style="flex: 3;">
                  <label class="form-label">Descrizione Servizio Extra *</label>
                  <input type="text" id="extra-desc" class="form-input" placeholder="es. Ore shooting aggiuntive, ritocco extra..." />
                </div>
                <div class="form-group" style="flex: 1.5;">
                  <label class="form-label">Importo (€) *</label>
                  <input type="number" id="extra-amt" class="form-input" step="0.01" placeholder="0.00" />
                </div>
                <div class="form-group" style="flex: 1.5;">
                  <label class="form-label">Stato Iniziale</label>
                  <select id="extra-status" class="form-select">
                    <option value="proposto">Proposto (In attesa)</option>
                    <option value="approvato">Approvato (Aggiorna totale)</option>
                  </select>
                </div>
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 8px;">
                <button type="button" id="extra-cancel-btn" class="btn btn-sm btn-secondary">Annulla</button>
                <button type="button" id="extra-save-btn" class="btn btn-sm btn-primary">Aggiungi Extra</button>
              </div>
            </div>

            <!-- Elenco Extra -->
            ${extraServices.length === 0 ? `
              <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 13px;">
                Nessun servizio aggiuntivo proposto.
              </div>
            ` : `
              <div style="display: flex; flex-direction: column; gap: 8px;">
                ${extraServices.map(es => `
                  <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #ffffff; border: 1px solid var(--border); border-radius: var(--radius);">
                    <div>
                      <div style="font-weight: 600;">${es.description}</div>
                      <div style="font-size: 11px; color: var(--text-muted);">
                        Proposto il: ${formatDate(es.proposed_at)} ${es.approved_at ? `• Approvato il: ${formatDate(es.approved_at)}` : ''}
                      </div>
                    </div>

                    <div style="display: flex; align-items: center; gap: 10px;">
                      <span style="font-size: 15px; font-weight: 700;">${formatCurrency(es.amount)}</span>
                      <select class="form-select qm-extra-status-select" data-id="${es.id}" style="font-size: 12px; padding: 4px 8px;">
                        <option value="proposto" ${es.status === 'proposto' ? 'selected' : ''}>Proposto</option>
                        <option value="approvato" ${es.status === 'approvato' ? 'selected' : ''}>Approvato</option>
                        <option value="rifiutato" ${es.status === 'rifiutato' ? 'selected' : ''}>Rifiutato</option>
                      </select>
                      <button type="button" class="btn btn-sm btn-danger qm-delete-extra-btn" data-id="${es.id}" title="Elimina">✕</button>
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>

          <!-- SEZIONE TO-DO COLLEGATI -->
          <div class="card" style="padding: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <div style="font-weight: 700; font-size: 14px;">To-do Collegati al Preventivo (${linkedTodos.length})</div>
              <button type="button" id="qm-add-todo-btn" class="btn btn-sm btn-secondary">+ Nuovo To-do per questo lavoro</button>
            </div>

            ${linkedTodos.length === 0 ? `
              <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 13px;">
                Nessun to-do operativo collegato a questo preventivo.
              </div>
            ` : `
              <div style="display: flex; flex-direction: column; gap: 6px;">
                ${linkedTodos.map(t => `
                  <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius);">
                    <div style="font-size: 13px; font-weight: 500; ${t.is_completed ? 'text-decoration: line-through; opacity: 0.6;' : ''}">
                      ${t.title}
                    </div>
                    <span class="badge ${t.is_completed ? 'badge-green' : 'badge-gray'}">${t.is_completed ? 'Fatto' : 'Da fare'}</span>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="qm-close-bottom-btn">Chiudi</button>
        </div>
      </div>
    </div>
  `;

  const div = document.createElement('div');
  div.innerHTML = modalHtml;
  modalContainer.appendChild(div);

  const overlay = div.querySelector('#quote-manager-overlay');
  const closeModal = () => {
    div.remove();
    if (onUpdated) onUpdated();
  };

  div.querySelector('#close-quote-mgr-btn').addEventListener('click', closeModal);
  div.querySelector('#qm-close-bottom-btn').addEventListener('click', closeModal);

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

  // Salva stato lavoro e consegna
  div.querySelector('#qm-save-status-btn').addEventListener('click', () => {
    const work_status = div.querySelector('#qm-work-status').value;
    const expected_delivery = div.querySelector('#qm-expected-delivery').value || null;
    store.update('quotes', quoteId, { work_status, expected_delivery });
    div.remove();
    openQuoteManagerModal(quoteId, parentContainer, router, onUpdated);
  });

  // Toggle form pagamento
  const payFormPane = div.querySelector('#qm-payment-form-pane');
  div.querySelector('#qm-add-payment-btn').addEventListener('click', () => {
    payFormPane.style.display = 'block';
  });
  div.querySelector('#p-cancel-btn').addEventListener('click', () => {
    payFormPane.style.display = 'none';
  });

  // Salva pagamento
  div.querySelector('#p-save-btn').addEventListener('click', () => {
    const amt = parseFloat(div.querySelector('#p-amount').value);
    if (!amt || amt <= 0) {
      alert('Inserisci un importo valido.');
      return;
    }

    const type = div.querySelector('#p-type').value;
    const status = div.querySelector('#p-status').value;
    const dateVal = div.querySelector('#p-date').value;

    store.create('payments', {
      quote_id: quoteId,
      client_id: quote.client_id || null,
      type,
      amount: amt,
      status,
      due_date: dateVal,
      payment_date: status === 'incassato' ? dateVal : null,
      method: div.querySelector('#p-method').value,
      reference_number: div.querySelector('#p-ref').value.trim(),
      notes: div.querySelector('#p-notes').value.trim(),
    });

    div.remove();
    openQuoteManagerModal(quoteId, parentContainer, router, onUpdated);
  });

  // Elimina pagamento
  div.querySelectorAll('.qm-delete-payment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-id');
      if (confirm('Eliminare questo pagamento?')) {
        store.permanentDelete('payments', pid);
        div.remove();
        openQuoteManagerModal(quoteId, parentContainer, router, onUpdated);
      }
    });
  });

  // Toggle form extra
  const extraFormPane = div.querySelector('#qm-extra-form-pane');
  div.querySelector('#qm-add-extra-btn').addEventListener('click', () => {
    extraFormPane.style.display = 'block';
  });
  div.querySelector('#extra-cancel-btn').addEventListener('click', () => {
    extraFormPane.style.display = 'none';
  });

  // Salva extra
  div.querySelector('#extra-save-btn').addEventListener('click', () => {
    const desc = div.querySelector('#extra-desc').value.trim();
    const amt = parseFloat(div.querySelector('#extra-amt').value);
    if (!desc || !amt || amt <= 0) {
      alert('Compila descrizione e importo del servizio extra.');
      return;
    }

    const status = div.querySelector('#extra-status').value;
    const extraServicesList = store.data.quote_extra_services || [];
    extraServicesList.push({
      id: generateId(),
      quote_id: quoteId,
      description: desc,
      amount: amt,
      status,
      proposed_at: new Date().toISOString().split('T')[0],
      approved_at: status === 'approvato' ? new Date().toISOString().split('T')[0] : null,
    });
    store.save();

    div.remove();
    openQuoteManagerModal(quoteId, parentContainer, router, onUpdated);
  });

  // Cambio stato extra live
  div.querySelectorAll('.qm-extra-status-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const extraId = e.target.getAttribute('data-id');
      const newStatus = e.target.value;
      const extra = (store.data.quote_extra_services || []).find(es => es.id === extraId);
      if (extra) {
        extra.status = newStatus;
        extra.approved_at = newStatus === 'approvato' ? new Date().toISOString().split('T')[0] : null;
        store.save();
        div.remove();
        openQuoteManagerModal(quoteId, parentContainer, router, onUpdated);
      }
    });
  });

  // Elimina extra
  div.querySelectorAll('.qm-delete-extra-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const extraId = btn.getAttribute('data-id');
      store.data.quote_extra_services = (store.data.quote_extra_services || []).filter(es => es.id !== extraId);
      store.save();
      div.remove();
      openQuoteManagerModal(quoteId, parentContainer, router, onUpdated);
    });
  });

  // Aggiungi To-do collegato
  div.querySelector('#qm-add-todo-btn').addEventListener('click', () => {
    const title = prompt('Titolo della nuova attività operativa per questo lavoro:');
    if (title && title.trim()) {
      store.create('todos', {
        title: title.trim(),
        quote_id: quoteId,
        client_id: quote.client_id || null,
        compensation_mode: 'included_in_quote',
        priority: 'media',
        is_completed: false,
        source: 'manual',
      });
      div.remove();
      openQuoteManagerModal(quoteId, parentContainer, router, onUpdated);
    }
  });
}
