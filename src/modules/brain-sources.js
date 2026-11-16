// src/modules/brain-sources.js
// Scheda "Fonti" del Second Brain: elenco dei documenti e delle chat importate, e finestra di importazione
// (scelta esplicita di cosa importare, ambito, stima del costo, avanzamento con pausa e ripresa).

import { store } from '../services/store.js';
import { escapeHtml, formatDate } from '../utils/formatters.js';
import { showToast } from '../utils/toast.js';
import { openFormModal } from '../utils/form-modal.js';
import { RAG_DOMAINS } from '../services/rag-core.js';
import { BRAIN_DOMAINS } from '../services/brain.js';
import { parseImportFile, estimateItemCost, suggestDomain } from '../utils/chat-importer.js';
import {
  createImportRunner, deleteDocument, reindexDocument, getDocumentRawContent, getDocumentChunks,
} from '../services/brain-docs.js';

const PROVIDER_META = {
  chatgpt: { label: 'ChatGPT', icon: '💬' },
  claude: { label: 'Claude', icon: '💬' },
  gemini: { label: 'Gemini', icon: '💬' },
  pdf: { label: 'PDF', icon: '📕' },
  markdown: { label: 'Markdown', icon: '📝' },
  text: { label: 'Testo', icon: '📄' },
  manual: { label: 'Incollato', icon: '📋' },
};

const domainLabel = (d) => {
  const m = RAG_DOMAINS[d] || BRAIN_DOMAINS[d];
  return m ? `${m.icon} ${m.label}` : d;
};
const eur = (v) => (v < 0.01 ? 'meno di 1 centesimo' : `circa ${v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}`);
const thousands = (n) => Math.round(n).toLocaleString('it-IT');

let searchText = '';

