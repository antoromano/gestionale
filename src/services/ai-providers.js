// src/services/ai-providers.js
// Un solo punto di ingresso per l'IA, con più fornitori in fila (si usano solo quelli con la chiave sul server):
//   1) OpenAI (modello "mini", veloce)   2) Gemini (modello "lite", senza ragionamento)   3) Claude (Anthropic)
// Se uno non risponde entro il suo tetto di tempo o dà errore, subentra il successivo. Se falliscono tutti l'errore arriva all'utente con il motivo: nessuna invenzione, nessun ripiego a regole.
//
// Nessun nome di modello scritto a mano: entrambi i fornitori vengono interrogati su quali modelli hanno.
// Copia sincronizzata nelle Edge Function da scripts/sync-edge-shared.mjs.

import { GeminiError, generate as geminiGenerate, parseJsonLoose } from './gemini-core.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_CACHE_MS = 30 * 60 * 1000;
const anthropicModelCache = new Map();

/** Quanto si aspetta Gemini prima di passare a Claude. */
let geminiBudgetMs = 5000;
export function setGeminiBudget(ms) { geminiBudgetMs = ms; }

let anthropicTimeoutMs = 25000;
export function setAnthropicTimeout(ms) { anthropicTimeoutMs = ms; }

// ---------------------------------------------------------------------------
// Claude (Anthropic)
// ---------------------------------------------------------------------------

function mapAnthropicError(status, bodyText) {
  let message = bodyText;
  try {
    message = JSON.parse(bodyText)?.error?.message || bodyText;
  } catch {
    /* corpo non JSON */
  }
  const short = String(message).slice(0, 300);
  if (status === 401 || status === 403) return new GeminiError('invalid_api_key', 'La chiave API di Claude non è valida o non ha i permessi.', short);
  if (status === 404) return new GeminiError('model_unavailable', 'Il modello Claude richiesto non è disponibile.', short);
  if (status === 429) return new GeminiError('quota', 'Hai superato il limite di richieste di Claude. Riprova tra qualche minuto.', short);
  if (status === 529 || status >= 500) return new GeminiError('unavailable', 'Il servizio Claude non risponde in questo momento.', short);
  return new GeminiError('bad_response', `Claude ha risposto con un errore (${status}).`, short);
}

async function anthropicRequest(fetchFn, path, apiKey, init = {}, timeoutMs = anthropicTimeoutMs) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchFn(`${ANTHROPIC_API}${path}`, {
      ...init,
      ...(controller ? { signal: controller.signal } : {}),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        ...(init.headers || {}),
      },
    });
    if (!res.ok) throw mapAnthropicError(res.status, await res.text().catch(() => ''));
    return await res.json();
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    if (controller?.signal.aborted) throw new GeminiError('timeout', `Claude non ha risposto entro ${Math.round(timeoutMs / 1000)} secondi.`);
    throw new GeminiError('network', 'Impossibile raggiungere Claude: controlla la connessione.', err?.message);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Sceglie il modello Claude: override esplicito → il più recente "haiku" (veloce ed economico) → il più recente in assoluto. */
export function pickAnthropicModel(models, override = '') {
  const ids = models.map(m => String(m.id || m.name || ''));
  if (override) {
    if (!ids.includes(override)) throw new GeminiError('model_unavailable', `Il modello Claude impostato "${override}" non è disponibile.`);
    return override;
  }
  const byNewest = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.id).localeCompare(String(a.id));
  const haiku = models.filter(m => /haiku/i.test(String(m.id || ''))).sort(byNewest);
  if (haiku.length) return String(haiku[0].id);
  const any = [...models].sort(byNewest);
  if (any.length) return String(any[0].id);
  throw new GeminiError('model_unavailable', 'Nessun modello Claude disponibile per questa chiave.');
}

