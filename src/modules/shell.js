// src/modules/shell.js
// Struttura di navigazione unica: menu laterale (desktop), barra in basso (telefono) e casella "Inbox".
// Una sola fonte (NAV) alimenta tutto: niente voci duplicate o dimenticate.

import { icon } from '../utils/icons.js';
import { store } from '../services/store.js';
import { showToast, showToastWithAction } from '../utils/toast.js';
import { openAiModal } from './ai-assistant.js';
import { processAiPrompt, applyAiResultToStore, undoAiResult } from '../services/ai.js';

export const NAV = [
  { route: 'dashboard', label: 'Oggi', icon: 'dashboard' },
  { group: 'Lavoro' },
  { route: 'clients', label: 'Clienti', icon: 'clients' },
  { route: 'quotes', label: 'Preventivi', icon: 'quotes' },
  { route: 'todos', label: 'Cose da fare', icon: 'todos', badge: 'nav-todos-badge' },
  { route: 'calendar', label: 'Calendario', icon: 'calendar' },
  { route: 'catalog', label: 'Listino servizi', icon: 'catalog' },
  { group: 'Soldi' },
  { route: 'finances', label: 'Entrate e uscite', icon: 'expenses' },
  { route: 'reports', label: 'Report', icon: 'reports' },
  { group: 'Persona' },
  { route: 'body', label: 'Corpo', icon: 'body' },
  { route: 'brain', label: 'Second Brain', icon: 'brain', badge: 'nav-brain-badge' },
];

export const PAGE_TITLES = {
  dashboard: 'Oggi',
  clients: 'Clienti',
  quotes: 'Preventivi',
  todos: 'Cose da fare',
  calendar: 'Calendario',
  catalog: 'Listino servizi',
  finances: 'Entrate e uscite',
  reports: 'Report',
  body: 'Corpo',
  brain: 'Second Brain',
  settings: 'Impostazioni',
  help: 'Guida',
  trash: 'Cestino',
};

const FOOTER = [
  { route: 'settings', label: 'Impostazioni', icon: 'settings' },
  { route: 'trash', label: 'Cestino', icon: 'trash', badge: 'nav-trash-badge' },
  { route: 'help', label: 'Guida', icon: 'help' },
];

// Barra in basso sul telefono: le 4 cose che servono di più + il tasto "+"
const BOTTOM = [
  { route: 'dashboard', label: 'Oggi', icon: 'dashboard' },
  { route: 'clients', label: 'Lavoro', icon: 'clients' },
  { action: 'add', label: 'Aggiungi', icon: 'plus' },
  { route: 'finances', label: 'Soldi', icon: 'expenses' },
  { action: 'menu', label: 'Altro', icon: 'sliders' },
];

const navItem = (n) => `
  <a class="nav-item" data-route="${n.route}" href="#${n.route}">
    ${icon(n.icon, 16, 'ui-icon')}<span>${n.label}</span>
    ${n.badge ? `<span class="badge" id="${n.badge}" style="display:none">0</span>` : ''}
  </a>`;

export function buildShell() {
  const main = document.getElementById('nav-main');
  if (main) {
    main.innerHTML = NAV.map(n => n.group
      ? `<div class="nav-section-label">${n.group}</div>`
      : navItem(n)).join('');
  }
  const footer = document.getElementById('nav-footer');
  if (footer) {
    footer.innerHTML = `
      <div class="footer-links">${FOOTER.map(navItem).join('')}</div>
      <div class="footer-row">
        <button type="button" id="quick-backup-export" class="link-btn" title="Salva una copia di tutti i dati sul tuo dispositivo">Copia di sicurezza</button>
        <button type="button" id="quick-backup-import" class="link-btn" title="Ripristina da una copia di sicurezza">Ripristina</button>
        <button type="button" id="logout-btn" class="link-btn">Esci</button>
      </div>`;
  }
  const bottom = document.getElementById('nav-bottom');
  if (bottom) {
    bottom.innerHTML = BOTTOM.map(b => b.route
      ? `<button class="bottom-nav-item" data-route="${b.route}">${icon(b.icon, 20, 'ui-icon')}<span>${b.label}</span></button>`
      : `<button class="bottom-nav-item ${b.action === 'add' ? 'add-center' : ''}" data-action="${b.action}">
           ${b.action === 'add' ? `<div class="ai-circle">${icon(b.icon, 22, 'ui-icon')}</div>` : icon(b.icon, 20, 'ui-icon')}<span>${b.label}</span>
         </button>`).join('');
  }
}

