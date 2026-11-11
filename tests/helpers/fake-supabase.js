// tests/helpers/fake-supabase.js
// Supabase "finto ma severo": rispetta lo schema reale (colonne inesistenti, NOT NULL, colonne generate, tipi),
// alcuni CHECK, le policy RLS (auth.uid() = user_id), il blocco a un solo utente e l'adozione delle righe orfane.
// Serve a provare il percorso COMPLETO Telegram → cloud → app, cosa che i test originali non facevano.

import { CLOUD_SCHEMA } from '../../src/services/cloud-schema.js';

const CHECKS = {
  clients: { type: ['person', 'company'] },
  todos: { priority: ['bassa', 'media', 'alta', 'urgente'], source: ['manual', 'ai', 'integration'], compensation_mode: ['autonomous', 'included_in_quote', 'extra', 'none'] },
  quotes: { status: ['bozza', 'inviato', 'accettato', 'rifiutato', 'scaduto'] },
  payments: { status: ['previsto', 'incassato', 'annullato'], type: ['acconto', 'saldo', 'extra', 'rimborso', 'altro'] },
  finance_transactions: { type: ['income', 'expense'], recurrence_frequency: ['monthly', 'yearly', 'weekly', 'annual'] },
  trading_items: { status: ['in_stock', 'sold', 'reserved', 'returned'] },
  ai_note_queue: { source: ['web', 'telegram'], status: ['queued', 'processed'] },
};

// Tabelle (oltre a quelle in CLOUD_SCHEMA) usate solo dal bot
const EXTRA_TABLES = ['telegram_pending_actions', 'telegram_bot_subscribers'];

