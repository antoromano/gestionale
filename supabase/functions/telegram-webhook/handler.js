// supabase/functions/telegram-webhook/handler.js
// Logica del bot Telegram, separata da Deno per poterla PROVARE con test veri (tests/telegram-e2e.test.js).
//
// REGOLE
//  1. Ogni scrittura nel database è verificata: il bot scrive "salvato" SOLO se il database ha confermato.
//  2. Ogni riga ha il user_id dell'unico utente: l'app la vede subito (RLS) e in tempo reale.
//  3. Senza TELEGRAM_ALLOWED_USER_ID il bot non accetta nessuno (fallisce in modo chiuso).
//  4. Se l'IA non è disponibile lo dice, con il motivo; non inventa dati in silenzio.
//  5. Le scritture dirette hanno un pulsante "Annulla".
//
// Dipendenze iniettate: { env, supabase, fetch } (in produzione arrivano da index.ts).

import { parseWorkoutNotation, DEFAULT_BODY_COLUMNS } from './body-parser.js';
import * as gemini from './gemini-core.js';

const ok = (body = { ok: true }) => ({ status: 200, body });
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------------------
// Telegram API
// ---------------------------------------------------------------------------

function telegram(deps) {
  const token = deps.env.TELEGRAM_BOT_TOKEN;
  const call = async (method, payload) => {
    if (!token) return { ok: false, description: 'TELEGRAM_BOT_TOKEN mancante' };
    const res = await deps.fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json().catch(() => ({ ok: false }));
  };
  return {
    send: (chat_id, text, reply_markup) => call('sendMessage', { chat_id, text, parse_mode: 'HTML', ...(reply_markup ? { reply_markup } : {}) }),
    edit: (chat_id, message_id, text) => call('editMessageText', { chat_id, message_id, text, parse_mode: 'HTML' }),
    answer: (callback_query_id, text) => call('answerCallbackQuery', { callback_query_id, text }),
    async download(file_id) {
      if (!token) throw new Error('TELEGRAM_BOT_TOKEN mancante');
      const info = await (await deps.fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${file_id}`)).json();
      const path = info?.result?.file_path;
      if (!path) throw new Error('Telegram non ha restituito il file');
      const buf = await (await deps.fetch(`https://api.telegram.org/file/bot${token}/${path}`)).arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    },
  };
}

// ---------------------------------------------------------------------------
// Sicurezza e proprietario
// ---------------------------------------------------------------------------

export function isAuthorized(env, fromId, chatId) {
  const allowed = String(env.TELEGRAM_ALLOWED_USER_ID || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length === 0) return false; // fail closed
  return allowed.includes(String(fromId)) || allowed.includes(String(chatId));
}

async function getOwnerId(supabase) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) throw new Error(`Impossibile leggere l'account: ${error.message}`);
  return data?.users?.[0]?.id || null;
}

function must(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

// ---------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------

function localDate(deps, unixSeconds, text = '') {
  const tz = deps.env.TIMEZONE || 'Europe/Rome';
  const base = unixSeconds ? new Date(unixSeconds * 1000) : (deps.now ? deps.now() : new Date());
  if (/\bieri\b/i.test(text)) base.setUTCDate(base.getUTCDate() - 1);
  return base.toLocaleDateString('sv-SE', { timeZone: tz });
}

// ---------------------------------------------------------------------------
// Estrazione Body a zero token (notazione 20(10,10,10), peso, kcal, sonno)
// ---------------------------------------------------------------------------

const EXERCISES = [
  ['Pull Up', /(?:pull\s*[-_]?up|trazioni|dorso)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i],
  ['Dips', /(?:dips?|parallele)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i],
  ['Push Up', /(?:push\s*[-_]?up|piegamenti)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i],
  ['Affondi', /(?:affondi|lunges?)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i],
  ['Squat / Sissy', /(?:squat|sissy(?:\s+squat)?)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i],
  ['Femo', /(?:femo(?:rali)?|leg\s+curl)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i],
  ['Stacchi', /(?:stacchi|stacco|deadlift|rdl)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i],
];

export function extractBodyHeuristic(text = '') {
  const clean = String(text).trim();
  const num = (re, i = 1) => { const m = clean.match(re); return m ? parseFloat(m[i].replace(',', '.')) : null; };
  const weight = num(/(?:peso(?:\s+corporeo)?\s*[:=]?\s*|pesato\s+)(\d{2,3}(?:[.,]\d{1,2})?)\s*kg/i) ?? num(/\b(\d{2}(?:[.,]\d{1,2}))\s*kg\b/i);
  const sleep = num(/(?:dormito|sonno)\s*[:=]?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:h|ore)?/i) ?? num(/\b(\d{1,2}(?:[.,]\d)?)\s*(?:h|ore)\s+di\s+sonno\b/i);
  const kcal = num(/(\d{3,4})\s*kcal/i);
  const protein = num(/(\d{2,3})\s*g?\s*(?:proteine|prot|pro)\b/i);
  const carbs = num(/(\d{2,3})\s*g?\s*(?:carboidrati|carbo|cho)\b/i);
  const fat = num(/(\d{1,3})\s*g?\s*(?:grassi|fat|lipidi)\b/i);

  const workouts = [];
  for (const [name, re] of EXERCISES) {
    const m = clean.match(re);
    if (m && m[1] && parseWorkoutNotation(m[1].trim(), 'pull').blocks.length > 0) {
      workouts.push({ exercise_name: name, raw_notation: m[1].trim() });
    }
  }
  const hasSignals = workouts.length > 0 || kcal !== null || sleep !== null || (weight !== null && (sleep !== null || kcal !== null));
  if (!hasSignals) return null;
  return { body_weight_kg: weight, sleep_hours: sleep, calories_kcal: kcal, protein_g: protein, carbs_g: carbs, fat_g: fat, workouts };
}