export function mountBrainSources(root, router, rerender) {
  if (!root) return;
  const refresh = () => (rerender ? rerender() : mountBrainSources(root, router, rerender));
  const docs = store.getAll('brain_documents')
    .filter(d => !searchText || `${d.title} ${d.summary || ''}`.toLowerCase().includes(searchText.toLowerCase()))
    .sort((a, b) => String(b.original_date || b.created_at || '').localeCompare(String(a.original_date || a.created_at || '')));
  const total = store.getAll('brain_documents').length;

  root.innerHTML = `
    <div class="card" style="margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap;">
        <div style="min-width: 0; flex: 1;">
          <div class="card-title">Le tue fonti</div>
          <div class="muted" style="margin-top: 4px;">
            Carica le vecchie chat con ChatGPT, Claude o Gemini, oppure PDF e file di testo. Li divido in pezzi che poi
            ritrovo quando fai una domanda, e ne ricavo i fatti su di te (solo da quello che hai scritto tu).
          </div>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button type="button" id="src-upload-btn" class="btn btn-primary">Carica file</button>
          <button type="button" id="src-paste-btn" class="btn btn-secondary">Incolla un testo</button>
          <input type="file" id="src-file-input" accept=".json,.md,.markdown,.txt,.pdf,application/json,application/pdf,text/plain,text/markdown" multiple hidden />
        </div>
      </div>
      <details class="ai-options" style="margin-top: 12px;">
        <summary>Come scarico le mie chat?</summary>
        <div style="padding-top: 8px; font-size: 13px; line-height: 1.6;">
          <strong>ChatGPT</strong>: Impostazioni → Controllo dei dati → Esporta dati. Arriva una email con un file .zip: dentro c'è <code>conversations.json</code>.<br>
          <strong>Claude</strong>: Impostazioni → Privacy → Esporta dati. Anche qui arriva un .zip con <code>conversations.json</code>.<br>
          <strong>Gemini</strong>: da Google Takeout scegli "Le mie attività" → Gemini, in formato JSON. Google non raggruppa le domande in chat: le raggruppo io per giorno.<br>
          Apri lo .zip sul computer e carica qui il file <code>.json</code>. Poi scegli tu quali chat importare: non parte nulla senza la tua conferma.
        </div>
      </details>
    </div>

    ${total > 0 ? `
      <div class="card" style="margin-bottom: 16px; padding: 12px 16px;">
        <input type="text" id="src-search" class="form-input" placeholder="Cerca tra le fonti per titolo…" value="${escapeHtml(searchText)}" style="max-width: 360px;" />
      </div>` : ''}

    ${docs.length === 0 ? `
      <div class="card" style="text-align: center; padding: 36px; color: var(--text-muted);">
        ${total === 0 ? 'Non hai ancora importato nulla. Inizia con una o due chat per vedere come funziona.' : 'Nessuna fonte con questo titolo.'}
      </div>
    ` : `
      <div style="display: flex; flex-direction: column; gap: 10px;">
        ${docs.map(d => {
          const p = PROVIDER_META[d.source_provider] || PROVIDER_META.manual;
          return `
            <div class="card" style="margin-bottom: 0; padding: 14px 16px;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap;">
                <div style="min-width: 0; flex: 1;">
                  <div style="font-weight: 650; font-size: 14.5px;">${p.icon} ${escapeHtml(d.title)}</div>
                  ${d.summary ? `<div class="muted" style="margin-top: 3px;">${escapeHtml(d.summary)}</div>` : ''}
                  <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px;">
                    <span class="badge badge-gray">${p.label}</span>
                    <span class="badge badge-blue">${escapeHtml(domainLabel(d.domain))}</span>
                    ${d.original_date ? `<span class="badge badge-gray" title="Data originale della chat o del documento">del ${formatDate(d.original_date)}</span>` : '<span class="badge badge-yellow" title="Senza data: i fatti ricavati valgono da oggi">senza data</span>'}
                    <span class="badge badge-gray">${d.chunk_count || 0} pezzi</span>
                    <span class="badge ${d.facts_extracted_count ? 'badge-green' : 'badge-gray'}">${d.facts_extracted_count || 0} fatti</span>
                    ${d.embedding_source === 'local' ? '<span class="badge badge-yellow" title="Trovabile solo per parole esatte: re-indicizza quando l\'IA è disponibile">solo parole</span>' : ''}
                  </div>
                </div>
                <div class="row-actions">
                  <button type="button" class="btn btn-sm btn-secondary src-preview-btn" data-id="${d.id}" title="Leggi il testo originale e i pezzi">👁 Anteprima</button>
                  <button type="button" class="btn btn-sm btn-secondary src-edit-btn" data-id="${d.id}" title="Cambia titolo o ambito">✏️</button>
                  <button type="button" class="btn btn-sm btn-secondary src-reindex-btn" data-id="${d.id}" title="Ricostruisce i pezzi dal testo originale">♻️ Re-indicizza</button>
                  <button type="button" class="btn btn-sm btn-danger src-delete-btn" data-id="${d.id}" title="Elimina il documento, i suoi pezzi e i fatti ricavati">🗑️</button>
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>
    `}
  `;

  const fileInput = root.querySelector('#src-file-input');
  root.querySelector('#src-upload-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (files.length === 0) return;
    const pending = showToast('Leggo i file…', 'info', 60000);
    try {
      const { items, warnings } = await readFiles(files);
      pending?.remove?.();
      if (items.length === 0) {
        showToast(warnings[0] || 'Nei file non ho trovato testo da importare.', 'error', 7000);
        return;
      }
      openImportModal({ items, warnings, onDone: refresh });
    } catch (err) {
      pending?.remove?.();
      showToast(`Non riesco a leggere il file: ${err.message}`, 'error', 7000);
    }
  });

  root.querySelector('#src-paste-btn').addEventListener('click', () => {
    openFormModal({
      title: 'Incolla un testo',
      intro: 'Incolla una conversazione, un appunto lungo o il testo di un documento. Nel passo successivo scegli l\'ambito e vedi il costo stimato.',
      large: true,
      fields: [
        { id: 'title', label: 'Titolo', required: true, placeholder: 'es. Chat sulla dieta di marzo' },
        { id: 'text', label: 'Testo', type: 'textarea', rows: 12, required: true },
        { id: 'date', label: 'Data a cui risale (facoltativa)', type: 'date', hint: 'Serve a non far scavalcare informazioni più recenti da un testo vecchio.' },
      ],
      submitLabel: 'Continua',
      onSubmit: (v) => {
        if (v.text.trim().length < 20) throw new Error('Il testo è troppo corto.');
        const item = { provider: 'manual', external_id: '', title: v.title.trim(), date: v.date ? new Date(`${v.date}T12:00:00`).toISOString() : null, text: v.text.trim() };
        setTimeout(() => openImportModal({ items: [item], warnings: [], onDone: refresh, preselect: true }), 0);
      },
    });
  });

  root.querySelector('#src-search')?.addEventListener('input', (e) => {
    searchText = e.target.value;
    const pos = e.target.selectionStart;
    refresh();
    const again = document.querySelector('#src-search');
    again?.focus();
    again?.setSelectionRange(pos, pos);
  });

  root.querySelectorAll('.src-preview-btn').forEach(btn => btn.addEventListener('click', () => openDocumentPreview(btn.dataset.id)));

  root.querySelectorAll('.src-edit-btn').forEach(btn => btn.addEventListener('click', () => {
    const d = store.getById('brain_documents', btn.dataset.id);
    if (!d) return;
    openFormModal({
      title: 'Modifica fonte',
      fields: [
        { id: 'title', label: 'Titolo', value: d.title, required: true },
        { id: 'domain', label: 'Ambito', type: 'select', value: d.domain, options: Object.keys(RAG_DOMAINS).map(k => ({ value: k, label: domainLabel(k) })) },
      ],
      onSubmit: (v) => {
        store.update('brain_documents', d.id, { title: v.title.trim(), domain: v.domain });
        refresh();
      },
    });
  }));

  root.querySelectorAll('.src-reindex-btn').forEach(btn => btn.addEventListener('click', async () => {
    const d = store.getById('brain_documents', btn.dataset.id);
    if (!d || !confirm(`Re-indicizzare "${d.title}"? Ricostruisco i pezzi dal testo originale (costa pochi centesimi). I fatti non cambiano.`)) return;
    btn.disabled = true;
    const original = btn.textContent;
    try {
      const res = await reindexDocument(d.id, { onStage: (s) => { btn.textContent = `${s}…`; } });
      showToast(`Re-indicizzato: ${res.chunks} pezzi.`, 'success');
      refresh();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = original;
      showToast(`Re-indicizzazione non riuscita: ${err.message}`, 'error', 8000);
    }
  }));

  root.querySelectorAll('.src-delete-btn').forEach(btn => btn.addEventListener('click', async () => {
    const d = store.getById('brain_documents', btn.dataset.id);
    if (!d) return;
    const facts = store.getAll('brain_facts', true).filter(f => f.source_document_id === d.id).length;
    if (!confirm(`Eliminare "${d.title}"?\n\nSpariscono il documento, i suoi ${d.chunk_count || 0} pezzi${facts ? ` e i ${facts} fatti ricavati da qui` : ''}. Non si può annullare.`)) return;
    btn.disabled = true;
    try {
      await deleteDocument(d.id);
      showToast('Fonte eliminata.', 'success');
      refresh();
    } catch (err) {
      btn.disabled = false;
      showToast(`Eliminazione non riuscita: ${err.message}`, 'error', 8000);
    }
  }));
}

// ---------------------------------------------------------------------------
// Lettura dei file scelti
// ---------------------------------------------------------------------------

async function extractPdfText(file) {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let text = '';
    for (const it of content.items) {
      if (typeof it.str !== 'string') continue;
      text += it.str;
      text += it.hasEOL ? '\n' : (it.str.endsWith(' ') || it.str === '' ? '' : ' ');
    }
    const clean = text.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
    if (clean) pages.push(clean);
  }
  return pages.join('\n\n');
}

async function readFiles(files) {
  const items = [];
  const warnings = [];
  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.zip')) {
      warnings.push(`"${file.name}" è un archivio .zip: aprilo sul computer e carica il file conversations.json che c'è dentro.`);
      continue;
    }
    if (lower.endsWith('.pdf')) {
      const text = await extractPdfText(file);
      if (text.length < 20) {
        warnings.push(`"${file.name}" non contiene testo selezionabile (sembra una scansione): non posso leggerlo.`);
        continue;
      }
      items.push({ provider: 'pdf', external_id: '', title: file.name.replace(/\.pdf$/i, ''), date: new Date(file.lastModified).toISOString(), text });
      continue;
    }
    const parsed = parseImportFile(file.name, await file.text(), { lastModified: file.lastModified });
    items.push(...parsed.items);
    warnings.push(...parsed.warnings);
  }
  return { items, warnings };
}

