// tests/cloud.test.js
// Sincronizzazione cloud-first: l'app e il bot Telegram devono vedere gli stessi dati.
// Usa un Supabase finto ma severo (schema reale, RLS, vincoli) invece di mock che dicono sempre "ok".
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { store } from '../src/services/store.js';
import { cloud, toRow, fromRow } from '../src/services/cloud.js';
import { createFakeCloud } from './helpers/fake-supabase.js';

async function signedInClient(fake) {
  const { data } = await fake.browser().auth.signUp({ email: 'io@example.com', password: 'segreta123' });
  return { client: fake.browser(), userId: data.user.id };
}

describe('17. Cloud-first: sincronizzazione app ↔ Supabase', () => {
  let fake;
  beforeEach(() => {
    store.clearAll();
    fake = createFakeCloud();
  });
  afterEach(() => {
    cloud.stop();
  });

  it('1. una modifica locale arriva nel cloud col tuo user_id; i campi senza colonna finiscono in `extra`', async () => {
    const { client, userId } = await signedInClient(fake);
    await cloud.start(client, userId);

    const c = store.create('clients', { type: 'company', company_name: 'TechCorp', stack: 'Next.js', staging_url: 'https://stage.techcorp.it', maintenance_contracts: [{ amount: 300 }] });
    await cloud.flush();

    const row = fake.tables.clients.find(r => r.id === c.id);
    expect(row).toBeDefined();
    expect(row.user_id).toBe(userId);
    expect(row.company_name).toBe('TechCorp');
    expect(row.extra).toMatchObject({ stack: 'Next.js', staging_url: 'https://stage.techcorp.it' });
    expect(row.extra.maintenance_contracts).toEqual([{ amount: 300 }]);
    expect(cloud.getStatus().state).toBe('idle');
    expect(cloud.getStatus().pending).toBe(0);
  });

  it('2. aggiornamenti, cestino ed eliminazioni definitive si propagano; le colonne generate non vengono mai inviate', async () => {
    const { client, userId } = await signedInClient(fake);
    await cloud.start(client, userId);

    const item = store.create('trading_items', { title: 'GoPro', purchase_price: 100, extra_costs: 20 });
    await cloud.flush();
    store.update('trading_items', item.id, { sale_price: 180, platform_fees: 12, status: 'sold' });
    await cloud.flush();
    const row = fake.tables.trading_items.find(r => r.id === item.id);
    expect(row.net_profit).toBe(48); // calcolato dal database
    expect(row.status).toBe('sold');

    store.moveToTrash('trading_items', item.id);
    await cloud.flush();
    expect(fake.tables.trading_items.find(r => r.id === item.id).is_deleted).toBe(true);

    store.permanentDelete('trading_items', item.id);
    await cloud.flush();
    expect(fake.tables.trading_items).toHaveLength(0);
  });

  it('3. IL BUG ORIGINALE: righe scritte dal bot senza proprietario sono invisibili finché non esiste il tuo account, poi vengono adottate e compaiono nell\'app', async () => {
    // Il bot (service role) scrive prima che esista un utente → user_id vuoto
    const botDb = fake.service();
    await botDb.from('body_exercise_columns').insert({ id: 'col-pull-up', name: 'Pull Up', slug: 'pull_up', category: 'pull' });
    const { error } = await botDb.from('body_daily_logs').insert({ date: '2026-11-11', body_weight_kg: 75.1, calories_kcal: 2450 });
    expect(error).toBeNull();
    expect(fake.tables.body_daily_logs[0].user_id).toBeUndefined();

    // Un client senza login non vede nulla (RLS)
    const anon = await fake.browser().from('body_daily_logs').select('*');
    expect(anon.error).toBeTruthy();

    // Registrazione: la migration adotta le righe orfane
    const { client, userId } = await signedInClient(fake);
    expect(fake.tables.body_daily_logs[0].user_id).toBe(userId);
    await cloud.start(client, userId);

    const log = store.getAll('body_daily_logs').find(l => l.date === '2026-11-11');
    expect(log).toBeDefined();
    expect(log.body_weight_kg).toBe(75.1);
  });

  it('4. un solo utente: dopo il primo account le registrazioni sono chiuse', async () => {
    await signedInClient(fake);
    const second = await fake.browser().auth.signUp({ email: 'altro@example.com', password: 'xxxxxxxx' });
    expect(second.error.message).toMatch(/Registrazioni chiuse/);
    expect(fake.users).toHaveLength(1);
  });

  it('5. dal bot all\'app: un dato scritto dal bot dopo il login arriva in tempo reale e con l\'aggiornamento periodico', async () => {
    const { client, userId } = await signedInClient(fake);
    await cloud.start(client, userId);
    expect(store.getAll('finance_transactions')).toHaveLength(0);

    // Il bot scrive col proprio user_id (come fa la Edge Function riscritta)
    await fake.service().from('finance_transactions').insert({ user_id: userId, type: 'expense', amount: 45, description: 'Benzina', category: 'Trasporti & Viaggi', date: '2026-11-11' });
    expect(store.getAll('finance_transactions').some(t => t.description === 'Benzina')).toBe(true); // realtime

    // Senza realtime: aggiornamento incrementale
    cloud.stop();
    await cloud.start(client, userId);
    store.clearAll();
    await fake.service().from('finance_transactions').insert({ user_id: userId, type: 'income', amount: 500, description: 'Saldo sito', category: 'generale', date: '2026-11-12' });
    await cloud.pull();
    expect(store.getAll('finance_transactions').some(t => t.description === 'Saldo sito')).toBe(true);
  });

  it('6. conflitti: la modifica locale non ancora inviata batte quella del cloud; l\'eliminazione fatta altrove rimuove la riga locale', async () => {
    const { client, userId } = await signedInClient(fake);
    await cloud.start(client, userId);

    const a = store.create('todos', { title: 'Da tenere', priority: 'media', compensation_mode: 'none', source: 'manual', is_completed: false });
    const b = store.create('todos', { title: 'Da eliminare altrove', priority: 'media', compensation_mode: 'none', source: 'manual', is_completed: false });
    await cloud.flush();

    // modifica locale NON ancora inviata, poi arriva una modifica concorrente dal cloud
    store.update('todos', a.id, { title: 'Titolo locale non inviato' });
    await fake.service().from('todos').update({ title: 'Titolo dal cloud' }).eq('id', a.id);
    expect(store.getById('todos', a.id).title).toBe('Titolo locale non inviato'); // il cloud non sovrascrive il lavoro in corso

    // eliminazione altrove di un elemento non modificato in locale
    await fake.service().from('todos').delete().eq('id', b.id);
    expect(store.getById('todos', b.id)).toBeNull();

    await cloud.flush();
    expect(fake.tables.todos.find(r => r.id === a.id).title).toBe('Titolo locale non inviato');
  });

  it('6b. dopo un riavvio lo stato sincronizzato è ricordato: le modifiche offline non vengono perse e le eliminazioni altrove sì applicate', async () => {
    const memory = new Map();
    globalThis.localStorage = { getItem: k => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k) };
    try {
      const { client, userId } = await signedInClient(fake);
      await cloud.start(client, userId);
      const keep = store.create('todos', { title: 'Originale', priority: 'media', compensation_mode: 'none', source: 'manual', is_completed: false });
      const gone = store.create('todos', { title: 'Sparirà', priority: 'media', compensation_mode: 'none', source: 'manual', is_completed: false });
      await cloud.flush();
      cloud.stop();

      // offline: modifica locale; nel frattempo il cloud cambia e un altro dispositivo elimina "gone"
      store.update('todos', keep.id, { title: 'Modificato offline' });
      await fake.service().from('todos').update({ title: 'Cambiato nel cloud' }).eq('id', keep.id);
      await fake.service().from('todos').delete().eq('id', gone.id);

      await cloud.start(client, userId); // riavvio con snapshot persistente
      await cloud.flush();
      expect(fake.tables.todos.find(r => r.id === keep.id).title).toBe('Modificato offline');
      expect(store.getById('todos', gone.id)).toBeNull();
    } finally {
      delete globalThis.localStorage;
    }
  });

  it('7. una riga rifiutata dal database non blocca le altre e l\'errore è VISIBILE (mai silenzioso)', async () => {
    const { client, userId } = await signedInClient(fake);
    await cloud.start(client, userId);

    store.create('clients', { type: 'company', company_name: 'Valido' });
    store.create('clients', { type: 'azienda-sbagliata', company_name: 'Rifiutato' }); // viola il CHECK su clients.type
    await cloud.flush();

    expect(fake.tables.clients.map(r => r.company_name)).toEqual(['Valido']);
    const status = cloud.getStatus();
    expect(status.state).toBe('error');
    expect(status.failedRows).toBe(1);
    expect(status.lastError).toMatch(/clients/);
  });

  it('8. offline: l\'errore di rete è segnalato come "offline" e le modifiche partono appena torna la rete', async () => {
    const { client, userId } = await signedInClient(fake);
    await cloud.start(client, userId);

    fake.failNext('clients', { message: 'Failed to fetch' });
    store.create('clients', { type: 'company', company_name: 'Offline Srl' });
    await cloud.flush();
    expect(cloud.getStatus().state).toBe('offline');
    expect(fake.tables.clients).toHaveLength(0);

    await cloud.flush(); // la rete è tornata
    expect(fake.tables.clients).toHaveLength(1);
    expect(cloud.getStatus().state).toBe('idle');
  });

  it('9. protezione: una cancellazione di massa accidentale viene bloccata, quella voluta (reset) passa', async () => {
    const { client, userId } = await signedInClient(fake);
    await cloud.start(client, userId);
    for (let i = 0; i < 15; i++) store.create('todos', { title: `T${i}`, priority: 'media', compensation_mode: 'none', source: 'manual', is_completed: false });
    await cloud.flush();
    expect(fake.tables.todos).toHaveLength(15);

    store.bulkDeleteAllowedUntil = 0; // (il reset del test precedente aveva aperto il permesso)
    store.data.todos = []; // bug o cache svuotata per errore: nessun permesso esplicito
    store.save();
    await cloud.flush();
    expect(fake.tables.todos).toHaveLength(15); // il cloud è intatto
    expect(cloud.getStatus().state).toBe('error');
    expect(cloud.getStatus().lastError).toMatch(/bloccata per sicurezza/);

    store.data.todos = [];
    store.allowBulkDelete();
    store.save();
    await cloud.flush();
    expect(fake.tables.todos).toHaveLength(0);
  });

  it('10. le chiavi segrete restano sul dispositivo; le impostazioni normali viaggiano nel cloud', async () => {
    const { client, userId } = await signedInClient(fake);
    await cloud.start(client, userId);
    store.updateSettings({ business_name: 'Studio Rossi', gemini_api_key: 'SEGRETA', telegram_bot_token: '123:ABC', dev_hourly_rate: 65 });
    await cloud.flush();

    const row = fake.tables.settings[0];
    expect(row.business_name).toBe('Studio Rossi');
    expect(row.extra.dev_hourly_rate).toBe(65);
    expect(JSON.stringify(row)).not.toMatch(/SEGRETA|123:ABC/);
  });

  it('11. mapping: ora a muro dei to-do, embedding e righe del Brain tornano identici dopo andata e ritorno', () => {
    const todoRow = toRow('todos', { id: '00000000-0000-4000-8000-0000000000aa', title: 'Deploy', due_date: '2026-11-12T15:00', priority: 'alta', compensation_mode: 'none', source: 'manual', is_completed: false, custom_flag: 'x' }, 'u1');
    expect(todoRow.extra).toEqual({ custom_flag: 'x' });
    // il database restituisce un istante con fuso: l'app lo vuole come ora a muro
    const back = fromRow('todos', { ...todoRow, due_date: '2026-11-12T15:00:00+00:00', extra: todoRow.extra });
    expect(back.due_date).toBe('2026-11-12T15:00:00');
    expect(back.custom_flag).toBe('x');

    const memRow = toRow('brain_memories', { id: '00000000-0000-4000-8000-0000000000bb', content: 'nota', domain: 'work', source_type: 'manual', embedding: [0.1, 0.2] }, 'u1');
    expect(memRow.embedding).toBe('[0.1,0.2]');
    expect(fromRow('brain_memories', { ...memRow }).embedding).toEqual([0.1, 0.2]);

    // stringhe vuote su colonne date/uuid diventano NULL invece di far fallire l'inserimento
    const quoteRow = toRow('quotes', { id: '00000000-0000-4000-8000-0000000000cc', quote_number: 'P1', title: 'T', issue_date: '2026-11-11', valid_until: '', client_id: '', status: 'bozza', work_status: 'Da iniziare', show_total_in_pdf: true }, 'u1');
    expect(quoteRow.valid_until).toBeNull();
    expect(quoteRow.client_id).toBeNull();
  });
});
