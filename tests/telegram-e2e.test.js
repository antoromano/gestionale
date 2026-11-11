// tests/telegram-e2e.test.js
// Percorso reale: messaggio Telegram → handler della Edge Function → database (con RLS) → app.
// Il bot può dire "salvato" SOLO se il database ha davvero confermato.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleUpdate, isAuthorized, parseCommand } from '../supabase/functions/telegram-webhook/handler.js';
import { pickGenerateModel, pickEmbedModel, generate, embed, GeminiError, clearModelCache, diagnose } from '../src/services/gemini-core.js';
import { store } from '../src/services/store.js';
import { cloud } from '../src/services/cloud.js';
import { createFakeCloud } from './helpers/fake-supabase.js';

const OWNER_TG = 99887766;
const MODELS_OK = [
  { name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
];

/** fetch finto: registra i messaggi Telegram e simula Gemini */
function makeFetch({ models = MODELS_OK, generateResponse = null, generateStatus = 200 } = {}) {
  const log = { telegram: [], gemini: [] };
  const fn = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    if (u.includes('api.telegram.org')) {
      log.telegram.push({ method: u.split('/').pop(), ...body });
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    }
    if (u.endsWith('/v1beta/models') || u.includes('/v1beta/models?')) {
      return { ok: true, json: async () => ({ models }), text: async () => '' };
    }
    if (u.includes(':generateContent')) {
      log.gemini.push(body);
      if (generateStatus !== 200) return { ok: false, status: generateStatus, text: async () => JSON.stringify({ error: { message: 'model not found' } }) };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(generateResponse || {}) }] } }] }) };
    }
    return { ok: false, status: 404, text: async () => 'not found' };
  };
  return { fn, log };
}

const textMsg = (text, extra = {}) => ({
  update_id: 1,
  message: { message_id: 10, date: Math.floor(Date.parse('2026-11-11T09:00:00Z') / 1000), chat: { id: OWNER_TG }, from: { id: OWNER_TG, username: 'antonio' }, text, ...extra },
});
const lastText = log => log.telegram.filter(t => t.method === 'sendMessage').pop()?.text || '';

