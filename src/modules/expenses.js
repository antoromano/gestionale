// src/modules/expenses.js
// Gestione Spese e Uscite con Ricorrenze Idempotenti (settimanali, mensili, annuali)

import { store } from '../services/store.js';
import { formatCurrency, formatDate } from '../utils/formatters.js';

let expenseCategoryFilter = 'all';
let expenseSearchQuery = '';

export function renderExpenses(container, router) {
  // Esegue generazione automatica spese ricorrenti idempotente
  const generatedCount = store.generateRecurringExpenses();

  const expenses = store.getAll('expenses');
  const clients = store.getAll('clients');

  const filtered = expenses.filter(e => {
    if (expenseCategoryFilter !== 'all' && e.category !== expenseCategoryFilter) return false;
    if (expenseSearchQuery) {
      const q = expenseSearchQuery.toLowerCase();
      const descMatch = (e.description || '').toLowerCase().includes(q);
      const catMatch = (e.category || '').toLowerCase().includes(q);
      return descMatch || catMatch;
    }
    return true;
  });

  const totalFilteredExpenses = filtered.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  // Categorie distinte
  const categories = Array.from(new Set(expenses.map(e => e.category).filter(Boolean)));

  container.innerHTML = `
    <!-- Barra Superiore Filtri e Azioni -->
    <div class="card" style="margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; gap: 10px; flex-wrap: wrap; flex: 1;">
          <input
            type="text"
            id="expenses-search-input"
            class="form-input"
            placeholder="Cerca spesa..."
            value="${expenseSearchQuery}"
            style="max-width: 250px;"
          />
          <select id="expenses-category-filter" class="form-select" style="max-width: 180px;">
            <option value="all" ${expenseCategoryFilter === 'all' ? 'selected' : ''}>Tutte le categorie</option>
            ${categories.map(cat => `<option value="${cat}" ${expenseCategoryFilter === cat ? 'selected' : ''}>${cat}</option>`).join('')}
          </select>
        </div>

        <div style="display: flex; gap: 8px; align-items: center;">
          <div style="font-weight: 700; font-size: 15px; margin-right: 10px;">
            Totale: <span style="color: var(--danger);">${formatCurrency(totalFilteredExpenses)}</span>
          </div>
          <button id="new-expense-btn" class="btn btn-primary">
            + Nuova Spesa
          </button>
        </div>
      </div>
    </div>

    <!-- Tabella / Schede Spese -->
    <div class="card" style="padding: 0; overflow: hidden;">
      ${filtered.length === 0 ? `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          Nessuna spesa registrata.
        </div>
      ` : `
        <div class="data-table-wrapper">
          <table class="data-table mobile-cards-table">
            <thead>
              <tr>
                <th>Descrizione</th>
                <th>Categoria</th>
                <th>Data</th>
                <th>Importo</th>
                <th>Cliente / Lavoro</th>
                <th>Ricorrenza</th>
                <th style="text-align: right;">Azioni</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(e => {
                const client = e.client_id ? clients.find(c => c.id === e.client_id) : null;
                return `
                  <tr>
                    <td data-label="Descrizione" style="font-weight: 600;">${e.description}</td>
                    <td data-label="Categoria"><span class="badge badge-gray">${e.category}</span></td>
                    <td data-label="Data">${formatDate(e.date)}</td>
                    <td data-label="Importo" style="font-weight: 700; color: var(--danger);">${formatCurrency(e.amount)}</td>
                    <td data-label="Cliente / Lavoro">${client ? (client.company_name || `${client.first_name} ${client.last_name}`) : '-'}</td>
                    <td data-label="Ricorrenza">
                      ${e.is_recurring ? `
                        <span class="badge badge-blue">
                          🔄 ${e.recurrence_frequency || 'Ricorrente'} ${e.is_suspended ? '(Sospesa)' : ''}
                        </span>
                      ` : '<span style="color: var(--text-muted); font-size: 11px;">Una tantum</span>'}
                    </td>
                    <td data-label="Azioni" style="text-align: right;">
                      <button class="btn btn-sm btn-secondary expense-edit-btn" data-id="${e.id}">✏️</button>
                      <button class="btn btn-sm btn-danger expense-trash-btn" data-id="${e.id}">🗑️</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>

    <div id="expense-modal-container"></div>
  `;

  // Search & Filter listeners
  container.querySelector('#expenses-search-input')?.addEventListener('input', (e) => {
    expenseSearchQuery = e.target.value;
    renderExpenses(container, router);
  });
  container.querySelector('#expenses-category-filter')?.addEventListener('change', (e) => {
    expenseCategoryFilter = e.target.value;
    renderExpenses(container, router);
  });

  // Nuovo
  container.querySelector('#new-expense-btn')?.addEventListener('click', () => {
    openExpenseModal(null, container, router);
  });

  // Modifica
  container.querySelectorAll('.expense-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const exp = store.getById('expenses', id);
      openExpenseModal(exp, container, router);
    });
  });

  // Cestina
  container.querySelectorAll('.expense-trash-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (confirm('Spostare questa spesa nel cestino?')) {
        store.moveToTrash('expenses', id);
        renderExpenses(container, router);
      }
    });
  });
}

