// src/services/store.js
// Central Data Access and Storage Layer for Gestionale
// Supports Local Database (IndexedDB / LocalStorage) and Supabase Cloud Sync with RLS

import { generateId } from '../utils/id.js';

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
  supabase_url: '',
  supabase_anon_key: '',
};

class Store {
  constructor() {
    this.data = {
      settings: { ...defaultSettings },
      clients: [],
      quotes: [],
      quote_items: [],
      quote_item_images: [],
      quote_extra_services: [],
      payments: [],
      todos: [],
      appointments: [],
      expenses: [],
      services_catalog: [],
      trash: [],
    };
    this.listeners = new Set();
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
    } catch (err) {
      console.warn('Errore nel caricamento dei dati locali:', err);
    }
  }

  save() {
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
  getAll(collection, includeDeleted = false) {
    const list = this.data[collection] || [];
    if (includeDeleted) return list;
    return list.filter(item => !item.is_deleted);
  }

  getById(collection, id) {
    const list = this.data[collection] || [];
    return list.find(item => item.id === id) || null;
  }

  create(collection, item) {
    if (!this.data[collection]) {
      this.data[collection] = [];
    }
    const newItem = {
      id: item.id || generateId(),
      ...item,
      is_deleted: false,
      created_at: item.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.data[collection].unshift(newItem);
    this.save();
    return newItem;
  }

  update(collection, id, partial) {
    const list = this.data[collection] || [];
    const index = list.findIndex(item => item.id === id);
    if (index === -1) return null;

    list[index] = {
      ...list[index],
      ...partial,
      updated_at: new Date().toISOString(),
    };
    this.save();
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
    if (!this.data[collection]) return false;
    this.data[collection] = this.data[collection].filter(item => item.id !== id);
    this.save();
    return true;
  }

  // Raccoglie tutti gli elementi attualmente nel cestino
  getAllTrash() {
    const collections = [
      'clients', 'quotes', 'todos', 'appointments', 'expenses', 'services_catalog', 'payments'
    ];
    const results = [];
    for (const col of collections) {
      const items = (this.data[col] || []).filter(item => item.is_deleted);
      for (const it of items) {
        results.push({ ...it, collection: col });
      }
    }
    return results.sort((a, b) => new Date(b.deleted_at || 0) - new Date(a.deleted_at || 0));
  }

  emptyTrash() {
    const collections = [
      'clients', 'quotes', 'todos', 'appointments', 'expenses', 'services_catalog', 'payments'
    ];
    for (const col of collections) {
      if (this.data[col]) {
        this.data[col] = this.data[col].filter(item => !item.is_deleted);
      }
    }
    this.save();
    return true;
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

    return {
      client,
      todos,
      appointments,
      quotes,
      payments,
      expenses,
    };
  }

  // --- GENERATORE SPESE RICORRENTI (IDEMPOTENTE) ---
  generateRecurringExpenses() {
    const recurringParents = this.getAll('expenses').filter(e => e.is_recurring && !e.is_suspended && !e.recurrence_parent_id);
    const today = new Date();
    let generatedCount = 0;

    for (const parent of recurringParents) {
      const startDate = new Date(parent.recurrence_start_date || parent.date);
      const endDate = parent.recurrence_end_date ? new Date(parent.recurrence_end_date) : null;
      const freq = parent.recurrence_frequency; // 'weekly', 'monthly', 'annual'

      if (isNaN(startDate.getTime())) continue;

      let nextDate = new Date(startDate);
      // Avanza fino alla prima data successiva a startDate
      while (nextDate <= today) {
        if (freq === 'weekly') {
          nextDate.setDate(nextDate.getDate() + 7);
        } else if (freq === 'monthly') {
          // Gestione corretta dei mesi con diverso numero di giorni
          const targetDay = startDate.getDate();
          const targetMonth = nextDate.getMonth() + 1;
          const targetYear = nextDate.getFullYear();
          nextDate = new Date(targetYear, targetMonth, 1);
          const maxDays = new Date(targetYear, targetMonth + 1, 0).getDate();
          nextDate.setDate(Math.min(targetDay, maxDays));
        } else if (freq === 'annual') {
          nextDate.setFullYear(nextDate.getFullYear() + 1);
        } else {
          break;
        }

        if (nextDate > today) break;
        if (endDate && nextDate > endDate) break;

        const dateIso = nextDate.toISOString().split('T')[0];
        // Verifica idempotenza: esiste già una spesa generata per questo parent in questa data?
        const alreadyExists = this.data.expenses.some(e => e.recurrence_parent_id === parent.id && e.date === dateIso);
        if (!alreadyExists) {
          this.create('expenses', {
            description: `${parent.description} (Ricorrente)`,
            amount: parent.amount,
            category: parent.category,
            date: dateIso,
            notes: parent.notes || '',
            client_id: parent.client_id,
            quote_id: parent.quote_id,
            is_recurring: true,
            recurrence_frequency: parent.recurrence_frequency,
            recurrence_parent_id: parent.id,
          });
          generatedCount++;
        }
      }
    }
    return generatedCount;
  }

  // --- CARICAMENTO DATI DIMOSTRATIVI FACOLTATIVI ---
  loadSampleData(sampleJson) {
    if (!sampleJson) return false;
    this.data = {
      ...this.data,
      ...sampleJson,
      settings: { ...this.data.settings, ...(sampleJson.settings || {}) },
    };
    this.save();
    return true;
  }

  // --- RESET TOTALE DATI ---
  clearAll() {
    this.data = {
      settings: { ...defaultSettings },
      clients: [],
      quotes: [],
      quote_items: [],
      quote_item_images: [],
      quote_extra_services: [],
      payments: [],
      todos: [],
      appointments: [],
      expenses: [],
      services_catalog: [],
      trash: [],
    };
    this.save();
  }
}

export const store = new Store();