function guessDomain(text) {
  const lower = text.toLowerCase();
  if (/\b(ricetta|cucina|ingredienti|tuorli|guanciale|pecorino|cottura|pasta|carbonara|forno|grammi)\b/.test(lower)) return { domain: 'cucina', display: 'Cucina / Ricette', emoji: '🍳', nodeType: 'recipe' };
  if (/\b(etf|azioni|portafoglio|investiment[oi]|finanza|crypto|bitcoin|dividendi|risparmio)\b/.test(lower)) return { domain: 'finance', display: 'Finanza & Asset', emoji: '📈', nodeType: 'asset' };
  if (/\b(auto|macchina|tagliando|gomme|assicurazione|bollo|motore|revisione)\b/.test(lower)) return { domain: 'auto', display: 'Auto & Veicoli', emoji: '🚗', nodeType: 'vehicle' };
  return { domain: 'general', display: 'Conoscenza Generale', emoji: '🧠', nodeType: 'concept' };
}

// ---------------------------------------------------------------------------
// Scrittura nel database (verificata)
// ---------------------------------------------------------------------------

function findDefaultColumn(name = '') {
  const n = name.toLowerCase().trim();
  return DEFAULT_BODY_COLUMNS.find(c => c.name.toLowerCase() === n || c.slug === n.replace(/[^a-z0-9]+/g, '_')) || null;
}

async function ensureColumn(deps, owner, exerciseName) {
  const { supabase } = deps;
  const def = findDefaultColumn(exerciseName);
  const slug = def ? def.slug : exerciseName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const id = def ? def.id : `col-${slug}`;

  const existing = must(await supabase.from('body_exercise_columns').select('id').eq('id', id).eq('user_id', owner).limit(1), 'Lettura colonne Body');
  if (existing && existing.length > 0) return id;

  must(
    await supabase.from('body_exercise_columns').insert({
      id, user_id: owner, name: def ? def.name : exerciseName, slug, category: def ? def.category : 'pull',
      target_frequency_days: def ? def.target_frequency_days : 3, available_variants: def ? def.available_variants : [],
      position: def ? def.position : 99, is_active: true,
    }).select('id').single(),
    'Creazione colonna Body',
  );
  return id;
}

