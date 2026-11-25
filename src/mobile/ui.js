// src/mobile/ui.js
// Mattoncini dell'interfaccia per telefono: icone, testata, pannello dal basso (bottom sheet), moduli, date.

import { escapeHtml } from '../utils/formatters.js';
import { localTodayIso } from '../services/finances.js';

export const esc = escapeHtml;

// ---------------------------------------------------------------------------
// Icone (tratto 1.8, stile lineare)
// ---------------------------------------------------------------------------
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
  tasks: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>',
  body: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  ai: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18"/><path d="M16 15h2"/><path d="M6 6V5a2 2 0 0 1 2-2h9"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  scale: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 9a5 5 0 0 1 8 0l-3 3"/>',
  flame: '<path d="M12 22c4 0 7-2.7 7-6.7 0-3.7-2.6-6.4-4.4-8.3-.3 2.2-1.4 3.6-2.6 4.3C12.5 8 11 5 8.5 2.5 8.5 6 5 9 5 15.3 5 19.3 8 22 12 22z"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  devil: '<path d="M4 4c0 3 1.5 5 3.5 6M20 4c0 3-1.5 5-3.5 6"/><circle cx="12" cy="14" r="7"/><path d="M9.5 13h.01M14.5 13h.01M9.5 16.5c1.5 1 3.5 1 5 0"/>',
  doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>',
};

export function mi(name, size = 22, sw = 1.8) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || P.note}</svg>`;
}

// ---------------------------------------------------------------------------
// Date e numeri
// ---------------------------------------------------------------------------

export const todayIso = () => localTodayIso();

export function addDays(iso, n) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Giorno (AAAA-MM-GG) di un valore data o data-ora. Le date con ora senza fuso sono già "ora locale". */
export function dayOf(value) {
  if (!value) return '';
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return localTodayIso(d);
}

/** Ora "HH:MM" di una data-ora ('' se non c'è un orario). */
export function timeOf(value) {
  if (!value) return '';
  const s = String(value);
  const local = s.match(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/);
  if (local && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return local[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const WEEKDAYS_LONG = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

export function weekdayShort(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "martedì 25 novembre" */
export function longDate(iso = todayIso()) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const wd = WEEKDAYS_LONG[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} ${d} ${MONTHS[m - 1]}`;
}

