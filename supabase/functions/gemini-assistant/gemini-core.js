// COPIA GENERATA da src/services/gemini-core.js con scripts/sync-edge-shared.mjs: NON modificare qui.
// src/services/gemini-core.js
// Nucleo Gemini: puro (solo fetch), usato sia dal browser sia dalle Edge Function (copia sincronizzata da scripts/sync-edge-shared.mjs).
//
// REGOLE
//  • Nessun nome di modello scritto nel codice: i modelli disponibili si chiedono a Google (models.list) e si sceglie
//    il migliore. Così un modello dismesso non rompe più l'app in silenzio (è già successo con gemini-1.5-flash).
//  • Nessun fallback silenzioso: ogni errore ha un codice e un messaggio in italiano per l'utente.

const API = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_CACHE_MS = 30 * 60 * 1000;
const modelCache = new Map();

export class GeminiError extends Error {
  /** @param {'not_configured'|'no_api_key'|'invalid_api_key'|'permission'|'model_unavailable'|'quota'|'unavailable'|'network'|'blocked'|'bad_response'|'bad_dimension'} code */
  constructor(code, message, details = null) {
    super(message);
    this.name = 'GeminiError';
    this.code = code;
    this.details = details;
  }
}

function mapHttpError(status, bodyText, model) {
  let apiMessage = bodyText;
  try {
    apiMessage = JSON.parse(bodyText)?.error?.message || bodyText;
  } catch {
    /* corpo non JSON */
  }
  const short = String(apiMessage).slice(0, 300);
  if (status === 400 && /api key not valid|api_key_invalid/i.test(apiMessage)) {
    return new GeminiError('invalid_api_key', 'La chiave API Gemini non è valida.', short);
  }
  if (status === 401 || status === 403) {
    return new GeminiError('permission', `Gemini ha rifiutato l'accesso (${status}). Controlla la chiave API e i permessi del progetto Google.`, short);
  }
  if (status === 404) {
    return new GeminiError('model_unavailable', `Il modello "${model}" non è più disponibile su Gemini.`, short);
  }
  if (status === 429) {
    return new GeminiError('quota', 'Hai superato il limite di richieste Gemini. Riprova tra qualche minuto.', short);
  }
  if (status >= 500) {
    return new GeminiError('unavailable', 'Il servizio Gemini non risponde in questo momento.', short);
  }
  return new GeminiError('bad_response', `Gemini ha risposto con un errore (${status}).`, short);
}

// Le risposte vere arrivano in pochi secondi: un tempo più corto fa scattare prima il nuovo tentativo
// quando una connessione resta bloccata, invece di far aspettare l'utente fino al vecchio limite di 40s.
let requestTimeoutMs = 20000;
/** Limite di attesa per ogni richiesta a Google (modificabile solo per i test). */
export function setGeminiTimeout(ms) { requestTimeoutMs = ms; }

