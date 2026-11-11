// src/services/cloud.js
// Sincronizzazione cloud-first: Supabase è l'UNICA fonte di verità, lo store del browser è una cache.
//
//  • hydrate(): all'avvio scarica tutte le tabelle e le fonde con la cache (merge a 3 vie con l'ultimo stato sincronizzato)
//  • push:      ogni store.save() confronta lo stato con l'ultimo sincronizzato e invia SOLO le differenze (upsert/delete)
//  • pull:      realtime (se disponibile) + aggiornamento incrementale periodico e al ritorno sulla scheda
//  • errori:    mai silenziosi. Lo stato (ok / sincronizzando / offline / errore) è sempre consultabile e mostrato in UI
//
// Ogni campo dell'app senza colonna dedicata viaggia in `extra jsonb`: nessun dato si perde per differenze di schema.

import { store } from './store.js';
import { CLOUD_SCHEMA, SYNCED_TABLES } from './cloud-schema.js';

const SNAPSHOT_KEY = 'gestionale_cloud_snapshot_v1';
const LASTPULL_KEY = 'gestionale_cloud_lastpull_v1';
const PAGE_SIZE = 1000;
const PUSH_DEBOUNCE_MS = 400;
const RETRY_MS = 15000;
const POLL_MS = 60000;
const PULL_MARGIN_MS = 3000;

// Impostazioni che NON devono mai finire nel cloud (restano su questo dispositivo)
export const LOCAL_ONLY_SETTINGS = ['gemini_api_key', 'telegram_bot_token', 'github_token', 'supabase_url', 'supabase_anon_key'];

// Colonne timestamptz che l'app usa come "ora a muro" senza fuso (datetime-local): si restituiscono senza suffisso
const WALL_CLOCK = { todos: ['due_date'], appointments: ['start_time', 'end_time'] };

// Campi calcolati lato client che non vanno duplicati
const SKIP_KEYS = { quote_items: ['images'] };

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Mapping oggetto app <-> riga database
// ---------------------------------------------------------------------------

function sanitizeValue(spec, value) {
  if (value === undefined) return undefined;
  if (value === '' && spec.t !== 'text') return null;
  if (value === null) return spec.n || spec.d === false ? null : undefined; // NOT NULL con default: il database applica il default
  if (spec.t === 'numeric' || spec.t.startsWith('int') || spec.t === 'float8') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (spec.t === 'bool') return Boolean(value);
  if (spec.t === 'date' && typeof value === 'string') return value.slice(0, 10);
  return value;
}

/** Oggetto dell'app → riga del database (campi sconosciuti in `extra`, colonne generate escluse). */
export function toRow(table, item, userId) {
  const cols = CLOUD_SCHEMA[table];
  const skip = SKIP_KEYS[table] || [];
  const row = {};
  const extra = {};

  for (const [key, value] of Object.entries(item)) {
    if (key === 'extra' || skip.includes(key) || value === undefined || typeof value === 'function') continue;
    const spec = cols[key];
    if (!spec) {
      extra[key] = value;
      continue;
    }
    if (spec.g) continue;
    const clean = sanitizeValue(spec, value);
    if (clean !== undefined) row[key] = clean;
  }

  if ('user_id' in cols && userId) row.user_id = userId;
  if ('extra' in cols) row.extra = extra;
  if (table === 'brain_memories' && Array.isArray(row.embedding)) row.embedding = JSON.stringify(row.embedding);
  return row;
}

/** Riga del database → oggetto dell'app (`extra` rientra a livello radice). */
export function fromRow(table, row) {
  const item = { ...row };
  const extra = item.extra && typeof item.extra === 'object' ? item.extra : {};
  delete item.extra;
  for (const [k, v] of Object.entries(extra)) {
    if (!(k in item)) item[k] = v;
  }
  if (typeof item.embedding === 'string') {
    try {
      item.embedding = JSON.parse(item.embedding);
    } catch {
      item.embedding = null;
    }
  }
  for (const col of WALL_CLOCK[table] || []) {
    if (typeof item[col] === 'string') item[col] = item[col].replace(/(?:Z|[+-]00(?::?00)?)$/, '');
  }
  if (item.is_deleted === undefined && 'is_deleted' in CLOUD_SCHEMA[table]) item.is_deleted = false;
  return item;
}

