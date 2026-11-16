// tests/crud.test.js
// Azioni rapide aggiunte allo STEP 1: duplica preventivo/voce listino, canoni cliente, colonne Body, log giornaliero.
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../src/services/store.js';

beforeEach(() => {
  store.clearAll();
});

describe('Duplica preventivo e voce di listino', () => {
  it('duplicateQuote copia voci ed extra in una nuova bozza con nuovo numero, senza pagamenti', () => {
    const saved = store.saveFullQuote({
      quote: { quote_number: 'PREV-2026-001', title: 'Sito web', status: 'accettato', work_status: 'In corso', agreed_total: 1500 },
      items: [
        { description: 'Design', quantity: 1, unit_price: 500, images: [{ url: 'a.png' }] },
        { description: 'Sviluppo', quantity: 1, unit_price: 1000 },
      ],
      extraServices: [{ description: 'Hosting', amount: 120, status: 'approvato' }],
    });
    store.create('payments', { quote_id: saved.quote.id, amount: 300, status: 'incassato', type: 'acconto' });

    const copy = store.duplicateQuote(saved.quote.id);

    expect(copy.quote.id).not.toBe(saved.quote.id);
    expect(copy.quote.quote_number).not.toBe('PREV-2026-001');
    expect(copy.quote.status).toBe('bozza');
    expect(copy.quote.title).toBe('Sito web (copia)');
    expect(copy.items.map(i => i.description)).toEqual(['Design', 'Sviluppo']);
    expect(copy.items[0].images).toHaveLength(1);
    expect(copy.extraServices).toHaveLength(1);
    expect(copy.payments).toHaveLength(0);
    // gli id delle voci sono nuovi: modificare la copia non tocca l'originale
    const originalIds = new Set(saved.items.map(i => i.id));
    expect(copy.items.some(i => originalIds.has(i.id))).toBe(false);
    expect(store.getQuoteWithDetails(saved.quote.id).items).toHaveLength(2);
  });

  it('nextQuoteNumber non riusa un numero già esistente', () => {
    store.create('quotes', { quote_number: `PREV-${new Date().getFullYear()}-002`, title: 'A' });
    expect(store.nextQuoteNumber()).toBe(`PREV-${new Date().getFullYear()}-003`);
  });

  it('duplicateCatalogItem crea una copia con nuovo id', () => {
    const item = store.create('services_catalog', { name: 'Shooting', price: 250, unit: 'ora' });
    const copy = store.duplicateCatalogItem(item.id);
    expect(copy.id).not.toBe(item.id);
    expect(copy.name).toBe('Shooting (copia)');
    expect(copy.price).toBe(250);
    expect(store.getAll('services_catalog')).toHaveLength(2);
  });
});

describe('Canoni di manutenzione del cliente', () => {
  it('crea, modifica e sospende un canone; il canone in pausa non conta nel ricorrente mensile', () => {
    const c = store.create('clients', { type: 'company', company_name: 'TechCorp' });
    store.saveClientContract(c.id, { title: 'SLA', amount: '300', frequency: 'monthly' });
    store.saveClientContract(c.id, { title: 'Hosting', amount: 1200, frequency: 'annual' });
    expect(store.getClientFullProfile(c.id).activeMRR).toBe(400);

    store.saveClientContract(c.id, { title: 'SLA Plus', amount: 350, frequency: 'monthly', billing_day: 5 }, 0);
    const afterEdit = store.getById('clients', c.id).maintenance_contracts;
    expect(afterEdit).toHaveLength(2);
    expect(afterEdit[0]).toMatchObject({ title: 'SLA Plus', amount: 350, billing_day: 5, status: 'active' });

    store.toggleClientContract(c.id, 0);
    expect(store.getById('clients', c.id).maintenance_contracts[0].status).toBe('paused');
    expect(store.getClientFullProfile(c.id).activeMRR).toBe(100);

    store.toggleClientContract(c.id, 0);
    expect(store.getClientFullProfile(c.id).activeMRR).toBe(450);
  });
});

describe('Body: colonne esercizio e log giornaliero', () => {
  it('modifica, riordina e archivia una colonna senza perdere gli allenamenti', () => {
    const cols = store.getBodyColumns();
    const first = cols[0];
    const second = cols[1];

    store.updateBodyColumn(first.id, { name: 'Trazioni zavorrate', target_frequency_days: '4', available_variants: 'Presa larga, Chin up' });
    const edited = store.getBodyColumns().find(c => c.id === first.id);
    expect(edited.name).toBe('Trazioni zavorrate');
    expect(edited.target_frequency_days).toBe(4);
    expect(edited.available_variants).toEqual(['Standard', 'Presa larga', 'Chin up']);

    expect(store.moveBodyColumn(first.id, 1)).toBe(true);
    expect(store.getBodyColumns().slice(0, 2).map(c => c.id)).toEqual([second.id, first.id]);
    expect(store.moveBodyColumn(second.id, -1)).toBe(false); // è già in cima

    store.upsertBodyWorkoutEntry({ date: '2026-11-10', column_id: first.id, raw_notation: '5x5' });
    store.archiveBodyColumn(first.id);
    expect(store.getBodyColumns().some(c => c.id === first.id)).toBe(false);
    expect(store.getAll('body_workout_entries')).toHaveLength(1);
  });

  it('deleteBodyDailyLog elimina il log, ma se quel giorno ha allenamenti lo svuota soltanto', () => {
    store.upsertBodyDailyLog({ date: '2026-11-01', body_weight_kg: 80, calories_kcal: 2400 });
    expect(store.deleteBodyDailyLog('2026-11-01')).toBe('deleted');
    expect(store.getAll('body_daily_logs').find(l => l.date === '2026-11-01')).toBeUndefined();

    const col = store.getBodyColumns()[0];
    store.upsertBodyDailyLog({ date: '2026-11-02', body_weight_kg: 81, protein_g: 150 });
    store.upsertBodyWorkoutEntry({ date: '2026-11-02', column_id: col.id, raw_notation: '3x8' });
    expect(store.deleteBodyDailyLog('2026-11-02')).toBe('cleared');
    const log = store.getAll('body_daily_logs').find(l => l.date === '2026-11-02');
    expect(log.body_weight_kg).toBeNull();
    expect(log.protein_g).toBeNull();
    expect(store.getAll('body_workout_entries')).toHaveLength(1);

    expect(store.deleteBodyDailyLog('2020-01-01')).toBeNull();
  });
});
