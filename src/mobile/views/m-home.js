// src/mobile/views/m-home.js
// Home del telefono ("Oggi"): il punto della giornata, numeri principali, to-do di oggi e prossimi eventi.

import { store } from '../../services/store.js';
import { calculateColumnRecoveryStatus } from '../../utils/body-parser.js';
import {
  header, mi, esc, todayIso, dayOf, timeOf, relativeDay, longDate, greeting, eur, num,
  prioBadge, isOverdue, dueLabel, checkButton, clientName,
} from '../ui.js';
import { openTodoSheet, toggleTodo, openAppointmentSheet } from '../forms.js';

/** To-do da fare oggi: scadenza oggi o già passata, più quelli completati oggi (per il conteggio). */
export function todayTodos(today = todayIso()) {
  const all = store.getAll('todos');
  const open = all.filter(t => !t.is_completed && t.due_date && dayOf(t.due_date) <= today);
  const doneToday = all.filter(t => t.is_completed && (dayOf(t.completed_at) === today));
  const byDue = (a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'));
  return { open: open.sort(byDue), doneToday, total: open.length + doneToday.length };
}

export function upcomingAppointments(limit = 3, fromDay = todayIso()) {
  const nowTime = `${fromDay}T${new Date().toTimeString().slice(0, 5)}`;
  return store.getAll('appointments')
    .filter(a => a.start_time && (dayOf(a.start_time) > fromDay || (dayOf(a.start_time) === fromDay && `${dayOf(a.start_time)}T${timeOf(a.start_time) || '23:59'}` >= nowTime)))
    .sort((a, b) => `${dayOf(a.start_time)}T${timeOf(a.start_time)}`.localeCompare(`${dayOf(b.start_time)}T${timeOf(b.start_time)}`))
    .slice(0, limit);
}

/** Le colonne esercizio con il loro stato di recupero (pronte = finestra ideale o da allenare). */
export function trainingStatus(today = todayIso()) {
  const entries = store.getAll('body_workout_entries');
  return store.getBodyColumns().map(col => ({ col, rec: calculateColumnRecoveryStatus(col, entries, today) }));
}

/**
 * Due frasi sul punto della giornata, calcolate dai TUOI dati (nessuna chiamata all'IA, nessun costo).
 */
export function dayInsight(today = todayIso()) {
  const tips = [];
  const log = store.getAll('body_daily_logs').find(l => l.date === today);
  const sleep = Number(log?.sleep_hours) || null;
  if (sleep !== null && sleep < 6.5) tips.push(`Hai dormito ${num(sleep)} h: oggi meglio un allenamento leggero e niente decisioni grosse la sera.`);
  else if (sleep !== null && sleep >= 7.5) tips.push(`${num(sleep)} h di sonno: buona giornata per un allenamento pieno.`);

  const overdue = store.getAll('todos').filter(t => isOverdue(t) && dayOf(t.due_date) < today).length;
  const { open } = todayTodos(today);
  if (overdue > 0) tips.push(`${overdue} ${overdue === 1 ? 'to-do è scaduto' : 'to-do sono scaduti'}: partirei da lì.`);
  else if (open.length > 0) tips.push(`${open.length} ${open.length === 1 ? 'cosa da fare' : 'cose da fare'} per oggi.`);

  const ready = trainingStatus(today).filter(x => x.rec.status === 'optimal').map(x => x.col.name);
  if (ready.length && tips.length < 2) tips.push(`Pronti da allenare: ${ready.slice(0, 3).join(', ')}.`);

  const next = upcomingAppointments(1, today)[0];
  if (next && dayOf(next.start_time) === today && tips.length < 2) tips.push(`Prossimo impegno alle ${timeOf(next.start_time)}: ${next.title}.`);

  if (tips.length === 0) tips.push('Niente in scadenza oggi. Scrivi con il "+" qualunque cosa ti venga in mente: la smisto io.');
  return tips.slice(0, 2).join(' ');
}

function todoRow(t) {
  const late = isOverdue(t);
  const client = t.client_id ? store.getById('clients', t.client_id) : null;
  return `
    <div class="m-row">
      ${checkButton(t.is_completed, `data-toggle="${esc(t.id)}" aria-label="Segna come fatto: ${esc(t.title)}"`)}
      <button type="button" class="m-row-main" data-edit-todo="${esc(t.id)}" style="background:none;border:none;text-align:left;font:inherit;color:inherit;padding:0;cursor:pointer;">
        <span class="m-row-title ${t.is_completed ? 'm-done' : ''}">${esc(t.title)}</span>
        <span class="m-row-sub ${late ? 'm-late' : ''}">${esc([dueLabel(t), clientName(client)].filter(Boolean).join(' · ') || 'Senza scadenza')}</span>
      </button>
      <span class="m-row-end">${prioBadge(t.priority)}</span>
    </div>`;
}

function eventRow(a) {
  const client = a.client_id ? store.getById('clients', a.client_id) : null;
  const day = dayOf(a.start_time);
  return `
    <button type="button" class="m-row" data-edit-appt="${esc(a.id)}">
      <span class="m-icon-badge ${a.activity_type === 'server_deadline' ? 'red' : a.activity_type === 'call' ? 'amber' : ''}">${mi('calendar', 20)}</span>
      <span class="m-row-main">
        <span class="m-row-title" style="display:block;">${esc(a.title)}</span>
        <span class="m-row-sub" style="display:block;">${esc([`${relativeDay(day)} · ${timeOf(a.start_time) || ''}`, a.location, clientName(client)].filter(Boolean).join(' · '))}</span>
      </span>
      <span class="m-row-end">${mi('chevron', 18)}</span>
    </button>`;
}

export function render(container, ctx) {
  const today = todayIso();
  const { open, doneToday, total } = todayTodos(today);
  const allOpen = store.getAll('todos').filter(t => !t.is_completed).length;
  const log = store.getAll('body_daily_logs').find(l => l.date === today) || {};
  const weights = store.getAll('body_daily_logs').filter(l => Number(l.body_weight_kg) > 0).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const lastWeight = weights[0];
  const [y, m] = today.split('-').map(Number);
  const fin = store.getFinancialSummary(m, y);
  const events = upcomingAppointments(3, today);
  const pct = total > 0 ? Math.round((doneToday.length / total) * 100) : 0;
  const shownTodos = open.length ? open.slice(0, 5) : store.getAll('todos').filter(t => !t.is_completed && !t.due_date).slice(0, 3);

  container.innerHTML = `
    ${header({
      title: greeting(),
      subtitle: longDate(today).replace(/^./, c => c.toUpperCase()),
      right: `<button type="button" class="m-icon-btn" data-m-nav="search" aria-label="Cerca">${mi('search', 20)}</button>`,
      initial: ctx.initial,
    })}
    <div class="m-page">
      <div class="m-insight">
        <span class="m-icon-badge" style="background:#fff;">${mi('ai', 20)}</span>
        <div>
          <div class="m-insight-label">Il punto di oggi</div>
          <p>${esc(dayInsight(today))}</p>
        </div>
      </div>

      <div class="m-hero-grid">
        <button type="button" class="m-hero" data-m-tab="tasks">
          <span class="m-hero-label">Da fare oggi</span>
          <span class="m-hero-value">${doneToday.length}/${total}</span>
          <span class="m-hero-foot">${total === 0 ? 'Niente in scadenza' : `${open.length} ${open.length === 1 ? 'rimasto' : 'rimasti'}`}</span>
          <span class="m-progress"><span style="width:${pct}%"></span></span>
        </button>
        <button type="button" class="m-hero m-light" data-m-tab="body">
          <span class="m-hero-label">Corpo</span>
          <span class="m-hero-value">${lastWeight ? `${num(lastWeight.body_weight_kg)}<small style="font-size:15px;font-weight:600;"> kg</small>` : '—'}</span>
          <span class="m-hero-foot" style="color:var(--m-text-sec);">${lastWeight ? `peso di ${esc(relativeDay(lastWeight.date).toLowerCase())}` : 'Nessun peso registrato'}</span>
        </button>
      </div>

      <div class="m-mini-grid">
        <div class="m-mini"><span class="m-mini-value">${log.sleep_hours ? `${num(log.sleep_hours)}h` : '—'}</span><span class="m-mini-label">Sonno</span></div>
        <div class="m-mini"><span class="m-mini-value">${log.calories_kcal ? num(log.calories_kcal, 0) : '—'}</span><span class="m-mini-label">Kcal</span></div>
        <div class="m-mini"><span class="m-mini-value">${allOpen}</span><span class="m-mini-label">Da fare</span></div>
        <div class="m-mini"><span class="m-mini-value" style="color:${fin.netCashflow < 0 ? 'var(--m-red-text)' : 'var(--m-green-text)'}">${eur(fin.netCashflow)}</span><span class="m-mini-label">Saldo mese</span></div>
      </div>

      <section class="m-section">
        <div class="m-section-head"><h2>${open.length ? 'To-do di oggi' : 'Da fare'}</h2><button type="button" class="m-link" data-m-tab="tasks">Vedi tutti ›</button></div>
        <div class="m-list">
          ${shownTodos.length ? shownTodos.map(todoRow).join('') : '<div class="m-empty">Nessun to-do aperto. 🎉</div>'}
        </div>
      </section>

      <section class="m-section">
        <div class="m-section-head"><h2>Prossimi eventi</h2><button type="button" class="m-link" data-m-tab="calendar">Agenda ›</button></div>
        <div class="m-list">
          ${events.length ? events.map(eventRow).join('') : '<div class="m-empty">Nessun impegno in arrivo.</div>'}
        </div>
      </section>

      <section class="m-section">
        <div class="m-section-head"><h2>Altre sezioni</h2></div>
        <div class="m-list">
          <button type="button" class="m-row" data-m-nav="finances"><span class="m-icon-badge green">${mi('wallet', 20)}</span><span class="m-row-main"><span class="m-row-title" style="display:block;">Entrate e uscite</span><span class="m-row-sub" style="display:block;">Questo mese: ${eur(fin.totalIncome)} entrate · ${eur(fin.totalExpenses)} uscite</span></span><span class="m-row-end">${mi('chevron', 18)}</span></button>
          <button type="button" class="m-row" data-m-nav="notes"><span class="m-icon-badge purple">${mi('note', 20)}</span><span class="m-row-main"><span class="m-row-title" style="display:block;">Note e Second Brain</span><span class="m-row-sub" style="display:block;">${store.getAll('brain_memories').filter(x => !x.document_id).length} note · ${store.getActiveFacts().length} fatti</span></span><span class="m-row-end">${mi('chevron', 18)}</span></button>
          <button type="button" class="m-row" data-m-nav="clients"><span class="m-icon-badge amber">${mi('briefcase', 20)}</span><span class="m-row-main"><span class="m-row-title" style="display:block;">Clienti e preventivi</span><span class="m-row-sub" style="display:block;">${store.getAll('clients').length} clienti · ${store.getAll('quotes').length} preventivi</span></span><span class="m-row-end">${mi('chevron', 18)}</span></button>
        </div>
      </section>
    </div>`;

  const onChange = () => ctx.refresh();
  container.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => toggleTodo(b.dataset.toggle, onChange)));
  container.querySelectorAll('[data-edit-todo]').forEach(b => b.addEventListener('click', () => openTodoSheet(store.getById('todos', b.dataset.editTodo), { onChange })));
  container.querySelectorAll('[data-edit-appt]').forEach(b => b.addEventListener('click', () => openAppointmentSheet(store.getById('appointments', b.dataset.editAppt), { onChange })));
}
