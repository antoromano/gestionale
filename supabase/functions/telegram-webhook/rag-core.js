// COPIA GENERATA da src/services/rag-core.js con scripts/sync-edge-shared.mjs: NON modificare qui.
// src/services/rag-core.js
// Motore di "Chiedi a te stesso" (Personal RAG). Codice PURO: nessun accesso a store, DOM, Deno o rete.
// Lo stesso file gira nel browser, nelle Edge Function (app e Telegram) e nei test: chi lo usa gli passa le
// "dipendenze" (come cercare, come leggere i fatti, come chiamare l'IA). Così la risposta è identica ovunque.
//
// Tre fonti:  1) pezzi di documenti e note (ricerca ibrida: significato + parole esatte)
//             2) fatti attivi su di te (regole, preferenze, numeri)
//             3) dati vivi del gestionale, SOLO quelli che gli interruttori privacy consentono
// Due livelli di istruzioni: regole generali + regole dell'ambito della domanda. Nessun addestramento del modello.

export const RAG_DOMAINS = {
  cucina: { label: 'Cucina', icon: '🍳' },
  work: { label: 'Lavoro e carriera', icon: '💼' },
  body: { label: 'Allenamento e salute', icon: '🏋️' },
  tech: { label: 'Tecnica e codice', icon: '⚙️' },
  personal: { label: 'Personale', icon: '🧭' },
};

export const DEFAULT_LIVE_PERMISSIONS = { body: true, todos_calendar: true, clients: false, finances: false };

export const LIVE_SOURCES = {
  body: { label: 'Corpo: diario e allenamenti', icon: '🏋️' },
  todos_calendar: { label: 'Cose da fare e agenda', icon: '✅' },
  clients: { label: 'Clienti e lavori', icon: '🏢' },
  finances: { label: 'Entrate e uscite', icon: '💶' },
};

export const DEFAULT_GLOBAL_INSTRUCTIONS =
  'Rispondi in italiano, in modo diretto e pratico, senza preamboli né convenevoli. ' +
  'Usa numeri concreti quando si parla di soldi, calorie o tempi. ' +
  'Se nelle fonti non c\'è la risposta, dillo chiaramente invece di inventare.';

export const DEFAULT_DOMAIN_RULES = {
  cucina: 'Porzioni per 1 persona, ingredienti reperibili nei supermercati italiani, tempi indicati in minuti.',
  work: 'Valuta sempre il rapporto tra guadagno e ore di lavoro e il rischio di dipendere da un solo cliente.',
  body: 'Rispetta i miei schemi di allenamento e i tempi di recupero che trovi nelle fonti.',
  tech: 'Vai dritto alla soluzione, con esempi brevi. Niente teoria non richiesta.',
  personal: '',
};

