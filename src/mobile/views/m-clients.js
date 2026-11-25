// src/mobile/views/m-clients.js
// Clienti e preventivi sul telefono: elenco con ricerca e scheda cliente per consultazione rapida
// (contatti, soldi concordati/incassati, preventivi con pagamenti, to-do). PDF e importazioni restano sul computer.

import { store } from '../../services/store.js';
import { openQuoteManagerModal } from '../../modules/quote-manager.js';
import { header, mi, esc, eur, dueLabel, isOverdue, clientName, prioBadge, checkButton } from '../ui.js';
import { openTodoSheet, toggleTodo } from '../forms.js';

const state = { query: '' };

const QUOTE_TONE = { accettato: 'green', inviato: 'blue', bozza: '', rifiutato: 'red', scaduto: 'amber' };

/** Stesse regole della scheda cliente per computer. */
export function clientMoney(profile) {
  let agreed = 0;
  let paid = 0;
  for (const q of profile.quotes) if (q.status !== 'rifiutato') agreed += Number(q.agreed_total) || 0;
  for (const t of profile.todos) if (t.compensation_mode === 'autonomous' || t.compensation_mode === 'extra') agreed += Number(t.compensation_amount) || 0;
  for (const p of profile.payments) {
    if (p.status !== 'incassato') continue;
    paid += (p.type === 'rimborso' ? -1 : 1) * (Number(p.amount) || 0);
  }
  return { agreed, paid, residual: Math.max(0, agreed - paid) };
}

function renderList(container, ctx) {
  const q = state.query.trim().toLowerCase();
  const clients = store.getAll('clients')
    .filter(c => !q || `${clientName(c)} ${c.contact_person || ''} ${c.email || ''} ${c.city || ''} ${(c.tags || []).join(' ')}`.toLowerCase().includes(q))
    .sort((a, b) => clientName(a).localeCompare(clientName(b)));

  container.innerHTML = `
    ${header({ title: 'Clienti', subtitle: `${store.getAll('clients').length} in archivio`, back: true, initial: ctx.initial })}
    <div class="m-page">
      <label class="m-search">${mi('search', 18)}<input type="search" id="cl-q" placeholder="Cerca per nome, email, città" value="${esc(state.query)}" aria-label="Cerca clienti" /></label>
      <div class="m-list" id="cl-list">
        ${clients.length ? clients.map(c => {
          const p = store.getClientFullProfile(c.id);
          const money = clientMoney(p);
          return `<button type="button" class="m-row" data-m-nav="client" data-m-params='${esc(JSON.stringify({ id: c.id }))}'>
            <span class="m-avatar" style="width:40px;height:40px;" aria-hidden="true">${esc(clientName(c).charAt(0).toUpperCase())}</span>
            <span class="m-row-main"><span class="m-row-title">${esc(clientName(c))}</span><span class="m-row-sub">${esc([p.quotes.length ? `${p.quotes.length} preventivi` : '', money.residual > 0 ? `da incassare ${eur(money.residual)}` : '', p.activeMRR > 0 ? `${eur(p.activeMRR)}/mese` : ''].filter(Boolean).join(' · ') || c.email || '—')}</span></span>
            <span class="m-row-end">${mi('chevron', 18)}</span>
          </button>`;
        }).join('') : `<div class="m-empty">${q ? 'Nessun cliente trovato.' : 'Nessun cliente. Si aggiungono dalla vista per computer o scrivendo all\'assistente.'}</div>`}
      </div>
    </div>`;

  const input = container.querySelector('#cl-q');
  input.addEventListener('input', () => {
    state.query = input.value;
    const pos = input.selectionStart;
    renderList(container, ctx);
    const again = container.querySelector('#cl-q');
    again.focus();
    again.setSelectionRange(pos, pos);
  });
}

