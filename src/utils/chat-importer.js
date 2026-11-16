// src/utils/chat-importer.js
// Lettura di vecchie chat (ChatGPT, Claude, Gemini) e documenti, pulizia dei convenevoli, divisione in "pezzi"
// per la ricerca, stima dei costi e controllo dei fatti estratti. Codice PURO: niente rete, niente store, niente DOM.
//
// Tre regole che questo file garantisce con il codice, non con la buona volontà del modello:
//   1. Il contenuto utile non si butta: si tolgono solo le frasi di cortesia, il resto resta parola per parola.
//   2. I fatti su di te valgono solo se li hai scritti TU: ogni fatto deve citare una tua frase, e la citazione
//      viene cercata davvero nei tuoi messaggi. Se non c'è, il fatto si scarta.
//   3. Ogni chat porta la sua data vera, così un'informazione vecchia non scavalca una più recente.

import { detectDomain } from '../services/rag-core.js';

// ---------------------------------------------------------------------------
// Lettura degli export
// ---------------------------------------------------------------------------

const toIso = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const ms = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

const textOfParts = (parts) => (Array.isArray(parts) ? parts : [])
  .map(p => (typeof p === 'string' ? p : (p && typeof p.text === 'string' ? p.text : '')))
  .filter(Boolean)
  .join('\n')
  .trim();

/**
 * Export ufficiale di ChatGPT (conversations.json). Ogni chat è un albero (`mapping`): le risposte rigenerate
 * creano rami. Si segue il ramo attivo, dall'ultimo messaggio (`current_node`) risalendo fino all'inizio.
 */
export function parseChatGptExport(json) {
  const list = Array.isArray(json) ? json : (Array.isArray(json?.conversations) ? json.conversations : []);
  const out = [];
  for (const conv of list) {
    if (!conv || typeof conv.mapping !== 'object' || !conv.mapping) continue;
    const mapping = conv.mapping;
    let nodeId = conv.current_node && mapping[conv.current_node] ? conv.current_node : null;
    if (!nodeId) {
      // nessun puntatore: si prende la foglia con il messaggio più recente
      const leaves = Object.values(mapping).filter(n => n && (!n.children || n.children.length === 0));
      leaves.sort((a, b) => (b.message?.create_time || 0) - (a.message?.create_time || 0));
      nodeId = leaves[0]?.id || null;
    }
    const chain = [];
    const seen = new Set();
    while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
      seen.add(nodeId);
      chain.push(mapping[nodeId]);
      nodeId = mapping[nodeId].parent;
    }
    chain.reverse();

    const messages = [];
    for (const node of chain) {
      const m = node.message;
      if (!m) continue;
      const role = m.author?.role;
      if (role !== 'user' && role !== 'assistant') continue; // via istruzioni di sistema e strumenti
      if (m.metadata?.is_visually_hidden_from_conversation) continue;
      const type = m.content?.content_type;
      if (type && type !== 'text' && type !== 'multimodal_text') continue; // via codice eseguito, ragionamenti, ecc.
      const text = textOfParts(m.content?.parts);
      if (!text) continue;
      messages.push({ role, text, date: toIso(m.create_time) });
    }
    if (messages.length === 0) continue;
    out.push({
      provider: 'chatgpt',
      external_id: String(conv.conversation_id || conv.id || ''),
      title: String(conv.title || 'Chat senza titolo').trim(),
      date: toIso(conv.create_time) || messages[0].date,
      messages,
    });
  }
  return out;
}