/** Scrive il log Body del giorno. @returns {{lines:string[], created:Array}} */
async function saveBody(deps, owner, bd, date) {
  const { supabase } = deps;
  const created = [];
  const lines = [];

  const daily = {};
  for (const k of ['body_weight_kg', 'sleep_hours', 'calories_kcal', 'protein_g', 'carbs_g', 'fat_g']) {
    if (bd[k] !== null && bd[k] !== undefined) daily[k] = bd[k];
  }
  const existing = must(await supabase.from('body_daily_logs').select('id').eq('date', date).eq('user_id', owner).limit(1), 'Lettura log Body');
  let logId;
  if (existing && existing.length > 0) {
    logId = existing[0].id;
    if (Object.keys(daily).length) must(await supabase.from('body_daily_logs').update(daily).eq('id', logId), 'Aggiornamento log Body');
  } else {
    const row = must(await supabase.from('body_daily_logs').insert({ ...daily, date, user_id: owner }).select('id').single(), 'Creazione log Body');
    logId = row.id;
    created.push({ table: 'body_daily_logs', id: logId });
  }

  for (const w of bd.workouts || []) {
    if (!w?.exercise_name || !w?.raw_notation) continue;
    const parsed = parseWorkoutNotation(w.raw_notation, 'pull');
    if (!parsed.blocks.length) continue;
    const columnId = await ensureColumn(deps, owner, w.exercise_name);
    const prev = must(await supabase.from('body_workout_entries').select('id').eq('date', date).eq('column_id', columnId).eq('user_id', owner).limit(1), 'Lettura allenamenti');
    const entry = { daily_log_id: logId, date, column_id: columnId, raw_notation: parsed.normalized_notation || w.raw_notation, parsed_blocks: parsed.blocks, feeling: 'buono', user_id: owner };
    if (prev && prev.length > 0) {
      must(await supabase.from('body_workout_entries').update(entry).eq('id', prev[0].id), 'Aggiornamento allenamento');
    } else {
      const row = must(await supabase.from('body_workout_entries').insert(entry).select('id').single(), 'Creazione allenamento');
      created.push({ table: 'body_workout_entries', id: row.id });
    }
    lines.push(`• ${esc(w.exercise_name)}: <b>${esc(parsed.blocks.map(b => b.display_label).join(' + ') || w.raw_notation)}</b>`);
  }
  if (daily.body_weight_kg !== undefined) lines.push(`• Peso: <b>${daily.body_weight_kg} kg</b>`);
  if (daily.sleep_hours !== undefined) lines.push(`• Sonno: <b>${daily.sleep_hours} h</b>`);
  if (daily.calories_kcal !== undefined) lines.push(`• Calorie: <b>${daily.calories_kcal} kcal</b>${daily.protein_g ? ` (P ${daily.protein_g} g)` : ''}`);
  return { lines, created, section: 'Body' };
}

async function insertRows(supabase, table, rows, what) {
  if (!rows.length) return [];
  const data = must(await supabase.from(table).insert(rows).select('id'), what);
  return (data || []).map(r => ({ table, id: r.id }));
}

/**
 * Applica un'estrazione (messaggio singolo o digest). Ogni sezione è indipendente: un errore in una non cancella le altre
 * e viene riportato con onestà.
 * @returns {{saved:string[], failed:string[], created:Array}}
 */
export async function applyExtraction(deps, owner, ex, date) {
  const { supabase } = deps;
  const saved = [];
  const failed = [];
  const created = [];

  const section = async (label, fn) => {
    try {
      const r = await fn();
      if (r) { created.push(...(r.created || [])); saved.push(...(r.lines || [])); }
    } catch (err) {
      failed.push(`${label}: ${err.message}`);
    }
  };

  if (ex.body_log) {
    const bd = { ...ex.body_log, workouts: ex.body_log.workouts || (ex.body_log.workout_entries || []).map(w => ({ exercise_name: w.column_name, raw_notation: w.raw_notation })) };
    const hasData = ['body_weight_kg', 'sleep_hours', 'calories_kcal', 'protein_g', 'carbs_g', 'fat_g'].some(k => bd[k] != null) || bd.workouts.length;
    if (hasData) await section('Body', async () => saveBody(deps, owner, bd, String(ex.body_log.date || date).slice(0, 10)));
  }

  const finance = (ex.finance_transactions || []).filter(t => (t?.type === 'income' || t?.type === 'expense') && Number(t?.amount) > 0 && t?.description);
  if (finance.length) {
    await section('Finanze', async () => {
      const rows = finance.map(t => ({ user_id: owner, type: t.type, amount: Math.abs(Number(t.amount)), description: String(t.description), category: t.category || 'generale', date: String(t.date || date).slice(0, 10), payment_method: t.payment_method || 'bonifico' }));
      const refs = await insertRows(supabase, 'finance_transactions', rows, 'Salvataggio movimenti');
      return { created: refs, lines: rows.map(r => `• ${r.type === 'income' ? '💚 Entrata' : '🔻 Uscita'} <b>${r.amount.toFixed(2)} €</b> — ${esc(r.description)}`) };
    });
  }

  const trading = (ex.trading_items || []).filter(t => t?.title && Number(t?.purchase_price) >= 0);
  if (trading.length) {
    await section('Compravendita', async () => {
      const rows = trading.map(t => ({
        user_id: owner, title: String(t.title), platform: ['Vinted', 'Subito', 'eBay'].includes(t.platform) ? t.platform : 'Altro',
        purchase_price: Number(t.purchase_price) || 0, extra_costs: Number(t.extra_costs) || 0, platform_fees: Number(t.platform_fees) || 0,
        sale_price: t.sale_price != null ? Number(t.sale_price) : null,
        status: ['in_stock', 'reserved', 'sold'].includes(t.status) ? t.status : (t.sale_price != null ? 'sold' : 'in_stock'),
        purchase_date: date,
      }));
      const refs = await insertRows(supabase, 'trading_items', rows, 'Salvataggio articoli');
      return { created: refs, lines: rows.map(r => `• 🏷️ ${esc(r.title)} (${r.platform}) acquisto <b>${r.purchase_price.toFixed(2)} €</b>`) };
    });
  }

  const todos = (ex.todos || []).filter(t => t?.title);
  if (todos.length) {
    await section('To-do', async () => {
      const rows = todos.map(t => ({
        user_id: owner, title: String(t.title), notes: t.notes || '', due_date: t.due_date || null,
        priority: ['bassa', 'media', 'alta', 'urgente'].includes(t.priority) ? t.priority : 'media',
        compensation_mode: 'none', is_completed: false, source: 'ai',
      }));
      const refs = await insertRows(supabase, 'todos', rows, 'Salvataggio to-do');
      return { created: refs, lines: rows.map(r => `• 📋 ${esc(r.title)}`) };
    });
  }

  const appts = (ex.appointments || []).filter(a => a?.title && a?.start_time);
  if (appts.length) {
    await section('Agenda', async () => {
      const rows = appts.map(a => ({ user_id: owner, title: String(a.title), description: a.description || '', start_time: a.start_time, end_time: a.end_time || null, location: a.location || '', is_all_day: Boolean(a.is_all_day) }));
      const refs = await insertRows(supabase, 'appointments', rows, 'Salvataggio eventi');
      return { created: refs, lines: rows.map(r => `• 📅 ${esc(r.title)}`) };
    });
  }
  return { saved, failed, created };
}