function settingsToRow(settings, userId) {
  const cols = CLOUD_SCHEMA.settings;
  const row = { user_id: userId, extra: {} };
  for (const [key, value] of Object.entries(settings)) {
    if (LOCAL_ONLY_SETTINGS.includes(key) || value === undefined) continue;
    if (key === 'id' || key === 'user_id' || key === 'extra' || key === 'created_at' || key === 'updated_at') continue;
    const spec = cols[key];
    if (spec && !spec.g) {
      const clean = sanitizeValue(spec, value);
      if (clean !== undefined) row[key] = clean;
    } else if (!spec) {
      row.extra[key] = value;
    }
  }
  return row;
}

function settingsFromRow(row) {
  const out = { ...row };
  const extra = out.extra && typeof out.extra === 'object' ? out.extra : {};
  for (const k of ['extra', 'id', 'user_id', 'created_at']) delete out[k];
  return { ...extra, ...out };
}

function isNetworkError(error) {
  return /failed to fetch|fetch failed|network|load failed|timeout/i.test(error?.message || '');
}

function hashOf(item) {
  const { updated_at: _u, ...rest } = item;
  return JSON.stringify(rest, (k, v) => (v === undefined ? null : v));
}

function readJson(key, fallback) {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota/storage non disponibile: lo snapshot resta solo in memoria */
  }
}

// ---------------------------------------------------------------------------
// Motore di sincronizzazione
// ---------------------------------------------------------------------------

class CloudSync {
  constructor() {
    this.client = null;
    this.userId = null;
    this.snapshot = {}; // tabella -> { id -> hash } = ultimo stato noto del cloud
    this.lastPull = {};
    this.state = 'stopped'; // stopped | syncing | idle | offline | error
    this.lastError = null;
    this.lastSyncAt = null;
    this.failed = {}; // tabella -> { id -> messaggio } righe rifiutate dal database
    this.listeners = new Set();
    this.applyingRemote = false;
    this.pushTimer = null;
    this.pushing = false;
    this.pushAgain = false;
    this.pollTimer = null;
    this.retryTimer = null;
    this.channel = null;
    this.started = false;
    this._unhook = null;
  }

  // --- stato osservabile ---------------------------------------------------
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getStatus() {
    return {
      state: this.state,
      pending: this.countPending(),
      failedRows: Object.values(this.failed).reduce((n, t) => n + Object.keys(t).length, 0),
      lastError: this.lastError,
      lastSyncAt: this.lastSyncAt,
    };
  }

  _setState(state, error = null) {
    this.state = state;
    if (state === 'error') this.lastError = error;
    if (state === 'idle') {
      this.lastError = null;
      this.lastSyncAt = nowIso();
    }
    for (const fn of this.listeners) {
      try {
        fn(this.getStatus());
      } catch (err) {
        console.warn('Listener di stato sync:', err);
      }
    }
  }

  // --- differenze locali vs cloud -------------------------------------------
  _collect(table) {
    if (table === 'settings') return [{ id: '__settings__', item: store.data.settings }];
    return (store.data[table] || []).filter(it => it && it.id).map(it => ({ id: it.id, item: it }));
  }

  _diff() {
    const changes = [];
    for (const table of SYNCED_TABLES) {
      const snap = this.snapshot[table] || {};
      const failed = this.failed[table] || {};
      const upserts = [];
      const seen = new Set();
      for (const { id, item } of this._collect(table)) {
        seen.add(id);
        const h = table === 'settings' ? hashOf(settingsToRow(item, this.userId)) : hashOf(item);
        if (snap[id] !== h && failed[id] !== h) upserts.push({ id, item, hash: h });
      }
      const deletes = table === 'settings' ? [] : Object.keys(snap).filter(id => !seen.has(id));
      if (upserts.length || deletes.length) changes.push({ table, upserts, deletes });
    }
    return changes;
  }

  countPending() {
    if (!this.userId) return 0;
    return this._diff().reduce((n, c) => n + c.upserts.length + c.deletes.length, 0);
  }

