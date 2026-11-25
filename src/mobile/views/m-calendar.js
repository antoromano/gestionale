// src/mobile/views/m-calendar.js
// Agenda del telefono: vista Giorno (striscia di 7 giorni + elenco orario) o Settimana (giorni in fila).
// Mostra eventi e scadenze dei to-do; tocca per modificare.

import { store } from '../../services/store.js';
import { header, mi, esc, todayIso, addDays, dayOf, timeOf, weekdayShort, relativeDay, longDate, clientName } from '../ui.js';
import { openAppointmentSheet, openTodoSheet } from '../forms.js';

const state = { mode: 'day', selected: null, weekStart: null };

const TYPE_TONE = { deploy: '', shooting: '', demo: 'green', call: 'amber', general: 'amber', server_deadline: 'red' };
const TYPE_LABEL = { deploy: 'Rilascio', shooting: 'Shooting', demo: 'Demo', call: 'Chiamata', general: 'Incontro', server_deadline: 'Scadenza' };

/** Lunedì della settimana di `iso`. */
function mondayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(iso, wd === 0 ? -6 : 1 - wd);
}

function itemsOn(day) {
  const appts = store.getAll('appointments')
    .filter(a => a.start_time && dayOf(a.start_time) === day)
    .map(a => ({ kind: 'appt', time: timeOf(a.start_time) || '', item: a }));
  const todos = store.getAll('todos')
    .filter(t => t.due_date && dayOf(t.due_date) === day)
    .map(t => ({ kind: 'todo', time: timeOf(t.due_date) === '00:00' ? '' : timeOf(t.due_date), item: t }));
  return [...appts, ...todos].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
}

function itemCard(x) {
  if (x.kind === 'appt') {
    const a = x.item;
    const type = a.is_shooting ? 'shooting' : (a.activity_type || 'general');
    const client = a.client_id ? store.getById('clients', a.client_id) : null;
    const span = [timeOf(a.start_time), timeOf(a.end_time)].filter(Boolean).join('–');
    return `<button type="button" class="m-event ${TYPE_TONE[type] ?? ''}" data-appt="${esc(a.id)}">
      <div class="m-event-title">${esc(a.title)}</div>
      <div class="m-event-sub">${esc([TYPE_LABEL[type] || 'Evento', span, a.location, clientName(client)].filter(Boolean).join(' · '))}</div>
    </button>`;
  }
  const t = x.item;
  return `<button type="button" class="m-event ${t.is_completed ? 'green' : 'red'}" data-todo="${esc(t.id)}">
    <div class="m-event-title" style="${t.is_completed ? 'text-decoration:line-through;color:var(--m-text-muted);' : ''}">${esc(t.title)}</div>
    <div class="m-event-sub">${t.is_completed ? 'To-do fatto' : 'Scadenza to-do'}</div>
  </button>`;
}

function timeline(items) {
  if (!items.length) return '<div class="m-card m-empty">Niente in programma.</div>';
  return `<div class="m-timeline">${items.map(x => `
    <div class="m-tl-row"><div class="m-tl-time">${esc(x.time || '—')}</div>${itemCard(x)}</div>`).join('')}</div>`;
}

export function render(container, ctx) {
  const today = todayIso();
  if (!state.selected) state.selected = today;
  if (!state.weekStart) state.weekStart = mondayOf(state.selected);
  const days = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
  const busy = new Set([
    ...store.getAll('appointments').map(a => dayOf(a.start_time)),
    ...store.getAll('todos').filter(t => !t.is_completed && t.due_date).map(t => dayOf(t.due_date)),
  ]);
  const [, mm] = state.weekStart.split('-').map(Number);
  const monthLabel = new Date(Date.UTC(2000, mm - 1, 1)).toLocaleDateString('it-IT', { month: 'long', timeZone: 'UTC' });

  container.innerHTML = `
    ${header({ title: 'Agenda', subtitle: longDate(state.selected).replace(/^./, c => c.toUpperCase()), initial: ctx.initial,
      right: `<button type="button" class="m-icon-btn" id="cal-add" aria-label="Nuovo evento">${mi('plus', 20)}</button>` })}
    <div class="m-page">
      <div class="m-seg" role="group" aria-label="Vista">
        <button type="button" data-mode="day" aria-pressed="${state.mode === 'day'}">Giorno</button>
        <button type="button" data-mode="week" aria-pressed="${state.mode === 'week'}">Settimana</button>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;">
        <button type="button" class="m-icon-btn" data-shift="-7" aria-label="Settimana prima">${mi('back', 20)}</button>
        <div style="font-weight:650;text-transform:capitalize;">${esc(monthLabel)}${state.weekStart !== mondayOf(today) ? ` · <button type="button" class="m-link" id="cal-today" style="padding:0;">oggi</button>` : ''}</div>
        <button type="button" class="m-icon-btn" data-shift="7" aria-label="Settimana dopo">${mi('chevron', 20)}</button>
      </div>

      <div class="m-days" role="group" aria-label="Giorni della settimana">
        ${days.map(d => `
          <button type="button" class="m-day ${d === today ? 'm-today' : ''}" data-day="${d}" aria-pressed="${state.mode === 'day' && d === state.selected}" aria-label="${esc(longDate(d))}">
            <span class="m-day-name">${weekdayShort(d)}</span>
            <span class="m-day-num">${Number(d.slice(8, 10))}</span>
            <span class="m-day-dot ${busy.has(d) ? 'on' : ''}"></span>
          </button>`).join('')}
      </div>

      ${state.mode === 'day'
        ? timeline(itemsOn(state.selected))
        : days.map(d => {
            const items = itemsOn(d);
            return `<div class="m-day-head">${esc(relativeDay(d))}${d !== today ? '' : ''}</div>${items.length ? `<div class="m-timeline">${items.map(x => `<div class="m-tl-row"><div class="m-tl-time">${esc(x.time || '—')}</div>${itemCard(x)}</div>`).join('')}</div>` : '<div class="m-small" style="padding:2px 0 4px;">Libero</div>'}`;
          }).join('')}
    </div>`;

  const onChange = () => ctx.refresh();
  container.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { state.mode = b.dataset.mode; ctx.refresh(); }));
  container.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => { state.selected = b.dataset.day; state.mode = 'day'; ctx.refresh(); }));
  container.querySelectorAll('[data-shift]').forEach(b => b.addEventListener('click', () => {
    const n = Number(b.dataset.shift);
    state.weekStart = addDays(state.weekStart, n);
    state.selected = addDays(state.selected, n);
    ctx.refresh();
  }));
  container.querySelector('#cal-today')?.addEventListener('click', () => { state.selected = today; state.weekStart = mondayOf(today); ctx.refresh(); });
  container.querySelector('#cal-add').addEventListener('click', () => openAppointmentSheet(null, { onChange, defaults: { date: state.selected } }));
  container.querySelectorAll('[data-appt]').forEach(b => b.addEventListener('click', () => openAppointmentSheet(store.getById('appointments', b.dataset.appt), { onChange })));
  container.querySelectorAll('[data-todo]').forEach(b => b.addEventListener('click', () => openTodoSheet(store.getById('todos', b.dataset.todo), { onChange })));
}