async function requestOnce(fetchFn, url, apiKey, init, model, timeoutMs) {
  let res;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    res = await fetchFn(url, {
      ...init,
      ...(controller ? { signal: controller.signal } : {}),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey, ...(init.headers || {}) },
    });
    if (!res.ok) throw mapHttpError(res.status, await res.text().catch(() => ''), model);
    return await res.json();
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    if (controller?.signal.aborted) {
      throw new GeminiError('timeout', `Gemini non ha risposto entro ${Math.round(timeoutMs / 1000)} secondi (${model || 'richiesta'}).`);
    }
    throw new GeminiError('network', 'Impossibile raggiungere Gemini: controlla la connessione.', err?.message);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * A volte la connessione verso Google resta bloccata senza alcuna risposta (osservato in produzione: metà delle
 * richieste in ~5s, l'altra metà appesa fino al timeout) mentre un nuovo tentativo va a buon fine in pochi secondi.
 * Un solo nuovo tentativo, solo per timeout/rete (mai per errori come chiave non valida o quota).
 */
async function request(fetchFn, url, apiKey, init = {}, model = '', timeoutMs = requestTimeoutMs) {
  try {
    return await requestOnce(fetchFn, url, apiKey, init, model, timeoutMs);
  } catch (err) {
    if (err.code === 'timeout' || err.code === 'network') {
      return await requestOnce(fetchFn, url, apiKey, init, model, timeoutMs);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Scoperta dei modelli
// ---------------------------------------------------------------------------

export async function listModels(apiKey, fetchFn = fetch) {
  const models = [];
  let pageToken = '';
  for (let i = 0; i < 10; i++) {
    const url = `${API}/models?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const data = await request(fetchFn, url, apiKey, { method: 'GET' }, 'models.list');
    models.push(...(data.models || []));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return models;
}

const versionOf = id => {
  const m = id.match(/gemini-(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
};

const NOT_TEXT = /lite|image|tts|live|audio|native|thinking|vision|robotics|computer|embedding|exp(?:erimental)?\b|customtools|learnlm|gemma/i;

/** Sceglie il modello di testo: override esplicito → alias "latest" → ultima versione stabile → ultima anteprima. */
export function pickGenerateModel(models, override = '') {
  const gen = models
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => String(m.name).replace(/^models\//, ''));

  if (override) {
    if (!gen.includes(override)) {
      throw new GeminiError('model_unavailable', `Il modello impostato "${override}" non è disponibile. Modelli disponibili: ${gen.filter(g => /flash/.test(g)).slice(0, 8).join(', ') || 'nessuno'}.`);
    }
    return override;
  }

  if (gen.includes('gemini-flash-latest')) return 'gemini-flash-latest';

  const byVersionDesc = (a, b) => versionOf(b) - versionOf(a) || a.localeCompare(b);
  const stable = gen.filter(id => /^gemini-\d+(?:\.\d+)?-flash$/.test(id)).sort(byVersionDesc);
  if (stable.length) return stable[0];

  const preview = gen.filter(id => /^gemini-\d+(?:\.\d+)?-flash/.test(id) && !NOT_TEXT.test(id)).sort(byVersionDesc);
  if (preview.length) return preview[0];

  const anyFlash = gen.filter(id => /flash/.test(id) && !NOT_TEXT.test(id)).sort(byVersionDesc);
  if (anyFlash.length) return anyFlash[0];

  throw new GeminiError('model_unavailable', 'Nessun modello Gemini di testo disponibile per questa chiave.');
}

/** Sceglie il modello per gli embedding (vettori). */
export function pickEmbedModel(models, override = '') {
  const emb = models
    .filter(m => (m.supportedGenerationMethods || []).includes('embedContent'))
    .map(m => String(m.name).replace(/^models\//, ''));
  if (override) {
    if (!emb.includes(override)) throw new GeminiError('model_unavailable', `Il modello di embedding "${override}" non è disponibile.`);
    return override;
  }
  if (emb.includes('gemini-embedding-001')) return 'gemini-embedding-001';
  const ranked = emb.filter(id => /embedding/.test(id)).sort((a, b) => (parseFloat((b.match(/(\d+(?:\.\d+)?)$/) || [0, 0])[1]) - parseFloat((a.match(/(\d+(?:\.\d+)?)$/) || [0, 0])[1])));
  if (ranked.length) return ranked[0];
  throw new GeminiError('model_unavailable', 'Nessun modello di embedding disponibile per questa chiave.');
}

/** Elenco modelli con cache (30 min). */
export async function resolveModels(apiKey, { fetchFn = fetch, env = {}, force = false } = {}) {
  const key = `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`;
  const hit = modelCache.get(key);
  if (!force && hit && Date.now() - hit.at < MODEL_CACHE_MS) return hit.value;
  const models = await listModels(apiKey, fetchFn);
  const value = {
    generate: pickGenerateModel(models, env.GEMINI_MODEL || ''),
    embed: (() => {
      try {
        return pickEmbedModel(models, env.GEMINI_EMBEDDING_MODEL || '');
      } catch (err) {
        return null; // gli embedding sono opzionali: se mancano lo segnaliamo solo quando servono
      }
    })(),
    available: models.filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => String(m.name).replace(/^models\//, '')),
  };
  modelCache.set(key, { at: Date.now(), value });
  return value;
}

export function clearModelCache() {
  modelCache.clear();
}

// ---------------------------------------------------------------------------
// Generazione ed embedding
// ---------------------------------------------------------------------------

export function parseJsonLoose(text) {
  const clean = String(text ?? '').replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(clean.slice(start, end + 1));
      } catch {
        /* cade nell'errore sotto */
      }
    }
    throw new GeminiError('bad_response', 'La risposta di Gemini non era in un formato leggibile.', clean.slice(0, 200));
  }
}

/**
 * @param {{apiKey:string, fetchFn?:Function, env?:object, system?:string, parts:Array, temperature?:number, json?:boolean}} opts
 * @returns {Promise<{data:any, model:string}>}
 */
export async function generate({ apiKey, fetchFn = fetch, env = {}, system = '', parts, temperature = 0.1, json = true }) {
  if (!apiKey) throw new GeminiError('no_api_key', 'Chiave API Gemini non configurata.');
  const { generate: model } = await resolveModels(apiKey, { fetchFn, env });

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const data = await request(fetchFn, `${API}/models/${model}:generateContent`, apiKey, { method: 'POST', body: JSON.stringify(body) }, model);

  const cand = data.candidates?.[0];
  if (!cand) {
    const reason = data.promptFeedback?.blockReason;
    throw new GeminiError(reason ? 'blocked' : 'bad_response', reason ? `Gemini ha bloccato la richiesta (${reason}).` : 'Gemini non ha restituito nessuna risposta.');
  }
  const text = (cand.content?.parts || []).map(p => p.text || '').join('');
  return { data: json ? parseJsonLoose(text) : text, model };
}

/** Embedding a 768 dimensioni (colonna vector(768) di brain_memories). */
export async function embed({ apiKey, fetchFn = fetch, env = {}, text, dims = 768 }) {
  if (!apiKey) throw new GeminiError('no_api_key', 'Chiave API Gemini non configurata.');
  const { embed: model } = await resolveModels(apiKey, { fetchFn, env });
  if (!model) throw new GeminiError('model_unavailable', 'Nessun modello di embedding disponibile per questa chiave.');

  const data = await request(
    fetchFn,
    `${API}/models/${model}:embedContent`,
    apiKey,
    { method: 'POST', body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: dims }) },
    model,
  );
  const values = data.embedding?.values;
  if (!Array.isArray(values) || values.length !== dims) {
    throw new GeminiError('bad_dimension', `L'embedding ha ${values?.length ?? 0} dimensioni invece di ${dims}.`);
  }
  return { values, model };
}

/** Diagnostica per la schermata Impostazioni: quale modello userà e se la chiave funziona davvero. */
export async function diagnose({ apiKey, fetchFn = fetch, env = {} }) {
  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      return { value: await fn(), ms: Date.now() - t0 };
    } catch (err) {
      err.message = `[passo: ${name}] ${err.message}`;
      throw err;
    }
  };
  const list = await step('elenco modelli', () => resolveModels(apiKey, { fetchFn, env, force: true }));
  const probe = await step(`prova di risposta con ${list.value.generate}`, () => generate({ apiKey, fetchFn, env, parts: [{ text: 'Rispondi con {"ok":true}' }], temperature: 0 }));
  return {
    generateModel: list.value.generate,
    embedModel: list.value.embed,
    probeOk: probe.value.data?.ok === true,
    availableCount: list.value.available.length,
    timings: { listMs: list.ms, generateMs: probe.ms },
  };
}