export async function resolveAnthropicModel(apiKey, { fetchFn = fetch, env = {}, force = false } = {}) {
  const cacheKey = `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}`;
  const hit = anthropicModelCache.get(cacheKey);
  if (!force && hit && Date.now() - hit.at < ANTHROPIC_CACHE_MS) return hit.value;
  const data = await anthropicRequest(fetchFn, '/models?limit=100', apiKey, { method: 'GET' }, 10000);
  const model = pickAnthropicModel(data?.data || [], env.ANTHROPIC_MODEL || '');
  anthropicModelCache.set(cacheKey, { at: Date.now(), value: model });
  return model;
}

export function clearAnthropicCache() {
  anthropicModelCache.clear();
}

/** Converte le "parts" in formato Gemini nel formato di Claude. L'audio non è supportato: lo dichiara. */
export function partsToAnthropic(parts = []) {
  return parts.map(p => {
    if (p?.text !== undefined) return { type: 'text', text: String(p.text) };
    const inline = p?.inline_data || p?.inlineData;
    if (inline?.data) {
      const mime = inline.mime_type || inline.mimeType || '';
      if (mime.startsWith('image/')) return { type: 'image', source: { type: 'base64', media_type: mime, data: inline.data } };
      throw new GeminiError('media_unsupported', 'Claude non accetta note vocali: per i messaggi audio serve Gemini.');
    }
    return { type: 'text', text: '' };
  }).filter(b => b.type !== 'text' || b.text !== '');
}

/**
 * Genera con Claude. Per ottenere JSON valido si usa il "prefill": si fa iniziare la risposta con "{",
 * così il modello non può premettere frasi di cortesia.
 */
export async function anthropicGenerate({ apiKey, fetchFn = fetch, env = {}, system = '', parts, temperature = 0.1, json = true, maxTokens = 2048 }) {
  if (!apiKey) throw new GeminiError('no_api_key', 'Chiave API di Claude non configurata.');
  const model = await resolveAnthropicModel(apiKey, { fetchFn, env });
  const content = partsToAnthropic(parts);
  const messages = [{ role: 'user', content }];
  if (json) messages.push({ role: 'assistant', content: [{ type: 'text', text: '{' }] });

  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages,
    ...(system ? { system } : {}),
  };
  const data = await anthropicRequest(fetchFn, '/messages', apiKey, { method: 'POST', body: JSON.stringify(body) });
  const text = (data?.content || []).filter(b => b?.type === 'text').map(b => b.text || '').join('');
  if (!text && data?.stop_reason === 'refusal') throw new GeminiError('blocked', 'Claude ha rifiutato di rispondere a questa richiesta.');
  if (!text) throw new GeminiError('bad_response', 'Claude non ha restituito nessuna risposta.');
  return { data: json ? parseJsonLoose(`{${text}`) : text, model };
}

// ---------------------------------------------------------------------------
// OpenAI (ChatGPT)
// ---------------------------------------------------------------------------

const OPENAI_API = 'https://api.openai.com/v1';
const OPENAI_CACHE_MS = 30 * 60 * 1000;
const openaiModelCache = new Map();

/** Quanto si aspetta OpenAI prima di passare al fornitore successivo (se ce n'è uno). */
let openaiBudgetMs = 10000;
export function setOpenAIBudget(ms) { openaiBudgetMs = ms; }

function mapOpenAIError(status, bodyText) {
  let message = bodyText;
  let code = '';
  try {
    const e = JSON.parse(bodyText)?.error;
    message = e?.message || bodyText;
    code = e?.code || e?.type || '';
  } catch {
    /* corpo non JSON */
  }
  const short = String(message).slice(0, 300);
  if (status === 401) return new GeminiError('invalid_api_key', 'La chiave API di OpenAI non è valida.', short);
  if (status === 403) return new GeminiError('permission', 'OpenAI ha rifiutato l\'accesso: controlla i permessi della chiave.', short);
  if (status === 404) return new GeminiError('model_unavailable', 'Il modello OpenAI richiesto non è disponibile.', short);
  if (status === 429 && /insufficient_quota|billing|exceeded your current quota/i.test(`${code} ${message}`)) {
    return new GeminiError('quota', 'Il credito OpenAI è finito: ricaricalo su platform.openai.com (Billing).', short);
  }
  if (status === 429) return new GeminiError('quota', 'Troppe richieste a OpenAI in poco tempo. Riprova tra qualche secondo.', short);
  if (status >= 500) return new GeminiError('unavailable', 'Il servizio OpenAI non risponde in questo momento.', short);
  return new GeminiError('bad_response', `OpenAI ha risposto con un errore (${status}).`, short);
}