/** La data di oggi (AAAA-MM-GG) nel fuso dell'utente: sul server l'ora è UTC, e dopo mezzanotte "oggi" cambierebbe in anticipo. */
export function todayIn(timeZone = 'Europe/Rome', now = new Date()) {
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Profilo completo: i valori mancanti prendono quelli di partenza. Le finanze sono accese SOLO se esplicitamente true. */
export function normalizeProfile(profile = null) {
  const p = profile || {};
  const perms = p.live_data_permissions && typeof p.live_data_permissions === 'object' ? p.live_data_permissions : {};
  const rules = p.domain_rules && typeof p.domain_rules === 'object' ? p.domain_rules : {};
  return {
    global_instructions: typeof p.global_instructions === 'string' && p.global_instructions.trim()
      ? p.global_instructions.trim()
      : DEFAULT_GLOBAL_INSTRUCTIONS,
    domain_rules: Object.fromEntries(Object.keys(RAG_DOMAINS).map(d => [
      d, typeof rules[d] === 'string' ? rules[d].trim() : DEFAULT_DOMAIN_RULES[d],
    ])),
    live_data_permissions: {
      body: perms.body === undefined ? DEFAULT_LIVE_PERMISSIONS.body : perms.body === true,
      todos_calendar: perms.todos_calendar === undefined ? DEFAULT_LIVE_PERMISSIONS.todos_calendar : perms.todos_calendar === true,
      clients: perms.clients === true,
      finances: perms.finances === true,
    },
  };
}

// ---------------------------------------------------------------------------
// Testo: parole, radici, punteggio ibrido
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra',
  'che', 'chi', 'cosa', 'come', 'quando', 'dove', 'perché', 'perche', 'qual', 'quale', 'quali', 'quanto', 'quanti',
  'sono', 'è', 'e', 'ed', 'o', 'ha', 'ho', 'hai', 'hanno', 'suo', 'sua', 'mio', 'mia', 'miei', 'mie', 'del', 'della',
  'dei', 'delle', 'dello', 'degli', 'nel', 'nella', 'nei', 'nelle', 'al', 'allo', 'alla', 'ai', 'agli', 'alle', 'dal',
  'dalla', 'sul', 'sulla', 'ma', 'se', 'non', 'mi', 'ti', 'si', 'ci', 'vi', 'me', 'te', 'questo', 'questa', 'questi',
  'queste', 'quello', 'quella', 'posso', 'puoi', 'può', 'devo', 'voglio', 'vorrei', 'fare', 'fatto', 'avevo', 'avevamo',
  'essere', 'avere', 'più', 'piu', 'anche', 'già', 'gia', 'oggi', 'ieri', 'poi', 'così', 'cosi', 'molto', 'poco',
]);

/** Radice "alla buona" per l'italiano: toglie la vocale finale (ricetta/ricette, cliente/clienti). */
export function stem(word) {
  return word.length > 3 ? word.replace(/[aeiouàèéìòù]+$/u, '') : word;
}

export function tokenize(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s._-]/gu, ' ')
    .split(/[\s._-]+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t))
    .map(stem);
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  return den === 0 ? 0 : dot / den;
}

/** Quota di parole della domanda che compaiono (come parole intere) nel testo: 0..1. */
export function lexicalScore(queryText, text) {
  const q = [...new Set(tokenize(queryText))];
  if (q.length === 0) return 0;
  const words = new Set(tokenize(text));
  let hit = 0;
  for (const t of q) if (words.has(t)) hit++;
  return hit / q.length;
}

/**
 * Punteggio unico: 70% significato (vettori della stessa sorgente) + 30% parole esatte.
 * Stessa formula della funzione SQL match_brain_memories_hybrid (migration 010).
 */
export function hybridScore({ queryEmbedding = null, queryText = '', embedding = null, text = '' }) {
  const similarity = queryEmbedding && embedding ? cosine(queryEmbedding, embedding) : 0;
  const lexical = lexicalScore(queryText, text);
  return { similarity, lexical, score: similarity * 0.7 + lexical * 0.3 };
}

/**
 * Ricerca ibrida su un elenco di memorie in memoria (uso locale e test). Sul cloud la fa il database.
 * @param {Array} memories righe con { id, title, content, embedding, embedding_source, document_id, chunk_index, ... }
 */
