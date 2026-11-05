// src/modules/calendar.js
// Calendario Mensile & Agenda Mobile, Shooting Fotografici e Stato Google Calendar

import { store } from '../services/store.js';
import { formatDate, formatDateTime, formatCurrency } from '../utils/formatters.js';

let currentCalendarMonth = new Date().getMonth();
let currentCalendarYear = new Date().getFullYear();
let currentViewMode = window.innerWidth < 768 ? 'agenda' : 'month'; // 'month' | 'agenda'

export function renderCalendar(container, router) {
  const appointments = store.getAll('appointments');
  const todos = store.getAll('todos').filter(t => t.due_date && !t.is_completed);
  const clients = store.getAll('clients');
  const settings = store.getSettings();

  const monthNames = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
  ];

  // Stato sincronizzazione Google Calendar
  const gcalConnected = settings.google_calendar_connected;
  const gcalStatusBadge = gcalConnected
    ? `<span class="badge badge-green">Google Calendar: Collegato</span>`
    : `<span class="badge badge-gray" id="open-settings-gcal">Google Calendar: Da collegare</span>`;

  container.innerHTML = `
    <!-- Barra Superiore Calendario -->
    <div class="card" style="margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <button id="cal-prev-month-btn" class="btn btn-sm btn-secondary">◀</button>
          <div style="font-size: 18px; font-weight: 800; min-width: 170px; text-align: center;">
            ${monthNames[currentCalendarMonth]} ${currentCalendarYear}
          </div>
          <button id="cal-next-month-btn" class="btn btn-sm btn-secondary">▶</button>
          <button id="cal-today-btn" class="btn btn-sm btn-secondary">Oggi</button>
        </div>

        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
          <div style="display: flex; background: var(--border-light); border-radius: var(--radius); padding: 2px;">
            <button id="cal-toggle-month" class="btn btn-sm ${currentViewMode === 'month' ? 'btn-primary' : 'btn-secondary'}" style="border: none;">Mese</button>
            <button id="cal-toggle-agenda" class="btn btn-sm ${currentViewMode === 'agenda' ? 'btn-primary' : 'btn-secondary'}" style="border: none;">Agenda</button>
          </div>
          ${gcalStatusBadge}
          <button id="cal-new-appointment-btn" class="btn btn-primary">
            + Nuovo Evento / Rilascio
          </button>
        </div>
      </div>
    </div>

    <!-- Contenitore Vista (Mese o Agenda) -->
    <div id="calendar-view-container">
      ${currentViewMode === 'month' ? renderMonthGrid(currentCalendarYear, currentCalendarMonth, appointments, todos, clients) : renderAgendaList(appointments, todos, clients)}
    </div>

    <div id="calendar-modal-container"></div>
  `;

  // Listeners Navigazione
  container.querySelector('#cal-prev-month-btn')?.addEventListener('click', () => {
    currentCalendarMonth--;
    if (currentCalendarMonth < 0) {
      currentCalendarMonth = 11;
      currentCalendarYear--;
    }
    renderCalendar(container, router);
  });

  container.querySelector('#cal-next-month-btn')?.addEventListener('click', () => {
    currentCalendarMonth++;
    if (currentCalendarMonth > 11) {
      currentCalendarMonth = 0;
      currentCalendarYear++;
    }
    renderCalendar(container, router);
  });

  container.querySelector('#cal-today-btn')?.addEventListener('click', () => {
    const now = new Date();
    currentCalendarMonth = now.getMonth();
    currentCalendarYear = now.getFullYear();
    renderCalendar(container, router);
  });

  container.querySelector('#cal-toggle-month')?.addEventListener('click', () => {
    currentViewMode = 'month';
    renderCalendar(container, router);
  });

  container.querySelector('#cal-toggle-agenda')?.addEventListener('click', () => {
    currentViewMode = 'agenda';
    renderCalendar(container, router);
  });

  container.querySelector('#cal-new-appointment-btn')?.addEventListener('click', () => {
    openAppointmentModal(null, container, router);
  });

  container.querySelector('#open-settings-gcal')?.addEventListener('click', () => {
    router.navigate('settings');
  });

  // Event click
  container.querySelectorAll('.cal-event-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = pill.getAttribute('data-id');
      const appt = store.getById('appointments', id);
      if (appt) openAppointmentModal(appt, container, router);
    });
  });
}