let uuidCounter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`;

let clock = Date.parse('2026-11-11T10:00:00.000Z');
const tick = () => new Date((clock += 1000)).toISOString();

const TYPE_CHECKS = {
  uuid: v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v)),
  date: v => /^\d{4}-\d{2}-\d{2}/.test(String(v)),
  numeric: v => typeof v === 'number' && Number.isFinite(v),
  bool: v => typeof v === 'boolean',
};

export function createFakeCloud() {
  const tables = {};
  for (const name of [...Object.keys(CLOUD_SCHEMA), ...EXTRA_TABLES]) tables[name] = [];
  const users = [];
  const channels = [];
  const state = { failNext: null, calls: [] };

  const generatedFor = (table, row) => {
    if (table === 'trading_items') {
      const sale = row.sale_price;
      if (sale === null || sale === undefined) return { net_profit: null, roi_percent: null };
      const cost = Number(row.purchase_price) + Number(row.extra_costs || 0);
      const net = Number(sale) - cost - Number(row.platform_fees || 0);
      return { net_profit: Math.round(net * 100) / 100, roi_percent: cost > 0 ? Math.round((net / cost) * 10000) / 100 : null };
    }
    return {};
  };

  function validate(table, row, isInsert) {
    const cols = CLOUD_SCHEMA[table];
    if (!cols) return null; // tabelle del bot: nessuna validazione di schema
    for (const [key, value] of Object.entries(row)) {
      const spec = cols[key];
      if (!spec) return { code: 'PGRST204', message: `Could not find the '${key}' column of '${table}' in the schema cache` };
      if (spec.g && value !== undefined) return { code: '428C9', message: `cannot insert a non-DEFAULT value into column "${key}"` };
      if (value === null || value === undefined) continue;
      const base = spec.t;
      if (TYPE_CHECKS[base] && !TYPE_CHECKS[base](value)) return { code: '22P02', message: `invalid input syntax for type ${base}: "${value}" (column ${key})` };
      if (base.startsWith('int') && !Number.isInteger(value)) return { code: '22P02', message: `invalid input syntax for type integer: "${value}" (column ${key})` };
      const allowed = CHECKS[table]?.[key];
      if (allowed && !allowed.includes(value)) return { code: '23514', message: `new row for relation "${table}" violates check constraint on "${key}"` };
    }
    if (isInsert) {
      for (const [key, spec] of Object.entries(cols)) {
        if (!spec.n && !spec.d && !spec.g && (row[key] === undefined || row[key] === null)) {
          return { code: '23502', message: `null value in column "${key}" of relation "${table}" violates not-null constraint` };
        }
      }
    }
    return null;
  }

  function emit(table, eventType, row, old) {
    for (const ch of channels) {
      for (const h of ch.handlers) {
        if (h.table === table && ch.uid && (row?.user_id === ch.uid || old?.user_id === ch.uid)) {
          h.cb({ eventType, new: row, old: old || {}, table });
        }
      }
    }
  }

  function makeClient(uid, { service = false } = {}) {
    const visible = (table, row) => service || (uid && row.user_id === uid);

    function from(table) {
      if (!tables[table]) {
        return { select: () => ({ then: res => res({ data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } }) }) };
      }
      const q = { op: 'select', filters: [], order: null, range: null, limit: null, single: false, head: false, count: false, returning: false, values: null, opts: {} };

      const exec = () => {
        state.calls.push({ table, op: q.op, as: service ? 'service' : uid ? 'user' : 'anon', rows: Array.isArray(q.values) ? q.values.length : undefined });
        if (state.failNext && state.failNext.table === table) {
          const err = state.failNext.error;
          if (!state.failNext.sticky) state.failNext = null;
          return { data: null, error: err };
        }
        if (!service && !uid) return { data: null, error: { code: '42501', message: 'permission denied (not authenticated)' } };

        const match = row => q.filters.every(f => f(row));
        const rows = tables[table];

        if (q.op === 'select') {
          let out = rows.filter(r => visible(table, r) && match(r));
          if (q.order) out = [...out].sort((a, b) => String(a[q.order.col]).localeCompare(String(b[q.order.col])) * (q.order.asc ? 1 : -1));
          const total = out.length;
          if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
          if (q.limit !== null) out = out.slice(0, q.limit);
          if (q.head) return { data: null, error: null, count: total };
          const data = out.map(r => structuredClone(r));
          if (q.single) return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
          return { data, error: null, count: q.count ? total : undefined };
        }

        if (q.op === 'insert' || q.op === 'upsert') {
          const incoming = Array.isArray(q.values) ? q.values : [q.values];
          const written = [];
          // controllo atomico: se una riga è sbagliata, nessuna viene scritta (come un'unica istruzione SQL)
          const prepared = [];
          for (const input of incoming) {
            const row = { ...input };
            if (!service && row.user_id !== undefined && row.user_id !== uid) {
              return { data: null, error: { code: '42501', message: `new row violates row-level security policy for table "${table}"` } };
            }
            if (!service && row.user_id === undefined && 'user_id' in (CLOUD_SCHEMA[table] || { user_id: 1 })) row.user_id = uid;
            const conflictKey = q.opts.onConflict || 'id';
            const existing = q.op === 'upsert' && row[conflictKey] !== undefined
              ? rows.find(r => r[conflictKey] === row[conflictKey] && (service || r.user_id === uid))
              : null;
            const err = validate(table, row, !existing);
            if (err) return { data: null, error: err };
            prepared.push({ row, existing });
          }
          for (const { row, existing } of prepared) {
            if (existing) {
              const old = structuredClone(existing);
              Object.assign(existing, row, { updated_at: tick() }, generatedFor(table, { ...existing, ...row }));
              written.push(existing);
              emit(table, 'UPDATE', structuredClone(existing), old);
            } else {
              const hasId = CLOUD_SCHEMA[table] ? Boolean(CLOUD_SCHEMA[table].id) : table !== 'telegram_bot_subscribers';
              const full = { id: hasId ? uuid() : undefined, created_at: tick(), updated_at: tick(), extra: CLOUD_SCHEMA[table]?.extra ? {} : undefined, ...row };
              if (!hasId) delete full.id;
              if (full.extra === undefined) delete full.extra;
              if (CLOUD_SCHEMA[table] && 'is_deleted' in CLOUD_SCHEMA[table] && full.is_deleted === undefined) full.is_deleted = false;
              Object.assign(full, generatedFor(table, full));
              rows.push(full);
              written.push(full);
              emit(table, 'INSERT', structuredClone(full));
            }
          }
          if (q.returning) {
            const data = written.map(r => structuredClone(r));
            return q.single ? { data: data[0] || null, error: null } : { data, error: null };
          }
          return { data: null, error: null };
        }

        if (q.op === 'update') {
          const targets = rows.filter(r => visible(table, r) && match(r));
          const err = validate(table, q.values, false);
          if (err) return { data: null, error: err };
          for (const r of targets) {
            const old = structuredClone(r);
            Object.assign(r, q.values, { updated_at: tick() });
            emit(table, 'UPDATE', structuredClone(r), old);
          }
          return { data: q.returning ? targets.map(r => structuredClone(r)) : null, error: null };
        }

        if (q.op === 'delete') {
          const targets = rows.filter(r => visible(table, r) && match(r));
          for (const r of targets) {
            rows.splice(rows.indexOf(r), 1);
            emit(table, 'DELETE', null, structuredClone(r));
          }
          return { data: null, error: null };
        }
        return { data: null, error: { message: 'operazione non supportata' } };
      };

      const builder = {
        select(_cols, opts = {}) {
          if (q.op === 'select') {
            q.head = Boolean(opts.head);
            q.count = Boolean(opts.count);
          } else q.returning = true;
          return builder;
        },
        insert(values) { q.op = 'insert'; q.values = values; return builder; },
        upsert(values, opts = {}) { q.op = 'upsert'; q.values = values; q.opts = opts; return builder; },
        update(values) { q.op = 'update'; q.values = values; return builder; },
        delete() { q.op = 'delete'; return builder; },
        eq(col, v) { q.filters.push(r => r[col] === v); return builder; },
        neq(col, v) { q.filters.push(r => r[col] !== v); return builder; },
        gt(col, v) { q.filters.push(r => String(r[col]) > String(v)); return builder; },
        in(col, list) { q.filters.push(r => list.includes(r[col])); return builder; },
        ilike(col, pattern) {
          const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i');
          q.filters.push(r => re.test(String(r[col] ?? '')));
          return builder;
        },
        order(col, { ascending = true } = {}) { q.order = { col, asc: ascending }; return builder; },
        range(a, b) { q.range = [a, b]; return builder; },
        limit(n) { q.limit = n; return builder; },
        single() { q.single = true; return builder; },
        maybeSingle() { q.single = true; return builder; },
        then(resolve, reject) { return Promise.resolve().then(exec).then(resolve, reject); },
      };
      return builder;
    }

    return {
      from,
      channel(name) {
        const ch = { name, uid, handlers: [] };
        const api = {
          on(_type, filter, cb) { ch.handlers.push({ table: filter.table, cb }); return api; },
          subscribe() { channels.push(ch); return api; },
          _ch: ch,
        };
        return api;
      },
      removeChannel(api) { const i = channels.indexOf(api?._ch); if (i >= 0) channels.splice(i, 1); },
      auth: authApi(uid),
      functions: { invoke: async (name, opts) => cloud.functionHandlers[name] ? cloud.functionHandlers[name](opts) : { data: null, error: { message: `Function ${name} not found` } } },
    };
  }

  let currentUid = null;
  function authApi() {
    return {
      async getSession() {
        return { data: { session: currentUid ? { user: users.find(u => u.id === currentUid), access_token: 't' } : null } };
      },
      async signUp({ email, password }) {
        // trigger single_user_lock
        if (users.length > 0) return { data: { user: null }, error: { message: 'Registrazioni chiuse: questa app ha un solo utente.' } };
        const user = { id: uuid(), email, password };
        users.push(user);
        // trigger adopt_orphan_rows
        for (const [name, rows] of Object.entries(tables)) {
          const spec = CLOUD_SCHEMA[name]?.user_id;
          const adoptable = CLOUD_SCHEMA[name] ? Boolean(spec && spec.n) : true; // le tabelle del bot hanno user_id nullable
          if (adoptable) for (const r of rows) if (r.user_id === null || r.user_id === undefined) r.user_id = user.id;
        }
        currentUid = user.id;
        return { data: { user, session: { user, access_token: 't' } }, error: null };
      },
      async signInWithPassword({ email, password }) {
        const user = users.find(u => u.email === email && u.password === password);
        if (!user) return { data: null, error: { message: 'Invalid login credentials' } };
        currentUid = user.id;
        return { data: { user, session: { user, access_token: 't' } }, error: null };
      },
      async signOut() { currentUid = null; return { error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      admin: {
        listUsers: async () => ({ data: { users: users.map(u => ({ id: u.id, email: u.email })) }, error: null }),
      },
    };
  }

  const cloud = {
    tables,
    users,
    state,
    functionHandlers: {},
    /** Client del browser (anon key + login): soggetto a RLS */
    browser: () => makeClient(currentUid),
    /** Client dell'Edge Function (service role): bypassa RLS */
    service: () => makeClient(null, { service: true }),
    get currentUid() { return currentUid; },
    /** Simula un errore del database alla prossima operazione sulla tabella */
    failNext(table, error, sticky = false) { state.failNext = { table, error, sticky }; },
  };
  return cloud;
}
