// src/services/rag-server.js
// "Chiedi a te stesso" lato server: legge profilo, fatti, pezzi e dati vivi direttamente dal database e chiama l'IA.
// Usato dall'Edge Function dell'app (personal-rag-chat, con i permessi dell'utente collegato) e dal bot Telegram
// (comando /ask, con la chiave di servizio: per questo ogni lettura è filtrata esplicitamente per utente).
// Il ragionamento (ricerca, regole a strati, interruttori privacy, citazioni) è tutto in rag-core.js: qui c'è solo
// "da dove prendo i dati".

import { askRag, todayIn } from './rag-core.js';
import { generateStructured, openaiEmbed } from './ai-providers.js';
import { embed as geminiEmbed } from './gemini-core.js';

const flat = (row) => ({ ...(row?.extra && typeof row.extra === 'object' ? row.extra : {}), ...row });

function rows(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data || []).map(flat);
}

/** IA: vettori (OpenAI; Gemini solo se la chiave OpenAI non c'è) e risposta (fornitori in fila). */
export function createAiDeps({ env = {}, fetchFn = fetch }) {
  const openaiKey = env.OPENAI_API_KEY || '';
  const geminiKey = env.GEMINI_API_KEY || '';
  const anthropicKey = env.ANTHROPIC_API_KEY || '';
  return {
    async embed(text) {
      if (openaiKey) {
        const { vectors } = await openaiEmbed({ apiKey: openaiKey, env, fetchFn, texts: [text] });
        return { values: vectors[0], source: 'openai' };
      }
      if (geminiKey) {
        const { values } = await geminiEmbed({ apiKey: geminiKey, env, fetchFn, text });
        return { values, source: 'gemini' };
      }
      return null; // nessuna chiave: si cerca solo per parole esatte
    },
    generate({ system, parts, json = true, temperature = 0.3, maxTokens = 3000, budgetMs = 45000 }) {
      return generateStructured({ openaiKey, geminiKey, anthropicKey, env, fetchFn, system, parts, json, temperature, maxTokens, budgetMs });
    },
  };
}

/**
 * Dati: tutto letto dal database. `userId` va passato quando il client salta le regole RLS (chiave di servizio);
 * con il client dell'utente collegato può restare null (le regole RLS filtrano già).
 */
export function createDataDeps({ client, userId = null, today = todayIn() }) {
  const own = (q) => (userId ? q.eq('user_id', userId) : q);
  return {
    async getProfile() {
      const res = await own(client.from('brain_assistant_profiles').select('*')).order('updated_at', { ascending: false }).limit(1);
      return rows(res, 'Lettura del profilo')[0] || null;
    },

    async searchChunks({ embedding, source, text, limit }) {
      const res = await client.rpc('match_brain_memories_hybrid', {
        query_embedding: embedding ? JSON.stringify(embedding) : null,
        query_text: text,
        match_threshold: 0.35,
        match_count: limit,
        filter_domain: null,
        filter_source: source || 'openai',
        filter_user: userId,
      });
      if (res.error) throw new Error(`Ricerca: ${res.error.message}`);
      return res.data || [];
    },

    async getFacts() {
      const res = await own(client.from('brain_facts').select('*')).eq('is_active', true).limit(400);
      return rows(res, 'Lettura dei fatti');
    },

    /** Si leggono SOLO le tabelle il cui interruttore è acceso: i dati spenti non lasciano mai il database. */
    async getLiveData(permissions = {}) {
      const raw = {};
      const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
      if (permissions.body === true) {
        raw.dailyLogs = rows(await own(client.from('body_daily_logs').select('*')).gte('date', weekAgo), 'Diario corpo');
        raw.workouts = rows(await own(client.from('body_workout_entries').select('*')).gte('date', weekAgo), 'Allenamenti');
        raw.columns = rows(await own(client.from('body_exercise_columns').select('*')), 'Esercizi');
      }
      if (permissions.todos_calendar === true) {
        raw.todos = rows(await own(client.from('todos').select('*')).eq('is_completed', false).limit(100), 'Cose da fare');
        raw.appointments = rows(await own(client.from('appointments').select('*')).gte('start_time', today).limit(100), 'Agenda');
      }
      if (permissions.clients === true) {
        raw.clients = rows(await own(client.from('clients').select('*')).limit(100), 'Clienti');
        raw.quotes = rows(await own(client.from('quotes').select('*')).limit(100), 'Preventivi');
      }
      if (permissions.finances === true) {
        const monthStart = `${today.slice(0, 7)}-01`;
        const prevMonth = new Date(Date.parse(`${monthStart}T00:00:00Z`) - 31 * 86400000).toISOString().slice(0, 10);
        raw.transactions = rows(await own(client.from('finance_transactions').select('*')).gte('date', prevMonth).limit(500), 'Movimenti');
        raw.tradingItems = rows(await own(client.from('trading_items').select('*')).limit(300), 'Compravendita');
      }
      return raw;
    },
  };
}

/**
 * Una domanda, una risposta con le fonti.
 * @returns {Promise<{answer:string, sources:Array, domain:string, suggestedRule:object|null, model:string|null, provider:string|null, context:object}>}
 */
export async function askPersonalRagServer({ client, userId = null, env = {}, fetchFn = fetch, question, history = [], domain = null, today = todayIn(env.TIMEZONE || 'Europe/Rome') }) {
  const deps = { ...createDataDeps({ client, userId, today }), ...createAiDeps({ env, fetchFn }) };
  return askRag({ question, history, domain, deps, today });
}
