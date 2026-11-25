// src/mobile/views/m-notes.js
// Note e Second Brain sul telefono: note come foglietti colorati, fatti attivi, fonti importate.

import { store } from '../../services/store.js';
import { BRAIN_DOMAINS, updateMemory, deleteFact, invalidateFact } from '../../services/brain.js';
import { getDocumentRawContent } from '../../services/brain-docs.js';
import { showToast, showToastWithAction } from '../../utils/toast.js';
import { header, mi, esc, openSheet, formSheet, textSheet } from '../ui.js';
import { openNoteSheet, openFactSheet, trashWithUndo } from '../forms.js';

const state = { filter: 'all', query: '' };
const DOMAIN_OPTIONS = Object.entries(BRAIN_DOMAINS).map(([value, m]) => ({ value, label: `${m.icon} ${m.label}` }));
const colorOf = (id) => `c${[...String(id)].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 5}`;

function matches(text, q) {
  return !q || String(text || '').toLowerCase().includes(q);
}

function paint(container, ctx) {
  const q = state.query.trim().toLowerCase();
  const notes = store.getAll('brain_memories').filter(m => !m.document_id)
    .filter(m => matches(`${m.title} ${m.content} ${(m.tags || []).join(' ')}`, q))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const facts = store.getActiveFacts().filter(f => matches(`${f.subject} ${f.fact_key} ${f.fact_value}`, q))
    .sort((a, b) => String(a.subject).localeCompare(String(b.subject)));
  const docs = store.getAll('brain_documents').filter(d => matches(`${d.title} ${d.summary || ''}`, q));
  const show = (k) => state.filter === 'all' || state.filter === k;

  container.querySelector('#notes-body').innerHTML = `
    ${show('notes') ? `
      <section class="m-section">
        <div class="m-section-head"><h2>Note</h2><span class="m-small">${notes.length}</span></div>
        ${notes.length ? `<div class="m-note-grid">${notes.slice(0, state.filter === 'notes' ? 200 : 8).map(n => `
          <button type="button" class="m-note ${colorOf(n.id)}" data-note="${esc(n.id)}">
            ${n.title ? `<span class="m-note-title">${esc(n.title)}</span>` : ''}
            <span class="m-note-body">${esc(n.content)}</span>
            <span class="m-note-foot">${esc(BRAIN_DOMAINS[n.domain]?.icon || '')} ${esc(String(n.created_at || '').slice(0, 10))}</span>
          </button>`).join('')}</div>` : '<div class="m-card m-empty">Nessuna nota.</div>'}
        ${state.filter === 'all' && notes.length > 8 ? '<button type="button" class="m-link" data-show="notes">Tutte le note ›</button>' : ''}
      </section>` : ''}

    ${show('facts') ? `
      <section class="m-section">
        <div class="m-section-head"><h2>Fatti attivi</h2><span class="m-small">${facts.length}</span></div>
        <div class="m-list">
          ${facts.length ? facts.slice(0, state.filter === 'facts' ? 300 : 10).map(f => `
            <button type="button" class="m-row" data-fact="${esc(f.id)}">
              <span class="m-icon-badge ${f.category === 'rule' || f.category === 'preference' ? 'purple' : ''}">${mi('pin', 18)}</span>
              <span class="m-row-main"><span class="m-row-title">${esc(String(f.fact_key).replace(/_/g, ' '))}: ${esc(f.fact_value)}</span><span class="m-row-sub">${esc(f.subject)}${f.category === 'rule' ? ' · regola' : f.category === 'preference' ? ' · preferenza' : ''}</span></span>
              <span class="m-row-end">${mi('chevron', 18)}</span>
            </button>`).join('') : '<div class="m-empty">Nessun fatto salvato.</div>'}
        </div>
        ${state.filter === 'all' && facts.length > 10 ? '<button type="button" class="m-link" data-show="facts">Tutti i fatti ›</button>' : ''}
      </section>` : ''}

    ${show('sources') ? `
      <section class="m-section">
        <div class="m-section-head"><h2>Fonti importate</h2><span class="m-small">${docs.length}</span></div>
        <div class="m-list">
          ${docs.length ? docs.slice(0, 100).map(d => `
            <button type="button" class="m-row" data-doc="${esc(d.id)}">
              <span class="m-icon-badge amber">${mi('doc', 18)}</span>
              <span class="m-row-main"><span class="m-row-title">${esc(d.title)}</span><span class="m-row-sub">${esc([d.original_date ? String(d.original_date).slice(0, 10) : 'senza data', `${d.chunk_count || 0} pezzi`, `${d.facts_extracted_count || 0} fatti`].join(' · '))}</span></span>
              <span class="m-row-end">${mi('chevron', 18)}</span>
            </button>`).join('') : '<div class="m-empty">Nessuna fonte. Le chat e i documenti si importano dalla vista per computer (Second Brain → Fonti).</div>'}
        </div>
      </section>` : ''}`;

  container.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(state.filter === b.dataset.filter)));
}

