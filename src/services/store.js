// src/services/store.js
// Central Data Access and Storage Layer for Gestionale
// Supports Local Database (IndexedDB / LocalStorage) and Supabase Cloud Sync with RLS

import { generateId } from '../utils/id.js';
import { DEFAULT_BODY_COLUMNS, parseWorkoutNotation } from '../utils/body-parser.js';
import {
  getRecurrenceDates,
  getRecurrenceStart,
  isRecurringParent,
  legacyExpenseToTransaction,
  localTodayIso,
  normalizeFrequency,
  normalizeTradingItem,
  normalizeTransaction,
  summarizeFinancials,
  summarizeTrading,
} from './finances.js';

const STORAGE_KEY = 'gestionale_store_v1';
const SETTINGS_KEY = 'gestionale_settings_v1';

export const defaultSettings = {
  app_name: 'Gestionale',
  logo_url: '',
  app_icon_url: '',
  primary_color: '#1e293b',
  accent_color: '#2563eb',
  business_name: '',
  owner_name: '',
  address: '',
  city: '',
  postal_code: '',
  vat_number: '',
  fiscal_code: '',
  email: '',
  phone: '',
  pec: '',
  sdi_code: '',
  currency: 'EUR',
  currency_symbol: '€',
  language: 'it',
  timezone: 'Europe/Rome',
  date_format: 'DD/MM/YYYY',
  quote_default_validity_days: 30,
  quote_default_conditions: 'Pagamento: 30% acconto all\'accettazione, saldo alla consegna dei lavori.',
  fiscal_levy_name: 'Cassa Previdenziale',
  fiscal_levy_percent: 4.0,
  fiscal_levy_enabled: false,
  vat_percent: 22.0,
  vat_enabled: false,
  google_calendar_connected: false,
  google_calendar_id: '',
  google_sync_last_at: null,
  notion_connected: false,
  notion_database_id: '',
  notion_sync_last_at: null,
  gemini_api_key: '',
  dev_hourly_rate: 50,
  business_type: 'software_dev',
  github_token: '',
  supabase_url: '',
  supabase_anon_key: '',
  telegram_bot_token: '',
  telegram_allowed_user_id: '',
  telegram_connected: false,
};

// Collezioni "alias" retrocompatibili: la vecchia collezione `expenses` è ora una vista su
// `finance_transactions` filtrata per type = 'expense' (lettura e scrittura passano dal nuovo ledger).
const COLLECTION_ALIASES = {
  expenses: {
    target: 'finance_transactions',
    filter: item => item.type === 'expense',
    defaults: { type: 'expense' },
  },
};

// Collezioni con elementi cestinabili (Soft Delete) mostrate nella sezione Cestino
// Collezioni che notificano gli hook di sincronizzazione (Second Brain, coda appunti -> Supabase)
const ENTITY_HOOK_COLLECTIONS = new Set([
  'clients', 'todos', 'body_daily_logs', 'body_workout_entries', 'ai_note_queue',
]);

const TRASHABLE_COLLECTIONS = [
  'clients', 'quotes', 'todos', 'appointments', 'finance_transactions', 'trading_items',
  'services_catalog', 'payments', 'brain_memories',
];

function createEmptyData() {
  return {
    settings: { ...defaultSettings },
    clients: [],
    quotes: [],
    quote_items: [],
    quote_item_images: [],
    quote_extra_services: [],
    payments: [],
    todos: [],
    appointments: [],
    finance_transactions: [],
    trading_items: [],
    ai_note_queue: [],
    services_catalog: [],
    trash: [],
    brain_memories: [],
    brain_facts: [],
    brain_nodes: [],
    brain_edges: [],
    body_exercise_columns: [],
    body_daily_logs: [],
    body_workout_entries: [],
    telegram_pending_actions: [],
    telegram_bot_subscribers: [],
  };
}

class Store {
  constructor() {
    this.data = createEmptyData();
    this.listeners = new Set();
    this.entityHooks = new Set();
    this._batchDepth = 0;
    this._dirty = false;
    this.init();
  }