// ---------------------------------------------------------------------------
// Finestra di importazione
// ---------------------------------------------------------------------------

function openImportModal({ items, warnings = [], onDone, preselect = false }) {
  // con più chat non si seleziona nulla in automatico: scegli tu cosa far leggere all'IA
  const rows = items.map((item, i) => ({ i, item, selected: preselect || items.length === 1, domain: suggestDomain(item), cost: estimateItemCost(item) }));
  rows.sort((a, b) => String(b.item.date || '').localeCompare(String(a.item.date || '')));
  let filter = '';
  let runner = null;

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-dialog modal-lg" style="max-width: 980px;">
        <div class="modal-header">
          <div class="modal-title">Importa nel Second Brain</div>
          <button type="button" class="btn btn-sm btn-secondary" data-im="close" aria-label="Chiudi">✕</button>
        </div>
        <div class="modal-body" data-im="body"></div>
        <div class="modal-footer" data-im="footer" style="justify-content: space-between; flex-wrap: wrap;"></div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const body = wrap.querySelector('[data-im="body"]');
  const footer = wrap.querySelector('[data-im="footer"]');

  const close = () => {
    if (runner && runner.state.status === 'running' && !confirm('L\'importazione è in corso. Chiudendo si ferma dopo l\'elemento attuale: quello che è già stato importato resta. Chiudo?')) return;
    runner?.pause();
    wrap.remove();
    onDone?.();
  };
  wrap.querySelector('[data-im="close"]').addEventListener('click', close);

  const selected = () => rows.filter(r => r.selected);
  const visible = () => rows.filter(r => !filter || `${r.item.title}`.toLowerCase().includes(filter.toLowerCase()));

  function paintSummary() {
    const sel = selected();
    const tokens = sel.reduce((n, r) => n + r.cost.tokens, 0);
    const cost = sel.reduce((n, r) => n + r.cost.eur, 0);
    const chunks = sel.reduce((n, r) => n + r.cost.chunks, 0);
    footer.querySelector('[data-im="summary"]').innerHTML = sel.length === 0
      ? 'Nessun elemento selezionato.'
      : `<strong>${sel.length}</strong> ${sel.length === 1 ? 'selezionato' : 'selezionati'} · ${thousands(chunks)} pezzi · ~${thousands(tokens)} token · costo stimato: <strong>${eur(cost)}</strong>`;
    footer.querySelector('[data-im="start"]').disabled = sel.length === 0;
  }

  function paintSelection() {
    const list = visible();
    body.innerHTML = `
      ${warnings.map(w => `<div class="notice warn">${escapeHtml(w)}</div>`).join('')}
      <p class="muted" style="margin-bottom: 10px;">
        Scegli cosa importare e controlla l'ambito. Per ogni elemento l'IA legge <strong>solo i tuoi messaggi</strong> per ricavare i fatti su di te;
        il testo (comprese le risposte utili dell'assistente) viene conservato e diviso in pezzi.
      </p>
      ${rows.length > 1 ? `
        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 10px;">
          <input type="text" class="form-input" data-im="filter" placeholder="Filtra per titolo…" value="${escapeHtml(filter)}" style="max-width: 280px;" />
          <button type="button" class="btn btn-sm btn-secondary" data-im="all">Seleziona quelle in elenco</button>
          <button type="button" class="btn btn-sm btn-secondary" data-im="none">Deseleziona tutto</button>
          <span class="muted">${list.length} di ${rows.length}</span>
        </div>` : ''}
      <div style="display: flex; flex-direction: column; gap: 6px;">
        ${list.map(r => `
          <div style="display: flex; gap: 10px; align-items: center; padding: 9px 11px; border: 1px solid var(--border); border-radius: var(--radius); flex-wrap: wrap;">
            <input type="checkbox" data-im-check="${r.i}" ${r.selected ? 'checked' : ''} style="width: 17px; height: 17px; flex-shrink: 0;" aria-label="Seleziona ${escapeHtml(r.item.title)}" />
            <div style="flex: 1; min-width: 180px;">
              <div style="font-weight: 600; font-size: 13.5px;">${escapeHtml(r.item.title)}</div>
              <div class="muted" style="font-size: 12px;">
                ${(PROVIDER_META[r.item.provider] || PROVIDER_META.manual).label}
                ${r.item.date ? ` · ${formatDate(r.item.date)}` : ' · senza data'}
                ${Array.isArray(r.item.messages) ? ` · ${r.item.messages.length} messaggi` : ''}
                · ${r.cost.chunks} pezzi · ~${thousands(r.cost.tokens)} token
              </div>
            </div>
            <select class="form-select" data-im-domain="${r.i}" style="width: auto; font-size: 12.5px; padding: 5px 8px;" aria-label="Ambito">
              ${Object.keys(RAG_DOMAINS).map(k => `<option value="${k}" ${r.domain === k ? 'selected' : ''}>${escapeHtml(domainLabel(k))}</option>`).join('')}
            </select>
          </div>`).join('')}
      </div>`;

    footer.innerHTML = `
      <div data-im="summary" class="muted" style="font-size: 13px;"></div>
      <div style="display: flex; gap: 8px;">
        <button type="button" class="btn btn-secondary" data-im="cancel">Annulla</button>
        <button type="button" class="btn btn-primary" data-im="start">Avvia importazione</button>
      </div>`;
    paintSummary();

    body.querySelector('[data-im="filter"]')?.addEventListener('input', (e) => {
      filter = e.target.value;
      const pos = e.target.selectionStart;
      paintSelection();
      const again = body.querySelector('[data-im="filter"]');
      again?.focus();
      again?.setSelectionRange(pos, pos);
    });
    body.querySelector('[data-im="all"]')?.addEventListener('click', () => { for (const r of visible()) r.selected = true; paintSelection(); });
    body.querySelector('[data-im="none"]')?.addEventListener('click', () => { for (const r of rows) r.selected = false; paintSelection(); });
    body.querySelectorAll('[data-im-check]').forEach(cb => cb.addEventListener('change', () => {
      rows.find(r => r.i === Number(cb.dataset.imCheck)).selected = cb.checked;
      paintSummary();
    }));
    body.querySelectorAll('[data-im-domain]').forEach(sel => sel.addEventListener('change', () => {
      rows.find(r => r.i === Number(sel.dataset.imDomain)).domain = sel.value;
    }));
    footer.querySelector('[data-im="cancel"]').addEventListener('click', close);
    footer.querySelector('[data-im="start"]').addEventListener('click', startImport);
  }

  function startImport() {
    const jobs = selected().map(r => ({ item: r.item, domain: r.domain }));
    if (jobs.length === 0) return;
    runner = createImportRunner(jobs, { onUpdate: paintProgress });
    runner.start();
  }

  function paintProgress(s) {
    const finished = s.done + s.failed;
    const pct = Math.round((finished / s.total) * 100);
    const facts = s.jobs.reduce((n, j) => n + (j.result ? j.result.facts.created + j.result.facts.updated + j.result.facts.historical : 0), 0);
    const statusIcon = { pending: '⏳', running: '🔄', done: '✅', failed: '❌' };
    body.innerHTML = `
      <div style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
          <strong>${s.status === 'done' ? 'Importazione terminata' : s.status === 'paused' ? 'In pausa' : `Sto importando: ${escapeHtml(s.jobs[s.current]?.title || '')}`}</strong>
          <span class="mono">${finished} di ${s.total}</span>
        </div>
        <div role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" style="height: 10px; background: #ece9e1; border-radius: 6px; overflow: hidden;">
          <div style="height: 100%; width: ${pct}%; background: var(--accent); transition: width .2s;"></div>
        </div>
        <div class="muted" style="font-size: 12.5px; margin-top: 6px;">
          ${s.status === 'running' && s.stage ? `${escapeHtml(s.stage)}… ` : ''}Si elabora un elemento alla volta: puoi mettere in pausa e riprendere senza perdere quello già fatto.
        </div>
      </div>
      ${s.status === 'done' ? `<div class="notice ${s.failed ? 'warn' : 'ok'}">${s.done} importati${s.failed ? `, ${s.failed} non riusciti (puoi riprovare)` : ''}. Fatti salvati: ${facts}.</div>` : ''}
      <div style="display: flex; flex-direction: column; gap: 5px;">
        ${s.jobs.map(j => `
          <div style="padding: 7px 10px; border: 1px solid var(--border); border-radius: var(--radius); font-size: 13px;">
            <div style="display: flex; justify-content: space-between; gap: 8px;">
              <span>${statusIcon[j.status]} ${escapeHtml(j.title)}</span>
              ${j.result ? `<span class="muted" style="white-space: nowrap;">${j.result.chunks} pezzi · ${j.result.facts.created + j.result.facts.updated} fatti${j.result.facts.historical ? ` · ${j.result.facts.historical} nello storico` : ''}${j.result.facts.discarded ? ` · ${j.result.facts.discarded} scartati` : ''}</span>` : ''}
            </div>
            ${j.status === 'failed' ? `<div style="color: #8c1d1d; font-size: 12.5px; margin-top: 3px;">${escapeHtml(j.error || 'errore')}</div>` : ''}
          </div>`).join('')}
      </div>`;

    footer.innerHTML = `
      <div class="muted" style="font-size: 13px;">${s.failed ? `${s.failed} non riusciti` : ''}</div>
      <div style="display: flex; gap: 8px;">
        ${s.status === 'running' ? '<button type="button" class="btn btn-secondary" data-im="pause">Pausa</button>' : ''}
        ${s.status === 'paused' ? '<button type="button" class="btn btn-primary" data-im="resume">Riprendi</button>' : ''}
        ${s.status === 'done' && s.failed ? '<button type="button" class="btn btn-secondary" data-im="resume">Riprova i non riusciti</button>' : ''}
        ${s.status !== 'running' ? '<button type="button" class="btn btn-primary" data-im="finish">Chiudi</button>' : ''}
      </div>`;
    footer.querySelector('[data-im="pause"]')?.addEventListener('click', (e) => {
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = 'Mi fermo dopo questo…';
      runner.pause();
    });
    footer.querySelector('[data-im="resume"]')?.addEventListener('click', () => runner.resume());
    footer.querySelector('[data-im="finish"]')?.addEventListener('click', close);
  }

  paintSelection();
}