function renderDetail(container, ctx, id) {
  const profile = store.getClientFullProfile(id);
  if (!profile) {
    container.innerHTML = `${header({ title: 'Cliente', back: true, initial: ctx.initial })}<div class="m-page"><div class="m-card m-empty">Questo cliente non esiste più.</div></div>`;
    return;
  }
  const { client: c, quotes, todos, appointments, activeMRR } = profile;
  const money = clientMoney(profile);
  const openTodos = todos.filter(t => !t.is_completed);
  const routerShim = { refresh: () => ctx.refresh(), navigate: () => {}, currentRoute: 'clients', setBack: () => {} };

  container.innerHTML = `
    ${header({ title: clientName(c), subtitle: [c.type === 'company' ? 'Azienda' : 'Privato', c.contact_person ? `Ref. ${c.contact_person}` : ''].filter(Boolean).join(' · '), back: true, initial: ctx.initial })}
    <div class="m-page">
      ${c.phone || c.email ? `<div class="m-btn-row">
        ${c.phone ? `<a class="m-btn" href="tel:${esc(String(c.phone).replace(/\s+/g, ''))}">📞 Chiama</a>` : ''}
        ${c.email ? `<a class="m-btn" href="mailto:${esc(c.email)}">✉️ Email</a>` : ''}
      </div>` : ''}

      <div class="m-stat-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));">
        <div class="m-stat" style="cursor:default;"><div class="m-stat-label">Concordato</div><div class="m-stat-value" style="font-size:16px;">${eur(money.agreed)}</div></div>
        <div class="m-stat" style="cursor:default;"><div class="m-stat-label">Incassato</div><div class="m-stat-value" style="font-size:16px;color:var(--m-green-text);">${eur(money.paid)}</div></div>
        <div class="m-stat" style="cursor:default;"><div class="m-stat-label">Da incassare</div><div class="m-stat-value" style="font-size:16px;color:${money.residual > 0 ? 'var(--m-red-text)' : 'var(--m-text-sec)'};">${eur(money.residual)}</div></div>
      </div>
      ${activeMRR > 0 ? `<div class="m-ok">Canone ricorrente attivo: <strong>${eur(activeMRR, { decimals: 2 })}/mese</strong></div>` : ''}

      <section class="m-section">
        <div class="m-section-head"><h2>Preventivi</h2><span class="m-small">${quotes.length}</span></div>
        <div class="m-list">
          ${quotes.length ? quotes.map(q => `
            <div class="m-row">
              <span class="m-row-main"><span class="m-row-title">${esc(q.title || 'Preventivo')}</span><span class="m-row-sub">N. ${esc(q.quote_number || '—')} · ${eur(q.agreed_total || 0)}${q.work_status ? ` · ${esc(q.work_status)}` : ''}</span></span>
              <span class="m-row-end" style="flex-direction:column;align-items:flex-end;gap:6px;">
                <span class="m-tag ${QUOTE_TONE[q.status] ?? ''}">${esc(q.status || 'bozza')}</span>
                <button type="button" class="m-btn m-btn-sm" data-quote="${esc(q.id)}">Pagamenti</button>
              </span>
            </div>`).join('') : '<div class="m-empty">Nessun preventivo.</div>'}
        </div>
        <p class="m-small">Il PDF e la modifica delle voci del preventivo sono nella vista per computer.</p>
      </section>

      <section class="m-section">
        <div class="m-section-head"><h2>To-do</h2><button type="button" class="m-link" id="cl-add-todo">+ Aggiungi</button></div>
        <div class="m-list">
          ${openTodos.length ? openTodos.map(t => `
            <div class="m-row">
              ${checkButton(false, `data-toggle="${esc(t.id)}" aria-label="Segna come fatto: ${esc(t.title)}"`)}
              <button type="button" class="m-row-main" data-edit="${esc(t.id)}" style="background:none;border:none;text-align:left;font:inherit;color:inherit;padding:0;cursor:pointer;">
                <span class="m-row-title">${esc(t.title)}</span><span class="m-row-sub ${isOverdue(t) ? 'm-late' : ''}">${esc(dueLabel(t) || 'Senza scadenza')}</span>
              </button>
              <span class="m-row-end">${prioBadge(t.priority)}</span>
            </div>`).join('') : '<div class="m-empty">Nessun to-do aperto.</div>'}
        </div>
      </section>

      ${appointments.length ? `<section class="m-section">
        <div class="m-section-head"><h2>Agenda</h2></div>
        <div class="m-list">${appointments.slice(0, 6).map(a => `<div class="m-row"><span class="m-row-main"><span class="m-row-title">${esc(a.title)}</span><span class="m-row-sub">${esc(String(a.start_time || '').slice(0, 16).replace('T', ' '))}${a.location ? ` · ${esc(a.location)}` : ''}</span></span></div>`).join('')}</div>
      </section>` : ''}

      ${c.notes || c.address || c.vat_number ? `<section class="m-section">
        <div class="m-section-head"><h2>Dati</h2></div>
        <div class="m-card m-small" style="line-height:1.7;">
          ${c.address ? `<div>${esc(c.address)}${c.city ? `, ${esc(c.city)}` : ''}</div>` : ''}
          ${c.vat_number ? `<div>P.IVA ${esc(c.vat_number)}</div>` : ''}
          ${c.notes ? `<div style="color:var(--m-text);white-space:pre-wrap;margin-top:6px;">${esc(c.notes)}</div>` : ''}
        </div>
      </section>` : ''}
    </div>`;

  const onChange = () => ctx.refresh();
  container.querySelectorAll('[data-quote]').forEach(b => b.addEventListener('click', () => openQuoteManagerModal(b.dataset.quote, container, routerShim, onChange)));
  container.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => toggleTodo(b.dataset.toggle, onChange)));
  container.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openTodoSheet(store.getById('todos', b.dataset.edit), { onChange })));
  container.querySelector('#cl-add-todo').addEventListener('click', () => openTodoSheet(null, { onChange, defaults: { client_id: c.id } }));
}

export function render(container, ctx, route) {
  if (route === 'client' && ctx.params?.id) renderDetail(container, ctx, ctx.params.id);
  else renderList(container, ctx);
}
