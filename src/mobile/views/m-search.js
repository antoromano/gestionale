// src/mobile/views/m-search.js
// Ricerca su tutto: to-do, eventi, note, fatti, clienti, preventivi, movimenti.

import { store } from '../../services/store.js';
import { header, mi, esc, eur, dueLabel, clientName, relativeDay, dayOf, textSheet } from '../ui.js';
import { openTodoSheet, openAppointmentSheet, openTransactionSheet } from '../forms.js';

let query = '';

function results(q) {
  const has = (...parts) => parts.join(' ').toLowerCase().includes(q);
  const out = [];
  for (const t of store.getAll('todos')) if (has(t.title, t.notes)) out.push({ kind: 'todo', icon: 'tasks', title: t.title, sub: `To-do${t.is_completed ? ' fatto' : ''}${t.due_date ? ` · ${dueLabel(t)}` : ''}`, item: t });
  for (const a of store.getAll('appointments')) if (has(a.title, a.location, a.description)) out.push({ kind: 'appt', icon: 'calendar', title: a.title, sub: `Evento · ${relativeDay(dayOf(a.start_time))}`, item: a });
  for (const c of store.getAll('clients')) if (has(clientName(c), c.contact_person, c.email, c.city, c.notes)) out.push({ kind: 'client', icon: 'briefcase', title: clientName(c), sub: 'Cliente', item: c });
  for (const qu of store.getAll('quotes')) if (has(qu.title, qu.quote_number)) out.push({ kind: 'quote', icon: 'doc', title: qu.title || 'Preventivo', sub: `Preventivo N. ${qu.quote_number || '—'} · ${eur(qu.agreed_total || 0)}`, item: qu });
  for (const m of store.getAll('brain_memories').filter(x => !x.document_id)) if (has(m.title, m.content)) out.push({ kind: 'note', icon: 'note', title: m.title || String(m.content).slice(0, 60), sub: 'Nota', item: m });
  for (const f of store.getActiveFacts()) if (has(f.subject, f.fact_key, f.fact_value)) out.push({ kind: 'fact', icon: 'pin', title: `${String(f.fact_key).replace(/_/g, ' ')}: ${f.fact_value}`, sub: `Fatto · ${f.subject}`, item: f });
  for (const tx of store.getAll('finance_transactions')) if (has(tx.description, tx.category)) out.push({ kind: 'tx', icon: 'wallet', title: tx.description || tx.category, sub: `${tx.type === 'income' ? 'Entrata' : 'Spesa'} · ${eur(tx.amount, { decimals: 2 })} · ${String(tx.date).slice(0, 10)}`, item: tx });
  return out;
}

function paint(container, ctx) {
  const q = query.trim().toLowerCase();
  const host = container.querySelector('#search-results');
  if (q.length < 2) {
    host.innerHTML = '<div class="m-empty">Scrivi almeno due lettere. Cerco in to-do, agenda, clienti, preventivi, note, fatti e movimenti.</div>';
    return;
  }
  const list = results(q);
  host.innerHTML = list.length
    ? `<p class="m-small" style="margin-bottom:6px;">${list.length} risultati${list.length > 80 ? ' (primi 80)' : ''}</p><div class="m-list">${list.slice(0, 80).map((r, i) => `
      <button type="button" class="m-row" data-i="${i}">
        <span class="m-icon-badge">${mi(r.icon, 18)}</span>
        <span class="m-row-main"><span class="m-row-title">${esc(r.title)}</span><span class="m-row-sub">${esc(r.sub)}</span></span>
        <span class="m-row-end">${mi('chevron', 18)}</span>
      </button>`).join('')}</div>`
    : '<div class="m-empty">Nessun risultato.</div>';
  host.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => {
    const r = list[Number(b.dataset.i)];
    const onChange = () => paint(container, ctx);
    if (r.kind === 'todo') openTodoSheet(store.getById('todos', r.item.id), { onChange });
    else if (r.kind === 'appt') openAppointmentSheet(store.getById('appointments', r.item.id), { onChange });
    else if (r.kind === 'tx') openTransactionSheet(store.getById('finance_transactions', r.item.id), { onChange });
    else if (r.kind === 'client') ctx.navigate('client', { id: r.item.id });
    else if (r.kind === 'quote') { if (r.item.client_id) ctx.navigate('client', { id: r.item.client_id }); else textSheet(r.title, r.sub); }
    else if (r.kind === 'note') textSheet(r.item.title || 'Nota', r.item.content);
    else if (r.kind === 'fact') textSheet(r.title, `${r.item.subject} — ${r.item.fact_key}: ${r.item.fact_value}`);
  }));
}

export function render(container, ctx) {
  container.innerHTML = `
    ${header({ title: 'Cerca', back: true, initial: ctx.initial })}
    <div class="m-page">
      <label class="m-search">${mi('search', 18)}<input type="search" id="search-q" placeholder="Cerca ovunque" value="${esc(query)}" aria-label="Cerca ovunque" enterkeyhint="search" /></label>
      <div id="search-results"></div>
    </div>`;
  const input = container.querySelector('#search-q');
  input.addEventListener('input', () => { query = input.value; paint(container, ctx); });
  paint(container, ctx);
  setTimeout(() => input.focus(), 50);
}
