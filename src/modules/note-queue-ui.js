// src/modules/note-queue-ui.js
// Coda Appunti del Giorno: accumula pensieri, spese, allenamenti e note senza chiamare l'IA.
// Componente condiviso:
//   • renderNoteQueueBox()      → cassetto collassabile dentro l'Assistente IA
//   • mountNoteQueueWidget()    → box flottante sempre disponibile (bottone 📝 con contatore)

import { store } from '../services/store.js';
import { escapeHtml } from '../utils/formatters.js';
import { showToast } from '../utils/toast.js';
import { syncQueueWithSupabase } from '../services/note-queue-sync.js';

const COLLAPSED_KEY = 'gestionale_queue_collapsed_v1';

function readPref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* localStorage non disponibile: la preferenza resta solo in memoria */
  }
}

function noteTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Disegna la coda dentro `host` e la mantiene sincronizzata con lo store.
 * @param {HTMLElement} host
 * @param {{onProcess?: Function, collapsible?: boolean, startCollapsed?: boolean|null}} options
 */
export function renderNoteQueueBox(host, { onProcess = null, collapsible = true, startCollapsed = null } = {}) {
  if (!host) return null;
  let collapsed = collapsible ? (startCollapsed ?? readPref(COLLAPSED_KEY, false)) : false;

  const paint = () => {
    const previous = host.querySelector('[data-q-input]');
    const hadFocus = previous && document.activeElement === previous;
    const draft = previous ? previous.value : '';
    const notes = store.getQueuedNotes();
    const label = `${notes.length} ${notes.length === 1 ? 'nota' : 'note'}`;

    host.innerHTML = `
      <div class="queue-box ${collapsed ? 'collapsed' : ''}">
        ${collapsible ? `
          <button type="button" class="queue-box-header" data-q-toggle aria-expanded="${!collapsed}">
            <span>📝 Coda Appunti del Giorno (${label})</span>
            <span aria-hidden="true">${collapsed ? '▸' : '▾'}</span>
          </button>` : `
          <div class="queue-box-header static"><span>📝 Coda Appunti del Giorno (${label})</span></div>`}
        ${collapsed ? '' : `
          <div class="queue-box-body">
            <div style="display: flex; gap: 8px;">
              <input type="text" class="form-input" data-q-input maxlength="2000" autocomplete="off"
                placeholder="Scrivi una nota e premi Invio — nessuna chiamata IA" aria-label="Nuova nota in coda" />
              <button type="button" class="btn btn-sm btn-secondary" data-q-add>Aggiungi</button>
            </div>

            ${notes.length === 0 ? `
              <div class="queue-empty">Coda vuota. Esempi: “Pull Up 20(10,10,10,10)”, “ho speso 45€ di benzina”, “richiamare Marco per il preventivo”.</div>
            ` : `
              <ul class="queue-list">
                ${notes.map(n => `
                  <li>
                    <span class="mono queue-time">${noteTime(n.created_at)}</span>
                    ${n.source === 'telegram' ? '<span class="badge badge-blue">Telegram</span>' : ''}
                    <span class="queue-note-text">${escapeHtml(n.content)}</span>
                    <button type="button" class="queue-del" data-q-del="${n.id}" aria-label="Rimuovi nota">×</button>
                  </li>`).join('')}
              </ul>`}

            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px;">
              <button type="button" class="btn btn-ai" data-q-process ${notes.length === 0 || !onProcess ? 'disabled' : ''}>⚡ Elabora Coda con IA (1 Chiamata)</button>
              ${notes.length > 0 ? '<button type="button" class="btn btn-sm btn-secondary" data-q-clear>Svuota</button>' : ''}
            </div>
            <div class="queue-hint">
              ${notes.length > 1 ? `${notes.length} note → 1 sola chiamata: il prompt di sistema, che pesa gran parte dei token, si paga una volta invece di ${notes.length}.` : 'Accumula le note durante la giornata: verranno elaborate insieme in un’unica chiamata. Su Telegram usa /queue e /digest.'}
            </div>
          </div>`}
      </div>`;

    const input = host.querySelector('[data-q-input]');
    if (input) {
      input.value = draft;
      if (hadFocus) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
    bind();
  };

  const addFromInput = () => {
    const input = host.querySelector('[data-q-input]');
    if (!input) return;
    const note = store.addQueuedNote(input.value, 'web');
    if (!note) return;
    input.value = '';
    // lo store notifica e ridisegna; il focus viene ripristinato da paint()
    const again = host.querySelector('[data-q-input]');
    if (again) again.focus();
  };

  function bind() {
    host.querySelector('[data-q-toggle]')?.addEventListener('click', () => {
      collapsed = !collapsed;
      writePref(COLLAPSED_KEY, collapsed);
      paint();
    });
    const input = host.querySelector('[data-q-input]');
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addFromInput();
      }
    });
    host.querySelector('[data-q-add]')?.addEventListener('click', addFromInput);
    host.querySelectorAll('[data-q-del]').forEach(btn => btn.addEventListener('click', () => {
      // “Rimossa” = non più in coda (stato processed): evita che il pull da Supabase la faccia riapparire
      store.markNotesProcessed([btn.dataset.qDel]);
    }));
    host.querySelector('[data-q-clear]')?.addEventListener('click', () => {
      if (!confirm('Svuotare la coda senza elaborarla?')) return;
      store.markNotesProcessed(store.getQueuedNotes().map(n => n.id));
    });
    host.querySelector('[data-q-process]')?.addEventListener('click', () => {
      if (store.getQueuedNotes().length === 0) {
        showToast('La coda è vuota.', 'info');
        return;
      }
      onProcess?.();
    });
  }

  const unsubscribe = store.subscribe(() => {
    if (!host.isConnected) {
      unsubscribe();
      return;
    }
    paint();
  });

  paint();
  // Recupera in background le note arrivate da Telegram (best-effort, no-op senza Supabase)
  syncQueueWithSupabase().then(changed => { if (changed && host.isConnected) paint(); }).catch(() => {});
  return { refresh: paint, destroy: unsubscribe };
}