// ---------------------------------------------------------------------------
// Estrazione con IA (un messaggio o l'intera coda)
// ---------------------------------------------------------------------------

const EXTRACTION_PROMPT = `
Sei il motore di estrazione di "Gestionale". Ricevi uno o più appunti (numerati). Elaborali TUTTI in un'unica risposta,
output compatto, ZERO convenevoli, SOLO JSON valido con questa forma (ometti o usa null/[] ciò che non c'è):
{
  "summary": "una riga per appunto: 'n → destinazione'",
  "body_log": { "date": "YYYY-MM-DD", "sleep_hours": null, "body_weight_kg": null, "calories_kcal": null, "protein_g": null, "carbs_g": null, "fat_g": null,
                "workouts": [{ "exercise_name": "Pull Up|Dips|Push Up|Affondi|Squat / Sissy|Femo|Stacchi|Cardio & Sport", "raw_notation": "es. 20(10,10,10,10)" }] } | null,
  "finance_transactions": [{ "type": "income|expense", "amount": 0, "description": "", "category": "", "date": "YYYY-MM-DD" }],
  "trading_items": [{ "title": "", "platform": "Vinted|Subito|eBay|Altro", "purchase_price": 0, "extra_costs": 0, "platform_fees": 0, "sale_price": null, "status": "in_stock|reserved|sold" }],
  "todos": [{ "title": "", "notes": "", "due_date": "YYYY-MM-DDTHH:mm:ss|null", "priority": "bassa|media|alta|urgente" }],
  "appointments": [{ "title": "", "start_time": "YYYY-MM-DDTHH:mm:ss", "end_time": null, "location": "", "description": "" }],
  "brain_note": { "title": "", "domain": "work|client|tech|cucina|finance|auto|hobby|general", "domain_display": "", "domain_emoji": "🧠", "node_label": "", "node_type": "recipe|asset|vehicle|client|concept", "properties_summary": "", "fact_subject": "", "fact_key": "", "fact_value": "" } | null
}
Regole: importi SEMPRE positivi (il segno lo dà "type"); più pasti nello stesso giorno si SOMMANO in un solo body_log; non inventare dati mancanti;
usa "brain_note" solo per conoscenza da ricordare (ricette, fatti su clienti, regole), non per azioni operative.`;

async function extractWithAi(deps, notes, date, media = []) {
  const parts = [{ text: `Data odierna: ${date}\n\nAPPUNTI:\n${notes.map((n, i) => `[${i + 1}] ${n}`).join('\n')}` }, ...media];
  const { data, model } = await gemini.generate({
    apiKey: deps.env.GEMINI_API_KEY || '', fetchFn: deps.fetch, env: deps.env, system: EXTRACTION_PROMPT, parts, temperature: 0.05,
  });
  return { extraction: data, model };
}

function aiUnavailableNote(err) {
  if (err.code === 'no_api_key') return null; // IA non configurata: scelta, non guasto
  return `⚠️ IA non disponibile (${esc(err.message)}). Ho usato regole semplici: controlla il risultato.`;
}

