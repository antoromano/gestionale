// src/services/ai-client.js
// Unico punto di accesso all'IA per l'app. Ordine: Edge Function (chiavi sul server) → chiavi personali su questo
// browser (facoltative: OpenAI, poi Gemini) → ERRORE ESPLICITO. I modelli per rispondere si scoprono dai fornitori.

import { getSupabase } from './supabase.js';
import { store } from './store.js';
import * as core from './gemini-core.js';
import { generateStructured, openaiEmbed } from './ai-providers.js';

export { GeminiError } from './gemini-core.js';

/** L'IA è disponibile in linea di principio? (cloud collegato o chiave personale presente) */
export function isAiConfigured() {
  const s = store.getSettings();
  return Boolean(getSupabase()) || Boolean(s.gemini_api_key) || Boolean(s.openai_api_key);
}

async function viaEdge(action, body) {
  const client = getSupabase();
  if (!client) return null;
  const timeoutMs = 110000; // il server puo impiegare fino a ~90s nel caso peggiore (elenco modelli + generazione, ciascuno riprovato fino a 3 volte)
  const { data, error } = await Promise.race([
    client.functions.invoke('gemini-assistant', { body: { action, ...body } }),
    new Promise((_, rej) => setTimeout(() => rej(new core.GeminiError('timeout', `La funzione IA sul cloud non ha risposto entro ${timeoutMs / 1000} secondi.`)), timeoutMs)),
  ]);
  if (error) {
    let detail = error.message || 'errore sconosciuto';
    try {
      const j = await error.context?.json?.();
      if (j?.error?.message) detail = j.error.message;
    } catch {
      /* corpo non leggibile */
    }
    throw new core.GeminiError('unavailable', `La funzione IA sul cloud non risponde (${detail}).`);
  }
  if (data?.ok) return data;
  const err = data?.error || {};
  throw new core.GeminiError(err.code || 'unavailable', err.message || 'Errore IA sconosciuto.', err.details);
}

/** Chiavi personali salvate solo su questo dispositivo (facoltative: di norma le chiavi stanno sul server). */
function personalKeys() {
  const s = store.getSettings();
  return { openaiKey: s.openai_api_key || '', geminiKey: s.gemini_api_key || '', env: s.openai_chat_model ? { OPENAI_MODEL: s.openai_chat_model } : {} };
}

/**
 * Genera testo/JSON con l'IA.
 * @returns {Promise<{data:any, model:string, via:'edge'|'direct', provider?:string}>}
 * @throws {GeminiError} con code: not_configured | no_api_key | invalid_api_key | model_unavailable | quota | network | ...
 */
export async function aiGenerate({ system = '', parts, temperature = 0.1, json = true, maxTokens = undefined, budgetMs = undefined }) {
  const { openaiKey, geminiKey, env } = personalKeys();
  const hasPersonal = Boolean(openaiKey || geminiKey);
  let edgeError = null;

  try {
    const res = await viaEdge('generate', { system, parts, temperature, json, maxTokens, budgetMs });
    if (res) return { data: res.data, model: res.model, provider: res.provider, via: 'edge' };
  } catch (err) {
    edgeError = err;
    // Se il server non ha la chiave ma l'utente ne ha una personale, si prosegue; altrimenti l'errore è l'esito
    if (!(err.code === 'no_api_key' && hasPersonal)) throw err;
  }

  if (hasPersonal) {
    const res = await generateStructured({ openaiKey, geminiKey, env, system, parts, temperature, json, ...(maxTokens ? { maxTokens } : {}), ...(budgetMs ? { budgetMs } : {}) });
    return { data: res.data, model: res.model, provider: res.provider, via: 'direct' };
  }
  throw edgeError || new core.GeminiError('not_configured', 'IA non configurata: aggiungi la chiave sul server (secret OPENAI_API_KEY su Supabase) o una chiave personale in Impostazioni.');
}

/**
 * Vettori di ricerca a 768 numeri per uno o più testi. `source` dice chi li ha calcolati ('openai' | 'gemini'):
 * vettori di fornitori diversi non si possono confrontare tra loro.
 * @returns {Promise<{vectors:number[][], model:string, source:string, via:'edge'|'direct'}>}
 */
export async function aiEmbedBatch(texts) {
  const list = (Array.isArray(texts) ? texts : [texts]).map(t => String(t || ''));
  const { openaiKey, geminiKey, env } = personalKeys();
  const hasPersonal = Boolean(openaiKey || geminiKey);
  let edgeError = null;
  try {
    const res = await viaEdge('embed', list.length === 1 ? { text: list[0] } : { texts: list });
    if (res) {
      const vectors = Array.isArray(res.vectors) ? res.vectors : [res.values];
      // un server non aggiornato rispondeva senza `source` ed era sempre Gemini
      return { vectors, model: res.model, source: res.source || 'gemini', via: 'edge' };
    }
  } catch (err) {
    edgeError = err;
    if (!(err.code === 'no_api_key' && hasPersonal)) throw err;
  }
  if (openaiKey) {
    const res = await openaiEmbed({ apiKey: openaiKey, env, texts: list });
    return { vectors: res.vectors, model: res.model, source: 'openai', via: 'direct' };
  }
  if (geminiKey) {
    const vectors = [];
    let model = '';
    for (const text of list) {
      const r = await core.embed({ apiKey: geminiKey, text });
      vectors.push(r.values);
      model = r.model;
    }
    return { vectors, model, source: 'gemini', via: 'direct' };
  }
  throw edgeError || new core.GeminiError('not_configured', 'IA non configurata.');
}

/** Vettore di ricerca per un solo testo. */
export async function aiEmbed(text) {
  const res = await aiEmbedBatch([text]);
  return { values: res.vectors[0], model: res.model, source: res.source, via: res.via };
}

/** Diagnostica per Impostazioni: quali modelli userà, se le chiavi funzionano e se c'è la riserva. */
export async function aiDiagnose() {
  const localKey = store.getSettings().gemini_api_key;
  try {
    const res = await viaEdge('diagnose', {});
    if (res) return { ok: true, via: 'edge', openai: res.openai || null, gemini: res.gemini || null, anthropic: res.anthropic || null };
  } catch (err) {
    if (!(err.code === 'no_api_key' && localKey)) return { ok: false, code: err.code, message: err.message };
  }
  if (localKey) {
    try {
      const d = await core.diagnose({ apiKey: localKey });
      return { ok: true, via: 'direct', ...d };
    } catch (err) {
      return { ok: false, code: err.code, message: err.message };
    }
  }
  return { ok: false, code: 'not_configured', message: 'IA non configurata.' };
}