/** "Oggi", "Domani", "Ieri" oppure "mer 26 nov" */
export function relativeDay(iso) {
  const t = todayIso();
  if (iso === t) return 'Oggi';
  if (iso === addDays(t, 1)) return 'Domani';
  if (iso === addDays(t, -1)) return 'Ieri';
  const [, m, d] = String(iso).split('-').map(Number);
  return `${weekdayShort(iso)} ${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 5) return 'Buonanotte';
  if (h < 13) return 'Buongiorno';
  if (h < 18) return 'Buon pomeriggio';
  return 'Buonasera';
}

export function eur(value, { sign = false, decimals = 0 } = {}) {
  const n = Number(value) || 0;
  const abs = Math.abs(n).toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const prefix = n < 0 ? '−' : (sign && n > 0 ? '+' : '');
  return `${prefix}${abs} €`;
}

export function num(value, decimals = 1) {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return null;
  return Number(value).toLocaleString('it-IT', { maximumFractionDigits: decimals });
}

// ---------------------------------------------------------------------------
// To-do: priorità e scadenze
// ---------------------------------------------------------------------------

export function prioBadge(priority) {
  const p = String(priority || 'media');
  if (p === 'urgente' || p === 'alta') return `<span class="m-prio h" title="Priorità ${esc(p)}">H</span>`;
  if (p === 'bassa') return '<span class="m-prio l" title="Priorità bassa">L</span>';
  return '<span class="m-prio m" title="Priorità media">M</span>';
}

/** true se il to-do aperto ha una scadenza già passata. */
export function isOverdue(todo, now = new Date()) {
  if (!todo || todo.is_completed || !todo.due_date) return false;
  const day = dayOf(todo.due_date);
  const t = todayIso();
  if (day < t) return true;
  if (day > t) return false;
  const time = timeOf(todo.due_date);
  if (!time || time === '00:00') return false;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m < now.getHours() * 60 + now.getMinutes();
}

export function dueLabel(todo) {
  if (!todo?.due_date) return '';
  const day = dayOf(todo.due_date);
  const time = timeOf(todo.due_date);
  return `${relativeDay(day)}${time && time !== '00:00' ? ` · ${time}` : ''}`;
}

export function clientName(c) {
  if (!c) return '';
  return c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Cliente';
}

export function checkButton(checked, attrs = '') {
  return `<button type="button" class="m-check" role="checkbox" aria-checked="${checked ? 'true' : 'false'}" ${attrs}>${mi('check', 15, 3)}</button>`;
}

// ---------------------------------------------------------------------------
// Testata delle schermate
// ---------------------------------------------------------------------------

/**
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.subtitle]
 * @param {boolean} [o.back] mostra la freccia "indietro"
 * @param {string} [o.right] HTML extra a destra (oltre a sincronizzazione e profilo)
 * @param {boolean} [o.profile=true] mostra il pulsante profilo con il pallino di sincronizzazione
 */
export function header({ title, subtitle = '', back = false, right = '', profile = true, initial = 'G' }) {
  return `
    <header class="m-header">
      ${back ? `<button type="button" class="m-icon-btn m-back-btn" data-m-back aria-label="Indietro">${mi('back', 24)}</button>` : ''}
      <div class="m-header-text">
        <h1>${esc(title)}</h1>
        ${subtitle ? `<div class="m-sub">${esc(subtitle)}</div>` : ''}
      </div>
      <div class="m-header-actions">
        ${right}
        ${profile ? `<button type="button" class="m-avatar" data-m-nav="profile" aria-label="Profilo e sincronizzazione">${esc(initial)}<span class="m-sync-dot" data-m-sync></span></button>` : ''}
      </div>
    </header>`;
}

// ---------------------------------------------------------------------------
// Pannello dal basso
// ---------------------------------------------------------------------------

let openSheets = 0;
export const isSheetOpen = () => openSheets > 0;

/**
 * @param {object} o
 * @param {string} o.title
 * @param {string} o.body HTML del contenuto
 * @param {string} [o.footer] HTML dei pulsanti in fondo
 * @param {(el:HTMLElement, close:()=>void)=>void} [o.onMount]
 * @param {()=>void} [o.onClose]
 * @returns {{el:HTMLElement, close:()=>void}}
 */
export function openSheet({ title, body, footer = '', onMount = null, onClose = null }) {
  const wrap = document.createElement('div');
  wrap.className = 'm-sheet-backdrop';
  wrap.innerHTML = `
    <div class="m-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="m-sheet-handle" aria-hidden="true"></div>
      <div class="m-sheet-head">
        <h3>${esc(title)}</h3>
        <button type="button" class="m-icon-btn" data-sheet-close aria-label="Chiudi">${mi('close', 20)}</button>
      </div>
      <div class="m-sheet-body">${body}</div>
      ${footer ? `<div class="m-sheet-foot">${footer}</div>` : ''}
    </div>`;
  document.body.appendChild(wrap);
  openSheets++;
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openSheets = Math.max(0, openSheets - 1);
    if (openSheets === 0) document.body.style.overflow = prevOverflow;
    document.removeEventListener('keydown', onKey);
    wrap.remove();
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelectorAll('[data-sheet-close]').forEach(b => b.addEventListener('click', close));
  onMount?.(wrap, close);
  return { el: wrap, close };
}

/** Pannello di sola lettura con un testo. */
export function textSheet(title, text, meta = '') {
  return openSheet({
    title,
    body: `${meta ? `<p class="m-muted" style="margin-bottom:10px;">${esc(meta)}</p>` : ''}<div class="m-sheet-text">${esc(text || '(testo non disponibile)')}</div>`,
    footer: '<button type="button" class="m-btn" data-sheet-close>Chiudi</button>',
  });
}

/**
 * Pannello con un modulo.
 * Campi: { id, label, type: 'text'|'textarea'|'number'|'date'|'datetime-local'|'time'|'select'|'choice'|'checkbox',
 *          value, options:[{value,label}], required, placeholder, hint, rows, step, inputmode, half:true }
 * `onSubmit(values, close)`: se lancia un errore, il messaggio compare nel pannello e i dati restano.
 */
export function formSheet({ title, intro = '', fields, submitLabel = 'Salva', onSubmit, danger = null, extraHtml = '' }) {
  const fieldHtml = (f) => {
    const id = `msf-${f.id}`;
    const req = f.required ? 'required' : '';
    const ph = f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '';
    const hint = f.hint ? `<div class="m-hint">${esc(f.hint)}</div>` : '';
    if (f.type === 'checkbox') {
      return `<label class="m-switch-row m-field" for="${id}" style="flex-direction:row;">
        <span><span style="font-weight:600;">${esc(f.label)}</span>${hint}</span>
        <input type="checkbox" id="${id}" ${f.value ? 'checked' : ''} style="width:24px;height:24px;flex-shrink:0;" />
      </label>`;
    }
    if (f.type === 'choice') {
      return `<div class="m-field"><span class="m-label">${esc(f.label)}</span>
        <div class="m-choice-row" data-choice="${f.id}" role="group" aria-label="${esc(f.label)}">
          ${(f.options || []).map(o => `<button type="button" class="m-pill" data-value="${esc(o.value)}" aria-pressed="${String(o.value) === String(f.value) ? 'true' : 'false'}">${esc(o.label)}</button>`).join('')}
        </div>${hint}</div>`;
    }
    let control;
    if (f.type === 'textarea') {
      control = `<textarea id="${id}" class="m-textarea" rows="${f.rows || 4}" ${req} ${ph}>${esc(f.value ?? '')}</textarea>`;
    } else if (f.type === 'select') {
      control = `<select id="${id}" class="m-select">${(f.options || []).map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else {
      // i numeri sono campi di testo con tastiera numerica: così si può scrivere la virgola ("45,50")
      const isNum = f.type === 'number';
      const extra = isNum ? `inputmode="${f.inputmode || 'decimal'}" pattern="[0-9]*[.,]?[0-9]*"` : '';
      const value = isNum && f.value !== '' && f.value !== null && f.value !== undefined ? String(f.value).replace('.', ',') : (f.value ?? '');
      control = `<input type="${isNum ? 'text' : (f.type || 'text')}" id="${id}" class="m-input" value="${esc(value)}" ${req} ${ph} ${extra} autocomplete="off" />`;
    }
    return `<div class="m-field"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${control}${hint}</div>`;
  };

  // i campi con half:true si affiancano a coppie
  const rows = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.half && fields[i + 1]?.half) {
      rows.push(`<div class="m-row2">${fieldHtml(f)}${fieldHtml(fields[i + 1])}</div>`);
      i++;
    } else {
      rows.push(fieldHtml(f));
    }
  }

  return openSheet({
    title,
    body: `<form data-msf novalidate>
        ${intro ? `<p class="m-muted" style="margin-bottom:12px;">${esc(intro)}</p>` : ''}
        <div class="m-error" data-msf-error hidden></div>
        ${rows.join('')}
        ${extraHtml}
        <button type="submit" hidden></button>
      </form>`,
    footer: `${danger ? `<button type="button" class="m-btn m-btn-danger" data-msf-danger style="flex:0 0 auto;">${esc(danger.label)}</button>` : ''}
      <button type="button" class="m-btn m-btn-primary" data-msf-submit>${esc(submitLabel)}</button>`,
    onMount(el, close) {
      const form = el.querySelector('[data-msf]');
      const errorBox = el.querySelector('[data-msf-error]');
      const submitBtn = el.querySelector('[data-msf-submit]');
      el.querySelectorAll('[data-choice]').forEach(group => {
        group.addEventListener('click', (e) => {
          const b = e.target.closest('[data-value]');
          if (!b) return;
          group.querySelectorAll('[data-value]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        });
      });
      const read = () => {
        const v = {};
        for (const f of fields) {
          if (f.type === 'choice') {
            v[f.id] = el.querySelector(`[data-choice="${f.id}"] [aria-pressed="true"]`)?.dataset.value ?? '';
          } else {
            const input = el.querySelector(`#msf-${f.id}`);
            v[f.id] = f.type === 'checkbox' ? input.checked : input.value;
          }
        }
        return v;
      };
      const submit = async () => {
        const values = read();
        const missing = fields.find(f => f.required && f.type !== 'checkbox' && !String(values[f.id] ?? '').trim());
        if (missing) {
          errorBox.textContent = `Compila "${missing.label}".`;
          errorBox.hidden = false;
          el.querySelector(`#msf-${missing.id}`)?.focus();
          return;
        }
        errorBox.hidden = true;
        submitBtn.disabled = true;
        try {
          await onSubmit(values, close);
          close();
        } catch (err) {
          errorBox.textContent = err?.message || String(err);
          errorBox.hidden = false;
          submitBtn.disabled = false;
        }
      };
      submitBtn.addEventListener('click', submit);
      form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      el.querySelector('[data-msf-danger]')?.addEventListener('click', () => danger.onClick(close));
    },
  });
}