// ---------------------------------------------------------------------------
// Risposte con pulsante Annulla
// ---------------------------------------------------------------------------

async function replyWithUndo(deps, tg, owner, chatId, header, result) {
  // Il titolo di successo si usa SOLO se il database ha confermato: altrimenti il bot lo dice chiaramente
  let title = header;
  if (result.failed.length && !result.created.length && !result.saved.length) title = '❌ <b>Non sono riuscito a salvare</b>';
  else if (result.failed.length) title = '⚠️ <b>Salvato solo in parte</b>';
  const lines = [title, ...result.saved];
  if (result.failed.length) lines.push('', '❌ <b>Non salvato:</b>', ...result.failed.map(f => `• ${esc(f)}`));

  let markup;
  if (result.created.length) {
    const { data } = await deps.supabase.from('telegram_pending_actions').insert({
      user_id: owner, telegram_chat_id: chatId, action_type: 'undo_log', domain: 'undo',
      proposed_payload: { refs: result.created }, status: 'pending',
    }).select('id').single();
    if (data?.id) markup = { inline_keyboard: [[{ text: '↩️ Annulla', callback_data: `undo:${data.id}` }]] };
  }
  await tg.send(chatId, lines.join('\n'), markup);
}

async function createPendingBrain(deps, tg, owner, chatId, note, rawText, notice) {
  const prop = {
    title: note.title || `Nota Telegram (${note.domain})`, node_label: note.node_label, node_type: note.node_type || 'concept',
    properties_summary: note.properties_summary || rawText, properties: { descrizione: note.properties_summary || rawText, source: 'telegram' },
    fact_subject: note.fact_subject || note.node_label, fact_key: note.fact_key || 'dettagli', fact_value: note.fact_value || note.properties_summary || rawText, raw_text: rawText,
  };
  const row = must(await deps.supabase.from('telegram_pending_actions').insert({
    user_id: owner, telegram_chat_id: chatId, action_type: 'ingest_new_domain', domain: note.domain || 'general', proposed_payload: prop, status: 'pending',
  }).select('id').single(), 'Salvataggio proposta');

  const text = [
    ...(notice ? [notice, ''] : []),
    `${note.domain_emoji || '🧠'} <b>Nuovo argomento: ${esc(note.domain_display || note.domain || 'Generale')}</b>`,
    `• Nodo: <b>${esc(prop.node_label)}</b> (${esc(prop.node_type)})`,
    `• Fatto: <code>${esc(prop.fact_key)}</code> = ${esc(prop.fact_value)}`,
    '', 'Vuoi salvarlo nel Second Brain?',
  ].join('\n');
  await tg.send(chatId, text, { inline_keyboard: [[{ text: '✅ Conferma e Salva', callback_data: `confirm:${row.id}` }, { text: '❌ Ignora', callback_data: `reject:${row.id}` }]] });
}

// ---------------------------------------------------------------------------
// Comandi
// ---------------------------------------------------------------------------