function renderMonthGrid(year, month, appointments, todos, clients) {
  const firstDayIndex = new Date(year, month, 1).getDay(); // 0 è Domenica
  // Lunedì come primo giorno (standard europeo)
  const startingDay = (firstDayIndex === 0) ? 6 : firstDayIndex - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const daysHeader = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

  let cellsHtml = '';

  // Giorni vuoti del mese precedente
  for (let i = 0; i < startingDay; i++) {
    cellsHtml += `<div style="min-height: 100px; background: #f8fafc; border: 1px solid var(--border); opacity: 0.4;"></div>`;
  }

  const todayStr = new Date().toISOString().split('T')[0];

  for (let day = 1; day <= daysInMonth; day++) {
    const dayDate = new Date(year, month, day);
    const dateIso = dayDate.toISOString().split('T')[0];
    const isToday = dateIso === todayStr;

    // Filtra eventi e to-do del giorno
    const dayAppts = appointments.filter(a => (a.start_time || '').startsWith(dateIso));
    const dayTodos = todos.filter(t => (t.due_date || '').startsWith(dateIso));

    cellsHtml += `
      <div style="min-height: 105px; background: ${isToday ? '#eff6ff' : '#ffffff'}; border: 1px solid var(--border); padding: 6px; display: flex; flex-direction: column;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="font-size: 12px; font-weight: ${isToday ? '800' : '600'}; color: ${isToday ? 'var(--accent)' : 'var(--text-main)'};">
            ${day}
          </span>
          ${isToday ? `<span class="badge badge-blue" style="font-size: 9px; padding: 1px 4px;">Oggi</span>` : ''}
        </div>

        <div style="display: flex; flex-direction: column; gap: 3px; overflow-y: auto; max-height: 85px;">
          ${dayAppts.map(a => {
            let icon = '🕒';
            let bg = '#f1f5f9';
            let color = '#334155';
            let border = '#64748b';

            if (a.activity_type === 'deploy') {
              icon = '🚀'; bg = '#dbeafe'; color = '#1e40af'; border = '#2563eb';
            } else if (a.activity_type === 'demo') {
              icon = '💻'; bg = '#dcfce7'; color = '#166534'; border = '#16a34a';
            } else if (a.activity_type === 'call') {
              icon = '📞'; bg = '#fef9c3'; color = '#854d0e'; border = '#ca8a04';
            } else if (a.activity_type === 'server_deadline') {
              icon = '⏳'; bg = '#fee2e2'; color = '#991b1b'; border = '#dc2626';
            } else if (a.is_shooting) {
              icon = '📸'; bg = '#dbeafe'; color = '#1e40af'; border = '#2563eb';
            }

            return `
              <div
                class="cal-event-pill"
                data-id="${a.id}"
                style="font-size: 11px; padding: 2px 5px; border-radius: 4px; background: ${bg}; color: ${color}; font-weight: 600; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-left: 3px solid ${border};"
                title="${a.title}"
              >
                ${icon} ${a.title}
              </div>
            `;
          }).join('')}

          ${dayTodos.map(t => `
            <div style="font-size: 10px; padding: 2px 4px; border-radius: 4px; background: #fef3c7; color: #92400e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ✓ ${t.title}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  return `
    <div class="card" style="padding: 12px;">
      <div style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-weight: 700; font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">
        ${daysHeader.map(d => `<div>${d}</div>`).join('')}
      </div>
      <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden;">
        ${cellsHtml}
      </div>
    </div>
  `;
}

function renderAgendaList(appointments, todos, clients) {
  const sortedAppts = [...appointments].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

  return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">Agenda Cronologica</div>
      </div>

      ${sortedAppts.length === 0 ? `
        <div style="text-align: center; padding: 30px; color: var(--text-muted);">
          Nessun appuntamento in agenda.
        </div>
      ` : `
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${sortedAppts.map(a => {
            const client = a.client_id ? clients.find(c => c.id === a.client_id) : null;
            let icon = '📅';
            let badgeText = 'Incontro';
            let badgeClass = 'badge-gray';

            if (a.activity_type === 'deploy') {
              icon = '🚀'; badgeText = 'Deploy'; badgeClass = 'badge-blue';
            } else if (a.activity_type === 'demo') {
              icon = '💻'; badgeText = 'Sprint Demo'; badgeClass = 'badge-green';
            } else if (a.activity_type === 'call') {
              icon = '📞'; badgeText = 'Call Tecnica'; badgeClass = 'badge-yellow';
            } else if (a.activity_type === 'server_deadline') {
              icon = '⏳'; badgeText = 'Scadenza Server/SSL'; badgeClass = 'badge-red';
            } else if (a.is_shooting) {
              icon = '📸'; badgeText = a.shooting_type || 'Shooting'; badgeClass = 'badge-blue';
            }

            return `
              <div
                class="cal-event-pill"
                data-id="${a.id}"
                style="padding: 12px; background: #ffffff; border: 1px solid var(--border); border-radius: var(--radius); display: flex; justify-content: space-between; align-items: center; cursor: pointer;"
              >
                <div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 16px;">${icon}</span>
                    <span style="font-weight: 700; font-size: 14px;">${a.title}</span>
                    <span class="badge ${badgeClass}">${badgeText}</span>
                  </div>

                  <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px; display: flex; gap: 12px; flex-wrap: wrap;">
                    <span>🕒 ${formatDateTime(a.start_time)}</span>
                    ${a.location ? `<span>📍 ${a.location}</span>` : ''}
                    ${client ? `<span>👤 ${client.company_name || `${client.first_name} ${client.last_name}`}</span>` : ''}
                    ${a.compensation_amount > 0 ? `<span style="color: var(--success); font-weight: 600;">💰 ${formatCurrency(a.compensation_amount)}</span>` : ''}
                  </div>
                </div>

                <div style="font-size: 13px; color: var(--accent); font-weight: 600;">Dettagli →</div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

export function openAppointmentModal(appointment, parentContainer, router) {
  const modalContainer = parentContainer.querySelector('#calendar-modal-container') || document.body;
  const clients = store.getAll('clients');
  const isEdit = Boolean(appointment);

  const now = new Date();
  const defaultStart = appointment?.start_time ? appointment.start_time.slice(0, 16) : now.toISOString().slice(0, 16);
  const defaultEnd = appointment?.end_time ? appointment.end_time.slice(0, 16) : new Date(now.getTime() + 3600000 * 2).toISOString().slice(0, 16);

  const modalHtml = `
    <div class="modal-overlay" id="appt-modal-overlay">
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Modifica Evento' : 'Nuovo Evento'}</div>
          <button type="button" class="btn btn-sm btn-secondary" id="close-appt-modal-btn">✕</button>
        </div>

        <form id="appt-modal-form">
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Titolo Evento *</label>
              <input type="text" id="a-title" class="form-input" value="${appointment?.title || ''}" required placeholder="es. Deploy v2.0 / Sprint Demo / Rinnovo Dominio" />
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Cliente</label>
                <select id="a-client" class="form-select">
                  <option value="">Nessun cliente</option>
                  ${clients.map(c => `
                    <option value="${c.id}" ${appointment?.client_id === c.id ? 'selected' : ''}>
                      ${c.company_name || `${c.first_name} ${c.last_name}`}
                    </option>
                  `).join('')}
                </select>
              </div>

              <div class="form-group" style="flex: 1;">
                <label class="form-label">Tipo Attività</label>
                <select id="a-activity-type" class="form-select">
                  <option value="deploy" ${appointment?.activity_type === 'deploy' ? 'selected' : ''}>🚀 Deploy / Rilascio</option>
                  <option value="demo" ${appointment?.activity_type === 'demo' ? 'selected' : ''}>💻 Demo / Sprint Review</option>
                  <option value="call" ${appointment?.activity_type === 'call' ? 'selected' : ''}>📞 Call Tecnica / Allineamento</option>
                  <option value="server_deadline" ${appointment?.activity_type === 'server_deadline' ? 'selected' : ''}>⏳ Scadenza Server / Dominio / SSL</option>
                  <option value="general" ${(!appointment?.activity_type || appointment?.activity_type === 'general') && !appointment?.is_shooting ? 'selected' : ''}>🗓️ Incontro Generale</option>
                  <option value="shooting" ${appointment?.is_shooting || appointment?.activity_type === 'shooting' ? 'selected' : ''}>📸 Shooting Fotografico</option>
                </select>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Data e Ora Inizio *</label>
                <input type="datetime-local" id="a-start" class="form-input" value="${defaultStart}" required />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Data e Ora Fine</label>
                <input type="datetime-local" id="a-end" class="form-input" value="${defaultEnd}" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 2;">
                <label class="form-label">Luogo / Link Meeting</label>
                <input type="text" id="a-location" class="form-input" value="${appointment?.location || ''}" placeholder="es. Google Meet, Zoom o Sede cliente" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Compenso (€)</label>
                <input type="number" id="a-compensation" class="form-input" step="0.01" value="${appointment?.compensation_amount || ''}" placeholder="0.00" />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Descrizione / Note operative</label>
              <textarea id="a-desc" class="form-textarea" rows="2" placeholder="Dettagli rilascio, checklist demo, link PR o credenziali...">${appointment?.description || ''}</textarea>
            </div>
          </div>

          <div class="modal-footer" style="display: flex; justify-content: space-between;">
            <div>
              ${isEdit ? `<button type="button" class="btn btn-danger" id="delete-appt-btn">🗑️ Elimina</button>` : ''}
            </div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="btn btn-secondary" id="cancel-appt-modal-btn">Annulla</button>
              <button type="submit" class="btn btn-primary">${isEdit ? 'Salva Modifiche' : 'Salva Evento'}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;

  const div = document.createElement('div');
  div.innerHTML = modalHtml;
  modalContainer.appendChild(div);

  const overlay = div.querySelector('#appt-modal-overlay');
  const form = div.querySelector('#appt-modal-form');

  const closeModal = () => div.remove();
  div.querySelector('#close-appt-modal-btn').addEventListener('click', closeModal);
  div.querySelector('#cancel-appt-modal-btn').addEventListener('click', closeModal);

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

  // Elimina
  div.querySelector('#delete-appt-btn')?.addEventListener('click', () => {
    if (confirm('Eliminare questo appuntamento?')) {
      store.moveToTrash('appointments', appointment.id);
      closeModal();
      renderCalendar(parentContainer, router);
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = div.querySelector('#a-title').value.trim();
    if (!title) return;

    const activityType = div.querySelector('#a-activity-type').value;

    const payload = {
      title,
      client_id: div.querySelector('#a-client').value || null,
      start_time: div.querySelector('#a-start').value,
      end_time: div.querySelector('#a-end').value || null,
      location: div.querySelector('#a-location').value.trim(),
      compensation_amount: parseFloat(div.querySelector('#a-compensation').value) || 0,
      description: div.querySelector('#a-desc').value.trim(),
      activity_type: activityType,
      is_shooting: activityType === 'shooting',
      shooting_type: activityType === 'shooting' ? 'Shooting' : '',
    };

    if (isEdit) {
      store.update('appointments', appointment.id, payload);
    } else {
      store.create('appointments', payload);
    }

    closeModal();
    renderCalendar(parentContainer, router);
  });
}