  init() {
    try {
      if (typeof localStorage === 'undefined') return;
      const savedSettings = localStorage.getItem(SETTINGS_KEY);
      if (savedSettings) {
        this.data.settings = { ...defaultSettings, ...JSON.parse(savedSettings) };
      }

      const savedData = localStorage.getItem(STORAGE_KEY);
      if (savedData) {
        const parsed = JSON.parse(savedData);
        this.data = {
          ...this.data,
          ...parsed,
          settings: { ...defaultSettings, ...(parsed.settings || this.data.settings) },
        };
      }

      // Retrocompatibilità: le vecchie `expenses` confluiscono in finance_transactions (type = 'expense')
      if (this.migrateLegacyExpenses() > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      }
    } catch (err) {
      console.warn('Errore nel caricamento dei dati locali:', err);
    }
  }

  /**
   * Sposta le eventuali vecchie spese (data.expenses, es. da localStorage precedente o da un backup)
   * nel ledger unificato finance_transactions con type = 'expense'. Idempotente: salta gli id già presenti.
   * @returns {number} numero di spese migrate
   */
  migrateLegacyExpenses() {
    const legacy = this.data.expenses;
    if (!Array.isArray(legacy)) return 0;
    if (!Array.isArray(this.data.finance_transactions)) this.data.finance_transactions = [];

    const known = new Set(this.data.finance_transactions.map(t => t.id));
    const nowIso = new Date().toISOString();
    let moved = 0;
    for (const exp of legacy) {
      if (!exp) continue;
      const id = exp.id || generateId();
      if (known.has(id)) continue;
      this.data.finance_transactions.push({
        ...legacyExpenseToTransaction(exp),
        id,
        is_deleted: Boolean(exp.is_deleted),
        created_at: exp.created_at || nowIso,
        updated_at: exp.updated_at || nowIso,
      });
      known.add(id);
      moved++;
    }
    delete this.data.expenses;
    return moved;
  }

  // Raggruppa più scritture in un unico salvataggio/notifica (import massivi, generazione ricorrenze)
  runBatch(fn) {
    this._batchDepth++;
    try {
      return fn();
    } finally {
      this._batchDepth--;
      if (this._batchDepth === 0 && this._dirty) {
        this._dirty = false;
        this.save();
      }
    }
  }

  // Inserisce N record della stessa collezione con un solo salvataggio
  createBatch(collection, items = []) {
    const created = [];
    this.runBatch(() => {
      for (const item of items) {
        created.push(this.create(collection, item));
      }
    });
    return created;
  }