export function parseCommand(text = '') {
  const m = String(text).trim().match(/^\/(start|help|queue|digest)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  return m ? { name: m[1].toLowerCase(), args: (m[2] || '').trim() } : null;
}

const HELP = [
  '👋 <b>Gestionale</b>',
  '• Scrivi o manda un vocale: <i>"Pull Up 20(10,10,10), peso 75 kg"</i>, <i>"ho speso 45€ di benzina"</i>, <i>"richiamare Marco domani"</i>.',
  '• <code>/queue testo</code> accoda una nota senza consumare IA.',
  '• <code>/digest</code> elabora tutte le note in coda con UNA sola chiamata.',
  'Ogni salvataggio ha un pulsante ↩️ Annulla.',
].join('\n');

async function handleCommand(deps, tg, owner, chatId, cmd, date) {
  const { supabase } = deps;
  if (cmd.name === 'start' || cmd.name === 'help') return tg.send(chatId, HELP);

  if (cmd.name === 'queue') {
    if (!cmd.args) return tg.send(chatId, '📝 Usa <code>/queue testo</code> per accodare una nota. Poi <code>/digest</code> le elabora tutte insieme.');
    const ins = await supabase.from('ai_note_queue').insert({ user_id: owner, content: cmd.args, source: 'telegram', status: 'queued' }).select('id').single();
    if (ins.error) return tg.send(chatId, `❌ Nota NON accodata: ${esc(ins.error.message)}`);
    const { count } = await supabase.from('ai_note_queue').select('id', { count: 'exact', head: true }).eq('status', 'queued').eq('user_id', owner);
    return tg.send(chatId, `📝 Nota accodata (${count ?? '?'} in coda). Usa /digest per elaborarle tutte insieme.`);
  }

  // /digest
  const notesRes = await supabase.from('ai_note_queue').select('id, content, created_at').eq('status', 'queued').eq('user_id', owner).order('created_at', { ascending: true }).limit(100);
  if (notesRes.error) return tg.send(chatId, `❌ Impossibile leggere la coda: ${esc(notesRes.error.message)}`);
  const notes = notesRes.data || [];
  if (!notes.length) return tg.send(chatId, '📭 La coda appunti è vuota. Aggiungi note con /queue testo.');

  let extraction;
  try {
    ({ extraction } = await extractWithAi(deps, notes.map(n => n.content), date));
  } catch (err) {
    // Le note restano in coda: nessuna perdita
    const why = err.code === 'no_api_key' ? 'La chiave Gemini non è configurata sul server.' : err.message;
    return tg.send(chatId, `❌ Digest non eseguito: ${esc(why)}\nLe ${notes.length} note restano in coda.`);
  }
  const result = await applyExtraction(deps, owner, extraction, date);
  const mark = await supabase.from('ai_note_queue').update({ status: 'processed', processed_at: new Date().toISOString() }).in('id', notes.map(n => n.id));
  if (mark.error) result.failed.push(`Coda: note salvate ma non segnate come elaborate (${mark.error.message})`);

  const header = `✅ <b>Digest completato</b>: ${notes.length} ${notes.length === 1 ? 'nota' : 'note'} in 1 chiamata.`;
  const extra = extraction.summary ? [`<i>${esc(String(extraction.summary).slice(0, 600))}</i>`] : [];
  await replyWithUndo(deps, tg, owner, chatId, header, { ...result, saved: [...result.saved, ...(result.saved.length || result.failed.length ? [] : ['• Nessuna azione operativa individuata']), ...extra] });
}

// ---------------------------------------------------------------------------
// Messaggi
// ---------------------------------------------------------------------------

async function handleMessage(deps, tg, msg) {
  const { supabase } = deps;
  const chatId = msg.chat?.id;
  const fromId = msg.from?.id;

  if (!isAuthorized(deps.env, fromId, chatId)) {
    const hint = String(deps.env.TELEGRAM_ALLOWED_USER_ID || '').trim() ? '' : ' (TELEGRAM_ALLOWED_USER_ID non è configurato sul server)';
    await tg.send(chatId, `⛔ Non sei autorizzato ad accedere a questo Gestionale.${hint}`);
    return ok({ ok: false, unauthorized: true });
  }

  const owner = await getOwnerId(supabase);
  if (!owner) {
    await tg.send(chatId, '⚠️ Non c\'è ancora un account: apri l\'app, crea il tuo account e poi riscrivimi. <b>Non ho salvato nulla.</b>');
    return ok({ ok: false, error: 'no_owner' });
  }

  const sub = await supabase.from('telegram_bot_subscribers').upsert({ chat_id: chatId, user_id: owner, username: msg.from?.username || null, first_name: msg.from?.first_name || null, is_authorized: true }, { onConflict: 'chat_id' });
  if (sub.error) console.warn('subscriber non aggiornato:', sub.error.message);

  const text = (msg.text || msg.caption || '').trim();
  const date = localDate(deps, msg.date, text);
  const cmd = parseCommand(text);
  if (cmd) {
    await handleCommand(deps, tg, owner, chatId, cmd, date);
    return ok({ ok: true, intent: cmd.name });
  }

  // Media: vocale / foto (solo con IA)
  const media = [];
  try {
    const fileId = msg.voice?.file_id || msg.audio?.file_id;
    if (fileId) media.push({ inline_data: { mime_type: 'audio/ogg', data: await tg.download(fileId) } });
    if (Array.isArray(msg.photo) && msg.photo.length) media.push({ inline_data: { mime_type: 'image/jpeg', data: await tg.download(msg.photo[msg.photo.length - 1].file_id) } });
  } catch (err) {
    await tg.send(chatId, `❌ Non sono riuscito a scaricare il file: ${esc(err.message)}. Non ho salvato nulla.`);
    return ok({ ok: false, error: err.message });
  }
  if (!text && media.length === 0) return ok({ ok: true, ignored: true });

  // 1) IA (se configurata)
  let notice = null;
  try {
    const { extraction } = await extractWithAi(deps, [text || '(vedi allegato)'], date, media);
    const result = await applyExtraction(deps, owner, extraction, date);
    const worked = result.saved.length > 0 || result.failed.length > 0;
    if (worked) {
      await replyWithUndo(deps, tg, owner, chatId, '✅ <b>Salvato</b>', result);
    }
    if (extraction.brain_note?.node_label) {
      await createPendingBrain(deps, tg, owner, chatId, extraction.brain_note, text, null);
    } else if (!worked) {
      await tg.send(chatId, `🤔 Non ho individuato nulla da salvare. Hai scritto: <i>${esc(text.slice(0, 200))}</i>`);
    }
    return ok({ ok: true, intent: 'ai_extraction', saved: result.saved.length, failed: result.failed.length });
  } catch (err) {
    if (!(err instanceof Error && err.name === 'GeminiError')) throw err;
    notice = aiUnavailableNote(err);
    if (media.length) {
      await tg.send(chatId, `❌ Per vocali e foto serve l'IA, ma non è disponibile: ${esc(err.message)}\n<b>Non ho salvato nulla.</b>`);
      return ok({ ok: false, error: err.code });
    }
  }

  // 2) Regole semplici (zero token) — con avviso se l'IA era configurata ma non ha risposto
  const body = extractBodyHeuristic(text);
  if (body) {
    const result = await applyExtraction(deps, owner, { body_log: { ...body, date } }, date);
    await replyWithUndo(deps, tg, owner, chatId, `${notice ? `${notice}\n\n` : ''}✅ <b>Registrato in Body</b>`, result);
    return ok({ ok: true, intent: 'body_log', saved: result.saved.length, failed: result.failed.length });
  }

  const g = guessDomain(text);
  const label = text.split(/[:\-–]/)[0].trim();
  const nodeLabel = (text.includes(':') || text.includes('-')) && label.length <= 40 ? label.replace(/^ricetta\s+/i, '').trim() : text.split(/\s+/).slice(0, 3).join(' ');
  await createPendingBrain(deps, tg, owner, chatId, { title: `${g.display}: ${nodeLabel}`, domain: g.domain, domain_display: g.display, domain_emoji: g.emoji, node_label: nodeLabel, node_type: g.nodeType, properties_summary: text, fact_subject: nodeLabel, fact_key: g.domain === 'cucina' ? 'dosi_ottimali' : 'dettagli', fact_value: text }, text, notice);
  return ok({ ok: true, intent: 'new_open_domain' });
}

// ---------------------------------------------------------------------------
// Pulsanti (conferma / ignora / annulla)
// ---------------------------------------------------------------------------

async function confirmBrain(deps, owner, pending) {
  const { supabase } = deps;
  const prop = pending.proposed_payload || {};
  const domain = pending.domain || 'general';

  const mem = must(await supabase.from('brain_memories').insert({
    user_id: owner, title: prop.title || `Nota Telegram (${domain})`, content: prop.raw_text || prop.properties_summary || '', summary: prop.properties_summary || '',
    domain, source_type: 'telegram', tags: [domain, 'telegram'],
  }).select('id').single(), 'Salvataggio memoria');

  if (prop.node_label) {
    const nodes = must(await supabase.from('brain_nodes').select('id, properties').eq('user_id', owner).ilike('label', prop.node_label).eq('node_type', prop.node_type || 'concept').limit(1), 'Lettura nodi');
    if (nodes && nodes.length) {
      must(await supabase.from('brain_nodes').update({ properties: { ...(nodes[0].properties || {}), ...(prop.properties || {}) } }).eq('id', nodes[0].id), 'Aggiornamento nodo');
    } else {
      must(await supabase.from('brain_nodes').insert({ user_id: owner, label: prop.node_label, node_type: prop.node_type || 'concept', properties: prop.properties || {} }).select('id').single(), 'Creazione nodo');
    }
  }

  if (prop.fact_subject && prop.fact_key && prop.fact_value) {
    const prev = must(await supabase.from('brain_facts').select('id').eq('user_id', owner).ilike('subject', prop.fact_subject).ilike('fact_key', prop.fact_key).eq('is_active', true), 'Lettura fatti');
    const fact = must(await supabase.from('brain_facts').insert({
      user_id: owner, subject: prop.fact_subject, fact_key: prop.fact_key, fact_value: prop.fact_value, category: domain, is_active: true, source_memory_id: mem.id,
    }).select('id').single(), 'Salvataggio fatto');
    for (const p of prev || []) {
      if (p.id !== fact.id) must(await supabase.from('brain_facts').update({ is_active: false, superseded_by: fact.id, valid_to: new Date().toISOString() }).eq('id', p.id), 'Storicizzazione fatto');
    }
  }
}

async function handleCallback(deps, tg, cb) {
  const { supabase } = deps;
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  if (!isAuthorized(deps.env, cb.from?.id, chatId)) {
    await tg.answer(cb.id, 'Non autorizzato.');
    return ok({ ok: false, unauthorized: true });
  }
  const owner = await getOwnerId(supabase);
  const [verb, id] = String(cb.data || '').split(':');
  if (!owner || !id) { await tg.answer(cb.id, 'Richiesta non valida.'); return ok({ ok: false }); }

  const found = await supabase.from('telegram_pending_actions').select('*').eq('id', id).eq('user_id', owner).limit(1);
  const pending = found.data?.[0];
  if (!pending || pending.status !== 'pending') {
    await tg.answer(cb.id, 'Richiesta già elaborata o scaduta.');
    return ok({ ok: false, error: 'not_pending' });
  }

  try {
    if (verb === 'reject') {
      must(await supabase.from('telegram_pending_actions').update({ status: 'rejected' }).eq('id', id), 'Aggiornamento richiesta');
      await tg.answer(cb.id, 'Ignorato');
      if (messageId) await tg.edit(chatId, messageId, '❌ <b>Ignorato.</b> Nulla è stato salvato.');
      return ok({ ok: true, status: 'rejected' });
    }
    if (verb === 'confirm') {
      await confirmBrain(deps, owner, pending);
      must(await supabase.from('telegram_pending_actions').update({ status: 'confirmed' }).eq('id', id), 'Aggiornamento richiesta');
      await tg.answer(cb.id, 'Salvato nel Second Brain!');
      if (messageId) await tg.edit(chatId, messageId, `✅ <b>Salvato nel Second Brain!</b>\n• ${esc(pending.proposed_payload?.node_label || '')}`);
      return ok({ ok: true, status: 'confirmed' });
    }
    if (verb === 'undo') {
      const refs = pending.proposed_payload?.refs || [];
      for (const r of refs) must(await supabase.from(r.table).delete().eq('id', r.id).eq('user_id', owner), `Annullamento ${r.table}`);
      must(await supabase.from('telegram_pending_actions').update({ status: 'rejected' }).eq('id', id), 'Aggiornamento richiesta');
      await tg.answer(cb.id, 'Annullato');
      if (messageId) await tg.edit(chatId, messageId, `↩️ <b>Annullato</b>: ${refs.length} inserimenti rimossi. (Le modifiche a dati già esistenti non vengono ripristinate.)`);
      return ok({ ok: true, status: 'undone', removed: refs.length });
    }
  } catch (err) {
    await tg.answer(cb.id, 'Errore');
    if (chatId) await tg.send(chatId, `❌ Operazione non riuscita: ${esc(err.message)}`);
    return ok({ ok: false, error: err.message });
  }
  return ok({ ok: false });
}

// ---------------------------------------------------------------------------
// Ingresso
// ---------------------------------------------------------------------------

export async function handleUpdate(update, deps) {
  const tg = telegram(deps);

  if (update?.action === 'check_status') {
    return ok({ ok: true, configured: Boolean(deps.env.TELEGRAM_BOT_TOKEN && deps.env.TELEGRAM_ALLOWED_USER_ID), has_bot_token: Boolean(deps.env.TELEGRAM_BOT_TOKEN), has_allowed_user: Boolean(deps.env.TELEGRAM_ALLOWED_USER_ID), has_gemini_key: Boolean(deps.env.GEMINI_API_KEY) });
  }
  if (update?.action === 'send_test_message') {
    const chat = deps.env.TELEGRAM_ALLOWED_USER_ID?.split(',')[0]?.trim();
    if (!deps.env.TELEGRAM_BOT_TOKEN || !chat) return { status: 400, body: { ok: false, error: 'Configura TELEGRAM_BOT_TOKEN e TELEGRAM_ALLOWED_USER_ID nei Secrets di Supabase.' } };
    const res = await tg.send(chat, '🟢 <b>Gestionale connesso!</b>\n' + HELP);
    return ok({ ok: Boolean(res?.ok), telegram_response: res });
  }

  const msg = update?.message || update?.edited_message;
  const chatId = msg?.chat?.id || update?.callback_query?.message?.chat?.id;
  try {
    if (update?.callback_query) return await handleCallback(deps, tg, update.callback_query);
    if (msg) return await handleMessage(deps, tg, msg);
    return ok({ ok: true, ignored: true });
  } catch (err) {
    // Paracadute finale: mai lasciare l'utente senza una risposta onesta
    console.error('telegram-webhook:', err);
    if (chatId) await tg.send(chatId, `❌ Errore: ${esc(err.message)}\n<b>Non ho salvato nulla.</b>`).catch(() => {});
    return ok({ ok: false, error: err.message });
  }
}
