// src/mobile/forms.js
// Pannelli dal basso condivisi dalle schermate per telefono: creano e modificano i dati con gli stessi servizi
// dell'interfaccia per computer (store, brain, ai). Salva subito; per le eliminazioni c'è sempre "Annulla".

import { store } from '../services/store.js';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../services/finances.js';
import { processAiPrompt, applyAiResultToStore, undoAiResult } from '../services/ai.js';
import { BRAIN_DOMAINS, proposeKnowledge, commitKnowledge, upsertFact } from '../services/brain.js';
import { parseWorkoutNotation } from '../utils/body-parser.js';
import { showToast, showToastWithAction } from '../utils/toast.js';
import { formSheet, openSheet, esc, todayIso, dayOf, timeOf, clientName, num } from './ui.js';

const PRIORITY_OPTIONS = [
  { value: 'bassa', label: 'Bassa' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
];

const ACTIVITY_OPTIONS = [
  { value: 'general', label: 'Incontro' },
  { value: 'call', label: 'Chiamata' },
  { value: 'demo', label: 'Demo / revisione' },
  { value: 'deploy', label: 'Rilascio' },
  { value: 'server_deadline', label: 'Scadenza (server, dominio…)' },
  { value: 'shooting', label: 'Shooting' },
];

const clientOptions = () => [
  { value: '', label: 'Nessun cliente' },
  ...store.getAll('clients').map(c => ({ value: c.id, label: clientName(c) })),
];

/** Elimina spostando nel cestino, con "Annulla" per 5 secondi. */
export function trashWithUndo(collection, id, label, onChange) {
  if (!store.moveToTrash(collection, id)) return;
  onChange?.();
  showToastWithAction(`${label} spostato nel cestino.`, 'Annulla', () => {
    store.restoreFromTrash(collection, id);
    onChange?.();
  }, { durationMs: 5000 });
}

// ---------------------------------------------------------------------------
// To-do
// ---------------------------------------------------------------------------

export function openTodoSheet(todo = null, { onChange, defaults = {} } = {}) {
  const isEdit = Boolean(todo?.id);
  const t = todo || defaults;
  const time = timeOf(t.due_date);
  formSheet({
    title: isEdit ? 'Modifica to-do' : 'Nuovo to-do',
    fields: [
      { id: 'title', label: 'Cosa devi fare', value: t.title || '', required: true, placeholder: 'es. Richiamare Marco' },
      { id: 'date', label: 'Giorno', type: 'date', value: t.due_date ? dayOf(t.due_date) : (defaults.date || ''), half: true },
      { id: 'time', label: 'Ora (facoltativa)', type: 'time', value: time && time !== '00:00' ? time : '', half: true },
      { id: 'priority', label: 'Priorità', type: 'choice', value: t.priority || 'media', options: PRIORITY_OPTIONS },
      { id: 'client_id', label: 'Cliente', type: 'select', value: t.client_id || '', options: clientOptions() },
      { id: 'notes', label: 'Note', type: 'textarea', rows: 3, value: t.notes || '' },
    ],
    submitLabel: isEdit ? 'Salva' : 'Aggiungi',
    danger: isEdit ? {
      label: 'Elimina',
      onClick: (close) => { close(); trashWithUndo('todos', todo.id, 'To-do', onChange); },
    } : null,
    onSubmit: (v) => {
      const payload = {
        title: v.title.trim(),
        due_date: v.date ? `${v.date}T${v.time || '00:00'}` : null,
        priority: v.priority || 'media',
        client_id: v.client_id || null,
        notes: v.notes.trim(),
      };
      if (isEdit) store.update('todos', todo.id, payload);
      else store.create('todos', { ...payload, is_completed: false, source: 'manual', compensation_mode: 'none', compensation_amount: 0 });
      showToast(isEdit ? 'To-do aggiornato.' : 'To-do aggiunto.', 'success', 2500);
      onChange?.();
    },
  });
}

/** Spunta / togli la spunta, con "Annulla". */
export function toggleTodo(id, onChange) {
  const t = store.getById('todos', id);
  if (!t) return;
  const done = !t.is_completed;
  store.update('todos', id, { is_completed: done, completed_at: done ? new Date().toISOString() : null });
  onChange?.();
  if (done) {
    showToastWithAction(`Fatto: ${t.title}`, 'Annulla', () => {
      store.update('todos', id, { is_completed: false, completed_at: null });
      onChange?.();
    }, { durationMs: 5000 });
  }
}

// ---------------------------------------------------------------------------
// Entrate e uscite
// ---------------------------------------------------------------------------

export function openTransactionSheet(tx = null, { onChange, type = 'expense' } = {}) {
  const isEdit = Boolean(tx?.id);
  const currentType = tx?.type || type;
  const cats = (ty) => (ty === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map(c => ({ value: c, label: c }));
  const sheet = formSheet({
    title: isEdit ? 'Modifica movimento' : (currentType === 'income' ? 'Nuova entrata' : 'Nuova spesa'),
    fields: [
      { id: 'type', label: 'Tipo', type: 'choice', value: currentType, options: [{ value: 'expense', label: 'Uscita' }, { value: 'income', label: 'Entrata' }] },
      { id: 'amount', label: 'Importo (€)', type: 'number', value: tx?.amount ?? '', required: true, placeholder: '0,00', step: '0.01', half: true },
      { id: 'date', label: 'Data', type: 'date', value: tx?.date ? String(tx.date).slice(0, 10) : todayIso(), half: true },
      { id: 'description', label: 'Descrizione', value: tx?.description || '', required: true, placeholder: 'es. Benzina' },
      { id: 'category', label: 'Categoria', type: 'select', value: tx?.category || 'Generale', options: cats(currentType) },
    ],
    submitLabel: isEdit ? 'Salva' : 'Aggiungi',
    danger: isEdit ? {
      label: 'Elimina',
      onClick: (close) => { close(); trashWithUndo('finance_transactions', tx.id, 'Movimento', onChange); },
    } : null,
    onSubmit: (v) => {
      const amount = Math.abs(parseFloat(String(v.amount).replace(',', '.')));
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Scrivi un importo maggiore di zero.');
      const payload = { type: v.type === 'income' ? 'income' : 'expense', amount, date: v.date || todayIso(), description: v.description.trim(), category: v.category || 'Generale' };
      if (isEdit) store.update('finance_transactions', tx.id, payload);
      else store.create('finance_transactions', payload);
      showToast(isEdit ? 'Movimento aggiornato.' : `${payload.type === 'income' ? 'Entrata' : 'Spesa'} salvata.`, 'success', 2500);
      onChange?.();
    },
  });
  // le categorie cambiano con il tipo
  const group = sheet.el.querySelector('[data-choice="type"]');
  const select = sheet.el.querySelector('#msf-category');
  group?.addEventListener('click', () => {
    setTimeout(() => {
      const ty = group.querySelector('[aria-pressed="true"]')?.dataset.value || 'expense';
      const keep = select.value;
      select.innerHTML = cats(ty).map(o => `<option value="${esc(o.value)}" ${o.value === keep ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
      if (!cats(ty).some(o => o.value === keep)) select.value = 'Generale';
    }, 0);
  });
  return sheet;
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

export function openAppointmentSheet(appt = null, { onChange, defaults = {} } = {}) {
  const isEdit = Boolean(appt?.id);
  const a = appt || defaults;
  formSheet({
    title: isEdit ? 'Modifica evento' : 'Nuovo evento',
    fields: [
      { id: 'title', label: 'Titolo', value: a.title || '', required: true, placeholder: 'es. Call con TechCorp' },
      { id: 'date', label: 'Giorno', type: 'date', value: a.start_time ? dayOf(a.start_time) : (defaults.date || todayIso()), required: true },
      { id: 'start', label: 'Inizio', type: 'time', value: timeOf(a.start_time) || '09:00', half: true },
      { id: 'end', label: 'Fine', type: 'time', value: timeOf(a.end_time) || '', half: true },
      { id: 'activity_type', label: 'Tipo', type: 'select', value: a.is_shooting ? 'shooting' : (a.activity_type || 'general'), options: ACTIVITY_OPTIONS },
      { id: 'location', label: 'Luogo', value: a.location || '', placeholder: 'es. Google Meet' },
      { id: 'client_id', label: 'Cliente', type: 'select', value: a.client_id || '', options: clientOptions() },
      { id: 'description', label: 'Note', type: 'textarea', rows: 3, value: a.description || '' },
    ],
    submitLabel: isEdit ? 'Salva' : 'Aggiungi',
    danger: isEdit ? {
      label: 'Elimina',
      onClick: (close) => { close(); trashWithUndo('appointments', appt.id, 'Evento', onChange); },
    } : null,
    onSubmit: (v) => {
      if (v.end && v.start && v.end < v.start) throw new Error('L\'ora di fine è prima dell\'inizio.');
      const payload = {
        title: v.title.trim(),
        start_time: `${v.date}T${v.start || '09:00'}`,
        end_time: v.end ? `${v.date}T${v.end}` : null,
        activity_type: v.activity_type,
        is_shooting: v.activity_type === 'shooting',
        shooting_type: v.activity_type === 'shooting' ? 'Shooting' : '',
        location: v.location.trim(),
        client_id: v.client_id || null,
        description: v.description.trim(),
      };
      if (isEdit) store.update('appointments', appt.id, payload);
      else store.create('appointments', { ...payload, compensation_amount: 0 });
      showToast(isEdit ? 'Evento aggiornato.' : 'Evento aggiunto.', 'success', 2500);
      onChange?.();
    },
  });
}

// ---------------------------------------------------------------------------
// Second Brain: nota e fatto
// ---------------------------------------------------------------------------

const DOMAIN_OPTIONS = Object.entries(BRAIN_DOMAINS).map(([value, m]) => ({ value, label: `${m.icon} ${m.label}` }));

export function openNoteSheet({ onChange } = {}) {
  const sheet = formSheet({
    title: 'Nuova nota',
    fields: [
      { id: 'text', label: 'Cosa vuoi ricordare', type: 'textarea', rows: 5, required: true, placeholder: 'es. TechCorp usa Next.js e Supabase, canone 450 €/mese.' },
      { id: 'title', label: 'Titolo (facoltativo)', value: '' },
      { id: 'domain', label: 'Argomento', type: 'select', value: 'personal', options: DOMAIN_OPTIONS },
      { id: 'extract', label: 'Ricava i fatti con l\'IA', type: 'checkbox', value: true, hint: 'Ti mostro i fatti trovati e scegli tu quali tenere.' },
    ],
    extraHtml: '<button type="button" class="m-link" data-open-fact style="padding-left:0;">Oppure salva un fatto preciso (es. tariffa oraria = 60 €) ›</button>',
    submitLabel: 'Salva nota',
    onSubmit: async (v) => {
      const args = { text: v.text.trim(), title: v.title.trim(), domain: v.domain, sourceType: 'manual', tags: [] };
      if (!v.extract) {
        await commitKnowledge(args, { engine: 'manual', summary: '', tags: [], facts: [], nodes: [], edges: [] });
        showToast('Nota salvata.', 'success', 2500);
        onChange?.();
        return;
      }
      const proposal = await proposeKnowledge(args); // errore esplicito se l'IA non risponde: il testo resta nel modulo
      setTimeout(() => openFactsPreview(args, proposal, onChange), 0);
    },
  });
  sheet.el.querySelector('[data-open-fact]')?.addEventListener('click', () => {
    sheet.close();
    openFactSheet({ onChange });
  });
}

function openFactsPreview(args, proposal, onChange) {
  const facts = proposal.facts || [];
  openSheet({
    title: 'Cosa ho capito',
    body: `
      <p class="m-muted" style="margin-bottom:12px;">${esc(proposal.summary || '')}</p>
      ${facts.length === 0 ? '<p class="m-muted">Nessun fatto stabile trovato: salvo il testo come nota.</p>' : `
        <div class="m-list">
          ${facts.map((f, i) => `
            <label class="m-row" style="cursor:pointer;">
              <input type="checkbox" data-fact="${i}" checked style="width:22px;height:22px;flex-shrink:0;" />
              <span class="m-row-main"><span class="m-row-title">${esc(f.fact_key)} = ${esc(f.fact_value)}</span><span class="m-row-sub">${esc(f.subject)}</span></span>
            </label>`).join('')}
        </div>`}`,
    footer: '<button type="button" class="m-btn" data-sheet-close>Non salvare</button><button type="button" class="m-btn m-btn-primary" data-save>Salva</button>',
    onMount(el, close) {
      el.querySelector('[data-save]').addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        const keep = new Set([...el.querySelectorAll('[data-fact]:checked')].map(x => Number(x.dataset.fact)));
        try {
          const res = await commitKnowledge(args, { ...proposal, facts: facts.filter((_, i) => keep.has(i)) });
          close();
          showToast(`Nota salvata${res.facts.length ? ` con ${res.facts.length} ${res.facts.length === 1 ? 'fatto' : 'fatti'}` : ''}.`, 'success', 3000);
          onChange?.();
        } catch (err) {
          e.currentTarget.disabled = false;
          showToast(`Salvataggio non riuscito: ${err.message}`, 'error', 6000);
        }
      });
    },
  });
}

export function openFactSheet({ onChange, fact = null } = {}) {
  formSheet({
    title: fact ? 'Aggiorna fatto' : 'Nuovo fatto',
    intro: fact ? 'Scrivi il valore nuovo: quello di prima resta nello storico.' : 'Un\'informazione stabile su di te o su un cliente. Se cambia, il valore di prima resta nello storico.',
    fields: [
      { id: 'subject', label: 'Di chi o di cosa parla', value: fact?.subject || 'Io', required: true },
      { id: 'fact_key', label: 'Che cosa', value: fact?.fact_key || '', required: true, placeholder: 'es. tariffa_oraria, target_kcal' },
      { id: 'fact_value', label: 'Valore', value: fact?.fact_value || '', required: true, placeholder: 'es. 60 €/h' },
      { id: 'category', label: 'Tipo', type: 'select', value: fact?.category || 'status', options: [
        { value: 'rule', label: 'Regola (vale sempre nelle risposte)' },
        { value: 'preference', label: 'Preferenza (vale sempre nelle risposte)' },
        { value: 'status', label: 'Stato' },
        { value: 'metric', label: 'Numero / misura' },
        { value: 'client_info', label: 'Informazione su un cliente' },
      ] },
    ],
    onSubmit: (v) => {
      const res = upsertFact({ subject: v.subject, fact_key: v.fact_key, fact_value: v.fact_value, category: v.category });
      if (!res) throw new Error('Compila tutti i campi.');
      showToast(res.action === 'superseded' ? `Aggiornato (prima: ${res.previousFact?.fact_value}).` : 'Fatto salvato.', 'success', 3000);
      onChange?.();
    },
  });
}

// ---------------------------------------------------------------------------
// Corpo: biometria e allenamenti
// ---------------------------------------------------------------------------

export const BODY_METRICS = {
  sleep_hours: { label: 'Sonno', unit: 'h', step: '0.25', decimals: 1 },
  body_weight_kg: { label: 'Peso', unit: 'kg', step: '0.1', decimals: 1 },
  calories_kcal: { label: 'Kcal', unit: '', step: '1', decimals: 0, int: true },
  protein_g: { label: 'Proteine', unit: 'g', step: '1', decimals: 0, int: true },
  carbs_g: { label: 'Carbo', unit: 'g', step: '1', decimals: 0, int: true },
  fat_g: { label: 'Grassi', unit: 'g', step: '1', decimals: 0, int: true },
};

const parseMetric = (key, raw) => {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Valore non valido per ${BODY_METRICS[key].label}.`);
  return BODY_METRICS[key].int ? Math.round(n) : n;
};

/** Un solo valore di oggi (tap su una cella della griglia). */
export function openMetricSheet(key, { date = todayIso(), onChange } = {}) {
  const meta = BODY_METRICS[key];
  const log = store.getAll('body_daily_logs').find(l => l.date === date);
  formSheet({
    title: `${meta.label} · ${date === todayIso() ? 'oggi' : date}`,
    fields: [{ id: 'value', label: `${meta.label}${meta.unit ? ` (${meta.unit})` : ''}`, type: 'number', step: meta.step, value: log?.[key] ?? '', hint: 'Lascia vuoto per cancellare il valore.' }],
    onSubmit: (v) => {
      store.upsertBodyDailyLog({ date, [key]: parseMetric(key, v.value) });
      onChange?.();
    },
  });
}

/** Tutta la biometria di un giorno. */
export function openDailyLogSheet({ date = todayIso(), onChange } = {}) {
  const log = store.getAll('body_daily_logs').find(l => l.date === date) || {};
  formSheet({
    title: date === todayIso() ? 'Corpo di oggi' : `Corpo · ${date}`,
    fields: [
      ...Object.entries(BODY_METRICS).map(([key, m]) => ({ id: key, label: `${m.label}${m.unit ? ` (${m.unit})` : ''}`, type: 'number', step: m.step, value: log[key] ?? '', half: true })),
      { id: 'is_rest_day', label: 'Giorno di riposo', type: 'checkbox', value: Boolean(log.is_rest_day) },
      { id: 'general_notes', label: 'Note', type: 'textarea', rows: 2, value: log.general_notes || '' },
    ],
    onSubmit: (v) => {
      const patch = { date, is_rest_day: Boolean(v.is_rest_day), general_notes: v.general_notes.trim() };
      for (const key of Object.keys(BODY_METRICS)) patch[key] = parseMetric(key, v[key]);
      store.upsertBodyDailyLog(patch);
      showToast('Diario del corpo salvato.', 'success', 2500);
      onChange?.();
    },
  });
}

/** Una sessione di un esercizio (tap su un esercizio): notazione, varianti, RPE. */
export function openWorkoutSheet(col, { date = todayIso(), onChange } = {}) {
  const entries = store.getAll('body_workout_entries').filter(e => e.column_id === col.id && e.raw_notation);
  const existing = entries.find(e => e.date === date) || null;
  const previous = entries.filter(e => e.date < date).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
  const variants = Array.isArray(col.available_variants) && col.available_variants.length ? col.available_variants : ['Standard'];

  openSheet({
    title: `${col.name} · ${date === todayIso() ? 'oggi' : date}`,
    body: `
      <p class="m-muted" style="margin-bottom:12px;">${previous ? `Ultima volta (${esc(previous.date)}): <strong>${esc(previous.raw_notation)}</strong>` : 'Prima sessione per questo esercizio.'}</p>
      <div class="m-field">
        <span class="m-label">Variante</span>
        <div class="m-pills" style="margin:0;padding:0;flex-wrap:wrap;">
          ${variants.map(v => `<button type="button" class="m-pill" data-variant="${esc(v)}">${esc(v)}</button>`).join('')}
        </div>
      </div>
      <div class="m-field">
        <label for="mw-raw">Serie e ripetizioni</label>
        <input id="mw-raw" class="m-input" value="${esc(existing?.raw_notation || '')}" autocomplete="off" placeholder="${col.category === 'cardio' ? 'es. 30 min corsa' : 'es. 20(10,10,10) oppure (12,12,12)'}" />
        <div class="m-hint" data-preview></div>
      </div>
      <div class="m-row2">
        <div class="m-field"><label for="mw-rpe">Fatica (RPE 1-10)</label><input id="mw-rpe" class="m-input" type="text" inputmode="decimal" value="${esc(existing?.rpe ?? '')}" placeholder="es. 8" /></div>
        <div class="m-field"><label for="mw-feel">Sensazione</label>
          <select id="mw-feel" class="m-select">
            ${[['ottimo', 'Ottima / esplosiva'], ['buono', 'Buona'], ['normale', 'Normale'], ['faticoso', 'Faticosa / pesante'], ['dolore_fastidio', 'Fastidio / tensione']].map(([v, l]) => `<option value="${v}" ${(existing?.feeling || 'buono') === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></div>
      </div>
      <div class="m-field"><label for="mw-notes">Note</label><textarea id="mw-notes" class="m-textarea" rows="2">${esc(existing?.detailed_notes || '')}</textarea></div>`,
    footer: `${existing ? '<button type="button" class="m-btn m-btn-danger" data-del style="flex:0 0 auto;">Elimina</button>' : ''}<button type="button" class="m-btn m-btn-primary" data-save>Salva</button>`,
    onMount(el, close) {
      const raw = el.querySelector('#mw-raw');
      const preview = el.querySelector('[data-preview]');
      const paint = () => {
        const p = parseWorkoutNotation(raw.value, col.category || 'pull');
        preview.textContent = raw.value.trim()
          ? `${p.total_sets} serie · ${p.total_reps} ripetizioni${p.max_load_kg ? ` · carico max ${num(p.max_load_kg)} kg` : ''}`
          : 'Carico e ripetizioni per serie: 20(10,10,10) = 20 kg, 3 serie da 10. A corpo libero: (12,12,12).';
      };
      paint();
      raw.addEventListener('input', paint);
      el.querySelectorAll('[data-variant]').forEach(b => b.addEventListener('click', () => {
        const v = b.dataset.variant;
        const cur = raw.value.trim();
        const block = v === 'Standard' ? '(10,10,10)' : `${v} (10,10,10)`;
        if (!cur) raw.value = block;
        else if (!cur.toLowerCase().includes(v.toLowerCase())) raw.value = `${cur} + ${block}`;
        raw.focus();
        paint();
      }));
      el.querySelector('[data-save]').addEventListener('click', () => {
        const rawNotation = raw.value.trim();
        if (!rawNotation) { raw.focus(); preview.textContent = 'Scrivi almeno una serie.'; return; }
        store.upsertBodyWorkoutEntry({
          date,
          column_id: col.id,
          raw_notation: rawNotation,
          rpe: Math.min(10, parseFloat(el.querySelector('#mw-rpe').value.replace(',', '.'))) || null,
          feeling: el.querySelector('#mw-feel').value || 'buono',
          detailed_notes: el.querySelector('#mw-notes').value.trim(),
        });
        close();
        showToast(`${col.name}: sessione salvata.`, 'success', 2500);
        onChange?.();
      });
      el.querySelector('[data-del]')?.addEventListener('click', () => {
        const before = { ...existing };
        store.upsertBodyWorkoutEntry({ date, column_id: col.id, raw_notation: '' });
        close();
        onChange?.();
        showToastWithAction(`${col.name}: sessione eliminata.`, 'Annulla', () => {
          store.upsertBodyWorkoutEntry({ date, column_id: col.id, raw_notation: before.raw_notation, rpe: before.rpe, feeling: before.feeling, detailed_notes: before.detailed_notes });
          onChange?.();
        }, { durationMs: 5000 });
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Cattura rapida con l'IA: salva subito, "Annulla" per 5 secondi
// ---------------------------------------------------------------------------

export function describeApplied(a) {
  const bits = [];
  if (a.finance) bits.push(`${a.finance} ${a.finance === 1 ? 'movimento' : 'movimenti'}`);
  if (a.trading) bits.push(`${a.trading} ${a.trading === 1 ? 'articolo' : 'articoli'}`);
  if (a.todos) bits.push(`${a.todos} ${a.todos === 1 ? 'to-do' : 'to-do'}`);
  if (a.appointments) bits.push(`${a.appointments} in agenda`);
  if (a.body) bits.push(a.workouts ? `corpo (${a.workouts} esercizi)` : 'diario corpo');
  return bits.join(' · ');
}

/**
 * Manda il testo all'IA, salva quello che ha capito e mostra "Annulla".
 * @returns {Promise<boolean>} true se l'IA ha risposto (anche senza nulla da salvare); false se c'è stato un errore
 */
export async function runAiCapture(text, { onChange } = {}) {
  const pending = showToast('Sto leggendo…', 'info', 60000);
  try {
    const result = await processAiPrompt({ prompt: text, activeModule: 'dashboard' });
    pending?.remove?.();
    const applied = applyAiResultToStore(result);
    const summary = describeApplied(applied);
    onChange?.();
    if (!summary) {
      showToast(`Non ho trovato niente da salvare.${applied.clientsPending ? ' C\'è un possibile cliente: confermalo dal computer.' : ''}`, 'info', 6000);
      return true;
    }
    showToastWithAction(`Salvato: ${summary}`, 'Annulla', () => {
      undoAiResult(applied.undo);
      onChange?.();
      showToast('Annullato.', 'info', 2500);
    }, { durationMs: 5000 });
    return true;
  } catch (err) {
    pending?.remove?.();
    showToastWithAction(`L'IA non ha risposto: ${err.message}`, 'Metti in coda', () => {
      store.addQueuedNote(text, 'web');
      showToast('Messa in coda: la elaboro quando vuoi.', 'success', 3000);
      onChange?.();
    }, { type: 'error', durationMs: 12000 });
    return false;
  }
}