  save() {
    if (this._batchDepth > 0) {
      this._dirty = true;
      return;
    }
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.data.settings));
      this.notify();
    } catch (err) {
      console.error('Errore nel salvataggio del database locale:', err);
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onEntityChange(hook) {
    this.entityHooks.add(hook);
    return () => this.entityHooks.delete(hook);
  }

  emitEntityChange(collection, action, item) {
    for (const hook of this.entityHooks) {
      try {
        hook(collection, action, item);
      } catch (err) {
        console.warn('Errore nel hook di sincronizzazione entità:', err);
      }
    }
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.data);
      } catch (err) {
        console.error('Errore nel listener dello store:', err);
      }
    }
  }

  // --- SETTINGS ---
  getSettings() {
    return { ...this.data.settings };
  }

  updateSettings(partial) {
    this.data.settings = { ...this.data.settings, ...partial, updated_at: new Date().toISOString() };
    this.save();
    return this.data.settings;
  }

  // --- GENERIC CRUD CON SOFT-DELETE (CESTINO) ---
  // Risolve un nome di collezione (anche alias legacy come `expenses`) nella collezione reale
  _resolveCollection(collection) {
    const alias = COLLECTION_ALIASES[collection];
    return alias
      ? { name: alias.target, filter: alias.filter, defaults: alias.defaults }
      : { name: collection, filter: null, defaults: null };
  }

  // Campi derivati / normalizzazioni per le collezioni finanziarie (mirror delle colonne SQL)
  _applyDerivedFields(collection, item) {
    if (collection === 'finance_transactions') return normalizeTransaction(item);
    if (collection === 'trading_items') return normalizeTradingItem(item);
    return item;
  }

  getAll(collection, includeDeleted = false) {
    const { name, filter } = this._resolveCollection(collection);
    let list = this.data[name] || [];
    if (filter) list = list.filter(filter);
    if (includeDeleted) return list;
    return list.filter(item => !item.is_deleted);
  }

  getById(collection, id) {
    const { name, filter } = this._resolveCollection(collection);
    const list = this.data[name] || [];
    return list.find(item => item.id === id && (!filter || filter(item))) || null;
  }

  create(collection, item) {
    const { name, defaults } = this._resolveCollection(collection);
    collection = name;
    if (!this.data[collection]) {
      this.data[collection] = [];
    }
    const newItem = {
      id: item.id || generateId(),
      ...this._applyDerivedFields(collection, { ...item, ...(defaults || {}) }),
      is_deleted: false,
      created_at: item.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.data[collection].unshift(newItem);
    this.save();
    if (ENTITY_HOOK_COLLECTIONS.has(collection)) {
      this.emitEntityChange(collection, 'create', newItem);
    }
    return newItem;
  }

  update(collection, id, partial) {
    const { name, filter } = this._resolveCollection(collection);
    collection = name;
    const list = this.data[collection] || [];
    const index = list.findIndex(item => item.id === id && (!filter || filter(item)));
    if (index === -1) return null;

    list[index] = {
      ...this._applyDerivedFields(collection, { ...list[index], ...partial }),
      updated_at: new Date().toISOString(),
    };
    this.save();
    if (ENTITY_HOOK_COLLECTIONS.has(collection)) {
      this.emitEntityChange(collection, 'update', list[index]);
    }
    return list[index];
  }

  // Sposta nel cestino (Soft Delete)
  moveToTrash(collection, id) {
    const item = this.getById(collection, id);
    if (!item) return false;

    this.update(collection, id, {
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      original_collection: collection,
    });
    return true;
  }

  // Ripristina dal cestino
  restoreFromTrash(collection, id) {
    const item = this.getById(collection, id);
    if (!item) return false;

    this.update(collection, id, {
      is_deleted: false,
      deleted_at: null,
    });
    return true;
  }

  // Eliminazione definitiva
  permanentDelete(collection, id) {
    const { name, filter } = this._resolveCollection(collection);
    if (!this.data[name]) return false;
    this.data[name] = this.data[name].filter(item => !(item.id === id && (!filter || filter(item))));
    this.save();
    return true;
  }

  // Raccoglie tutti gli elementi attualmente nel cestino
  getAllTrash() {
    const results = [];
    for (const col of TRASHABLE_COLLECTIONS) {
      const items = (this.data[col] || []).filter(item => item.is_deleted);
      for (const it of items) {
        results.push({ ...it, collection: col });
      }
    }
    return results.sort((a, b) => new Date(b.deleted_at || 0) - new Date(a.deleted_at || 0));
  }

  emptyTrash() {
    for (const col of TRASHABLE_COLLECTIONS) {
      if (this.data[col]) {
        this.data[col] = this.data[col].filter(item => !item.is_deleted);
      }
    }
    this.save();
    return true;
  }

  // --- HELPER SECOND BRAIN (TRI-LAYER) ---
  getActiveFacts(subject = null) {
    const facts = (this.data.brain_facts || []).filter(f => !f.is_deleted && f.is_active !== false);
    if (!subject) return facts;
    const normSubj = subject.trim().toLowerCase();
    return facts.filter(f => (f.subject || '').trim().toLowerCase() === normSubj);
  }

  getFactHistory(subject, fact_key) {
    const normSubj = (subject || '').trim().toLowerCase();
    const normKey = (fact_key || '').trim().toLowerCase();
    return (this.data.brain_facts || [])
      .filter(f => !f.is_deleted && (f.subject || '').trim().toLowerCase() === normSubj && (f.fact_key || '').trim().toLowerCase() === normKey)
      .sort((a, b) => new Date(b.valid_from || b.created_at || 0) - new Date(a.valid_from || a.created_at || 0));
  }

  getBrainGraph() {
    const nodes = (this.data.brain_nodes || []).filter(n => !n.is_deleted);
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const edges = (this.data.brain_edges || [])
      .filter(e => !e.is_deleted && nodeMap.has(e.source_node_id) && nodeMap.has(e.target_node_id))
      .map(e => {
        const src = nodeMap.get(e.source_node_id);
        const tgt = nodeMap.get(e.target_node_id);
        return {
          ...e,
          source_label: src.label,
          source_type: src.node_type,
          target_label: tgt.label,
          target_type: tgt.node_type,
        };
      });
    return { nodes, edges };
  }

  getMemoriesByDomain(domain = null, tag = null) {
    return this.getAll('brain_memories').filter(m => {
      if (domain && domain !== 'all' && m.domain !== domain) return false;
      if (tag && (!Array.isArray(m.tags) || !m.tags.some(t => t.toLowerCase() === tag.toLowerCase()))) return false;
      return true;
    });
  }

  // --- HELPER MODULO BODY (MATRICE DIARIO, BIOMETRIA, NUTRIZIONE & ALLENAMENTO) ---
  getBodyColumns() {
    if (!Array.isArray(this.data.body_exercise_columns) || this.data.body_exercise_columns.length === 0) {
      this.data.body_exercise_columns = DEFAULT_BODY_COLUMNS.map(col => ({
        ...col,
        is_deleted: false,
        created_at: new Date().toISOString(),
      }));
      this.save();
    }
    return this.data.body_exercise_columns
      .filter(c => !c.is_deleted && c.is_active !== false)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }

  upsertBodyDailyLog(logData = {}) {
    const dateStr = String(logData.date || new Date().toISOString().split('T')[0]).split('T')[0];
    if (!this.data.body_daily_logs) this.data.body_daily_logs = [];

    const existing = this.data.body_daily_logs.find(l => !l.is_deleted && l.date === dateStr);
    if (existing) {
      return this.update('body_daily_logs', existing.id, {
        ...logData,
        date: dateStr,
      });
    }
    return this.create('body_daily_logs', {
      sleep_hours: null,
      sleep_quality: null,
      body_weight_kg: null,
      calories_kcal: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      energy_level: null,
      is_rest_day: false,
      general_notes: '',
      ...logData,
      date: dateStr,
    });
  }

  upsertBodyWorkoutEntry(entryData = {}) {
    const dateStr = String(entryData.date || new Date().toISOString().split('T')[0]).split('T')[0];
    const columnId = entryData.column_id;
    if (!columnId) return null;

    if (!this.data.body_workout_entries) this.data.body_workout_entries = [];
    const columns = this.getBodyColumns();
    const colObj = columns.find(c => c.id === columnId);

    // Assicura che esista il daily log corrispondente per quella data
    let dailyLog = (this.data.body_daily_logs || []).find(l => !l.is_deleted && l.date === dateStr);
    if (!dailyLog) {
      dailyLog = this.upsertBodyDailyLog({ date: dateStr });
    }

    const rawNotation = String(entryData.raw_notation || '').trim();
    const existing = this.data.body_workout_entries.find(
      e => !e.is_deleted && e.date === dateStr && e.column_id === columnId
    );

    if (!rawNotation) {
      if (existing) {
        this.permanentDelete('body_workout_entries', existing.id);
      }
      return null;
    }

    const parsed = Array.isArray(entryData.parsed_blocks) && entryData.parsed_blocks.length > 0
      ? { blocks: entryData.parsed_blocks }
      : parseWorkoutNotation(rawNotation, colObj?.category || 'pull');

    const payload = {
      daily_log_id: dailyLog.id,
      date: dateStr,
      column_id: columnId,
      raw_notation: rawNotation,
      parsed_blocks: parsed.blocks,
      rpe: entryData.rpe ?? existing?.rpe ?? null,
      rest_seconds: entryData.rest_seconds ?? existing?.rest_seconds ?? null,
      feeling: entryData.feeling || existing?.feeling || 'buono',
      detailed_notes: entryData.detailed_notes !== undefined ? entryData.detailed_notes : (existing?.detailed_notes || ''),
    };

    if (existing) {
      return this.update('body_workout_entries', existing.id, payload);
    }
    return this.create('body_workout_entries', payload);
  }

  // --- QUERY SPECIFICHE PER PREVENTIVI ---
  getQuoteWithDetails(quoteId) {
    const quote = this.getById('quotes', quoteId);
    if (!quote) return null;

    const items = (this.data.quote_items || [])
      .filter(it => it.quote_id === quoteId)
      .sort((a, b) => (a.position || 0) - (b.position || 0));

    const images = this.data.quote_item_images || [];
    const itemsWithImages = items.map(it => ({
      ...it,
      images: images.filter(img => img.quote_item_id === it.id).sort((a, b) => (a.position || 0) - (b.position || 0)),
    }));

    const extraServices = (this.data.quote_extra_services || [])
      .filter(es => es.quote_id === quoteId);

    const payments = (this.data.payments || [])
      .filter(p => p.quote_id === quoteId && !p.is_deleted);

    const client = quote.client_id ? this.getById('clients', quote.client_id) : null;

    return {
      quote,
      items: itemsWithImages,
      extraServices,
      payments,
      client,
    };
  }

  saveFullQuote({ quote, items = [], extraServices = [] }) {
    let savedQuote;
    if (quote.id && this.getById('quotes', quote.id)) {
      savedQuote = this.update('quotes', quote.id, quote);
    } else {
      savedQuote = this.create('quotes', quote);
    }

    const quoteId = savedQuote.id;

    // Rimuove voci e immagini precedenti per riscriverle coerentemente
    this.data.quote_items = (this.data.quote_items || []).filter(it => it.quote_id !== quoteId);
    const existingItemIds = new Set(items.map(it => it.id));
    this.data.quote_item_images = (this.data.quote_item_images || []).filter(img => existingItemIds.has(img.quote_item_id));

    // Salva voci
    items.forEach((item, index) => {
      const itemId = item.id || generateId();
      const newItem = {
        ...item,
        id: itemId,
        quote_id: quoteId,
        position: index,
        created_at: item.created_at || new Date().toISOString(),
      };
      this.data.quote_items.push(newItem);

      // Salva immagini collegate
      if (Array.isArray(item.images)) {
        item.images.forEach((img, imgIndex) => {
          this.data.quote_item_images.push({
            ...img,
            id: img.id || generateId(),
            quote_item_id: itemId,
            position: imgIndex,
            created_at: img.created_at || new Date().toISOString(),
          });
        });
      }
    });

    // Salva o aggiorna extra services
    if (Array.isArray(extraServices)) {
      this.data.quote_extra_services = (this.data.quote_extra_services || []).filter(es => es.quote_id !== quoteId);
      extraServices.forEach(es => {
        this.data.quote_extra_services.push({
          ...es,
          id: es.id || generateId(),
          quote_id: quoteId,
          created_at: es.created_at || new Date().toISOString(),
        });
      });
    }

    this.save();
    return this.getQuoteWithDetails(quoteId);
  }

  // --- QUERY SPECIFICHE PER SCHEDA CLIENTE ---
  getClientFullProfile(clientId) {
    const client = this.getById('clients', clientId);
    if (!client) return null;

    const todos = this.getAll('todos').filter(t => t.client_id === clientId);
    const appointments = this.getAll('appointments').filter(a => a.client_id === clientId);
    const quotes = this.getAll('quotes').filter(q => q.client_id === clientId);
    const payments = this.getAll('payments').filter(p => p.client_id === clientId);
    const expenses = this.getAll('expenses').filter(e => e.client_id === clientId);

    const maintenance_contracts = Array.isArray(client.maintenance_contracts) ? client.maintenance_contracts : [];
    const activeMRR = maintenance_contracts
      .filter(c => c.status === 'active')
      .reduce((sum, c) => {
        const val = Number(c.amount) || 0;
        if (c.frequency === 'annual') return sum + (val / 12);
        if (c.frequency === 'quarterly') return sum + (val / 3);
        return sum + val;
      }, 0);

    return {
      client,
      todos,
      appointments,
      quotes,
      payments,
      expenses,
      maintenance_contracts,
      activeMRR,
    };
  }

  // --- GENERATORE TRANSAZIONI RICORRENTI (IDEMPOTENTE, Entrate e Uscite) ---
  // Per ogni "padre" ricorrente attivo genera le occorrenze successive alla data di inizio fino a oggi
  // (o alla data di fine). Una coppia (padre, data) già presente — anche se cestinata — non viene mai rigenerata.
  generateRecurringTransactions(todayIso = localTodayIso()) {
    const all = this.data.finance_transactions || [];
    const parents = all.filter(t => isRecurringParent(t) && !t.is_suspended);
    if (parents.length === 0) return 0;

    const existing = new Set(
      all.filter(t => t.recurrence_parent_id).map(t => `${t.recurrence_parent_id}|${String(t.date).slice(0, 10)}`),
    );
    let generatedCount = 0;

    this.runBatch(() => {
      for (const parent of parents) {
        const start = getRecurrenceStart(parent);
        const dates = getRecurrenceDates(
          { start, frequency: parent.recurrence_frequency, end: parent.recurrence_end_date },
          start,
          todayIso,
        ).filter(d => d > start);

        for (const dateIso of dates) {
          const key = `${parent.id}|${dateIso}`;
          if (existing.has(key)) continue;
          this.create('finance_transactions', {
            type: parent.type,
            description: `${parent.description} (Ricorrente)`,
            amount: parent.amount,
            category: parent.category,
            payment_method: parent.payment_method,
            date: dateIso,
            notes: parent.notes || '',
            client_id: parent.client_id,
            quote_id: parent.quote_id,
            is_recurring: true,
            recurrence_frequency: normalizeFrequency(parent.recurrence_frequency),
            recurrence_parent_id: parent.id,
          });
          existing.add(key);
          generatedCount++;
        }
      }
    });
    return generatedCount;
  }

  // Alias retrocompatibile del vecchio modulo Spese
  generateRecurringExpenses(todayIso) {
    return this.generateRecurringTransactions(todayIso);
  }

  // --- HELPER FINANZE & COMPRAVENDITA ---
  /**
   * Cash Flow del mese: Entrate Totali, Uscite Totali, Cashflow Netto e Previsione Uscite Ricorrenti.
   * @param {number} month 1-12 (default: mese corrente)
   * @param {number} year (default: anno corrente)
   */
  getFinancialSummary(month, year) {
    return summarizeFinancials(this.getAll('finance_transactions', true), month, year);
  }

  /** Capitale in giacenza (in_stock), Utile Totale Realizzato (sold) e ROI medio % della Compravendita. */
  getTradingStats() {
    return summarizeTrading(this.getAll('trading_items'));
  }

  // --- CODA APPUNTI RAPIDI (INGESTION BATCHING) ---
  /** Note ancora da elaborare, dalla più vecchia alla più recente (ordine di inserimento). */
  getQueuedNotes() {
    const queued = this.getAll('ai_note_queue').filter(n => n.status !== 'processed');
    // create() fa unshift: invertendo si ottiene l'ordine di inserimento; sort stabile per created_at
    return queued
      .slice()
      .reverse()
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  }

  addQueuedNote(text, source = 'web') {
    const content = String(text || '').trim();
    if (!content) return null;
    return this.create('ai_note_queue', {
      content,
      source: source === 'telegram' ? 'telegram' : 'web',
      status: 'queued',
    });
  }

  /** Segna come elaborate le note indicate (id singolo o array). @returns {number} note aggiornate */
  markNotesProcessed(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    const nowIso = new Date().toISOString();
    let count = 0;
    this.runBatch(() => {
      for (const id of list) {
        if (!id) continue;
        const note = this.getById('ai_note_queue', id);
        if (note && note.status !== 'processed') {
          this.update('ai_note_queue', id, { status: 'processed', processed_at: nowIso });
          count++;
        }
      }
    });
    return count;
  }

  // --- CARICAMENTO DATI DIMOSTRATIVI FACOLTATIVI ---
  loadSampleData(sampleJson) {
    if (!sampleJson) return false;
    this.data = {
      ...this.data,
      ...sampleJson,
      settings: { ...this.data.settings, ...(sampleJson.settings || {}) },
    };
    this.migrateLegacyExpenses();
    this.save();
    return true;
  }

  // --- RESET TOTALE DATI ---
  clearAll() {
    this.data = createEmptyData();
    this.save();
  }
}

export const store = new Store();