async function openaiRequest(fetchFn, path, apiKey, init = {}, timeoutMs = 20000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchFn(`${OPENAI_API}${path}`, {
      ...init,
      ...(controller ? { signal: controller.signal } : {}),
      headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers || {}) },
    });
    if (!res.ok) throw mapOpenAIError(res.status, await res.text().catch(() => ''));
    return await res.json();
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    if (controller?.signal.aborted) throw new GeminiError('timeout', `OpenAI non ha risposto entro ${Math.round(timeoutMs / 1000)} secondi.`);
    throw new GeminiError('network', 'Impossibile raggiungere OpenAI: controlla la connessione.', err?.message);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const OPENAI_NOT_CHAT = /audio|realtime|transcribe|tts|image|search|codex|instruct|embedding|moderation|whisper|dall|sora|davinci|babbage|computer|deep-research|omni-moderation/i;
const openaiVersion = id => {
  const m = String(id).match(/gpt-(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
};

/** Sceglie il modello di chat: override → il più recente "mini" (veloce ed economico) → il più recente "gpt". Ignora le versioni con data. */
export function pickOpenAIModel(models, override = '') {
  const ids = models.map(m => String(m.id || '')).filter(Boolean);
  if (override) {
    if (!ids.includes(override)) throw new GeminiError('model_unavailable', `Il modello OpenAI impostato "${override}" non è disponibile.`);
    return override;
  }
  const clean = ids.filter(id => /^gpt-/.test(id) && !OPENAI_NOT_CHAT.test(id) && !/-\d{4}-\d{2}-\d{2}$/.test(id) && !/-\d{4}$/.test(id) && !/preview/.test(id));
  const byNewest = (a, b) => openaiVersion(b) - openaiVersion(a) || a.localeCompare(b);
  const mini = clean.filter(id => /-mini$/.test(id)).sort(byNewest);
  if (mini.length) return mini[0];
  const anyMini = clean.filter(id => /mini/.test(id)).sort(byNewest);
  if (anyMini.length) return anyMini[0];
  const any = clean.sort(byNewest);
  if (any.length) return any[0];
  throw new GeminiError('model_unavailable', 'Nessun modello OpenAI di chat disponibile per questa chiave.');
}

/** Sceglie il modello per trascrivere i vocali: override → "transcribe" più recente → whisper. */
export function pickOpenAITranscribeModel(models, override = '') {
  const ids = models.map(m => String(m.id || '')).filter(Boolean);
  if (override) return override;
  const tr = ids.filter(id => /transcribe/.test(id) && !/diarize/.test(id) && !/-\d{4}-\d{2}-\d{2}$/.test(id)).sort((a, b) => b.localeCompare(a));
  if (tr.length) return tr.find(id => /mini/.test(id)) || tr[0];
  const whisper = ids.filter(id => /^whisper/.test(id)).sort();
  if (whisper.length) return whisper[0];
  throw new GeminiError('model_unavailable', 'Nessun modello OpenAI per trascrivere i vocali.');
}

async function openaiModels(apiKey, { fetchFn = fetch, force = false } = {}) {
  const cacheKey = `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}`;
  const hit = openaiModelCache.get(cacheKey);
  if (!force && hit && Date.now() - hit.at < OPENAI_CACHE_MS) return hit.value;
  const data = await openaiRequest(fetchFn, '/models', apiKey, { method: 'GET' }, 10000);
  const value = data?.data || [];
  openaiModelCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

export async function resolveOpenAIModel(apiKey, { fetchFn = fetch, env = {}, force = false } = {}) {
  return pickOpenAIModel(await openaiModels(apiKey, { fetchFn, force }), env.OPENAI_MODEL || '');
}

export function clearOpenAICache() {
  openaiModelCache.clear();
}

/** Parti in formato Gemini → messaggio di OpenAI. Le immagini passano; l'audio va trascritto prima. */
export function partsToOpenAI(parts = []) {
  return parts.map(p => {
    if (p?.text !== undefined) return { type: 'text', text: String(p.text) };
    const inline = p?.inline_data || p?.inlineData;
    if (inline?.data) {
      const mime = inline.mime_type || inline.mimeType || '';
      if (mime.startsWith('image/')) return { type: 'image_url', image_url: { url: `data:${mime};base64,${inline.data}` } };
      throw new GeminiError('media_unsupported', 'Questo tipo di allegato va prima trascritto.');
    }
    return { type: 'text', text: '' };
  }).filter(b => b.type !== 'text' || b.text !== '');
}

const base64ToBytes = (b64) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** Trascrive un vocale (ogg da Telegram, webm dal browser) con OpenAI. */
export async function openaiTranscribe({ apiKey, fetchFn = fetch, env = {}, base64, mime = 'audio/ogg' }) {
  const model = pickOpenAITranscribeModel(await openaiModels(apiKey, { fetchFn }), env.OPENAI_TRANSCRIBE_MODEL || '');
  const ext = /webm/.test(mime) ? 'webm' : /mpeg|mp3/.test(mime) ? 'mp3' : /mp4|m4a/.test(mime) ? 'm4a' : /wav/.test(mime) ? 'wav' : 'ogg';
  const form = new FormData();
  form.append('file', new Blob([base64ToBytes(base64)], { type: mime }), `nota.${ext}`);
  form.append('model', model);
  form.append('language', 'it');
  const data = await openaiRequest(fetchFn, '/audio/transcriptions', apiKey, { method: 'POST', body: form }, 30000);
  const text = String(data?.text || '').trim();
  if (!text) throw new GeminiError('bad_response', 'OpenAI non ha capito nulla dal vocale.');
  return { text, model };
}

/**
 * Genera con OpenAI. Parametri che alcuni modelli non accettano (temperatura, impegno di ragionamento) vengono
 * tolti automaticamente al primo rifiuto, senza dover conoscere in anticipo ogni modello.
 */
export async function openaiGenerate({ apiKey, fetchFn = fetch, env = {}, system = '', parts, json = true, maxTokens = 2048, timeoutMs = 20000 }) {
  if (!apiKey) throw new GeminiError('no_api_key', 'Chiave API di OpenAI non configurata.');
  const model = await resolveOpenAIModel(apiKey, { fetchFn, env });

  let workingParts = parts;
  const audio = parts.filter(p => String((p?.inline_data || p?.inlineData)?.mime_type || (p?.inline_data || p?.inlineData)?.mimeType || '').startsWith('audio/'));
  if (audio.length) {
    const texts = [];
    for (const a of audio) {
      const inline = a.inline_data || a.inlineData;
      const t = await openaiTranscribe({ apiKey, fetchFn, env, base64: inline.data, mime: inline.mime_type || inline.mimeType });
      texts.push(t.text);
    }
    workingParts = [
      ...parts.filter(p => !audio.includes(p)),
      { text: `Trascrizione del vocale: ${texts.join(' ')}` },
    ];
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: partsToOpenAI(workingParts) });

  const body = { model, messages, max_completion_tokens: maxTokens, reasoning_effort: 'minimal' };
  if (json) body.response_format = { type: 'json_object' };

  let data;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      data = await openaiRequest(fetchFn, '/chat/completions', apiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, timeoutMs);
      break;
    } catch (err) {
      const detail = `${err.details || ''} ${err.message || ''}`;
      const bad = err.code === 'bad_response' && /unsupported|not supported|unrecognized|invalid/i.test(detail);
      if (!bad) throw err;
      // Quale parametro ha dato fastidio? Si toglie e si riprova (prima il ragionamento, poi gli altri).
      if (body.reasoning_effort === 'minimal' && /reasoning_effort|minimal/i.test(detail)) { body.reasoning_effort = 'low'; continue; }
      if ('reasoning_effort' in body && /reasoning_effort/i.test(detail)) { delete body.reasoning_effort; continue; }
      if ('max_completion_tokens' in body && /max_completion_tokens/i.test(detail)) { body.max_tokens = body.max_completion_tokens; delete body.max_completion_tokens; continue; }
      if ('max_tokens' in body && /max_tokens/i.test(detail)) { delete body.max_tokens; continue; }
      if ('response_format' in body && /response_format/i.test(detail)) { delete body.response_format; continue; }
      throw err;
    }
  }
  if (!data) throw new GeminiError('bad_response', 'OpenAI non ha accettato la richiesta.');

  const choice = data?.choices?.[0];
  if (choice?.message?.refusal) throw new GeminiError('blocked', 'OpenAI ha rifiutato di rispondere a questa richiesta.');
  const text = String(choice?.message?.content || '').trim();
  if (!text) throw new GeminiError('bad_response', 'OpenAI non ha restituito nessuna risposta.');
  return { data: json ? parseJsonLoose(text) : text, model };
}