/** Riassunto in italiano di cosa è stato salvato, per il messaggio con "Annulla". */
function describeApplied(a) {
  const bits = [];
  if (a.finance) bits.push(`${a.finance} ${a.finance === 1 ? 'movimento' : 'movimenti'}`);
  if (a.trading) bits.push(`${a.trading} ${a.trading === 1 ? 'articolo' : 'articoli'}`);
  if (a.todos) bits.push(`${a.todos} ${a.todos === 1 ? 'cosa da fare' : 'cose da fare'}`);
  if (a.appointments) bits.push(`${a.appointments} in calendario`);
  if (a.body) bits.push(a.workouts ? `diario corpo (${a.workouts} esercizi)` : 'diario corpo');
  return bits.join(' · ');
}

/**
 * Scrivi e invia: si salva SUBITO e per 5 secondi c'è "Annulla".
 * Niente finestra di conferma: per l'uso di tutti i giorni è solo attrito in più.
 */
export async function runInbox(text, router) {
  const pending = showToast('Sto leggendo…', 'info', 60000);
  try {
    const result = await processAiPrompt({ prompt: text, activeModule: router?.currentRoute || null });
    pending?.remove?.();

    const applied = applyAiResultToStore(result);
    const summary = describeApplied(applied);
    router?.refresh?.();

    if (!summary) {
      const extra = applied.clientsPending ? ` Ho visto ${applied.clientsPending} possibile cliente: confermalo in Clienti.` : '';
      showToast(`Non ho trovato niente da salvare in: "${text.slice(0, 60)}".${extra}`, 'info', 6000);
      return;
    }

    showToastWithAction(`Salvato: ${summary}`, 'Annulla', () => {
      undoAiResult(applied.undo);
      router?.refresh?.();
      showToast('Annullato.', 'info', 2500);
    }, { durationMs: 5000 });
  } catch (err) {
    pending?.remove?.();
    // L'IA non ha risposto: niente inventato, il testo torna nella casella così non lo riscrivi
    const inputEl = document.getElementById('inbox-input');
    if (inputEl && !inputEl.value) inputEl.value = text;
    showToastWithAction(`L'IA non ha risposto: ${err.message}`, 'Metti da parte', () => {
      store.addQueuedNote(text, 'web');
      if (inputEl && inputEl.value === text) inputEl.value = '';
      showToast('Messa da parte: la elaboro quando vuoi.', 'success', 3000);
    }, { type: 'error', durationMs: 12000 });
  }
}

/**
 * Collega la casella Inbox e i tasti della barra in basso.
 * - Invio / "Invia": apre l'assistente con il testo già scritto e lo elabora subito.
 * - "Da parte": mette il testo in coda (nessuna chiamata all'IA); poi si elabora tutto insieme.
 */
export function wireInbox(router) {
  const form = document.getElementById('inbox-form');
  const input = document.getElementById('inbox-input');
  const queueBtn = document.getElementById('inbox-queue');
  const chip = document.getElementById('inbox-queue-chip');
  const onSaved = () => router.refresh();

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) { openAiModal({ onSaved }); return; }
    input.value = '';
    await runInbox(text, router);
  });

  queueBtn?.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    store.addQueuedNote(text, 'web');
    input.value = '';
    showToast('Messa da parte. La elaboro quando vuoi, tutte insieme.', 'success');
  });

  const paintChip = () => {
    const n = store.getQueuedNotes().length;
    if (!chip) return;
    chip.hidden = n === 0;
    chip.textContent = `${n} ${n === 1 ? 'nota da elaborare' : 'note da elaborare'}`;
  };
  chip?.addEventListener('click', () => openAiModal({ autoProcessQueue: true, onSaved }));
  store.subscribe(paintChip);
  paintChip();

  document.getElementById('nav-bottom')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'add') openAiModal({ onSaved });
    if (btn.dataset.action === 'menu') document.getElementById('app-sidebar')?.classList.toggle('open');
  });
}