  // --- avvio / arresto -------------------------------------------------------
  /**
   * @param {object} client client Supabase autenticato
   * @param {string} userId id dell'utente
   * @param {{confirmUploadLocal?: (count:number)=>Promise<boolean>}} hooks
   */
  async start(client, userId, hooks = {}) {
    this.stop();
    this.client = client;
    this.userId = userId;
    this.snapshot = readJson(SNAPSHOT_KEY, {});
    this.lastPull = readJson(LASTPULL_KEY, {});
    this.failed = {};
    this.started = true;

    // Primo avvio con una cache locale mai sincronizzata: chiedi cosa farne (evita di caricare dati di prova o vecchi)
    const neverSynced = Object.keys(this.snapshot).length === 0;
    if (neverSynced) {
      const localCount = SYNCED_TABLES.filter(t => t !== 'settings').reduce((n, t) => n + (store.data[t] || []).filter(i => !i.is_deleted).length, 0);
      if (localCount > 0 && hooks.confirmUploadLocal) {
        const upload = await hooks.confirmUploadLocal(localCount);
        if (!upload) {
          this.applyingRemote = true;
          const keepSettings = store.data.settings;
          store.clearAll();
          store.data.settings = keepSettings;
          this.applyingRemote = false;
        }
      }
    }

    this._unhook = store.onSave(() => {
      if (!this.applyingRemote) this.schedulePush();
    });

    try {
      await this.hydrate();
    } catch {
      // lo stato (offline/errore) è già stato impostato e mostrato: l'app parte con la cache e riprova da sola
    }
    this._startRealtime();
    this.pollTimer = setInterval(() => this.pull().catch(() => {}), POLL_MS);
    if (typeof document !== 'undefined') {
      this._onVisible = () => {
        if (document.visibilityState === 'visible') this.pull().catch(() => {});
      };
      document.addEventListener('visibilitychange', this._onVisible);
    }
    if (typeof window !== 'undefined') {
      this._onOnline = () => this.flush().catch(() => {});
      window.addEventListener('online', this._onOnline);
    }
  }

  stop() {
    if (this._unhook) this._unhook();
    this._unhook = null;
    clearTimeout(this.pushTimer);
    clearTimeout(this.retryTimer);
    clearInterval(this.pollTimer);
    if (this.channel && this.client) {
      try {
        this.client.removeChannel(this.channel);
      } catch {
        /* canale già chiuso */
      }
    }
    this.channel = null;
    if (typeof document !== 'undefined' && this._onVisible) document.removeEventListener('visibilitychange', this._onVisible);
    if (typeof window !== 'undefined' && this._onOnline) window.removeEventListener('online', this._onOnline);
    this.started = false;
    this.state = 'stopped';
  }

  _persistMeta() {
    writeJson(SNAPSHOT_KEY, this.snapshot);
    writeJson(LASTPULL_KEY, this.lastPull);
  }

