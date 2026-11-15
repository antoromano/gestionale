// src/services/personal-rag.js
// "Chiedi a te stesso" visto dall'app. Con il cloud collegato la domanda va alla funzione sul server
// (personal-rag-chat), che cerca nel database e chiama l'IA con le chiavi del server. Senza cloud (uso locale e
// test) lo stesso motore (rag-core.js) gira nel browser sui dati dello store. Stesse regole in entrambi i casi:
// tre fonti, istruzioni a strati, interruttori privacy, fonti citate.

import { store } from './store.js';
import { cloud } from './cloud.js';
import { getSupabase } from './supabase.js';
import { aiGenerate, GeminiError } from './ai-client.js';
import { generateEmbeddingDetailed, upsertFact } from './brain.js';
import { searchChunks } from './brain-docs.js';
import { getAssistantProfileRow } from './assistant-profile.js';
import { askRag, todayIn } from './rag-core.js';

const EDGE_TIMEOUT_MS = 110000;

/** Dati vivi letti dallo store: solo le sezioni con l'interruttore acceso. */
function localLiveData(permissions = {}) {
  const raw = {};
  if (permissions.body === true) {
    raw.dailyLogs = store.getAll('body_daily_logs');
    raw.workouts = store.getAll('body_workout_entries');
    raw.columns = store.getAll('body_exercise_columns');
  }
  if (permissions.todos_calendar === true) {
    raw.todos = store.getAll('todos');
    raw.appointments = store.getAll('appointments');
  }
  if (permissions.clients === true) {
    raw.clients = store.getAll('clients');
    raw.quotes = store.getAll('quotes');
  }
  if (permissions.finances === true) {
    raw.transactions = store.getAll('finance_transactions');
    raw.tradingItems = store.getAll('trading_items');
  }
  return raw;
}

function localDeps() {
  return {
    getProfile: async () => getAssistantProfileRow(),
    embed: async (text) => generateEmbeddingDetailed(text),
    searchChunks: (q) => searchChunks(q),
    getFacts: async () => store.getActiveFacts(),
    getLiveData: async (permissions) => localLiveData(permissions),
    generate: (p) => aiGenerate(p),
  };
}

async function askViaEdge(client, body) {
  // le modifiche appena fatte (istruzioni, nuovi fatti) devono essere nel database prima che il server le legga
  if (cloud.started) await cloud.flush().catch(() => {});
  const { data, error } = await Promise.race([
    client.functions.invoke('personal-rag-chat', { body }),
    new Promise((_, rej) => setTimeout(() => rej(new GeminiError('timeout', `La chat personale non ha risposto entro ${EDGE_TIMEOUT_MS / 1000} secondi.`)), EDGE_TIMEOUT_MS)),
  ]);
  if (error) {
    let detail = error.message || 'errore sconosciuto';
    try {
      const j = await error.context?.json?.();
      if (j?.error?.message) detail = j.error.message;
    } catch {
      /* corpo non leggibile */
    }
    throw new GeminiError('unavailable', `La chat personale sul cloud non risponde (${detail}).`);
  }
  if (data?.ok) return data;
  const err = data?.error || {};
  throw new GeminiError(err.code || 'unavailable', err.message || 'Errore sconosciuto.');
}

/**
 * Fa una domanda al proprio archivio.
 * @param {object} args
 * @param {string} args.question
 * @param {Array<{role:'user'|'assistant', content:string}>} [args.history] scambi precedenti della stessa conversazione
 * @param {string|null} [args.domain] ambito scelto a mano; null = dedotto dalla domanda
 * @returns {Promise<{answer:string, sources:Array, domain:string, suggestedRule:object|null, model:string|null, provider:string|null, context:object, via:'edge'|'local'}>}
 */
export async function askPersonalRag({ question, history = [], domain = null }) {
  const q = String(question || '').trim();
  if (!q) throw new Error('Scrivi una domanda.');
  const client = getSupabase();
  if (client) {
    const res = await askViaEdge(client, { question: q, history, domain });
    return { ...res, via: 'edge' };
  }
  const res = await askRag({ question: q, history, domain, deps: localDeps(), today: todayIn(store.getSettings().timezone || 'Europe/Rome') });
  return { ...res, via: 'local' };
}

/**
 * "Salva regola in memoria": una decisione presa in chat diventa un fatto stabile, usato in tutte le risposte future.
 * Se esisteva già un valore per la stessa chiave, quello vecchio passa nello storico.
 */
export function saveRuleFromChat({ subject = 'Io', fact_key, fact_value, category = 'rule' }) {
  const res = upsertFact({ subject: String(subject || 'Io').trim() || 'Io', fact_key, fact_value, category });
  if (!res) throw new Error('Per salvare la regola servono una chiave e un valore.');
  return res;
}