export function searchMemoriesLocal(memories, { embedding = null, source = null, text = '', limit = 8, threshold = 0.35, documents = [] } = {}) {
  const docs = new Map(documents.map(d => [d.id, d]));
  const out = [];
  for (const m of memories) {
    if (!m || m.is_deleted) continue;
    const doc = m.document_id ? docs.get(m.document_id) : null;
    if (m.document_id && doc?.is_deleted) continue;
    const sameSource = embedding && Array.isArray(m.embedding) && (m.embedding_source || 'local') === (source || 'local');
    const s = hybridScore({ queryEmbedding: sameSource ? embedding : null, queryText: text, embedding: sameSource ? m.embedding : null, text: `${m.title || ''} ${m.content || ''}` });
    if (!(s.similarity > threshold || s.lexical > 0)) continue;
    out.push({
      id: m.id, document_id: m.document_id || null, chunk_index: m.chunk_index || 0, title: m.title || '', content: m.content || '',
      domain: m.domain, source_type: m.source_type, source_date: m.source_date || doc?.original_date || null, created_at: m.created_at,
      document_title: doc?.title || null, document_provider: doc?.source_provider || null,
      similarity: s.similarity, lexical_rank: s.lexical, score: s.score,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Ambito della domanda (per scegliere il "cappello" di regole)
// ---------------------------------------------------------------------------

const DOMAIN_HINTS = {
  cucina: ['cucin', 'ricett', 'mangi', 'cena', 'pranz', 'colazion', 'ingredient', 'forno', 'padell', 'piatt', 'spesa al', 'supermercat', 'cuocer', 'pasto', 'pasti'],
  body: ['allen', 'palestr', 'kcal', 'calori', 'protein', 'macro', 'peso corpore', 'sonno', 'recuper', 'ripetizion', 'trazion', 'squat', 'panca', 'massa muscol', 'dimagr', 'corsa', 'scheda', 'workout'],
  work: ['client', 'preventiv', 'fattur', 'trattativ', 'negozi', 'tariff', 'carrier', 'lavoro', 'contratt', 'freelanc', 'collabor', 'offerta', 'colloqui', 'stipendi', 'progetto', 'compenso'],
  tech: ['codice', 'bug', 'deploy', 'server', 'database', 'api ', 'javascript', 'python', 'react', 'supabase', 'architettur', 'script', 'docker', 'framework', 'libreria', 'query', 'funzione'],
};

/** Ambito della domanda dalle parole chiave. Nessuna parola riconosciuta → 'personal'. */
export function detectDomain(question = '') {
  const q = ` ${String(question).toLowerCase()} `;
  let best = 'personal';
  let bestScore = 0;
  for (const [domain, hints] of Object.entries(DOMAIN_HINTS)) {
    const score = hints.reduce((n, h) => n + (q.includes(h) ? 1 : 0), 0);
    if (score > bestScore) {
      best = domain;
      bestScore = score;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Fonte 2: fatti attivi pertinenti
// ---------------------------------------------------------------------------

/** Regole e preferenze valgono sempre; gli altri fatti entrano se c'entrano con la domanda. */
export function selectRelevantFacts(facts = [], question = '', { maxAlways = 25, maxMatched = 15 } = {}) {
  const active = facts.filter(f => f && !f.is_deleted && f.is_active !== false);
  const qTokens = new Set(tokenize(question));
  const always = [];
  const matched = [];
  for (const f of active) {
    const cat = String(f.category || '').toLowerCase();
    if (cat === 'rule' || cat === 'preference') {
      always.push(f);
      continue;
    }
    const tokens = tokenize(`${f.subject} ${String(f.fact_key || '').replace(/_/g, ' ')} ${f.fact_value}`);
    if (tokens.some(t => qTokens.has(t))) matched.push(f);
  }
  const byRecent = (a, b) => String(b.valid_from || b.created_at || '').localeCompare(String(a.valid_from || a.created_at || ''));
  return [...always.sort(byRecent).slice(0, maxAlways), ...matched.sort(byRecent).slice(0, maxMatched)];
}

// ---------------------------------------------------------------------------
// Fonte 3: dati vivi del gestionale (solo quelli consentiti)
// ---------------------------------------------------------------------------

const day = (v) => String(v || '').slice(0, 10);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const eur = (v) => `${(Number(v) || 0).toLocaleString('it-IT', { maximumFractionDigits: 2 })} €`;

/**
 * Trasforma i dati grezzi del gestionale in sezioni di testo per l'IA.
 * Una sezione esiste SOLO se il suo interruttore è acceso: con `finances: false` i movimenti non arrivano mai al modello.
 * @param {object} raw { dailyLogs, workouts, columns, todos, appointments, clients, quotes, transactions, tradingItems }
 * @returns {Array<{kind:string, label:string, text:string}>}
 */
export function buildLiveSections(raw = {}, permissions = DEFAULT_LIVE_PERMISSIONS, { today = todayIn() } = {}) {
  const perms = normalizeProfile({ live_data_permissions: permissions }).live_data_permissions;
  const sections = [];
  const alive = (list) => (Array.isArray(list) ? list.filter(x => x && !x.is_deleted) : []);

  if (perms.body) {
    const lines = [];
    const log = alive(raw.dailyLogs).find(l => day(l.date) === today);
    if (log) {
      const bits = [];
      if (num(log.calories_kcal) !== null) bits.push(`${log.calories_kcal} kcal`);
      if (num(log.protein_g) !== null) bits.push(`${log.protein_g} g proteine`);
      if (num(log.carbs_g) !== null) bits.push(`${log.carbs_g} g carboidrati`);
      if (num(log.fat_g) !== null) bits.push(`${log.fat_g} g grassi`);
      if (num(log.body_weight_kg) !== null) bits.push(`peso ${log.body_weight_kg} kg`);
      if (num(log.sleep_hours) !== null) bits.push(`sonno ${log.sleep_hours} h`);
      if (log.is_rest_day) bits.push('giorno di riposo');
      lines.push(`Oggi (${today}), registrato finora: ${bits.join(', ') || 'nessun valore'}.${log.general_notes ? ` Note: ${log.general_notes}` : ''}`);
    } else {
      lines.push(`Oggi (${today}) non è ancora stato registrato nulla nel diario (calorie, peso, sonno).`);
    }
    const cols = new Map(alive(raw.columns).map(c => [c.id, c.name]));
    const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
    const recent = alive(raw.workouts).filter(w => day(w.date) >= weekAgo && day(w.date) <= today).sort((a, b) => day(b.date).localeCompare(day(a.date))).slice(0, 20);
    if (recent.length) {
      lines.push('Allenamenti degli ultimi 7 giorni:');
      for (const w of recent) lines.push(`- ${day(w.date)} ${cols.get(w.column_id) || 'Esercizio'}: ${w.raw_notation || ''}${w.rpe ? ` (RPE ${w.rpe})` : ''}`);
    } else {
      lines.push('Nessun allenamento registrato negli ultimi 7 giorni.');
    }
    sections.push({ kind: 'body', label: `${LIVE_SOURCES.body.icon} Diario corpo di oggi e ultimi allenamenti`, text: lines.join('\n') });
  }

  if (perms.todos_calendar) {
    const lines = [];
    const open = alive(raw.todos).filter(t => !t.is_completed).sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'))).slice(0, 15);
    lines.push(open.length ? 'Cose da fare aperte:' : 'Nessuna cosa da fare aperta.');
    for (const t of open) lines.push(`- ${t.title}${t.due_date ? ` (scadenza ${String(t.due_date).slice(0, 16).replace('T', ' ')})` : ''}${t.priority && t.priority !== 'media' ? ` [${t.priority}]` : ''}`);
    const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + 14 * 86400000).toISOString().slice(0, 10);
    const appts = alive(raw.appointments).filter(a => day(a.start_time) >= today && day(a.start_time) <= horizon).sort((a, b) => String(a.start_time).localeCompare(String(b.start_time))).slice(0, 10);
    lines.push(appts.length ? 'Impegni dei prossimi 14 giorni:' : 'Nessun impegno in agenda nei prossimi 14 giorni.');
    for (const a of appts) lines.push(`- ${String(a.start_time).slice(0, 16).replace('T', ' ')} ${a.title}${a.location ? ` (${a.location})` : ''}`);
    sections.push({ kind: 'todos_calendar', label: `${LIVE_SOURCES.todos_calendar.icon} Cose da fare e agenda`, text: lines.join('\n') });
  }

  if (perms.clients) {
    const lines = [];
    const clients = alive(raw.clients).slice(0, 40);
    lines.push(clients.length ? 'Clienti:' : 'Nessun cliente registrato.');
    for (const c of clients) {
      const name = c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Cliente';
      const contracts = Array.isArray(c.maintenance_contracts) ? c.maintenance_contracts.filter(k => k.status === 'active') : [];
      const mrr = contracts.reduce((s, k) => s + (Number(k.amount) || 0) / (k.frequency === 'annual' ? 12 : k.frequency === 'quarterly' ? 3 : 1), 0);
      lines.push(`- ${name}${c.stack ? ` — stack: ${c.stack}` : ''}${mrr > 0 ? ` — canone ricorrente ${eur(mrr)}/mese` : ''}${c.notes ? ` — note: ${String(c.notes).slice(0, 160)}` : ''}`);
    }
    const names = new Map(clients.map(c => [c.id, c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim()]));
    const quotes = alive(raw.quotes).filter(q => q.status !== 'rifiutato').slice(0, 20);
    if (quotes.length) {
      lines.push('Preventivi e lavori:');
      for (const q of quotes) lines.push(`- ${q.title} (${names.get(q.client_id) || 'cliente non indicato'}): ${eur(q.agreed_total)} — ${q.status}${q.work_status ? `, lavoro: ${q.work_status}` : ''}`);
    }
    sections.push({ kind: 'clients', label: `${LIVE_SOURCES.clients.icon} Clienti e lavori`, text: lines.join('\n') });
  }

  if (perms.finances) {
    const lines = [];
    const month = today.slice(0, 7);
    const tx = alive(raw.transactions);
    const inMonth = tx.filter(t => day(t.date).startsWith(month));
    const income = inMonth.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const expense = inMonth.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    lines.push(`Mese in corso (${month}): entrate ${eur(income)}, uscite ${eur(expense)}, saldo ${eur(income - expense)}.`);
    const last = [...tx].sort((a, b) => day(b.date).localeCompare(day(a.date))).slice(0, 15);
    if (last.length) {
      lines.push('Ultimi movimenti:');
      for (const t of last) lines.push(`- ${day(t.date)} ${t.type === 'income' ? '+' : '-'}${eur(t.amount)} ${t.description || ''}${t.category ? ` [${t.category}]` : ''}`);
    }
    const stock = alive(raw.tradingItems).filter(i => i.status === 'in_stock');
    if (stock.length) lines.push(`Compravendita: ${stock.length} articoli in magazzino, costo totale ${eur(stock.reduce((s, i) => s + (Number(i.purchase_price) || 0), 0))}.`);
    sections.push({ kind: 'finances', label: `${LIVE_SOURCES.finances.icon} Entrate e uscite`, text: lines.join('\n') });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Etichette delle fonti (quelle che l'utente vede sotto la risposta)
// ---------------------------------------------------------------------------

const monthOf = (v) => (v ? String(v).slice(0, 7) : '');

export function chunkLabel(c) {
  const date = monthOf(c.source_date || c.created_at);
  if (c.document_id) return `📄 ${c.document_title || c.title || 'Documento'}${date ? ` (${date})` : ''} • pezzo #${(c.chunk_index || 0) + 1}`;
  return `🗒️ Nota: ${c.title || String(c.content || '').slice(0, 40)}${date ? ` (${date})` : ''}`;
}

export function factLabel(f) {
  return `📌 Fatto: ${f.fact_key} = ${f.fact_value}`;
}

// ---------------------------------------------------------------------------
// Prompt a strati
// ---------------------------------------------------------------------------

const clip = (text, max) => {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

/**
 * Costruisce le istruzioni per il modello: regole generali + regole dell'ambito + fonti numerate.
 * @returns {{system:string, index:Record<string, object>}} `index` collega ogni sigla ([S1], [F2], [L1]) alla sua fonte
 */
export function buildRagPrompt({ profile, domain, chunks = [], facts = [], live = [], today = todayIn() }) {
  const p = normalizeProfile(profile);
  const index = {};
  const parts = [];

  parts.push(
    'Sei l\'assistente personale di chi ti scrive. Conosci la sua vita SOLO attraverso le FONTI elencate sotto ' +
    '(suoi documenti e vecchie conversazioni, fatti che ha salvato, dati di oggi del suo gestionale) e ciò che dice in questa conversazione.\n' +
    'Regole fisse:\n' +
    '- Rispondi usando le fonti. Se le fonti non bastano, dillo e spiega cosa manca: non inventare dati personali.\n' +
    '- Puoi usare la tua cultura generale per ragionare (es. valori nutrizionali, buone pratiche), ma distingui ciò che viene dalle sue fonti.\n' +
    '- Nei pezzi di vecchie chat, le frasi dell\'assistente sono consigli ricevuti, non fatti su di lui.\n' +
    '- Se due fonti si contraddicono, vale la più recente e lo segnali.\n' +
    `- Oggi è ${today}.`,
  );

  parts.push(`## Come rispondere (regole generali)\n${p.global_instructions}`);

  const rule = p.domain_rules[domain];
  if (rule) parts.push(`## Regole per l'ambito «${RAG_DOMAINS[domain]?.label || domain}»\n${rule}`);

  const src = ['## FONTI'];
  if (chunks.length) {
    src.push('### Documenti, vecchie chat e note');
    chunks.forEach((c, i) => {
      const id = `S${i + 1}`;
      index[id] = { id, type: 'chunk', label: chunkLabel(c), memory_id: c.id, document_id: c.document_id || null, chunk_index: c.chunk_index || 0, title: c.document_title || c.title || '', date: c.source_date || c.created_at || null, text: c.content || '' };
      src.push(`[${id}] ${chunkLabel(c)}\n${clip(c.content, 2400)}`);
    });
  }
  if (facts.length) {
    src.push('### Fatti e regole salvati');
    facts.forEach((f, i) => {
      const id = `F${i + 1}`;
      index[id] = { id, type: 'fact', label: factLabel(f), fact_id: f.id, text: `${f.subject} — ${f.fact_key}: ${f.fact_value}`, date: f.valid_from || f.created_at || null };
      src.push(`[${id}] ${f.subject} — ${String(f.fact_key).replace(/_/g, ' ')}: ${f.fact_value}${f.valid_from ? ` (dal ${day(f.valid_from)})` : ''}`);
    });
  }
  if (live.length) {
    src.push('### Dati di oggi dal gestionale');
    live.forEach((l, i) => {
      const id = `L${i + 1}`;
      index[id] = { id, type: 'live', kind: l.kind, label: l.label, text: l.text };
      src.push(`[${id}] ${l.label}\n${clip(l.text, 3000)}`);
    });
  }
  if (src.length === 1) src.push('(nessuna fonte trovata per questa domanda)');
  parts.push(src.join('\n\n'));

  parts.push(
    '## Formato della risposta\n' +
    'Restituisci SOLO un oggetto JSON:\n' +
    '{"answer": "la risposta in testo semplice, senza sigle delle fonti dentro", ' +
    '"used_sources": ["S1", "F2", "L1"], ' +
    '"suggested_rule": null}\n' +
    '- "used_sources": le sigle delle fonti che hai DAVVERO usato (lista vuota se nessuna).\n' +
    '- "suggested_rule": se in questo scambio l\'utente ha preso una nuova decisione o regola stabile su di sé ' +
    '(es. "da questa settimana niente latticini a pranzo"), proponila come ' +
    '{"subject": "...", "fact_key": "chiave_snake_case", "fact_value": "...", "category": "rule"}; altrimenti null.',
  );

  return { system: parts.join('\n\n'), index };
}

/** La conversazione fin qui + la nuova domanda, come un unico testo per il modello. */
export function buildUserTurn(question, history = []) {
  const recent = (Array.isArray(history) ? history : []).filter(h => h && h.content).slice(-8);
  if (recent.length === 0) return String(question);
  const lines = recent.map(h => `${h.role === 'assistant' ? 'Assistente' : 'Io'}: ${clip(h.content, 1500)}`);
  return `Conversazione finora:\n${lines.join('\n')}\n\nNuova domanda: ${question}`;
}

/** Testo usato per cercare: una domanda corta di seguito ("e con il riso?") si porta dietro la precedente. */
export function retrievalQuery(question, history = []) {
  const q = String(question || '').trim();
  if (q.length >= 40) return q;
  const prevUser = [...(history || [])].reverse().find(h => h && h.role === 'user' && h.content);
  return prevUser ? `${prevUser.content} ${q}`.slice(0, 600) : q;
}

// ---------------------------------------------------------------------------
// Il motore
// ---------------------------------------------------------------------------

/**
 * @param {object} args
 * @param {string} args.question
 * @param {Array<{role:'user'|'assistant', content:string}>} [args.history]
 * @param {string|null} [args.domain] ambito forzato; null = lo deduce dalla domanda
 * @param {object} args.deps
 * @param {() => Promise<object|null>} args.deps.getProfile
 * @param {(text:string) => Promise<{values:number[], source:string}|null>} args.deps.embed
 * @param {(q:{embedding:number[]|null, source:string|null, text:string, limit:number}) => Promise<Array>} args.deps.searchChunks
 * @param {() => Promise<Array>} args.deps.getFacts
 * @param {(permissions:object) => Promise<object>} args.deps.getLiveData
 * @param {(p:{system:string, parts:Array, json:boolean, temperature:number}) => Promise<{data:any, model?:string, provider?:string}>} args.deps.generate
 */
export async function askRag({ question, history = [], domain = null, deps, today = todayIn() }) {
  const q = String(question || '').trim();
  if (!q) throw new Error('Scrivi una domanda.');

  const profile = normalizeProfile(await deps.getProfile());
  const dom = domain && RAG_DOMAINS[domain] ? domain : detectDomain(q);
  const searchText = retrievalQuery(q, history);

  let emb = null;
  let embeddingError = null;
  try {
    emb = await deps.embed(searchText);
  } catch (err) {
    embeddingError = err?.message || String(err); // si prosegue con le sole parole esatte
  }

  const chunks = await deps.searchChunks({ embedding: emb?.values || null, source: emb?.source || null, text: searchText, limit: 8 });
  const facts = selectRelevantFacts(await deps.getFacts(), searchText);
  const live = buildLiveSections(await deps.getLiveData(profile.live_data_permissions), profile.live_data_permissions, { today });

  const { system, index } = buildRagPrompt({ profile, domain: dom, chunks, facts, live, today });
  const res = await deps.generate({ system, parts: [{ text: buildUserTurn(q, history) }], json: true, temperature: 0.3, maxTokens: 3000, budgetMs: 45000 });

  const data = res?.data && typeof res.data === 'object' ? res.data : { answer: String(res?.data || '') };
  const answer = String(data.answer || '').trim();
  if (!answer) throw new Error('L\'IA ha risposto senza testo. Riprova.');

  const used = Array.isArray(data.used_sources) ? data.used_sources.map(s => String(s).replace(/[[\]\s]/g, '')) : [];
  const sources = [...new Set(used)].map(id => index[id]).filter(Boolean);

  const sr = data.suggested_rule;
  const suggestedRule = sr && typeof sr === 'object' && sr.fact_key && sr.fact_value
    ? { subject: String(sr.subject || 'Io'), fact_key: String(sr.fact_key), fact_value: String(sr.fact_value), category: String(sr.category || 'rule') }
    : null;

  return {
    answer,
    sources,
    domain: dom,
    suggestedRule,
    model: res?.model || null,
    provider: res?.provider || null,
    context: { chunks: chunks.length, facts: facts.length, live: live.map(l => l.kind), embeddingSource: emb?.source || null, embeddingError },
  };
}

/** Risposta in testo semplice con le fonti in fondo (Telegram). */
export function formatAnswerText(result) {
  const lines = [result.answer];
  if (result.sources?.length) {
    lines.push('', 'Fonti usate:');
    for (const s of result.sources) lines.push(`• ${s.label}`);
  } else {
    lines.push('', 'Fonti usate: nessuna (risposta senza dati dal tuo archivio).');
  }
  return lines.join('\n');
}