// ---------------------------------------------------------------------------
// Anteprima di una fonte: testo originale e pezzi
// ---------------------------------------------------------------------------

export async function openDocumentPreview(documentId, { highlightChunk = null } = {}) {
  const doc = store.getById('brain_documents', documentId);
  if (!doc) {
    showToast('Questa fonte non esiste più.', 'error');
    return;
  }
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-dialog modal-lg">
        <div class="modal-header">
          <div>
            <div class="modal-title">${escapeHtml(doc.title)}</div>
            <div class="muted" style="font-size: 12px;">${(PROVIDER_META[doc.source_provider] || PROVIDER_META.manual).label}${doc.original_date ? ` · ${formatDate(doc.original_date)}` : ''} · ${doc.chunk_count || 0} pezzi</div>
          </div>
          <button type="button" class="btn btn-sm btn-secondary" data-pv="close" aria-label="Chiudi">✕</button>
        </div>
        <div class="modal-body" data-pv="body"><div class="muted">Carico il testo…</div></div>
        <div class="modal-footer"><button type="button" class="btn btn-secondary" data-pv="close">Chiudi</button></div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelectorAll('[data-pv="close"]').forEach(b => b.addEventListener('click', () => wrap.remove()));
  const body = wrap.querySelector('[data-pv="body"]');
  try {
    const [raw, chunks] = await Promise.all([getDocumentRawContent(documentId), getDocumentChunks(documentId)]);
    const showChunks = highlightChunk !== null;
    body.innerHTML = `
      <div class="segmented-tabs" style="margin-bottom: 12px;">
        <button type="button" class="segmented-tab-btn ${showChunks ? '' : 'active'}" data-pv-tab="raw">Testo originale</button>
        <button type="button" class="segmented-tab-btn ${showChunks ? 'active' : ''}" data-pv-tab="chunks">Pezzi (${chunks.length})</button>
      </div>
      <div data-pv-pane="raw" style="display: ${showChunks ? 'none' : 'block'}; white-space: pre-wrap; font-size: 13.5px; line-height: 1.6;">${escapeHtml(raw || '(testo non disponibile)')}</div>
      <div data-pv-pane="chunks" style="display: ${showChunks ? 'block' : 'none'};">
        ${chunks.map(c => `
          <div data-pv-chunk="${c.chunk_index}" style="padding: 10px 12px; border: 1px solid ${c.chunk_index === highlightChunk ? 'var(--accent)' : 'var(--border)'}; background: ${c.chunk_index === highlightChunk ? '#eef2ff' : '#fff'}; border-radius: var(--radius); margin-bottom: 8px;">
            <div class="muted" style="font-size: 11.5px; margin-bottom: 4px;">Pezzo #${(c.chunk_index || 0) + 1}${c.chunk_index === highlightChunk ? ' — usato nella risposta' : ''}</div>
            <div style="white-space: pre-wrap; font-size: 13px; line-height: 1.55;">${escapeHtml(c.content)}</div>
          </div>`).join('') || '<div class="muted">Nessun pezzo.</div>'}
      </div>`;
    body.querySelectorAll('[data-pv-tab]').forEach(tab => tab.addEventListener('click', () => {
      body.querySelectorAll('[data-pv-tab]').forEach(t => t.classList.toggle('active', t === tab));
      body.querySelectorAll('[data-pv-pane]').forEach(p => { p.style.display = p.dataset.pvPane === tab.dataset.pvTab ? 'block' : 'none'; });
    }));
    body.querySelector(`[data-pv-chunk="${highlightChunk}"]`)?.scrollIntoView({ block: 'center' });
  } catch (err) {
    body.innerHTML = `<div class="notice err">Non riesco a leggere il testo: ${escapeHtml(err.message)}</div>`;
  }
}
