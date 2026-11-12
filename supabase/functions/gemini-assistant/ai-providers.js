// COPIA GENERATA da src/services/ai-providers.js con scripts/sync-edge-shared.mjs: NON modificare qui.
// src/services/ai-providers.js
// Un solo punto di ingresso per l'IA, con DUE fornitori in fila:
//   1) Gemini (veloce, modello "lite" senza ragionamento) con un tetto di pochi secondi
//   2) se Gemini fallisce o è troppo lento → Claude (Anthropic)
// Se falliscono entrambi l'errore arriva all'utente con il motivo: nessuna invenzione, nessun ripiego a regole.
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
// Fallback sequenziale: Gemini → Claude
// ---------------------------------------------------------------------------

const hasAudio = (parts = []) => parts.some(p => {
  const inline = p?.inline_data || p?.inlineData;
  return inline?.data && String(inline.mime_type || inline.mimeType || '').startsWith('audio/');
});

/**
 * Prova Gemini (veloce, "lite", senza ragionamento) e, se non risponde entro il tetto di tempo o dà errore,
 * passa a Claude. Restituisce sempre quale fornitore ha risposto e quanto ci ha messo.
 *
 * @returns {Promise<{data:any, model:string, provider:'gemini'|'anthropic', ms:number, fallbackReason:string|null}>}
 */
export async function generateStructured({
  system = '',
  parts,
  temperature = 0.1,
  json = true,
  fetchFn = fetch,
  env = {},
  geminiKey = '',
  anthropicKey = '',
  budgetMs = null,
}) {
  const started = Date.now();
  const budget = budgetMs ?? geminiBudgetMs;
  let fallbackReason = null;

  if (geminiKey) {
    try {
      const res = await geminiGenerate({ apiKey: geminiKey, fetchFn, env, system, parts, temperature, json, timeoutMs: budget, fast: true });
      return { ...res, provider: 'gemini', ms: Date.now() - started, fallbackReason: null };
    } catch (err) {
      fallbackReason = `${err.code || 'errore'}: ${err.message}`;
      // Chiave sbagliata o richiesta bloccata: insistere con l'altro fornitore non serve a nulla di diverso,
      // ma proviamo comunque se c'è, perché il guasto può essere solo di Gemini.
      if (!anthropicKey) throw err;
    }
  }

  if (!anthropicKey) {
    throw new GeminiError('not_configured', 'Nessuna IA configurata: servono GEMINI_API_KEY o ANTHROPIC_API_KEY sul server.');
  }

  if (hasAudio(parts)) {
    throw new GeminiError('media_unsupported', `Per le note vocali serve Gemini, che però non ha risposto${fallbackReason ? ` (${fallbackReason})` : ''}.`);
  }

  const res = await anthropicGenerate({ apiKey: anthropicKey, fetchFn, env, system, parts, temperature, json });
  return { ...res, provider: 'anthropic', ms: Date.now() - started, fallbackReason };
}