/**
 * Box flottante: bottone 📝 con contatore + pannello rapido per accodare note da qualsiasi sezione.
 * @param {{onProcess?: Function}} options onProcess viene chiamato quando si preme “Elabora Coda”.
 */
export function mountNoteQueueWidget({ onProcess = null } = {}) {
  if (typeof document === 'undefined' || document.getElementById('queue-widget')) return;

  const root = document.createElement('div');
  root.id = 'queue-widget';
  root.className = 'queue-widget';
  root.innerHTML = `
    <div class="queue-panel" id="queue-panel" hidden></div>
    <button type="button" class="queue-fab" id="queue-fab" aria-expanded="false" aria-controls="queue-panel" title="Coda Appunti del Giorno">
      <span aria-hidden="true">📝</span>
      <span class="queue-fab-count" id="queue-fab-count" hidden>0</span>
      <span class="sr-only">Apri la coda appunti</span>
    </button>`;
  document.body.appendChild(root);

  const fab = root.querySelector('#queue-fab');
  const panel = root.querySelector('#queue-panel');
  const countEl = root.querySelector('#queue-fab-count');
  let boxHandle = null;

  const updateCount = () => {
    const n = store.getQueuedNotes().length;
    countEl.textContent = String(n);
    countEl.hidden = n === 0;
  };
  store.subscribe(updateCount);
  updateCount();

  const close = () => {
    panel.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    boxHandle?.destroy?.();
    boxHandle = null;
  };
  const open = () => {
    panel.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    boxHandle = renderNoteQueueBox(panel, {
      collapsible: false,
      onProcess: onProcess ? () => { close(); onProcess(); } : null,
    });
    panel.querySelector('[data-q-input]')?.focus();
  };

  fab.addEventListener('click', () => (panel.hidden ? open() : close()));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !root.contains(e.target)) close();
  });

  syncQueueWithSupabase().then(changed => { if (changed) updateCount(); }).catch(() => {});
}