function openExpenseModal(expense, parentContainer, router) {
  const modalContainer = parentContainer.querySelector('#expense-modal-container') || document.body;
  const isEdit = Boolean(expense);
  const clients = store.getAll('clients');

  const modalHtml = `
    <div class="modal-overlay" id="expense-modal-overlay">
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Modifica Spesa' : 'Nuova Spesa'}</div>
          <button type="button" class="btn btn-sm btn-secondary" id="close-exp-modal-btn">✕</button>
        </div>

        <form id="exp-modal-form">
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group" style="flex: 2;">
                <label class="form-label">Descrizione Spesa *</label>
                <input type="text" id="exp-desc" class="form-input" value="${expense?.description || ''}" required placeholder="es. Abbonamento Adobe, Noleggio ottiche, Carburante" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Importo (€) *</label>
                <input type="number" id="exp-amt" class="form-input" step="0.01" value="${expense?.amount || ''}" required placeholder="0.00" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Categoria</label>
                <input type="text" id="exp-cat" class="form-input" list="cat-suggestions" value="${expense?.category || 'Generale'}" />
                <datalist id="cat-suggestions">
                  <option value="Software & Abbonamenti"></option>
                  <option value="Attrezzatura & Hardware"></option>
                  <option value="Trasporti & Viaggi"></option>
                  <option value="Marketing & Adv"></option>
                  <option value="Commercialista & Fisco"></option>
                  <option value="Ufficio & Utenze"></option>
                  <option value="Collaboratori"></option>
                </datalist>
              </div>

              <div class="form-group" style="flex: 1;">
                <label class="form-label">Data Spesa *</label>
                <input type="date" id="exp-date" class="form-input" value="${expense?.date || new Date().toISOString().split('T')[0]}" required />
              </div>

              <div class="form-group" style="flex: 1;">
                <label class="form-label">Cliente Collegato (opzionale)</label>
                <select id="exp-client" class="form-select">
                  <option value="">Nessuno</option>
                  ${clients.map(c => `
                    <option value="${c.id}" ${expense?.client_id === c.id ? 'selected' : ''}>
                      ${c.company_name || `${c.first_name} ${c.last_name}`}
                    </option>
                  `).join('')}
                </select>
              </div>
            </div>

            <!-- Sezione Ricorrenza -->
            <div style="margin-top: 10px; padding: 12px; background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius);">
              <label style="display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; margin-bottom: 8px;">
                <input type="checkbox" id="exp-recurring-cb" ${expense?.is_recurring ? 'checked' : ''} />
                🔄 Rendi spesa ricorrente automatica
              </label>

              <div id="exp-recurring-pane" style="display: ${expense?.is_recurring ? 'block' : 'none'};">
                <div class="form-row">
                  <div class="form-group" style="flex: 1;">
                    <label class="form-label">Frequenza</label>
                    <select id="exp-freq" class="form-select">
                      <option value="monthly" ${expense?.recurrence_frequency === 'monthly' ? 'selected' : ''}>Mensile</option>
                      <option value="weekly" ${expense?.recurrence_frequency === 'weekly' ? 'selected' : ''}>Settimanale</option>
                      <option value="annual" ${expense?.recurrence_frequency === 'annual' ? 'selected' : ''}>Annuale</option>
                    </select>
                  </div>
                  <div class="form-group" style="flex: 1;">
                    <label class="form-label">Data Fine (Opzionale)</label>
                    <input type="date" id="exp-end-date" class="form-input" value="${expense?.recurrence_end_date || ''}" />
                  </div>
                  <div class="form-group" style="flex: 1; display: flex; align-items: flex-end; padding-bottom: 8px;">
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
                      <input type="checkbox" id="exp-suspended" ${expense?.is_suspended ? 'checked' : ''} />
                      Sospendi generazione
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div class="form-group" style="margin-top: 12px;">
              <label class="form-label">Note</label>
              <textarea id="exp-notes" class="form-textarea" rows="2" placeholder="Dettagli fattura fornitore o ricevuta...">${expense?.notes || ''}</textarea>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" id="cancel-exp-modal-btn">Annulla</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Salva Modifiche' : 'Salva Spesa'}</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const div = document.createElement('div');
  div.innerHTML = modalHtml;
  modalContainer.appendChild(div);

  const overlay = div.querySelector('#expense-modal-overlay');
  const form = div.querySelector('#exp-modal-form');
  const recurCb = div.querySelector('#exp-recurring-cb');
  const recurPane = div.querySelector('#exp-recurring-pane');

  recurCb.addEventListener('change', () => {
    recurPane.style.display = recurCb.checked ? 'block' : 'none';
  });

  const closeModal = () => div.remove();
  div.querySelector('#close-exp-modal-btn').addEventListener('click', closeModal);
  div.querySelector('#cancel-exp-modal-btn').addEventListener('click', closeModal);

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
    const description = div.querySelector('#exp-desc').value.trim();
    const amount = parseFloat(div.querySelector('#exp-amt').value);
    if (!description || isNaN(amount) || amount <= 0) {
      alert('Compila una descrizione valida e un importo maggiore di zero.');
      return;
    }

    const payload = {
      description,
      amount,
      category: div.querySelector('#exp-cat').value.trim() || 'Generale',
      date: div.querySelector('#exp-date').value,
      client_id: div.querySelector('#exp-client').value || null,
      is_recurring: recurCb.checked,
      recurrence_frequency: recurCb.checked ? div.querySelector('#exp-freq').value : null,
      recurrence_start_date: recurCb.checked ? div.querySelector('#exp-date').value : null,
      recurrence_end_date: recurCb.checked ? (div.querySelector('#exp-end-date').value || null) : null,
      is_suspended: div.querySelector('#exp-suspended').checked,
      notes: div.querySelector('#exp-notes').value.trim(),
    };

    if (isEdit) {
      store.update('expenses', expense.id, payload);
    } else {
      store.create('expenses', payload);
    }

    closeModal();
    renderExpenses(parentContainer, router);
  });
}
