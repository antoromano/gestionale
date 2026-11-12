// src/services/ai-client.js
// Unico punto di accesso all'IA per l'app. Ordine: Edge Function (chiave sul server) → chiave personale su questo
// browser (facoltativa) → ERRORE ESPLICITO. Nessun nome di modello qui: li sceglie gemini-core.js interrogando Google.

import { getSupabase } from './supabase.js';
import { store } from './store.js';
import * as core from './gemini-core.js';

export { GeminiError } from './gemini-core.js';

/** L'IA è disponibile in linea di principio? (cloud collegato o chiave personale presente) */
export function isAiConfigured() {
  return Boolean(getSupabase()) || Boolean(store.getSettings().gemini_api_key);
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

/**
 * Genera testo/JSON con Gemini.
 * @returns {Promise<{data:any, model:string, via:'edge'|'direct'}>}
 * @throws {GeminiError} con code: not_configured | no_api_key | invalid_api_key | model_unavailable | quota | network | ...
 */
export async function aiGenerate({ system = '', parts, temperature = 0.1, json = true }) {
  const localKey = store.getSettings().gemini_api_key;
  let edgeError = null;

  try {
    const res = await viaEdge('generate', { system, parts, temperature, json });
    if (res) return { data: res.data, model: res.model, via: 'edge' };
  } catch (err) {
    edgeError = err;
    // Se il server non ha la chiave ma l'utente ne ha una personale, si prosegue; altrimenti l'errore è l'esito
    if (!(err.code === 'no_api_key' && localKey)) throw err;
  }

  if (localKey) {
    const res = await core.generate({ apiKey: localKey, system, parts, temperature, json });
    return { data: res.data, model: res.model, via: 'direct' };
  }
  throw edgeError || new core.GeminiError('not_configured', 'IA non configurata: aggiungi la chiave Gemini (secret GEMINI_API_KEY su Supabase) o una chiave personale in Impostazioni.');
}

/** Embedding a 768 dimensioni. */
export async function aiEmbed(text) {
  const localKey = store.getSettings().gemini_api_key;
  let edgeError = null;
  try {
    const res = await viaEdge('embed', { text });
    if (res) return { values: res.values, model: res.model, via: 'edge' };
  } catch (err) {
    edgeError = err;
    if (!(err.code === 'no_api_key' && localKey)) throw err;
  }
  if (localKey) {
    const res = await core.embed({ apiKey: localKey, text });
    return { values: res.values, model: res.model, via: 'direct' };
  }
  throw edgeError || new core.GeminiError('not_configured', 'IA non configurata.');
}

/** Diagnostica per Impostazioni: quale modello userà e se la chiave funziona davvero. */
export async function aiDiagnose() {
  const localKey = store.getSettings().gemini_api_key;
  try {
    const res = await viaEdge('diagnose', {});
    if (res) return { ok: true, via: 'edge', generateModel: res.generateModel, embedModel: res.embedModel, probeOk: res.probeOk, timings: res.timings };
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
