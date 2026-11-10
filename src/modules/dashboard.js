// src/modules/dashboard.js
// Dashboard Operativa: Command Bar Quick-Add (Linear/Raycast style), Bento Grid operativa e Micro-Fisica 3D

import { store } from '../services/store.js';
import { formatDate, formatDateTime, formatCurrency } from '../utils/formatters.js';
import { openAiModal } from './ai-assistant.js';
import { icon } from '../utils/icons.js';
import { attachSpringTiltCards } from '../utils/three-scenes.js';

export function renderDashboard(container, router) {
  const todos = store.getAll('todos');
  const appointments = store.getAll('appointments');
  const quotes = store.getAll('quotes');
  const clients = store.getAll('clients');

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  // 1. To-do aperti, urgenti e scaduti
  const openTodos = todos.filter(t => !t.is_completed);
  const urgentTodos = openTodos.filter(t => t.priority === 'urgente' || t.priority === 'alta');
  const overdueTodos = openTodos.filter(t => t.due_date && t.due_date < now.toISOString());

  // 2. Scadenze e appuntamenti futuri o di oggi
  const upcomingAppointments = appointments
    .filter(a => a.start_time >= todayStr)
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .slice(0, 6);

  // 3. Lavori aperti collegati ai clienti o ai preventivi
  const openJobs = quotes
    .filter(q => q.status === 'accettato' || q.status === 'inviato')
    .filter(q => q.work_status !== 'Completato' && q.work_status !== 'Consegnato')
    .slice(0, 6);

  container.innerHTML = `
    <!-- Command Bar Rapida Aggiunta To-do (Linear / Raycast style) -->
    <div class="quick-todo-card">
      <div style="font-weight: 600; font-size: 12.5px; color: var(--text-muted); margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
        <span style="display: inline-flex; align-items: center; gap: 6px; color: var(--text-main);">
          ${icon('todos', 15)}
          <span>Command Bar • Aggiungi To-do al volo</span>
        </span>
        <button id="dashboard-trigger-ai-btn" class="btn btn-sm btn-ai" title="Assistente IA">
          ${icon('sparkles', 14)}
          <span>Chiedi all'IA</span>
        </button>
      </div>

      <form id="quick-todo-form">
        <div class="quick-todo-main">
          <input
            type="text"
            id="quick-todo-title"
            class="form-input"
            style="flex: 2; min-width: 220px;"
            placeholder="Cosa devi fare? (es. Revisionare contratto, deploy produzione, inviare bozza...)"
            required
            autocomplete="off"
          />
          <select id="quick-todo-client" class="form-select" style="flex: 1; max-width: 210px; min-width: 150px;">
            <option value="">Nessun cliente</option>
            ${clients.map(c => `<option value="${c.id}">${c.company_name || `${c.first_name} ${c.last_name}`}</option>`).join('')}
          </select>
          <button type="button" id="quick-todo-toggle-details" class="btn btn-secondary" title="Opzioni avanzate">
            ${icon('sliders', 14)}
            <span>Dettagli</span>
          </button>
          <button type="submit" class="btn btn-primary">
            ${icon('plus', 14)}
            <span>Aggiungi</span>
          </button>
        </div>

        <div id="quick-todo-details-pane" class="quick-todo-expandable" style="display: none;">
          <div>
            <label class="form-label">Scadenza</label>
            <input type="datetime-local" id="quick-todo-due" class="form-input mono" />
          </div>
          <div>
            <label class="form-label">Priorità</label>
            <select id="quick-todo-priority" class="form-select">
              <option value="bassa">Bassa</option>
              <option value="media" selected>Media</option>
              <option value="alta">Alta</option>
              <option value="urgente">Urgente</option>
            </select>
          </div>
          <div>
            <label class="form-label">Compenso autonomo (€)</label>
            <input type="number" id="quick-todo-compensation" class="form-input mono" placeholder="0.00" step="0.01" />
          </div>
          <div style="grid-column: 1 / -1;">
            <label class="form-label">Note</label>
            <textarea id="quick-todo-notes" class="form-textarea" rows="2" placeholder="Note operative aggiuntive..."></textarea>
          </div>
        </div>
      </form>
    </div>

    <!-- Bento Grid Operativa Principale -->
    <div class="grid-2">
      <!-- Colonna To-do Operativi -->
      <div class="card kpi-card-3d">
        <div class="card-header">
          <div class="card-title" style="display: flex; align-items: center; gap: 8px;">
            ${icon('todos', 16)}
            <span>To-do Aperti</span>
            <span class="badge badge-gray mono">${openTodos.length}</span>
          </div>
          <div style="display: flex; gap: 6px;">
            ${overdueTodos.length > 0 ? `<span class="badge badge-red mono">${overdueTodos.length} Scaduti</span>` : ''}
            ${urgentTodos.length > 0 ? `<span class="badge badge-yellow mono">${urgentTodos.length} Urgenti</span>` : ''}
          </div>
        </div>

        ${openTodos.length === 0 ? `
          <div style="text-align: center; padding: 32px 16px; color: var(--text-muted); font-size: 13px;">
            Nessun to-do aperto. Tutto in ordine.
          </div>
        ` : `
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${openTodos.slice(0, 8).map(t => {
              const client = t.client_id ? store.getById('clients', t.client_id) : null;
              const isOverdue = t.due_date && t.due_date < now.toISOString();
              return `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 9px 11px; background: #fafafa; border: 1px solid var(--border); border-radius: 7px; gap: 10px;">
                  <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                    <input type="checkbox" data-todo-id="${t.id}" class="dashboard-complete-todo" style="width: 16px; height: 16px; cursor: pointer; accent-color: #09090b;" />
                    <div style="min-width: 0;">
                      <div style="font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-main);">${t.title}</div>
                      <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 10px; flex-wrap: wrap; margin-top: 2px;">
                        ${client ? `<span>${client.company_name || `${client.first_name} ${client.last_name}`}</span>` : ''}
                        ${t.due_date ? `<span class="mono" style="${isOverdue ? 'color: var(--danger); font-weight: 600;' : ''}">${formatDateTime(t.due_date)}</span>` : ''}
                        ${t.compensation_amount > 0 ? `<span class="mono" style="color: var(--success); font-weight: 600;">${formatCurrency(t.compensation_amount)}</span>` : ''}
                      </div>
                    </div>
                  </div>
                  <div>
                    <span class="badge ${t.priority === 'urgente' ? 'badge-red' : t.priority === 'alta' ? 'badge-yellow' : 'badge-gray'}">
                      ${t.priority}
                    </span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>

      <!-- Colonna Appuntamenti e Scadenze Imminenti -->
      <div class="card kpi-card-3d">
        <div class="card-header">
          <div class="card-title" style="display: flex; align-items: center; gap: 8px;">
            ${icon('calendar', 16)}
            <span>Agenda, Deploy & Scadenze</span>
          </div>
          <button class="btn btn-sm btn-secondary" id="go-to-calendar-btn">Vedi Agenda</button>
        </div>

        ${upcomingAppointments.length === 0 ? `
          <div style="text-align: center; padding: 32px 16px; color: var(--text-muted); font-size: 13px;">
            Nessun appuntamento o rilascio imminente.
          </div>
        ` : `
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${upcomingAppointments.map(a => {
              const client = a.client_id ? store.getById('clients', a.client_id) : null;
              return `
                <div style="padding: 9px 11px; background: #fafafa; border: 1px solid var(--border); border-radius: 7px;">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                    <div style="font-weight: 600; font-size: 13px; color: var(--text-main);">${a.title}</div>
                    <span class="badge ${a.is_shooting || a.activity_type === 'deploy' ? 'badge-blue' : 'badge-gray'}">
                      ${a.activity_type === 'deploy' ? 'Deploy' : (a.is_shooting ? (a.shooting_type || 'Shooting') : 'Incontro')}
                    </span>
                  </div>
                  <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px; display: flex; gap: 10px; flex-wrap: wrap;">
                    <span class="mono">${formatDateTime(a.start_time)}</span>
                    ${a.location ? `<span>${a.location}</span>` : ''}
                    ${client ? `<span style="font-weight: 500; color: var(--text-main);">${client.company_name || `${client.first_name} ${client.last_name}`}</span>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    </div>

    <!-- Lavori Aperti Collegati ai Clienti -->
    <div class="card">
      <div class="card-header">
        <div class="card-title" style="display: flex; align-items: center; gap: 8px;">
          ${icon('quotes', 16)}
          <span>Lavori & Preventivi Attivi</span>
          <span class="badge badge-gray mono">${openJobs.length}</span>
        </div>
        <button class="btn btn-sm btn-secondary" id="go-to-quotes-btn">Vedi Preventivi</button>
      </div>

      ${openJobs.length === 0 ? `
        <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 13px;">
          Nessun lavoro attualmente in lavorazione.
        </div>
      ` : `
        <div class="grid-3">
          ${openJobs.map(q => {
            const client = q.client_id ? store.getById('clients', q.client_id) : null;
            return `
              <div style="border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; background: #fafafa;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <span class="mono" style="font-size: 11px; font-weight: 600; color: var(--accent);">#${q.quote_number}</span>
                  <span class="badge badge-blue">${q.work_status || 'In corso'}</span>
                </div>
                <div style="font-weight: 600; font-size: 13.5px; margin-bottom: 4px; color: var(--text-main);">${q.title}</div>
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">
                  ${client ? (client.company_name || `${client.first_name} ${client.last_name}`) : 'Cliente manuale'}
                </div>
                ${q.expected_delivery ? `
                  <div style="font-size: 11px; color: var(--text-muted);">
                    Consegna prevista: <strong class="mono">${formatDate(q.expected_delivery)}</strong>
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;

  attachSpringTiltCards(container);

  // Event Listeners
  const toggleDetailsBtn = container.querySelector('#quick-todo-toggle-details');
  const detailsPane = container.querySelector('#quick-todo-details-pane');
  if (toggleDetailsBtn && detailsPane) {
    toggleDetailsBtn.addEventListener('click', () => {
      const isHidden = detailsPane.style.display === 'none';
      detailsPane.style.display = isHidden ? 'grid' : 'none';
    });
  }

  // Modulo rapido submit
  const quickForm = container.querySelector('#quick-todo-form');
  if (quickForm) {
    quickForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const titleInput = container.querySelector('#quick-todo-title');
      const clientSelect = container.querySelector('#quick-todo-client');
      const dueInput = container.querySelector('#quick-todo-due');
      const prioritySelect = container.querySelector('#quick-todo-priority');
      const compInput = container.querySelector('#quick-todo-compensation');
      const notesInput = container.querySelector('#quick-todo-notes');

      const title = titleInput.value.trim();
      if (!title) return;

      const compVal = parseFloat(compInput.value) || 0;

      store.create('todos', {
        title,
        client_id: clientSelect.value || null,
        due_date: dueInput.value || null,
        priority: prioritySelect.value || 'media',
        compensation_mode: compVal > 0 ? 'autonomous' : 'none',
        compensation_amount: compVal,
        notes: notesInput.value.trim(),
        is_completed: false,
        source: 'manual',
      });

      titleInput.value = '';
      compInput.value = '';
      notesInput.value = '';
      if (detailsPane) detailsPane.style.display = 'none';

      renderDashboard(container, router);
    });
  }

  // Checkbox completamento rapido to-do
  container.querySelectorAll('.dashboard-complete-todo').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const todoId = e.target.getAttribute('data-todo-id');
      store.update('todos', todoId, {
        is_completed: true,
        completed_at: new Date().toISOString(),
      });
      renderDashboard(container, router);
    });
  });

  // AI Modal Trigger
  const aiBtn = container.querySelector('#dashboard-trigger-ai-btn');
  if (aiBtn) {
    aiBtn.addEventListener('click', () => {
      openAiModal({
        onSaved: () => renderDashboard(container, router),
      });
    });
  }

  // Navigazione pulsanti
  const calBtn = container.querySelector('#go-to-calendar-btn');
  if (calBtn) calBtn.addEventListener('click', () => router.navigate('calendar'));

  const quotesBtn = container.querySelector('#go-to-quotes-btn');
  if (quotesBtn) quotesBtn.addEventListener('click', () => router.navigate('quotes'));
}