describe('18. Telegram → cloud → app (percorso reale, con RLS)', () => {
  let fake;
  let owner;
  const baseEnv = { TELEGRAM_BOT_TOKEN: 'TKN', TELEGRAM_ALLOWED_USER_ID: String(OWNER_TG) };

  beforeEach(async () => {
    clearModelCache();
    store.clearAll();
    fake = createFakeCloud();
    const { data } = await fake.browser().auth.signUp({ email: 'io@example.com', password: 'segreta123' });
    owner = data.user.id;
  });
  afterEach(() => cloud.stop());

  it('1. IL TUO CASO: "Pull Up 20(10,10,10,10), peso 75.1kg" su Telegram compare nell\'app, col tuo user_id', async () => {
    const { fn, log } = makeFetch();
    const res = await handleUpdate(textMsg('Pull Up 20(10,10,10,10), peso 75.1kg'), { env: baseEnv, supabase: fake.service(), fetch: fn });
    expect(res.body.ok).toBe(true);

    // il database ha davvero le righe, col proprietario giusto
    const logRow = fake.tables.body_daily_logs[0];
    expect(logRow.user_id).toBe(owner);
    expect(logRow.body_weight_kg).toBe(75.1);
    expect(fake.tables.body_workout_entries[0].column_id).toBe('col-pull-up');
    expect(fake.tables.body_exercise_columns[0].id).toBe('col-pull-up');

    // la risposta è onesta e ha il pulsante Annulla
    const sent = log.telegram.filter(t => t.method === 'sendMessage').pop();
    expect(sent.text).toContain('Registrato in Body');
    expect(sent.reply_markup.inline_keyboard[0][0].callback_data).toMatch(/^undo:/);

    // e l'APP lo vede (prima era impossibile)
    await cloud.start(fake.browser(), owner);
    const appLog = store.getAll('body_daily_logs').find(l => l.date === '2026-11-11');
    expect(appLog.body_weight_kg).toBe(75.1);
    expect(store.getAll('body_workout_entries')).toHaveLength(1);
  });

  it('2. con l\'app già aperta il dato del bot arriva da solo (tempo reale)', async () => {
    await cloud.start(fake.browser(), owner);
    const { fn } = makeFetch();
    await handleUpdate(textMsg('peso 74.8 kg, dormito 8 ore'), { env: baseEnv, supabase: fake.service(), fetch: fn });
    expect(store.getAll('body_daily_logs')[0]).toMatchObject({ body_weight_kg: 74.8, sleep_hours: 8 });
  });

  it('3. senza account il bot NON finge di salvare e non lascia righe orfane', async () => {
    const empty = createFakeCloud(); // nessun utente registrato
    const { fn, log } = makeFetch();
    const res = await handleUpdate(textMsg('peso 75 kg, 2400 kcal'), { env: baseEnv, supabase: empty.service(), fetch: fn });
    expect(res.body.ok).toBe(false);
    expect(lastText(log)).toContain('Non ho salvato nulla');
    expect(lastText(log)).not.toContain('Registrato');
    expect(empty.tables.body_daily_logs).toHaveLength(0);
  });

  it('4. se il database rifiuta la scrittura il bot lo dice e NON scrive "✅ Registrato"', async () => {
    const { fn, log } = makeFetch();
    fake.failNext('body_daily_logs', { message: 'disk full' }, true);
    await handleUpdate(textMsg('peso 75 kg, 2400 kcal'), { env: baseEnv, supabase: fake.service(), fetch: fn });
    const text = lastText(log);
    expect(text).toContain('Non salvato');
    expect(text).toContain('disk full');
    expect(text).not.toContain('✅ <b>Registrato');
  });

  it('5. sicurezza: utente non autorizzato respinto; senza TELEGRAM_ALLOWED_USER_ID il bot non accetta nessuno', async () => {
    expect(isAuthorized({ TELEGRAM_ALLOWED_USER_ID: '1,2' }, 2, 5)).toBe(true);
    expect(isAuthorized({ TELEGRAM_ALLOWED_USER_ID: '' }, 99887766, 99887766)).toBe(false);

    const { fn, log } = makeFetch();
    const intruder = { update_id: 2, message: { message_id: 1, date: 1, chat: { id: 555 }, from: { id: 555 }, text: 'peso 80 kg, 2000 kcal' } };
    const res = await handleUpdate(intruder, { env: baseEnv, supabase: fake.service(), fetch: fn });
    expect(res.body.unauthorized).toBe(true);
    expect(fake.tables.body_daily_logs).toHaveLength(0);
    expect(lastText(log)).toContain('Non sei autorizzato');

    const open = await handleUpdate(textMsg('peso 80 kg, 2000 kcal'), { env: { TELEGRAM_BOT_TOKEN: 'TKN' }, supabase: fake.service(), fetch: fn });
    expect(open.body.unauthorized).toBe(true);
    expect(fake.tables.body_daily_logs).toHaveLength(0);
  });

  it('6. il pulsante Annulla rimuove ciò che il bot ha inserito', async () => {
    const { fn, log } = makeFetch();
    const deps = { env: baseEnv, supabase: fake.service(), fetch: fn };
    await handleUpdate(textMsg('Dips 25(8,8,8), peso 75 kg'), deps);
    expect(fake.tables.body_workout_entries).toHaveLength(1);

    const data = log.telegram.filter(t => t.method === 'sendMessage').pop().reply_markup.inline_keyboard[0][0].callback_data;
    const res = await handleUpdate({ callback_query: { id: 'cb1', from: { id: OWNER_TG }, data, message: { chat: { id: OWNER_TG }, message_id: 5 } } }, deps);
    expect(res.body.status).toBe('undone');
    expect(fake.tables.body_workout_entries).toHaveLength(0);
    expect(fake.tables.body_daily_logs).toHaveLength(0);
  });

  it('7. /queue + /digest: N note → UNA chiamata IA; finanze, to-do e body finiscono nell\'app; le note risultano elaborate', async () => {
    const { fn, log } = makeFetch({
      generateResponse: {
        summary: '1 → Finanze · 2 → To-do · 3 → Body',
        finance_transactions: [{ type: 'expense', amount: 45, description: 'Benzina', category: 'Trasporti & Viaggi', date: '2026-11-11' }],
        todos: [{ title: 'Richiamare Marco', priority: 'media' }],
        body_log: { date: '2026-11-11', body_weight_kg: 75.1, workouts: [{ exercise_name: 'Pull Up', raw_notation: '20(10,10,10,10)' }] },
      },
    });
    const deps = { env: { ...baseEnv, GEMINI_API_KEY: 'KEY' }, supabase: fake.service(), fetch: fn };
    await handleUpdate(textMsg('/queue ho speso 45€ di benzina'), deps);
    await handleUpdate(textMsg('/queue richiamare Marco'), deps);
    await handleUpdate(textMsg('/queue Pull Up 20(10,10,10,10), peso 75.1'), deps);
    expect(fake.tables.ai_note_queue).toHaveLength(3);
    expect(fake.tables.ai_note_queue.every(n => n.user_id === owner && n.source === 'telegram')).toBe(true);
    expect(log.gemini).toHaveLength(0); // /queue non usa l'IA

    await handleUpdate(textMsg('/digest'), deps);
    expect(log.gemini).toHaveLength(1); // 3 note → 1 chiamata
    expect(JSON.stringify(log.gemini[0])).toContain('richiamare Marco');
    expect(fake.tables.ai_note_queue.every(n => n.status === 'processed')).toBe(true);
    expect(fake.tables.finance_transactions[0]).toMatchObject({ user_id: owner, type: 'expense', amount: 45 });
    expect(fake.tables.todos[0]).toMatchObject({ user_id: owner, title: 'Richiamare Marco', source: 'ai' });
    expect(lastText(log)).toContain('Digest completato');

    await cloud.start(fake.browser(), owner);
    expect(store.getAll('finance_transactions')).toHaveLength(1);
    expect(store.getAll('todos')).toHaveLength(1);
    expect(store.getQueuedNotes()).toHaveLength(0);
  });

  it('8. IA non disponibile: /digest lo dice col motivo e le note restano in coda; sul testo semplice usa le regole con AVVISO', async () => {
    const { fn, log } = makeFetch({ generateStatus: 404 });
    const deps = { env: { ...baseEnv, GEMINI_API_KEY: 'KEY' }, supabase: fake.service(), fetch: fn };
    await handleUpdate(textMsg('/queue ho speso 45€ di benzina'), deps);
    await handleUpdate(textMsg('/digest'), deps);
    expect(lastText(log)).toContain('Digest non eseguito');
    expect(lastText(log)).toContain('non è più disponibile');
    expect(fake.tables.ai_note_queue[0].status).toBe('queued');

    clearModelCache();
    await handleUpdate(textMsg('Pull Up 20(10,10), peso 75 kg'), deps);
    expect(lastText(log)).toContain('IA non disponibile');
    expect(lastText(log)).toContain('Registrato in Body'); // regole semplici, ma dichiarato
    expect(fake.tables.body_workout_entries).toHaveLength(1);
  });

  it('9. Second Brain da Telegram: nuovo argomento → conferma con pulsante → memoria, nodo e fatto con il tuo user_id', async () => {
    const { fn, log } = makeFetch();
    const deps = { env: baseEnv, supabase: fake.service(), fetch: fn };
    await handleUpdate(textMsg('Ricetta Carbonara: 4 tuorli, 200g guanciale, 80g pecorino'), deps);
    const sent = log.telegram.filter(t => t.method === 'sendMessage').pop();
    const confirmData = sent.reply_markup.inline_keyboard[0][0].callback_data;
    expect(fake.tables.brain_memories).toHaveLength(0); // niente alla cieca

    const res = await handleUpdate({ callback_query: { id: 'cb', from: { id: OWNER_TG }, data: confirmData, message: { chat: { id: OWNER_TG }, message_id: 3 } } }, deps);
    expect(res.body.status).toBe('confirmed');
    expect(fake.tables.brain_memories[0]).toMatchObject({ user_id: owner, source_type: 'telegram' });
    expect(fake.tables.brain_nodes[0].user_id).toBe(owner);
    expect(fake.tables.brain_facts[0].user_id).toBe(owner);
  });

  it('10. parseCommand riconosce solo i comandi del bot', () => {
    expect(parseCommand('/digest')).toEqual({ name: 'digest', args: '' });
    expect(parseCommand('/queue@MioBot ciao')).toEqual({ name: 'queue', args: 'ciao' });
    expect(parseCommand('/altro')).toBeNull();
  });
});