  // --- download ---------------------------------------------------------------
  async _fetchTable(table, since = null) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      let q = this.client.from(table).select('*');
      if (since) q = q.gt('updated_at', since);
      const { data, error } = await q.order('created_at', { ascending: true }).range(from, from + PAGE_SIZE - 1);
      if (error) throw Object.assign(new Error(error.message), { table, code: error.code });
      rows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
    }
    return rows;
  }

  /**
   * Fonde le righe remote con lo store locale. Regola: se l'elemento locale ha modifiche non ancora inviate vince il locale
   * (verrà inviato al prossimo push); altrimenti vince il cloud.
   * @param {boolean} full true = elenco completo (permette di rilevare le eliminazioni fatte altrove)
   */
  _mergeRemote(table, remoteRows, full) {
    if (table === 'settings') {
      const row = remoteRows[0];
      if (!row) return;
      const localHash = hashOf(settingsToRow(store.data.settings, this.userId));
      const snapHash = (this.snapshot.settings || {}).__settings__;
      if (snapHash && localHash !== snapHash) return; // impostazioni locali modificate e non inviate
      const merged = { ...store.data.settings, ...settingsFromRow(row) };
      store.data.settings = merged;
      this.snapshot.settings = { __settings__: hashOf(settingsToRow(merged, this.userId)) };
      return;
    }

    const snap = (this.snapshot[table] = this.snapshot[table] || {});
    const list = store.data[table] || (store.data[table] = []);
    const index = new Map(list.map((it, i) => [it.id, i]));
    const remoteIds = new Set();

    for (const row of remoteRows) {
      remoteIds.add(row.id);
      const item = fromRow(table, row);
      const pos = index.get(row.id);
      if (pos !== undefined) {
        const localDirty = snap[row.id] !== undefined && hashOf(list[pos]) !== snap[row.id];
        if (localDirty) continue;
        list[pos] = item;
      } else {
        list.unshift(item);
        index.set(row.id, 0);
      }
      snap[row.id] = hashOf(item);
    }

    if (full) {
      // eliminato altrove: presente nello snapshot, assente dal cloud, non modificato in locale
      for (const id of Object.keys(snap)) {
        if (remoteIds.has(id)) continue;
        const pos = list.findIndex(it => it.id === id);
        const localDirty = pos !== -1 && hashOf(list[pos]) !== snap[id];
        if (!localDirty) {
          if (pos !== -1) list.splice(pos, 1);
          delete snap[id];
        }
      }
    }
  }

  _applyRemote(fn) {
    this.applyingRemote = true;
    try {
      fn();
    } finally {
      this.applyingRemote = false;
    }
  }

  async hydrate() {
    this._setState('syncing');
    try {
      const fetched = {};
      for (const table of SYNCED_TABLES) fetched[table] = await this._fetchTable(table);
      this._applyRemote(() => {
        for (const table of SYNCED_TABLES) {
          this._mergeRemote(table, fetched[table], true);
          this.lastPull[table] = new Date(Date.now() - PULL_MARGIN_MS).toISOString();
        }
        store.save();
      });
      this._persistMeta();
      await this.flush();
    } catch (err) {
      this._handleError(err, 'hydrate');
      throw err;
    }
  }

  /** Aggiornamento incrementale: solo le righe cambiate dall'ultima lettura. */
  async pull() {
    if (!this.started || !this.client || this.pushing) return;
    try {
      const started = new Date(Date.now() - PULL_MARGIN_MS).toISOString();
      const fetched = {};
      for (const table of SYNCED_TABLES) {
        fetched[table] = await this._fetchTable(table, this.lastPull[table] || null);
      }
      let changed = false;
      this._applyRemote(() => {
        for (const table of SYNCED_TABLES) {
          if (fetched[table].length > 0) {
            this._mergeRemote(table, fetched[table], false);
            changed = true;
          }
          this.lastPull[table] = started;
        }
        if (changed) store.save();
      });
      this._persistMeta();
      if (this.state !== 'syncing') this._setState('idle');
      return changed;
    } catch (err) {
      this._handleError(err, 'pull');
      return false;
    }
  }

  _startRealtime() {
    try {
      if (!this.client.channel) return;
      const channel = this.client.channel('gestionale-sync');
      for (const table of SYNCED_TABLES) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => this._onRealtime(table, payload));
      }
      channel.subscribe();
      this.channel = channel;
    } catch (err) {
      console.warn('Realtime non disponibile, resta attivo l\'aggiornamento periodico:', err.message);
    }
  }

  _onRealtime(table, payload) {
    this._applyRemote(() => {
      if (payload.eventType === 'DELETE') {
        const id = payload.old?.id;
        const list = store.data[table] || [];
        const pos = list.findIndex(it => it.id === id);
        const snap = this.snapshot[table] || {};
        if (pos !== -1 && hashOf(list[pos]) === snap[id]) {
          list.splice(pos, 1);
          delete snap[id];
          store.save();
        }
        return;
      }
      if (payload.new) {
        this._mergeRemote(table, [payload.new], false);
        store.save();
      }
    });
    this._persistMeta();
  }

  // --- upload -----------------------------------------------------------------
  schedulePush() {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.flush().catch(() => {}), PUSH_DEBOUNCE_MS);
    for (const fn of this.listeners) fn(this.getStatus());
  }

  _bulkDeleteBlocked(table, deletes) {
    const snapSize = Object.keys(this.snapshot[table] || {}).length;
    const allowed = store.bulkDeleteAllowedUntil && Date.now() < store.bulkDeleteAllowedUntil;
    return !allowed && deletes.length > 10 && deletes.length > snapSize * 0.5;
  }

  async flush() {
    if (!this.started || !this.client || !this.userId) return;
    if (this.pushing) {
      this.pushAgain = true;
      return;
    }
    this.pushing = true;
    try {
      do {
        this.pushAgain = false;
        const changes = this._diff();
        if (changes.length === 0) break;
        this._setState('syncing');
        for (const change of changes) await this._pushTable(change);
      } while (this.pushAgain);

      this._persistMeta();
      const failedRows = Object.values(this.failed).reduce((n, t) => n + Object.keys(t).length, 0);
      if (failedRows > 0) {
        this._setState('error', this.lastError || 'Alcune righe sono state rifiutate dal database.');
      } else {
        this._setState('idle');
      }
    } catch (err) {
      this._handleError(err, 'push');
    } finally {
      this.pushing = false;
    }
  }

  async _pushTable({ table, upserts, deletes }) {
    const snap = (this.snapshot[table] = this.snapshot[table] || {});
    const rowOf = u => (table === 'settings' ? settingsToRow(u.item, this.userId) : toRow(table, u.item, this.userId));
    const onConflict = table === 'settings' ? 'user_id' : 'id';

    // Lo stato "sincronizzato" si registra PRIMA della richiesta: l'eco realtime della nostra stessa scrittura può
    // arrivare durante l'upsert e deve poter aggiornare lo snapshot; se la richiesta fallisce si ripristina.
    const send = async batch => {
      const previous = batch.map(u => snap[u.id]);
      batch.forEach(u => { snap[u.id] = u.hash; });
      const { error } = await this.client.from(table).upsert(batch.map(rowOf), { onConflict });
      if (error) batch.forEach((u, i) => { if (previous[i] === undefined) delete snap[u.id]; else snap[u.id] = previous[i]; });
      return error;
    };

    if (upserts.length) {
      const error = await send(upserts);
      if (error) {
        if (isNetworkError(error)) throw Object.assign(new Error(error.message), { table });
        if (upserts.length === 1) {
          this._rejectRows(table, upserts, error);
        } else {
          // Isola le righe rifiutate: una riga sbagliata non deve bloccare le altre
          for (const u of upserts) {
            const err = await send([u]);
            if (err) {
              if (isNetworkError(err)) throw Object.assign(new Error(err.message), { table });
              this._rejectRows(table, [u], err);
            }
          }
        }
      }
    }

    if (deletes.length) {
      if (this._bulkDeleteBlocked(table, deletes)) {
        const msg = `Eliminazione di ${deletes.length} righe da "${table}" bloccata per sicurezza. Se è voluta, ripeti l'operazione dalle Impostazioni.`;
        this.lastError = msg;
        throw Object.assign(new Error(msg), { table, blocked: true });
      }
      const { error } = await this.client.from(table).delete().in('id', deletes);
      if (error) throw Object.assign(new Error(error.message), { table, code: error.code });
      for (const id of deletes) delete snap[id];
    }
  }

  _rejectRows(table, upserts, error) {
    const failed = (this.failed[table] = this.failed[table] || {});
    for (const u of upserts) failed[u.id] = u.hash;
    this.lastError = `${table}: ${error.message}`;
    console.error(`Il database ha rifiutato una riga di "${table}":`, error.message, upserts.map(u => u.id));
  }

  _handleError(err, phase) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const networkLike = /fetch|network|failed to fetch|load failed/i.test(err.message || '');
    if (offline || networkLike) {
      this._setState('offline', 'Nessuna connessione: le modifiche verranno inviate appena torna la rete.');
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.flush().catch(() => {}), RETRY_MS);
    } else {
      this._setState('error', `${phase}: ${err.message}`);
      if (!err.blocked) {
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.flush().catch(() => {}), RETRY_MS * 2);
      }
    }
  }

  /** Riprova subito, azzerando l'elenco delle righe rifiutate (utile dopo aver corretto un dato). */
  async retryNow() {
    this.failed = {};
    await this.flush();
    await this.pull();
  }
}

export const cloud = new CloudSync();