function openNoteDetail(id, onChange) {
  const n = store.getById('brain_memories', id);
  if (!n) return;
  openSheet({
    title: n.title || 'Nota',
    body: `<p class="m-small" style="margin-bottom:10px;">${esc(BRAIN_DOMAINS[n.domain]?.label || n.domain || '')} · ${esc(String(n.created_at || '').slice(0, 10))}${(n.tags || []).length ? ` · #${esc(n.tags.join(' #'))}` : ''}</p>
      <div class="m-sheet-text">${esc(n.content)}</div>`,
    footer: '<button type="button" class="m-btn m-btn-danger" data-del style="flex:0 0 auto;">Elimina</button><button type="button" class="m-btn m-btn-primary" data-edit>Modifica</button>',
    onMount(el, close) {
      el.querySelector('[data-del]').addEventListener('click', () => { close(); trashWithUndo('brain_memories', id, 'Nota', onChange); });
      el.querySelector('[data-edit]').addEventListener('click', () => {
        close();
        formSheet({
          title: 'Modifica nota',
          fields: [
            { id: 'title', label: 'Titolo', value: n.title || '' },
            { id: 'content', label: 'Testo', type: 'textarea', rows: 7, value: n.content || '', required: true },
            { id: 'domain', label: 'Argomento', type: 'select', value: n.domain, options: DOMAIN_OPTIONS },
            { id: 'tags', label: 'Etichette (separate da virgola)', value: (n.tags || []).join(', ') },
          ],
          onSubmit: async (v) => {
            await updateMemory(id, v);
            showToast('Nota aggiornata.', 'success', 2500);
            onChange();
          },
        });
      });
    },
  });
}

function openFactDetail(id, onChange) {
  const f = store.getById('brain_facts', id);
  if (!f) return;
  const history = store.getFactHistory(f.subject, f.fact_key);
  openSheet({
    title: String(f.fact_key).replace(/_/g, ' '),
    body: `<p style="font-size:18px;font-weight:650;margin-bottom:4px;">${esc(f.fact_value)}</p>
      <p class="m-small" style="margin-bottom:12px;">${esc(f.subject)} · vale dal ${esc(String(f.valid_from || f.created_at).slice(0, 10))}</p>
      ${history.length > 1 ? `<div class="m-label" style="margin-bottom:6px;">Storico</div><div class="m-list">${history.map(h => `
        <div class="m-row"><span class="m-row-main"><span class="m-row-title" style="font-weight:${h.is_active ? 650 : 450};">${esc(h.fact_value)}</span><span class="m-row-sub">${esc(String(h.valid_from || h.created_at).slice(0, 10))}${h.valid_to ? ` → ${esc(String(h.valid_to).slice(0, 10))}` : ' → oggi'}</span></span>${h.is_active ? '<span class="m-tag green">attivo</span>' : ''}</div>`).join('')}</div>` : ''}`,
    footer: '<button type="button" class="m-btn m-btn-danger" data-del style="flex:0 0 auto;">Elimina</button><button type="button" class="m-btn" data-off>Non vale più</button><button type="button" class="m-btn m-btn-primary" data-upd>Aggiorna</button>',
    onMount(el, close) {
      el.querySelector('[data-del]').addEventListener('click', () => {
        close();
        const res = deleteFact(id);
        onChange();
        showToast(res?.restored ? `Eliminato. È tornato attivo il valore di prima: ${res.restored.fact_value}` : 'Fatto eliminato.', 'info', 5000);
      });
      el.querySelector('[data-off]').addEventListener('click', () => {
        close();
        invalidateFact(id);
        onChange();
        showToastWithAction('Spostato nello storico.', 'Annulla', () => { store.update('brain_facts', id, { is_active: true, valid_to: null }); onChange(); }, { durationMs: 5000 });
      });
      el.querySelector('[data-upd]').addEventListener('click', () => { close(); openFactSheet({ onChange, fact: f }); });
    },
  });
}

async function openDocDetail(id) {
  const d = store.getById('brain_documents', id);
  if (!d) return;
  const sheet = textSheet(d.title, 'Carico il testo…', `${d.original_date ? `Del ${String(d.original_date).slice(0, 10)} · ` : ''}${d.chunk_count || 0} pezzi · ${d.facts_extracted_count || 0} fatti`);
  try {
    const raw = await getDocumentRawContent(id);
    const box = sheet.el.querySelector('.m-sheet-text');
    if (box) box.textContent = raw || '(testo non disponibile)';
  } catch (err) {
    const box = sheet.el.querySelector('.m-sheet-text');
    if (box) box.textContent = `Non riesco a leggere il testo: ${err.message}`;
  }
}

export function render(container, ctx) {
  container.innerHTML = `
    ${header({ title: 'Second Brain', subtitle: 'Note, fatti e fonti', back: true, initial: ctx.initial,
      right: `<button type="button" class="m-icon-btn" id="notes-add" aria-label="Nuova nota">${mi('plus', 20)}</button>` })}
    <div class="m-page">
      <label class="m-search">${mi('search', 18)}<input type="search" id="notes-q" placeholder="Cerca in note, fatti e fonti" value="${esc(state.query)}" aria-label="Cerca" /></label>
      <div class="m-pills" role="group" aria-label="Filtro">
        ${[['all', 'Tutte'], ['notes', 'Note'], ['facts', 'Fatti'], ['sources', 'Fonti']].map(([k, l]) => `<button type="button" class="m-pill" data-filter="${k}">${l}</button>`).join('')}
      </div>
      <div id="notes-body"></div>
      <button type="button" class="m-btn m-btn-dark m-btn-block" data-m-nav="ai" data-m-params='{"tab":"chat"}'>${mi('ai', 18)} Chiedi qualcosa al tuo archivio</button>
    </div>`;

  const onChange = () => paint(container, ctx);
  paint(container, ctx);
  container.querySelector('#notes-q').addEventListener('input', (e) => { state.query = e.target.value; paint(container, ctx); });
  container.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { state.filter = b.dataset.filter; paint(container, ctx); }));
  container.querySelector('#notes-add').addEventListener('click', () => openNoteSheet({ onChange }));
  container.querySelector('#notes-body').addEventListener('click', (e) => {
    const t = e.target.closest('[data-note],[data-fact],[data-doc],[data-show]');
    if (!t) return;
    if (t.dataset.note) openNoteDetail(t.dataset.note, onChange);
    else if (t.dataset.fact) openFactDetail(t.dataset.fact, onChange);
    else if (t.dataset.doc) openDocDetail(t.dataset.doc);
    else if (t.dataset.show) { state.filter = t.dataset.show; paint(container, ctx); window.scrollTo(0, 0); }
  });
}