describe('19. Gemini: nessun nome di modello scritto nel codice, errori sempre espliciti', () => {
  beforeEach(() => clearModelCache());

  it('1. sceglie il modello da quelli disponibili: alias "latest", altrimenti l\'ultima versione stabile; ignora lite/preview/tts', () => {
    expect(pickGenerateModel(MODELS_OK)).toBe('gemini-flash-latest');
    const noAlias = ['gemini-2.5-flash', 'gemini-3.1-flash', 'gemini-3.1-flash-lite', 'gemini-3.2-flash-preview', 'gemini-3.1-flash-tts', 'gemini-4-pro']
      .map(n => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] }));
    expect(pickGenerateModel(noAlias)).toBe('gemini-3.1-flash');
    expect(() => pickGenerateModel([{ name: 'models/gemini-1.5-flash', supportedGenerationMethods: [] }])).toThrow(/Nessun modello/);
    expect(() => pickGenerateModel(MODELS_OK, 'gemini-1.5-flash')).toThrow(/non è disponibile/);
    expect(pickEmbedModel(MODELS_OK)).toBe('gemini-embedding-001');
  });

  it('2. errori mappati con codice e messaggio in italiano (chiave errata, modello sparito, quota, rete)', async () => {
    const mk = (status, message) => async url => (String(url).includes('/models?') ? { ok: true, json: async () => ({ models: MODELS_OK }) } : { ok: false, status, text: async () => JSON.stringify({ error: { message } }) });
    const call = f => generate({ apiKey: 'AIzaKEY1234', fetchFn: f, parts: [{ text: 'x' }] }).catch(e => e);

    expect(await call(mk(400, 'API key not valid. Please pass a valid API key.'))).toMatchObject({ code: 'invalid_api_key' });
    clearModelCache();
    expect(await call(mk(404, 'models/x is not found'))).toMatchObject({ code: 'model_unavailable' });
    clearModelCache();
    expect(await call(mk(429, 'quota'))).toMatchObject({ code: 'quota' });
    clearModelCache();
    expect(await call(async () => { throw new Error('boom'); })).toMatchObject({ code: 'network' });
    expect(await generate({ apiKey: '', parts: [] }).catch(e => e)).toBeInstanceOf(GeminiError);
  });

  it('3. risposta JSON in blocco ```json e embedding a 768 dimensioni verificati; dimensione sbagliata = errore', async () => {
    const f = async (url) => {
      const u = String(url);
      if (u.includes('/models?')) return { ok: true, json: async () => ({ models: MODELS_OK }) };
      if (u.includes(':generateContent')) return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '```json\n{"ok": true}\n```' }] } }] }) };
      if (u.includes(':embedContent')) return { ok: true, json: async () => ({ embedding: { values: new Array(768).fill(0.1) } }) };
    };
    expect((await generate({ apiKey: 'AIzaKEY1234', fetchFn: f, parts: [{ text: 'x' }] })).data).toEqual({ ok: true });
    expect((await embed({ apiKey: 'AIzaKEY1234', fetchFn: f, text: 'ciao' })).values).toHaveLength(768);
    const bad = async (url) => (String(url).includes('/models?') ? { ok: true, json: async () => ({ models: MODELS_OK }) } : { ok: true, json: async () => ({ embedding: { values: [1, 2, 3] } }) });
    clearModelCache();
    expect(await embed({ apiKey: 'AIzaKEY1234', fetchFn: bad, text: 'x' }).catch(e => e)).toMatchObject({ code: 'bad_dimension' });
    clearModelCache();
    const d = await diagnose({ apiKey: 'AIzaKEY1234', fetchFn: f });
    expect(d).toMatchObject({ generateModel: 'gemini-flash-latest', probeOk: true });
  });

  it('4. le copie condivise nelle Edge Function sono identiche alla fonte in src/ (nessuna deriva)', () => {
    const strip = t => t.split('\n').slice(1).join('\n');
    const pairs = [
      ['src/utils/body-parser.js', 'supabase/functions/telegram-webhook/body-parser.js'],
      ['src/services/gemini-core.js', 'supabase/functions/telegram-webhook/gemini-core.js'],
      ['src/services/gemini-core.js', 'supabase/functions/gemini-assistant/gemini-core.js'],
    ];
    for (const [src, copy] of pairs) {
      expect(strip(readFileSync(copy, 'utf8')), `${copy} è fuori sincronia: esegui node scripts/sync-edge-shared.mjs`).toBe(readFileSync(src, 'utf8'));
    }
  });
});