// ---------------------------------------------------------------------------
// Fornitori in fila: OpenAI → Gemini → Claude (si salta chi non ha la chiave)
// ---------------------------------------------------------------------------

const hasAudio = (parts = []) => parts.some(p => {
  const inline = p?.inline_data || p?.inlineData;
  return inline?.data && String(inline.mime_type || inline.mimeType || '').startsWith('audio/');
});

/**
 * Prova i fornitori nell'ordine OpenAI, Gemini, Claude (solo quelli con la chiave configurata). Se uno non risponde
 * entro il suo tetto di tempo o dà errore, si passa al successivo. Restituisce sempre chi ha risposto e quanto ci ha messo.
 * Se falliscono tutti, l'errore elenca il motivo di ciascuno.
 *
 * @returns {Promise<{data:any, model:string, provider:'openai'|'gemini'|'anthropic', ms:number, fallbackReason:string|null}>}
 */
export async function generateStructured({
  system = '',
  parts,
  temperature = 0.1,
  json = true,
  fetchFn = fetch,
  env = {},
  openaiKey = '',
  geminiKey = '',
  anthropicKey = '',
  budgetMs = null,
}) {
  const started = Date.now();
  const order = [];
  if (openaiKey) order.push('openai');
  if (geminiKey) order.push('gemini');
  if (anthropicKey) order.push('anthropic');
  if (!order.length) {
    throw new GeminiError('not_configured', 'Nessuna IA configurata: servono OPENAI_API_KEY, GEMINI_API_KEY o ANTHROPIC_API_KEY sul server.');
  }

  const failures = [];
  let lastErr = null;

  for (let i = 0; i < order.length; i++) {
    const provider = order[i];
    const isLast = i === order.length - 1;
    try {
      let res;
      if (provider === 'openai') {
        res = await openaiGenerate({ apiKey: openaiKey, fetchFn, env, system, parts, json, timeoutMs: isLast ? 25000 : (budgetMs ?? openaiBudgetMs) });
      } else if (provider === 'gemini') {
        // Con altri fornitori pronti si fa un solo tentativo breve; se è l'ultimo si insiste come al solito.
        res = await geminiGenerate({ apiKey: geminiKey, fetchFn, env, system, parts, temperature, json, timeoutMs: isLast ? null : (budgetMs ?? geminiBudgetMs), fast: true });
      } else {
        if (hasAudio(parts)) throw new GeminiError('media_unsupported', 'Claude non accetta note vocali.');
        res = await anthropicGenerate({ apiKey: anthropicKey, fetchFn, env, system, parts, temperature, json });
      }
      return { ...res, provider, ms: Date.now() - started, fallbackReason: failures.length ? failures.join(' | ') : null };
    } catch (err) {
      lastErr = err;
      const nome = provider === 'openai' ? 'OpenAI' : provider === 'gemini' ? 'Gemini' : 'Claude';
      failures.push(`${nome} — ${err.message}`);
    }
  }

  const code = lastErr?.code || 'unavailable';
  const message = failures.length > 1 ? `Nessun fornitore IA ha risposto. ${failures.join(' | ')}` : lastErr.message;
  throw new GeminiError(code, message, lastErr?.details || null);
}
