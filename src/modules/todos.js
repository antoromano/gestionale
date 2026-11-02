// src/modules/todos.js
// Gestione To-do con scadenze rapide, raggruppamento per cliente/mese, compensi autonomi e collegati

import { store } from '../services/store.js';
import { formatDate, formatDateTime, formatCurrency, formatMonthYear } from '../utils/formatters.js';
import { openAiModal } from './ai-assistant.js';

let currentFilter = 'all'; // 'all' | 'open' | 'completed' | 'urgent'
let searchQuery = '';
let clientFilter = '';

export function renderTodos(container, router) {
  const allTodos = store.getAll('todos');
  const clients = store.getAll('clients');
  const quotes = store.getAll('quotes');

  // Filtri e ricerca
  const filteredTodos = allTodos.filter(t => {
    if (currentFilter === 'open' && t.is_completed) return false;
    if (currentFilter === 'completed' && !t.is_completed) return false;
    if (currentFilter === 'urgent' && (t.is_completed || (t.priority !== 'urgente' && t.priority !== 'alta'))) return false;
    if (clientFilter && t.client_id !== clientFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const titleMatch = (t.title || '').toLowerCase().includes(q);
      const notesMatch = (t.notes || '').toLowerCase().includes(q);
      return titleMatch || notesMatch;
    }
    return true;
  });

  // Raggruppamento per mese e separazione tra "Da fare" e "Completati"
  const groupedByMonth = {};
  filteredTodos.forEach(t => {
    const key = formatMonthYear(t.due_date || t.created_at);
    if (!groupedByMonth[key]) {
      groupedByMonth[key] = { pending: [], completed: [] };
    }
    if (t.is_completed) {
      groupedByMonth[key].completed.push(t);
    } else {
      groupedByMonth[key].pending.push(t);
    }
  });

  container.innerHTML = `
    <!-- Barra superiore con ricerca e pulsanti azione -->
    <div class="card" style="margin-bottom: 20px;">
      <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center; justify-content: space-between;">
        <div style="display: flex; gap: 10px; flex-wrap: wrap; flex: 1;">
          <input
            type="text"
            id="todos-search-input"
            class="form-input"
            placeholder="Cerca to-do..."
            value="${searchQuery}"
            style="max-width: 250px;"
          />
          <select id="todos-client-filter" class="form-select" style="max-width: 200px;">
            <option value="">Tutti i clienti</option>
            ${clients.map(c => `<option value="${c.id}" ${clientFilter === c.id ? 'selected' : ''}>${c.company_name || `${c.first_name} ${c.last_name}`}</option>`).join('')}
          </select>
          <select id="todos-status-filter" class="form-select" style="max-width: 160px;">
            <option value="all" ${currentFilter === 'all' ? 'selected' : ''}>Tutti</option>
            <option value="open" ${currentFilter === 'open' ? 'selected' : ''}>Da fare</option>
            <option value="completed" ${currentFilter === 'completed' ? 'selected' : ''}>Completati</option>
            <option value="urgent" ${currentFilter === 'urgent' ? 'selected' : ''}>Urgenti</option>
          </select>
        </div>

        <div style="display: flex; gap: 8px;">
          <button id="todos-open-ai-btn" class="btn btn-ai">
            ✨ Assistente IA
          </button>
          <button id="todos-new-btn" class="btn btn-primary">
            + Nuovo To-do
          </button>
        </div>
      </div>
    </div>

    <!-- Elenco raggruppato per Mese -->
    ${Object.keys(groupedByMonth).length === 0 ? `
      <div class="card" style="text-align: center; padding: 40px; color: var(--text-muted);">
        Nessun to-do trovato con i criteri selezionati.
      </div>
    ` : Object.entries(groupedByMonth).map(([monthYear, group]) => `
      <div class="card" style="margin-bottom: 24px;">
        <div class="card-header" style="border-bottom: 2px solid var(--border); padding-bottom: 10px;">
          <div class="card-title" style="font-size: 17px;">📅 ${monthYear}</div>
          <div style="font-size: 12px; color: var(--text-muted);">
            ${group.pending.length} da fare • ${group.completed.length} completati
          </div>
        </div>

        <!-- Sezione Da Fare -->
        <div style="margin-top: 14px;">
          <div style="font-size: 13px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;">
            Da fare (${group.pending.length})
          </div>

          ${group.pending.length === 0 ? `
            <div style="font-size: 12px; color: var(--text-muted); font-style: italic; margin-bottom: 12px;">Nessuna attività in sospeso</div>
          ` : `
            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;">
              ${group.pending.map(t => renderTodoRow(t, clients, quotes)).join('')}
            </div>
          `}
        </div>

        <!-- Sezione Completati -->
        ${group.completed.length > 0 ? `
          <div style="margin-top: 14px; border-top: 1px dashed var(--border); padding-top: 12px;">
            <div style="font-size: 13px; font-weight: 700; color: var(--success); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;">
              Fatti (${group.completed.length})
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${group.completed.map(t => renderTodoRow(t, clients, quotes)).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `).join('')}

    <!-- Modal Form To-do -->
    <div id="todo-modal-container"></div>
  `;

  // Listeners filtri
  container.querySelector('#todos-search-input')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderTodos(container, router);
  });
  container.querySelector('#todos-client-filter')?.addEventListener('change', (e) => {
    clientFilter = e.target.value;
    renderTodos(container, router);
  });
  container.querySelector('#todos-status-filter')?.addEventListener('change', (e) => {
    currentFilter = e.target.value;
    renderTodos(container, router);
  });

  // IA Modal
  container.querySelector('#todos-open-ai-btn')?.addEventListener('click', () => {
    openAiModal({
      onSaved: () => renderTodos(container, router),
    });
  });

  // Nuovo to-do
  container.querySelector('#todos-new-btn')?.addEventListener('click', () => {
    openTodoModal(null, container, router);
  });

  // Toggle completamento
  container.querySelectorAll('.todo-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const todoId = e.target.getAttribute('data-id');
      const isCompleted = e.target.checked;
      store.update('todos', todoId, {
        is_completed: isCompleted,
        completed_at: isCompleted ? new Date().toISOString() : null,
      });
      renderTodos(container, router);
    });
  });

  // Modifica to-do
  container.querySelectorAll('.todo-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const todoId = e.currentTarget.getAttribute('data-id');
      const todo = store.getById('todos', todoId);
      openTodoModal(todo, container, router);
    });
  });

  // Sposta nel cestino
  container.querySelectorAll('.todo-trash-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const todoId = e.currentTarget.getAttribute('data-id');
      if (confirm('Vuoi spostare questo to-do nel cestino?')) {
        store.moveToTrash('todos', todoId);
        renderTodos(container, router);
      }
    });
  });
}

function renderTodoRow(t, clients, quotes) {
  const client = t.client_id ? clients.find(c => c.id === t.client_id) : null;
  const quote = t.quote_id ? quotes.find(q => q.id === t.quote_id) : null;
  const isOverdue = !t.is_completed && t.due_date && t.due_date < new Date().toISOString();

  let compBadge = '';
  if (t.compensation_mode === 'autonomous' && t.compensation_amount > 0) {
    compBadge = `<span class="badge badge-green">💰 ${formatCurrency(t.compensation_amount)} (Autonomo)</span>`;
  } else if (t.compensation_mode === 'included_in_quote') {
    compBadge = `<span class="badge badge-blue">Incluso in prev. N. ${quote?.quote_number || ''}</span>`;
  } else if (t.compensation_mode === 'extra' && t.compensation_amount > 0) {
    compBadge = `<span class="badge badge-yellow">Extra: ${formatCurrency(t.compensation_amount)}</span>`;
  }

  return `
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: ${t.is_completed ? '#f1f5f9' : '#ffffff'}; border: 1px solid var(--border); border-radius: var(--radius); gap: 10px; opacity: ${t.is_completed ? '0.75' : '1'};">
      <div style="display: flex; align-items: flex-start; gap: 12px; min-width: 0; flex: 1;">
        <input
          type="checkbox"
          data-id="${t.id}"
          class="todo-checkbox"
          ${t.is_completed ? 'checked' : ''}
          style="width: 18px; height: 18px; margin-top: 3px; cursor: pointer;"
        />
        <div style="min-width: 0; flex: 1;">
          <div style="font-weight: 600; font-size: 14px; ${t.is_completed ? 'text-decoration: line-through; color: var(--text-muted);' : ''}">
            ${t.title}
          </div>
          ${t.notes ? `<div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">${t.notes}</div>` : ''}
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
            ${client ? `<span>👤 ${client.company_name || `${client.first_name} ${client.last_name}`}</span>` : ''}
            ${t.due_date ? `<span style="${isOverdue ? 'color: var(--danger); font-weight: 700;' : ''}">📅 ${formatDateTime(t.due_date)}</span>` : ''}
            ${compBadge}
            ${t.source === 'ai' ? `<span class="badge" style="background: #ede9fe; color: #6d28d9;">✨ IA</span>` : ''}
          </div>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 6px;">
        <span class="badge ${t.priority === 'urgente' ? 'badge-red' : t.priority === 'alta' ? 'badge-yellow' : 'badge-gray'}">
          ${t.priority}
        </span>
        <button class="btn btn-sm btn-secondary todo-edit-btn" data-id="${t.id}" title="Modifica">✏️</button>
        <button class="btn btn-sm btn-danger todo-trash-btn" data-id="${t.id}" title="Cestina">🗑️</button>
      </div>
    </div>
  `;
}

export function openTodoModal(todo, parentContainer, router, initialClientId = null) {
  const modalContainer = parentContainer.querySelector('#todo-modal-container') || document.body;
  const clients = store.getAll('clients');
  const quotes = store.getAll('quotes');

  const isEdit = Boolean(todo);
  const now = new Date();

  // Helper date rapide
  const getDateOffset = (hours = 0, days = 0) => {
    const d = new Date(now.getTime() + (hours * 3600 + days * 86400) * 1000);
    return d.toISOString().slice(0, 16);
  };

  const modalHtml = `
    <div class="modal-overlay" id="todo-modal-overlay">
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Modifica To-do' : 'Nuovo To-do'}</div>
          <button type="button" class="btn btn-sm btn-secondary" id="close-todo-modal-btn">✕</button>
        </div>

        <form id="todo-modal-form">
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Titolo To-do *</label>
              <input type="text" id="m-todo-title" class="form-input" value="${todo?.title || ''}" required placeholder="es. Inviare revisione bozze" />
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Cliente</label>
                <select id="m-todo-client" class="form-select">
                  <option value="">Nessun cliente</option>
                  ${clients.map(c => `
                    <option value="${c.id}" ${(todo?.client_id || initialClientId) === c.id ? 'selected' : ''}>
                      ${c.company_name || `${c.first_name} ${c.last_name}`}
                    </option>
                  `).join('')}
                </select>
              </div>

              <div class="form-group" style="flex: 1;">
                <label class="form-label">Preventivo / Lavoro collegato</label>
                <select id="m-todo-quote" class="form-select">
                  <option value="">Nessun preventivo</option>
                  ${quotes.map(q => `
                    <option value="${q.id}" ${todo?.quote_id === q.id ? 'selected' : ''}>
                      N. ${q.quote_number} - ${q.title}
                    </option>
                  `).join('')}
                </select>
              </div>
            </div>

            <!-- Scadenze Rapide -->
            <div class="form-group">
              <label class="form-label">Scadenza</label>
              <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;">
                <button type="button" class="btn btn-sm btn-secondary quick-date-btn" data-val="${getDateOffset(0, 0)}">Oggi</button>
                <button type="button" class="btn btn-sm btn-secondary quick-date-btn" data-val="${getDateOffset(0, 1)}">Domani</button>
                <button type="button" class="btn btn-sm btn-secondary quick-date-btn" data-val="${getDateOffset(1, 0)}">Fra 1 ora</button>
                <button type="button" class="btn btn-sm btn-secondary quick-date-btn" data-val="${getDateOffset(0, 3)}">Tra 3 giorni</button>
                <button type="button" class="btn btn-sm btn-secondary quick-date-btn" data-val="${getDateOffset(0, 7)}">Tra 1 settimana</button>
                <button type="button" class="btn btn-sm btn-secondary quick-date-btn" data-val="">Nessuna</button>
              </div>
              <input type="datetime-local" id="m-todo-due" class="form-input" value="${todo?.due_date ? todo.due_date.slice(0, 16) : ''}" />
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Priorità</label>
                <select id="m-todo-priority" class="form-select">
                  <option value="bassa" ${todo?.priority === 'bassa' ? 'selected' : ''}>Bassa</option>
                  <option value="media" ${!todo || todo?.priority === 'media' ? 'selected' : ''}>Media</option>
                  <option value="alta" ${todo?.priority === 'alta' ? 'selected' : ''}>Alta</option>
                  <option value="urgente" ${todo?.priority === 'urgente' ? 'selected' : ''}>Urgente</option>
                </select>
              </div>

              <div class="form-group" style="flex: 1;">
                <label class="form-label">Regime Compenso</label>
                <select id="m-todo-comp-mode" class="form-select">
                  <option value="none" ${!todo || todo.compensation_mode === 'none' ? 'selected' : ''}>Senza compenso</option>
                  <option value="autonomous" ${todo?.compensation_mode === 'autonomous' ? 'selected' : ''}>Compenso autonomo</option>
                  <option value="included_in_quote" ${todo?.compensation_mode === 'included_in_quote' ? 'selected' : ''}>Incluso nel preventivo</option>
                  <option value="extra" ${todo?.compensation_mode === 'extra' ? 'selected' : ''}>Compenso aggiuntivo (Extra)</option>
                </select>
              </div>
            </div>

            <div id="m-todo-comp-fields" style="display: ${todo?.compensation_mode === 'autonomous' || todo?.compensation_mode === 'extra' ? 'block' : 'none'};">
              <div class="form-row">
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Importo Compenso (€)</label>
                  <input type="number" id="m-todo-comp-amt" class="form-input" step="0.01" value="${todo?.compensation_amount || ''}" />
                </div>
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Acconto ricevuto (€)</label>
                  <input type="number" id="m-todo-deposit" class="form-input" step="0.01" value="${todo?.deposit_received || ''}" />
                </div>
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Saldo ricevuto (€)</label>
                  <input type="number" id="m-todo-balance" class="form-input" step="0.01" value="${todo?.balance_received || ''}" />
                </div>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Note Operative</label>
              <textarea id="m-todo-notes" class="form-textarea" rows="3" placeholder="Informazioni dettagliate...">${todo?.notes || ''}</textarea>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" id="cancel-todo-modal-btn">Annulla</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Salva Modifiche' : 'Crea To-do'}</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const div = document.createElement('div');
  div.innerHTML = modalHtml;
  modalContainer.appendChild(div);

  const overlay = div.querySelector('#todo-modal-overlay');
  const form = div.querySelector('#todo-modal-form');
  const compModeSelect = div.querySelector('#m-todo-comp-mode');
  const compFields = div.querySelector('#m-todo-comp-fields');

  // Toggle compenso fields
  compModeSelect.addEventListener('change', () => {
    const isComp = compModeSelect.value === 'autonomous' || compModeSelect.value === 'extra';
    compFields.style.display = isComp ? 'block' : 'none';
  });

  // Bottoni date rapide
  div.querySelectorAll('.quick-date-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      div.querySelector('#m-todo-due').value = btn.getAttribute('data-val');
    });
  });

  const closeModal = () => div.remove();
  div.querySelector('#close-todo-modal-btn').addEventListener('click', closeModal);
  div.querySelector('#cancel-todo-modal-btn').addEventListener('click', closeModal);

  // Safe backdrop click handler: non chiude se la selezione è iniziata dentro il modal
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
    const title = div.querySelector('#m-todo-title').value.trim();
    if (!title) return;

    const payload = {
      title,
      client_id: div.querySelector('#m-todo-client').value || null,
      quote_id: div.querySelector('#m-todo-quote').value || null,
      due_date: div.querySelector('#m-todo-due').value || null,
      priority: div.querySelector('#m-todo-priority').value || 'media',
      compensation_mode: compModeSelect.value,
      compensation_amount: parseFloat(div.querySelector('#m-todo-comp-amt')?.value) || 0,
      deposit_received: parseFloat(div.querySelector('#m-todo-deposit')?.value) || 0,
      balance_received: parseFloat(div.querySelector('#m-todo-balance')?.value) || 0,
      notes: div.querySelector('#m-todo-notes').value.trim(),
    };

    if (isEdit) {
      store.update('todos', todo.id, payload);
    } else {
      store.create('todos', { ...payload, is_completed: false, source: 'manual' });
    }

    closeModal();
    renderTodos(parentContainer, router);
  });
}