/** Export ufficiale di Claude (conversations.json): elenco di chat con `chat_messages`. */
export function parseClaudeExport(json) {
  const list = Array.isArray(json) ? json : [];
  const out = [];
  for (const conv of list) {
    if (!conv || !Array.isArray(conv.chat_messages)) continue;
    const messages = [];
    for (const m of conv.chat_messages) {
      const role = m.sender === 'human' ? 'user' : (m.sender === 'assistant' ? 'assistant' : null);
      if (!role) continue;
      let text = typeof m.text === 'string' ? m.text.trim() : '';
      if (!text && Array.isArray(m.content)) {
        text = m.content.filter(c => c && c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n').trim();
      }
      if (!text) continue;
      messages.push({ role, text, date: toIso(m.created_at) });
    }
    if (messages.length === 0) continue;
    out.push({
      provider: 'claude',
      external_id: String(conv.uuid || ''),
      title: String(conv.name || 'Chat senza titolo').trim() || 'Chat senza titolo',
      date: toIso(conv.created_at) || messages[0].date,
      messages,
    });
  }
  return out;
}

const stripHtml = (html) => String(html || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
  .replace(/<li[^>]*>/gi, '- ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\n{3,}/g, '\n\n')
  .trim();

/**
 * Gemini tramite Google Takeout ("Le mie attività" → Gemini, file JSON). Lì ogni domanda è un'attività a sé,
 * senza il raggruppamento in chat: si raggruppano per giorno. Formato dedotto dalla struttura di Takeout,
 * non verificato su tutti gli export: se il file non corrisponde, la funzione restituisce un elenco vuoto.
 */
export function parseGeminiExport(json) {
  const list = Array.isArray(json) ? json : [];
  const isActivity = (a) => a && typeof a.title === 'string' && (a.time || a.header) && (Array.isArray(a.safeHtmlItem) || Array.isArray(a.products) || a.header);
  if (!list.some(isActivity)) return [];
  const byDay = new Map();
  for (const a of list) {
    if (!isActivity(a)) continue;
    const date = toIso(a.time);
    const prompt = a.title.replace(/^(prompted|hai chiesto|hai scritto|asked|said)\s*:?\s*/i, '').trim();
    const answer = stripHtml((a.safeHtmlItem || []).map(x => x?.html || '').join('\n'));
    if (!prompt) continue;
    const dayKey = (date || '').slice(0, 10) || 'senza-data';
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey).push({ date, prompt, answer });
  }
  const out = [];
  for (const [dayKey, items] of byDay) {
    items.sort((x, y) => String(x.date).localeCompare(String(y.date)));
    const messages = [];
    for (const it of items) {
      messages.push({ role: 'user', text: it.prompt, date: it.date });
      if (it.answer) messages.push({ role: 'assistant', text: it.answer, date: it.date });
    }
    out.push({
      provider: 'gemini',
      external_id: `takeout-${dayKey}`,
      title: `Gemini — ${dayKey}: ${items[0].prompt.slice(0, 50)}`,
      date: items[0].date,
      messages,
    });
  }
  return out;
}

/** JSON generico: { messages: [{role, content}] } oppure direttamente un elenco di messaggi. */
function parseGenericJson(json, fileName) {
  const raw = Array.isArray(json?.messages) ? json.messages : (Array.isArray(json) ? json : null);
  if (!raw) return [];
  const messages = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const r = String(m.role || m.author || m.sender || '').toLowerCase();
    const role = /^(user|human|utente|io)$/.test(r) ? 'user' : (/^(assistant|model|ai|bot|gemini|chatgpt|claude)$/.test(r) ? 'assistant' : null);
    const text = typeof m.content === 'string' ? m.content : (typeof m.text === 'string' ? m.text : textOfParts(m.parts));
    if (!role || !text || !text.trim()) continue;
    messages.push({ role, text: text.trim(), date: toIso(m.created_at || m.create_time || m.timestamp || m.time) });
  }
  if (messages.length === 0) return [];
  return [{
    provider: 'manual',
    external_id: '',
    title: String(json?.title || json?.name || fileName || 'Chat importata').replace(/\.json$/i, ''),
    date: toIso(json?.created_at || json?.create_time) || messages[0].date,
    messages,
  }];
}

/**
 * Riconosce il tipo di file dal contenuto e lo legge.
 * @returns {{kind:'chatgpt'|'claude'|'gemini'|'json'|'markdown'|'text', items:Array, warnings:string[]}}
 *   Ogni elemento è una chat ({messages}) oppure un documento ({text}).
 */
export function parseImportFile(fileName, content, { lastModified = null } = {}) {
  const name = String(fileName || 'file');
  const lower = name.toLowerCase();
  const warnings = [];

  if (lower.endsWith('.json')) {
    let json;
    try {
      json = JSON.parse(content);
    } catch {
      return { kind: 'json', items: [], warnings: [`"${name}" non è un file JSON leggibile.`] };
    }
    const list = Array.isArray(json) ? json : (Array.isArray(json?.conversations) ? json.conversations : null);
    if (list && list.some(c => c && c.mapping)) return { kind: 'chatgpt', items: parseChatGptExport(list), warnings };
    if (list && list.some(c => c && Array.isArray(c.chat_messages))) return { kind: 'claude', items: parseClaudeExport(list), warnings };
    const gemini = parseGeminiExport(json);
    if (gemini.length) {
      warnings.push('Export di Gemini: Google non raggruppa le domande in chat, quindi le ho raggruppate per giorno.');
      return { kind: 'gemini', items: gemini, warnings };
    }
    const generic = parseGenericJson(json, name);
    if (generic.length) return { kind: 'json', items: generic, warnings };
    return { kind: 'json', items: [], warnings: [`Non riconosco il formato di "${name}". Formati letti: export di ChatGPT, Claude e Gemini (Takeout).`] };
  }

  const text = String(content || '').replace(/\r\n/g, '\n').trim();
  if (!text) return { kind: 'text', items: [], warnings: [`"${name}" è vuoto.`] };
  const provider = lower.endsWith('.md') || lower.endsWith('.markdown') ? 'markdown' : 'text';
  return {
    kind: provider,
    items: [{ provider, external_id: '', title: name.replace(/\.(md|markdown|txt)$/i, ''), date: toIso(lastModified), text }],
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Regola 1 — pulizia: via solo i convenevoli
// ---------------------------------------------------------------------------

const OPENERS = /^(certo|certamente|assolutamente|volentieri|ottima domanda|bella domanda|ottimo|perfetto|capito|va bene|ok|sì|si|ecco|ciao|grazie per|sure|certainly|of course|absolutely|great question|got it|here('s| is| are))\b/i;
const CLOSERS = /(spero (che |di )|fammi sapere|se hai (altre |ulteriori )?(domande|dubbi)|non esitare|posso aiutarti|vuoi che |ti serve altro|buon(a)? (lavoro|fortuna|appetito|allenamento|giornata|serata)|in bocca al lupo|let me know|hope this helps|feel free to|happy to help|would you like me to)/i;

/**
 * Toglie dalla risposta dell'assistente SOLO la frase di apertura di cortesia ("Certo! Ecco 10 idee:") e la chiusa
 * ("Spero di esserti stato utile!"). Ricette, tabelle, schede, codice e spiegazioni restano identici.
 */
export function cleanAssistantText(text = '') {
  const paragraphs = String(text).replace(/\r\n/g, '\n').split(/\n{2,}/);
  if (paragraphs.length === 0) return '';

  const isContent = (p) => /^\s*([-*•|#>]|\d+[.)]|```)/m.test(p) || p.includes('\n');
  const first = paragraphs[0].trim();
  if (paragraphs.length > 1 && first.length <= 180 && OPENERS.test(first) && !isContent(first)) paragraphs.shift();

  // l'apertura può stare sulla stessa riga del contenuto ("Certo! Ecco la ricetta: ...") → si toglie solo "Certo!"
  if (paragraphs.length > 0) {
    paragraphs[0] = paragraphs[0].replace(/^(certo|certamente|assolutamente|volentieri|ottima domanda|bella domanda|sure|certainly|of course|absolutely|great question)\s*[!.,:;]+\s*/i, '');
  }

  while (paragraphs.length > 1) {
    const last = paragraphs[paragraphs.length - 1].trim();
    if (last.length <= 260 && CLOSERS.test(last) && !isContent(last)) paragraphs.pop();
    else break;
  }
  return paragraphs.join('\n\n').trim();
}

/** Testo ripulito di una chat: i tuoi messaggi interi, le risposte dell'assistente senza convenevoli. */
export function conversationToCleanText(conv) {
  const blocks = [];
  for (const m of conv.messages || []) {
    const text = m.role === 'assistant' ? cleanAssistantText(m.text) : String(m.text || '').trim();
    if (!text) continue;
    blocks.push(`${m.role === 'assistant' ? '[Assistente]' : '[Io]'} ${text}`);
  }
  return blocks.join('\n\n');
}

/** Testo pronto per l'archivio, qualunque sia il tipo di elemento (chat o documento). */
export function itemToCleanText(item) {
  return Array.isArray(item.messages) ? conversationToCleanText(item) : String(item.text || '').replace(/\r\n/g, '\n').trim();
}

/** Solo ciò che hai scritto tu (chat: i tuoi messaggi; documento: tutto il testo, perché è tuo). */
export function authorText(item) {
  if (Array.isArray(item.messages)) return item.messages.filter(m => m.role === 'user').map(m => m.text).join('\n\n');
  return String(item.text || '');
}

// ---------------------------------------------------------------------------
// Divisione in pezzi (~400-500 token, con una piccola sovrapposizione)
// ---------------------------------------------------------------------------

const CHARS_PER_TOKEN = 3.6; // italiano: in media poco meno di 4 caratteri per token
export const estimateTokens = (text) => Math.ceil(String(text || '').length / CHARS_PER_TOKEN);

function splitLong(block, maxChars) {
  // un blocco troppo lungo si spezza a fine frase (o a fine riga), mai a metà parola
  const out = [];
  let rest = block;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    let cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
    if (cut < maxChars * 0.4) cut = window.lastIndexOf(' ');
    if (cut < maxChars * 0.4) cut = maxChars - 1;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1);
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

/**
 * Divide il testo in pezzi logici. Rispetta i paragrafi, tiene insieme i blocchi di codice, e fa iniziare ogni
 * pezzo con la coda del precedente (così una frase a cavallo non resta senza contesto).
 * @returns {string[]}
 */
export function chunkText(text, { targetTokens = 450, overlapTokens = 50 } = {}) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  const maxChars = Math.round(targetTokens * CHARS_PER_TOKEN);
  const overlapChars = Math.round(overlapTokens * CHARS_PER_TOKEN);

  // paragrafi, ricongiungendo quelli dentro un blocco di codice ``` … ```
  const rawParas = clean.split(/\n{2,}/);
  const paras = [];
  let fence = null;
  for (const p of rawParas) {
    const ticks = (p.match(/```/g) || []).length;
    if (fence !== null) {
      fence += `\n\n${p}`;
      if (ticks % 2 === 1) { paras.push(fence); fence = null; }
    } else if (ticks % 2 === 1) {
      fence = p;
    } else {
      paras.push(p);
    }
  }
  if (fence !== null) paras.push(fence);

  const blocks = paras.flatMap(p => (p.length > maxChars ? splitLong(p, maxChars) : [p.trim()])).filter(Boolean);

  const chunks = [];
  let current = '';
  for (const block of blocks) {
    if (current && current.length + block.length + 2 > maxChars) {
      chunks.push(current);
      // coda del pezzo precedente, tagliata all'inizio di una frase o di una riga
      let tail = current.slice(-overlapChars);
      const nl = tail.search(/[\n.!?]\s/);
      if (nl !== -1 && nl < tail.length - 20) tail = tail.slice(nl + 1);
      current = `${tail.trim()}\n\n${block}`.trim();
      if (current.length > maxChars * 1.25) current = block; // la sovrapposizione non deve gonfiare il pezzo
    } else {
      current = current ? `${current}\n\n${block}` : block;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ---------------------------------------------------------------------------
// Stima dei costi (prima di partire)
// ---------------------------------------------------------------------------

// Prezzi indicativi in dollari per milione di token: vettori di ricerca (text-embedding-3-small) e un modello "mini"
// per leggere i fatti. I prezzi cambiano e il modello viene scelto in automatico: è una STIMA, non un preventivo.
export const PRICES_USD_PER_MILLION = { embedding: 0.02, input: 0.40, output: 1.60 };
export const USD_TO_EUR = 0.92;
const FACT_OUTPUT_TOKENS = 450; // risposta tipica dell'estrazione dei fatti per una chat

/** Quanti caratteri dei TUOI messaggi si mandano all'IA per ricavare i fatti (per singola richiesta). */
export const FACT_WINDOW_CHARS = 24000;

export function estimateItemCost(item) {
  const cleanText = itemToCleanText(item);
  const chunks = chunkText(cleanText);
  const embeddingTokens = chunks.reduce((n, c) => n + estimateTokens(c), 0);
  const author = authorText(item);
  const windows = Math.max(1, Math.ceil(author.length / FACT_WINDOW_CHARS));
  const inputTokens = estimateTokens(author) + windows * 500; // +istruzioni
  const outputTokens = windows * FACT_OUTPUT_TOKENS;
  const usd = (embeddingTokens * PRICES_USD_PER_MILLION.embedding + inputTokens * PRICES_USD_PER_MILLION.input + outputTokens * PRICES_USD_PER_MILLION.output) / 1e6;
  return { chunks: chunks.length, embeddingTokens, inputTokens, outputTokens, tokens: embeddingTokens + inputTokens + outputTokens, eur: usd * USD_TO_EUR };
}

export function estimateImportCost(items = []) {
  const total = { items: items.length, chunks: 0, tokens: 0, eur: 0 };
  for (const it of items) {
    const c = estimateItemCost(it);
    total.chunks += c.chunks;
    total.tokens += c.tokens;
    total.eur += c.eur;
  }
  return total;
}

/** Ambito proposto per una chat/documento (lo puoi cambiare prima di importare). */
export function suggestDomain(item) {
  const sample = `${item.title || ''} ${authorText(item).slice(0, 2000)}`;
  return detectDomain(sample);
}

// ---------------------------------------------------------------------------
// Regola 2 — fatti solo dalle tue parole
// ---------------------------------------------------------------------------

/**
 * Istruzioni per ricavare i fatti. All'IA arrivano i TUOI messaggi per intero; delle risposte dell'assistente
 * arriva solo l'inizio, come contesto, marcato come "non è una fonte".
 * @returns {Array<{system:string, text:string}>} una richiesta per finestra (le chat lunghe ne hanno più d'una)
 */
export function buildFactExtractionRequests(item) {
  const system =
    'Leggi i messaggi scritti dall\'utente e ricava i FATTI PERMANENTI su di lui: preferenze, regole che si è dato, ' +
    'obiettivi, dati stabili (lavoro, tariffe, misure, allergie, strumenti che usa, persone e clienti).\n' +
    'Regole rigide:\n' +
    '- Usa SOLO le righe che iniziano con "IO:". Le righe "ASSISTENTE (contesto, NON è una fonte):" servono solo a capire di cosa si parla: ' +
    'consigli, stime e numeri proposti dall\'assistente NON sono fatti sull\'utente.\n' +
    '- Niente fatti momentanei (cosa ha mangiato oggi, una domanda di passaggio) e niente supposizioni.\n' +
    '- Ogni fatto deve avere "evidence": la frase dell\'utente, copiata parola per parola, da cui lo ricavi.\n' +
    '- Se non ci sono fatti permanenti, restituisci una lista vuota.\n' +
    'Rispondi SOLO con JSON: {"summary": "di cosa parla, in una frase", "facts": [{"subject": "Io oppure il nome della persona/cliente", ' +
    '"fact_key": "chiave_snake_case", "fact_value": "valore", "category": "preference|rule|status|metric|client_info", "evidence": "citazione esatta"}]}';

  const lines = [];
  if (Array.isArray(item.messages)) {
    for (const m of item.messages) {
      if (m.role === 'user') lines.push(`IO: ${m.text}`);
      else lines.push(`ASSISTENTE (contesto, NON è una fonte): ${String(m.text).replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  } else {
    lines.push(`IO: ${String(item.text || '')}`);
  }

  const requests = [];
  let current = '';
  for (const line of lines) {
    const piece = line.length > FACT_WINDOW_CHARS ? line.slice(0, FACT_WINDOW_CHARS) : line;
    if (current && current.length + piece.length + 1 > FACT_WINDOW_CHARS) {
      requests.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current) requests.push(current);
  return requests
    .filter(text => /(^|\n)IO: /.test(text))
    .map(text => ({ system, text: `Titolo: ${item.title || ''}\nData: ${item.date ? String(item.date).slice(0, 10) : 'sconosciuta'}\n\n${text}` }));
}

const normalizeQuote = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Controllo dell'autore: tiene solo i fatti la cui citazione compare davvero in ciò che hai scritto tu.
 * Così un consiglio dell'assistente ("dovresti mangiare 2.500 kcal") non può diventare un fatto su di te.
 * @returns {{kept:Array, discarded:Array}}
 */
export function filterFactsByEvidence(facts = [], authoredText = '') {
  const haystack = normalizeQuote(authoredText);
  const kept = [];
  const discarded = [];
  const seen = new Set();
  for (const f of Array.isArray(facts) ? facts : []) {
    if (!f || !f.subject || !f.fact_key || f.fact_value === undefined || f.fact_value === null || String(f.fact_value).trim() === '') {
      discarded.push({ ...f, reason: 'incompleto' });
      continue;
    }
    const quote = normalizeQuote(f.evidence);
    if (quote.length < 8 || !haystack.includes(quote)) {
      discarded.push({ ...f, reason: 'la citazione non è tra le tue frasi' });
      continue;
    }
    const key = `${String(f.subject).toLowerCase()}::${String(f.fact_key).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(f);
  }
  return { kept, discarded };
}
