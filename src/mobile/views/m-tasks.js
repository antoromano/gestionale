// src/mobile/views/m-tasks.js
// To-do del telefono: ricerca istantanea, filtri Oggi / In arrivo / Fatti, spunta con "Annulla".

import { store } from '../../services/store.js';
import { header, mi, esc, todayIso, dayOf, prioBadge, isOverdue, dueLabel, checkButton, clientName } from '../ui.js';
import { openTodoSheet, toggleTodo } from '../forms.js';

const state = { filter: 'today', query: '' };

function groups(today = todayIso()) {
  const all = store.getAll('todos');
  const open = all.filter(t => !t.is_completed);
  const byDue = (a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'));
  return {
    today: open.filter(t => t.due_date && dayOf(t.due_date) <= today).sort(byDue),
    upcoming: open.filter(t => !t.due_date || dayOf(t.due_date) > today).sort(byDue),
    done: all.filter(t => t.is_completed).sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || ''))),
  };
}

function row(t) {
  const client = t.client_id ? store.getById('clients', t.client_id) : null;
  const late = isOverdue(t);
  return `
    <div class="m-row">
      ${checkButton(t.is_completed, `data-toggle="${esc(t.id)}" aria-label="${t.is_completed ? 'Riapri' : 'Segna come fatto'}: ${esc(t.title)}"`)}
      <button type="button" class="m-row-main" data-edit="${esc(t.id)}" style="background:none;border:none;text-align:left;font:inherit;color:inherit;padding:0;cursor:pointer;min-height:44px;">
        <span class="m-row-title ${t.is_completed ? 'm-done' : ''}">${esc(t.title)}</span>
        <span class="m-row-sub ${late ? 'm-late' : ''}">${esc([late ? 'Scaduto' : '', dueLabel(t), clientName(client)].filter(Boolean).join(' · ') || 'Senza scadenza')}</span>
      </button>
      <span class="m-row-end">${prioBadge(t.priority)}</span>
    </div>`;
}

function paintList(container) {
  const g = groups();
  const q = state.query.trim().toLowerCase();
  let list = g[state.filter] || [];
  if (q) {
    // la ricerca guarda in tutti i to-do, non solo nel filtro attivo
    list = [...g.today, ...g.upcoming, ...g.done].filter(t => `${t.title} ${t.notes || ''} ${clientName(t.client_id ? store.getById('clients', t.client_id) : null)}`.toLowerCase().includes(q));
  }
  const host = container.querySelector('#tasks-list');
  host.innerHTML = list.length
    ? `<div class="m-list">${list.slice(0, 200).map(row).join('')}</div>`
    : `<div class="m-card m-empty">${q ? 'Nessun to-do trovato.' : state.filter === 'done' ? 'Nessun to-do completato.' : state.filter === 'today' ? 'Niente per oggi. 🎉' : 'Niente in arrivo.'}</div>`;
  container.querySelectorAll('[data-filter]').forEach(b => {
    const k = b.dataset.filter;
    b.setAttribute('aria-pressed', String(!q && state.filter === k));
    b.querySelector('.m-count').textContent = g[k].length;
  });
}

export function render(container, ctx) {
  container.innerHTML = `
    ${header({ title: 'To-do', subtitle: `${store.getAll('todos').filter(t => !t.is_completed).length} aperti`, initial: ctx.initial,
      right: `<button type="button" class="m-icon-btn" id="tasks-add" aria-label="Nuovo to-do">${mi('plus', 20)}</button>` })}
    <div class="m-page">
      <label class="m-search">${mi('search', 18)}<input type="search" id="tasks-q" placeholder="Cerca nei to-do" value="${esc(state.query)}" aria-label="Cerca nei to-do" /></label>
      <div class="m-pills" role="group" aria-label="Filtro">
        <button type="button" class="m-pill" data-filter="today">Oggi<span class="m-count"></span></button>
        <button type="button" class="m-pill" data-filter="upcoming">In arrivo<span class="m-count"></span></button>
        <button type="button" class="m-pill" data-filter="done">Fatti<span class="m-count"></span></button>
      </div>
      <div id="tasks-list"></div>
    </div>`;

  const onChange = () => paintList(container);
  paintList(container);

  container.querySelector('#tasks-q').addEventListener('input', (e) => { state.query = e.target.value; paintList(container); });
  container.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
    state.filter = b.dataset.filter;
    state.query = '';
    container.querySelector('#tasks-q').value = '';
    paintList(container);
  }));
  container.querySelector('#tasks-add').addEventListener('click', () => openTodoSheet(null, { onChange: () => ctx.refresh(), defaults: state.filter === 'today' ? { date: todayIso() } : {} }));
  container.querySelector('#tasks-list').addEventListener('click', (e) => {
    const tg = e.target.closest('[data-toggle]');
    if (tg) { toggleTodo(tg.dataset.toggle, onChange); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) openTodoSheet(store.getById('todos', ed.dataset.edit), { onChange });
  });
}
