// tests/gestionale.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateItemTotal,
  calculateItemGrossValue,
  calculateQuoteTotals,
  calculatePaymentBalance,
  calculateFinancialReport
} from '../src/utils/calculations.js';
import {
  formatCurrency,
  formatDate,
  sanitizeFileName,
  formatMonthYear
} from '../src/utils/formatters.js';
import { buildQuotePdfFileName } from '../src/services/pdf.js';
import { store } from '../src/services/store.js';
import { processAiPrompt } from '../src/services/ai.js';
import {
  ingestKnowledge,
  upsertFact,
  upsertGraphRelationship,
  querySecondBrain,
} from '../src/services/brain.js';
import {
  parseWorkoutNotation,
  calculateColumnRecoveryStatus,
  calculateBodyTrends,
  DEFAULT_BODY_COLUMNS,
} from '../src/utils/body-parser.js';

describe('1. Calcoli Economici Voci di Preventivo', () => {
  it('calcola correttamente il netto di una voce con quantità, prezzo e sconto', () => {
    const item = {
      quantity: 2,
      unit_price: 150.00,
      discount_percent: 10, // 300 - 10% = 270
      is_freebie: false,
    };
    expect(calculateItemTotal(item)).toBe(270.00);
  });

  it('azzera il totale per voci contrassegnate come omaggio ma conserva il valore lordo', () => {
    const freebieItem = {
      quantity: 1,
      unit_price: 250.00,
      discount_percent: 0,
      is_freebie: true,
    };
    expect(calculateItemTotal(freebieItem)).toBe(0);
    expect(calculateItemGrossValue(freebieItem)).toBe(250.00);
  });
});

describe('2. Prospetto Preventivo, Oneri Fiscali e Servizi Extra', () => {
  it('applica sconto globale, oneri previdenziali e IVA in sequenza corretta', () => {
    const items = [
      { quantity: 1, unit_price: 1000.00, discount_percent: 0, is_freebie: false },
    ];
    const quote = {
      global_discount_percent: 10, // 1000 - 100 = 900
      fiscal_levy_enabled: true,
      fiscal_levy_percent: 4.0, // 4% su 900 = 36.00 -> base imponibile = 936.00
      vat_enabled: true,
      vat_percent: 22.0, // 22% su 936 = 205.92
      agreed_total: null,
    };

    const totals = calculateQuoteTotals(quote, items);
    expect(totals.itemsSubtotal).toBe(1000.00);
    expect(totals.globalDiscountAmount).toBe(100.00);
    expect(totals.subtotalAfterDiscount).toBe(900.00);
    expect(totals.fiscalLevyAmount).toBe(36.00);
    expect(totals.vatAmount).toBe(205.92);
    expect(totals.computedMathematicalTotal).toBe(1141.92);
    expect(totals.agreedBaseTotal).toBe(1141.92);
  });

  it('gestisce il totale concordato modificabile con precedenza sul calcolo matematico', () => {
    const items = [
      { quantity: 1, unit_price: 850.00, discount_percent: 0, is_freebie: false },
    ];
    const quote = {
      agreed_total: 800.00, // Concordato forfettario
    };
    const totals = calculateQuoteTotals(quote, items);
    expect(totals.agreedBaseTotal).toBe(800.00);
    expect(totals.hasManualAgreedTotal).toBe(true);
  });

  it('verifica che i servizi extra proposti NON aumentino il totale, mentre quelli approvati LO aumentino', () => {
    const items = [
      { quantity: 1, unit_price: 500.00, discount_percent: 0, is_freebie: false },
    ];
    const quote = { agreed_total: 500.00 };

    const extraServices = [
      { description: 'Ore shooting aggiuntive', amount: 150.00, status: 'proposto' },
      { description: 'Reel promozionale', amount: 200.00, status: 'approvato' },
      { description: 'Stampe fine art', amount: 100.00, status: 'rifiutato' },
    ];

    const totals = calculateQuoteTotals(quote, items, extraServices);
    expect(totals.extraProposedTotal).toBe(150.00);
    expect(totals.extraApprovedTotal).toBe(200.00);
    // Solo il servizio approvato deve essere sommato al totale finale effettivo
    expect(totals.finalEffectiveTotal).toBe(700.00); // 500 + 200
  });
});

describe('3. Pagamenti, Rimborsi e Residuo', () => {
  it('registra acconti e saldi correttamente senza far aumentare l\'incassato dai pagamenti previsti', () => {
    const effectiveTotal = 1000.00;
    const payments = [
      { amount: 300.00, status: 'incassato', type: 'acconto' },
      { amount: 700.00, status: 'previsto', type: 'saldo' }, // Non ancora incassato
    ];

    const balance = calculatePaymentBalance(effectiveTotal, payments);
    expect(balance.collectedAmount).toBe(300.00);
    expect(balance.expectedPendingAmount).toBe(700.00);
    expect(balance.residualAmount).toBe(700.00);
    expect(balance.isFullyPaid).toBe(false);
  });

  it('i rimborsi riducono l\'incassato effettivo e aumentano il residuo', () => {
    const effectiveTotal = 1000.00;
    const payments = [
      { amount: 500.00, status: 'incassato', type: 'acconto' },
      { amount: 100.00, status: 'incassato', type: 'rimborso' }, // Rimborso parziale
    ];

    const balance = calculatePaymentBalance(effectiveTotal, payments);
    expect(balance.collectedAmount).toBe(400.00); // 500 - 100
    expect(balance.refundsAmount).toBe(100.00);
    expect(balance.residualAmount).toBe(600.00); // 1000 - 400
  });
});

describe('4. Report Finanziari ed Esclusione Doppio Conteggio', () => {
  it('evita rigorosamente il doppio conteggio tra preventivi e to-do inclusi', () => {
    const quotes = [
      { id: 'q-1', agreed_total: 1500.00, status: 'accettato', issue_date: '2026-10-01' },
    ];
    const todos = [
      // Questo to-do fa parte del preventivo, quindi NON deve essere contato nel fatturato autonomo!
      { id: 't-1', quote_id: 'q-1', compensation_mode: 'included_in_quote', compensation_amount: 1500.00 },
      // Questo to-do è autonomo e deve essere aggiunto al fatturato
      { id: 't-2', quote_id: null, compensation_mode: 'autonomous', compensation_amount: 250.00 },
    ];
    const payments = [
      { quote_id: 'q-1', amount: 500.00, status: 'incassato', type: 'acconto', payment_date: '2026-10-05' },
    ];
    const expenses = [
      { amount: 300.00, date: '2026-10-10' },
    ];

    const report = calculateFinancialReport({ quotes, todos, payments, expenses });

    // Fatturato concordato: 1500 (quote) + 250 (todo autonomo) = 1750 (NON 3250!)
    expect(report.agreedRevenue).toBe(1750.00);
    // Incasso reale: 500
    expect(report.collectedCash).toBe(500.00);
    // Crediti residui: 1750 - 500 = 1250
    expect(report.residualReceivables).toBe(1250.00);
    // Spese: 300
    expect(report.totalExpenses).toBe(300.00);
    // Margine di cassa: 500 - 300 = 200
    expect(report.estimatedCashMargin).toBe(200.00);
    // Margine sul concordato: 1750 - 300 = 1450
    expect(report.estimatedAgreedMargin).toBe(1450.00);
  });
});

describe('5. Generazione Nome File PDF Normalizzato', () => {
  it('costruisce il nome secondo la specifica: Preventivo - Numero - Nome Cognome - Azienda.pdf', () => {
    const quote = { quote_number: '2026-042' };
    const client = {
      first_name: 'Giulia',
      last_name: 'Verdi',
      company_name: 'Studio Gamma Srl',
    };
    const fileName = buildQuotePdfFileName(quote, client);
    expect(fileName).toBe('Preventivo - 2026-042 - Giulia Verdi - Studio Gamma Srl.pdf');
  });

  it('sanifica caratteri speciali e gestisce campi vuoti senza errori', () => {
    const quote = { quote_number: 'Bozza/01' };
    const client = {
      first_name: 'Mario',
      last_name: 'Rossi',
      company_name: '',
    };
    const fileName = buildQuotePdfFileName(quote, client);
    expect(fileName).toBe('Preventivo - Bozza-01 - Mario Rossi.pdf');
  });
});

describe('6. Gestione Cestino (Soft Delete & Restore)', () => {
  beforeEach(() => {
    store.clearAll();
  });

  it('sposta un record nel cestino e consente di ripristinarlo', () => {
    const client = store.create('clients', { first_name: 'Luca', last_name: 'Bianchi', type: 'person' });
    expect(store.getAll('clients').length).toBe(1);

    // Soft delete
    store.moveToTrash('clients', client.id);
    expect(store.getAll('clients').length).toBe(0);
    expect(store.getAllTrash().length).toBe(1);

    // Restore
    store.restoreFromTrash('clients', client.id);
    expect(store.getAll('clients').length).toBe(1);
    expect(store.getAllTrash().length).toBe(0);
  });
});

describe('7. Intelligenza Artificiale & Smart Parser Multitask', () => {
  it('riconosce richieste multiple distinte senza trasformare nomi di servizi in clienti', async () => {
    // Esempio cardine della specifica:
    // "Devo attivare un abbonamento per lavorare, fare le foto prodotti per Cliente A e preparare i contenuti per Cliente B."
    const prompt = "Devo attivare un abbonamento per lavorare, fare le foto prodotti per Cliente A e preparare i contenuti per Cliente B";

    const existingClients = [
      { id: 'c-a', name: 'Cliente A' },
      { id: 'c-b', name: 'Cliente B' },
    ];

    const result = await processAiPrompt({
      prompt,
      existingClients,
    });

    expect(result).toBeDefined();
    // Deve estrarre proposte
    const allItems = [...(result.todos || []), ...(result.appointments || [])];
    expect(allItems.length).toBeGreaterThanOrEqual(3);

    // L'abbonamento NON deve avere client_id
    const subscriptionItem = allItems.find(it => it.title.toLowerCase().includes('abbonamento'));
    expect(subscriptionItem).toBeDefined();
    expect(subscriptionItem.client_id).toBeNull();

    // Le foto prodotti devono essere collegate o proposte per Cliente A
    const photoItem = allItems.find(it => it.title.toLowerCase().includes('foto'));
    expect(photoItem).toBeDefined();
    expect(photoItem.client_id === 'c-a' || photoItem.client_name_proposed === 'Cliente A').toBe(true);
  });
});

describe('8. Workflow Software Engineer: Ambienti, MRR & Onboarding IA', () => {
  it('calcola correttamente il fatturato ricorrente mensile (MRR) e annuale (ARR)', () => {
    const clients = [
      {
        id: 'c-1',
        company_name: 'TechCorp',
        maintenance_contracts: [
          { title: 'SLA Base', amount: 300, frequency: 'monthly', status: 'active' },
          { title: 'Hosting Dedicato', amount: 50, frequency: 'monthly', status: 'active' },
          { title: 'Contratto Sospeso', amount: 100, frequency: 'monthly', status: 'paused' },
        ],
      },
      {
        id: 'c-2',
        company_name: 'Nexus Commerce',
        maintenance_contracts: [
          { title: 'Manutenzione Annuale', amount: 1200, frequency: 'annual', status: 'active' }, // 1200 / 12 = 100/m
        ],
      },
    ];

    const report = calculateFinancialReport({ clients, quotes: [], todos: [], payments: [], expenses: [] });
    // MRR = 300 + 50 + 100 (da annuale 1200/12) = 450
    expect(report.mrr).toBe(450.00);
    expect(report.activeContractsCount).toBe(3);
  });

  it('l\'assistente IA riconosce e on-boarda un cliente storico con repo, ambienti e canone', async () => {
    const prompt = 'Lavoro da mesi con Marco di TechCorp, sito https://www.techcorp.it, staging https://stage.techcorp.dev, repo antoromano/techcorp-web, stack Next.js e Supabase, canone manutenzione 300€/mese. Devo fare deploy mercoledì alle 15.';

    const result = await processAiPrompt({ prompt });
    expect(result).toBeDefined();
    expect(result.clients_to_create).toBeDefined();
    expect(result.clients_to_create.length).toBeGreaterThan(0);

    const client = result.clients_to_create[0];
    expect(client.company_name).toContain('TechCorp');
    expect(client.first_name).toBe('Marco');
    expect(client.production_url).toBe('https://www.techcorp.it');
    expect(client.staging_url).toBe('https://stage.techcorp.dev');
    expect(client.github_repo).toBe('antoromano/techcorp-web');
    expect(client.stack).toContain('Next.js');
    expect(client.maintenance_amount).toBe(300);
    expect(client.maintenance_frequency).toBe('monthly');

    // Verifica che abbia estratto anche l'appuntamento di tipo deploy
    const deployAppt = result.appointments.find(a => a.activity_type === 'deploy' || a.title.toLowerCase().includes('deploy'));
    expect(deployAppt).toBeDefined();
    expect(deployAppt.activity_type).toBe('deploy');
  });
});

describe('9. Second Brain: Architettura Cognitiva Tri-Layer Ibrida', () => {
  beforeEach(() => {
    store.clearAll();
  });

  it('1. esegue l\'ingestione nel Second Brain salvando memoria 768-dim, fatti atomici e grafo', async () => {
    const res = await ingestKnowledge({
      title: 'Architettura Cliente TechCorp',
      text: 'Il cliente TechCorp usa Next.js e Supabase con PostgreSQL. Canone MRR: 350€/mese. Massimale pull-up: 14 ripetizioni.',
      domain: 'client',
      tags: ['saas', 'architettura'],
    });

    expect(res.memory).toBeDefined();
    expect(res.memory.domain).toBe('client');
    expect(Array.isArray(res.memory.embedding)).toBe(true);
    expect(res.memory.embedding.length).toBe(768);

    // Verifica fatti estratti nel Livello 2
    expect(res.facts.length).toBeGreaterThanOrEqual(2);
    const activeFacts = store.getActiveFacts();
    expect(activeFacts.some(f => f.fact_key === 'stack_principale' && f.fact_value.includes('Next.js'))).toBe(true);
    expect(activeFacts.some(f => f.fact_key === 'canone_mrr' && f.fact_value.includes('350'))).toBe(true);

    // Verifica nodi e archi estratti nel Livello 3
    const { nodes, edges } = store.getBrainGraph();
    expect(nodes.some(n => n.label === 'Next.js' && n.node_type === 'technology')).toBe(true);
    expect(nodes.some(n => n.label === 'Supabase' && n.node_type === 'technology')).toBe(true);
    expect(edges.some(e => e.relation_type === 'USA_TECNOLOGIA')).toBe(true);
  });

  it('2. gestisce l\'upsert dei fatti stile Mem0 con storicizzazione automatica (is_active = false sul vecchio)', () => {
    // Creazione stato iniziale (v1)
    const first = upsertFact({
      subject: 'TechCorp',
      fact_key: 'canone_mrr',
      fact_value: '300€/mese',
      category: 'client_info',
    });

    expect(first).toBeDefined();
    expect(first.is_active).toBe(true);
    expect(first.action).toBe('created');

    // Aggiornamento con stesso valore -> non duplica
    const same = upsertFact({
      subject: 'techcorp',
      fact_key: 'canone_mrr',
      fact_value: '300€/mese',
      category: 'client_info',
    });
    expect(same.id).toBe(first.id);
    expect(same.action).toBe('unchanged');

    // Evoluzione dello stato con nuovo valore (v2) -> storicizza il vecchio record
    const updated = upsertFact({
      subject: 'TechCorp',
      fact_key: 'canone_mrr',
      fact_value: '500€/mese',
      category: 'client_info',
    });

    expect(updated.id).not.toBe(first.id);
    expect(updated.is_active).toBe(true);
    expect(updated.fact_value).toBe('500€/mese');
    expect(updated.action).toBe('superseded');

    // Il vecchio fatto deve avere is_active = false, valid_to valorizzato e superseded_by = updated.id
    const oldRecord = store.getById('brain_facts', first.id);
    expect(oldRecord.is_active).toBe(false);
    expect(oldRecord.valid_to).toBeTruthy();
    expect(oldRecord.superseded_by).toBe(updated.id);

    // Lo storico per (TechCorp, canone_mrr) contiene 2 versioni, ma solo 1 è attiva
    const history = store.getFactHistory('TechCorp', 'canone_mrr');
    expect(history.length).toBe(2);
    const activeForTechCorp = store.getActiveFacts('TechCorp');
    expect(activeForTechCorp.length).toBe(1);
    expect(activeForTechCorp[0].fact_value).toBe('500€/mese');
  });

  it('3. crea nodi/archi nel Knowledge Graph e risponde tramite interrogazione ibrida a 2 Hop (querySecondBrain)', async () => {
    await ingestKnowledge({
      title: 'Note Stack e Sicurezza',
      text: 'TechCorp usa Supabase per il database cloud. Target kcal: 2450 kcal.',
      domain: 'tech',
    });

    // Creiamo una catena a 2 Hop: [TechCorp] ──(USA_TECNOLOGIA)──> [Supabase] ──(DIPENDE_DA)──> [Row Level Security]
    upsertGraphRelationship({
      source: 'TechCorp',
      source_type: 'client',
      target: 'Supabase',
      target_type: 'technology',
      relation_type: 'USA_TECNOLOGIA',
      evidence: 'Stack principale',
    });

    const rel2 = upsertGraphRelationship({
      source: 'Supabase',
      source_type: 'technology',
      target: 'Row Level Security',
      target_type: 'concept',
      relation_type: 'DIPENDE_DA',
      evidence: 'Best practice sicurezza Postgres',
    });

    expect(rel2.edge.weight).toBe(1);

    // Ripetendo la relazione il peso viene incrementato
    const rel2Repeat = upsertGraphRelationship({
      source: 'Supabase',
      target: 'Row Level Security',
      relation_type: 'DIPENDE_DA',
    });
    expect(rel2Repeat.edge.weight).toBe(2);

    // Interrogazione ibrida su "TechCorp": deve recuperare memorie, fatti attivi e relazioni fino a 2 Hop (inclusa Row Level Security!)
    const queryResult = await querySecondBrain('TechCorp');
    expect(queryResult.relevantMemories.length).toBeGreaterThan(0);
    expect(queryResult.activeFacts.length).toBeGreaterThan(0);
    expect(queryResult.graphConnections.length).toBeGreaterThanOrEqual(2);

    const hasHop1 = queryResult.graphConnections.some(c => c.target_label === 'Supabase' && c.hop === 1);
    const hasHop2 = queryResult.graphConnections.some(c => c.target_label === 'Row Level Security' && c.hop === 2);
    expect(hasHop1).toBe(true);
    expect(hasHop2).toBe(true);
    expect(queryResult.synthesizedContext).toContain('Row Level Security');
  });

  it('4. sincronizza automaticamente i clienti creati/aggiornati nel Gestionale con Fatti Mem0 e Nodi del Grafo', () => {
    const client = store.create('clients', {
      type: 'company',
      company_name: 'AlfaCloud Srl',
      stack: 'React, Node.js, PostgreSQL',
      github_repo: 'antoromano/alfacloud',
      maintenance_contracts: [
        { title: 'SLA Mensile', amount: 400, frequency: 'monthly', status: 'active' },
      ],
    });

    const factsV1 = store.getActiveFacts('AlfaCloud Srl');
    expect(factsV1.some(f => f.fact_key === 'canone_mrr' && f.fact_value === '400€/mese')).toBe(true);
    expect(factsV1.some(f => f.fact_key === 'stack_principale' && f.fact_value.includes('React'))).toBe(true);

    // Aggiornamento del canone del cliente -> storicizza automaticamente il vecchio MRR nel Second Brain
    store.update('clients', client.id, {
      maintenance_contracts: [
        { title: 'SLA Enterprise', amount: 650, frequency: 'monthly', status: 'active' },
      ],
    });

    const factsV2 = store.getActiveFacts('AlfaCloud Srl');
    const activeMrr = factsV2.find(f => f.fact_key === 'canone_mrr');
    expect(activeMrr.fact_value).toBe('650€/mese');

    const mrrHistory = store.getFactHistory('AlfaCloud Srl', 'canone_mrr');
    expect(mrrHistory.length).toBe(2);
  });
});

describe('10. Modulo Body: Parser Notazione, Semaforo 2-3gg, Media Mobile Peso & Second Brain Sync', () => {
  beforeEach(() => {
    store.clearAll();
  });

  it('1. parseWorkoutNotation interpreta carichi, serie, moltiplicatori (10x5), varianti con parole complete, sigle legacy e Singolo Arto', () => {
    // 1a. Carico e serie standard: 20(10,10,10,10)
    const p1 = parseWorkoutNotation('20(10,10,10,10)', 'pull');
    expect(p1.blocks.length).toBe(1);
    expect(p1.blocks[0].load_kg).toBe(20);
    expect(p1.blocks[0].sets).toEqual([10, 10, 10, 10]);
    expect(p1.blocks[0].total_sets).toBe(4);
    expect(p1.blocks[0].total_reps).toBe(40);
    expect(p1.blocks[0].tonnage_kg).toBe(800);

    // 1b. Moltiplicatore rapido corpo libero: 10x5
    const p2 = parseWorkoutNotation('10x5', 'push');
    expect(p2.blocks[0].load_kg).toBe(0);
    expect(p2.blocks[0].sets).toEqual([10, 10, 10, 10, 10]);
    expect(p2.blocks[0].total_reps).toBe(50);

    // 1c. Sigla legacy S -> espande automaticamente in "Singolo Arto" (unilateral: true)
    const p3 = parseWorkoutNotation('10S(10,10,10)', 'legs_post');
    expect(p3.blocks[0].unilateral).toBe(true);
    expect(p3.blocks[0].execution_mode).toBe('Singolo Arto');
    expect(p3.blocks[0].load_kg).toBe(10);
    expect(p3.blocks[0].sets).toEqual([10, 10, 10]);
    expect(p3.normalized_notation).toContain('Singolo Arto');

    // 1d. Blocchi multipli separati da "+" e mappatura W -> "Presa Larga", PP -> "Pseudo Planche"
    const p4 = parseWorkoutNotation('30(5,6,6) + W(15,15)', 'pull');
    expect(p4.blocks.length).toBe(2);
    expect(p4.blocks[0].load_kg).toBe(30);
    expect(p4.blocks[0].variant_name).toBe('Standard');
    expect(p4.blocks[1].variant_name).toBe('Presa Larga');
    expect(p4.blocks[1].sets).toEqual([15, 15]);
    expect(p4.total_sets).toBe(5);
    expect(p4.total_reps).toBe(47);

    // 1e. Cardio & Sport testuale: "1h basket"
    const p5 = parseWorkoutNotation('1h basket', 'cardio');
    expect(p5.blocks.length).toBe(1);
    expect(p5.blocks[0].duration_minutes).toBe(60);
    expect(p5.blocks[0].variant_name.toLowerCase()).toContain('basket');
  });

  it('2. calculateColumnRecoveryStatus calcola il semaforo di recupero sulla finestra 2-3 giorni', () => {
    const col = DEFAULT_BODY_COLUMNS[0]; // Pull Up (target 3gg)
    const refDate = '2026-11-10';

    // Allenato ieri (1 giorno fa) -> recovery (blu)
    const s1 = calculateColumnRecoveryStatus(col, [{ column_id: col.id, date: '2026-11-09', raw_notation: '20(10,10,10)' }], refDate);
    expect(s1.days_since_last).toBe(1);
    expect(s1.status).toBe('recovery');

    // Allenato 2 giorni fa -> optimal (verde, finestra ideale 2-3gg)
    const s2 = calculateColumnRecoveryStatus(col, [{ column_id: col.id, date: '2026-11-08', raw_notation: '20(10,10,10)' }], refDate);
    expect(s2.days_since_last).toBe(2);
    expect(s2.status).toBe('optimal');

    // Allenato 5 giorni fa -> overdue (rosso/arancio, priorità oggi)
    const s3 = calculateColumnRecoveryStatus(col, [{ column_id: col.id, date: '2026-11-05', raw_notation: '20(10,10,10)' }], refDate);
    expect(s3.days_since_last).toBe(5);
    expect(s3.status).toBe('overdue');
  });

  it('3. calculateBodyTrends calcola la media mobile a 7 giorni del peso e le medie nutrizionali', () => {
    const dailyLogs = [
      { date: '2026-11-08', body_weight_kg: 75.0, sleep_hours: 7.5, calories_kcal: 2400, protein_g: 160, carbs_g: 280, fat_g: 70 },
      { date: '2026-11-09', body_weight_kg: 75.6, sleep_hours: 8.0, calories_kcal: 2600, protein_g: 170, carbs_g: 300, fat_g: 75 },
      { date: '2026-11-10', body_weight_kg: 75.3, sleep_hours: 7.0, calories_kcal: 2500, protein_g: 165, carbs_g: 290, fat_g: 74 },
    ];

    const trends = calculateBodyTrends({
      dailyLogs,
      workoutEntries: [],
      columns: DEFAULT_BODY_COLUMNS,
    });

    expect(trends.weightMovingAverageSeries.length).toBe(3);
    // Media mobile su (75.0 + 75.6 + 75.3) / 3 = 75.30
    expect(trends.avgWeight7d).toBe(75.3);
    expect(trends.avgCalories7d).toBe(2500);
    expect(trends.avgProtein7d).toBe(165);
  });

  it('4. l\'Assistente IA estrae un Body Log completo dal linguaggio naturale e lo sincronizza col Second Brain', async () => {
    const prompt = 'Oggi peso 75.3kg, dormito 7.5 ore, 2500 kcal con 165g proteine, 290g carbo e 75g grassi. Allenamento: Pull up 30(7,8,8) e presa larga (15,15), Affondi 20(15,15,15), Stacchi singolo arto 10(12,12), 1h basket';

    const res = await processAiPrompt({ prompt });
    expect(res.body_log).toBeDefined();
    expect(res.body_log).not.toBeNull();
    expect(res.body_log.body_weight_kg).toBe(75.3);
    expect(res.body_log.sleep_hours).toBe(7.5);
    expect(res.body_log.calories_kcal).toBe(2500);
    expect(res.body_log.protein_g).toBe(165);
    expect(res.body_log.carbs_g).toBe(290);
    expect(res.body_log.fat_g).toBe(75);
    expect(res.body_log.workout_entries.length).toBeGreaterThanOrEqual(4);

    // Salva nel store e verifica l'auto-sync con il Second Brain (Livello 2 Mem0 + Livello 3 Grafo)
    store.upsertBodyDailyLog({
      date: res.body_log.date,
      body_weight_kg: res.body_log.body_weight_kg,
      sleep_hours: res.body_log.sleep_hours,
      calories_kcal: res.body_log.calories_kcal,
      protein_g: res.body_log.protein_g,
      carbs_g: res.body_log.carbs_g,
      fat_g: res.body_log.fat_g,
    });

    for (const we of res.body_log.workout_entries) {
      store.upsertBodyWorkoutEntry({
        date: res.body_log.date,
        column_id: we.column_id,
        raw_notation: we.raw_notation,
        parsed_blocks: we.parsed_blocks,
      });
    }

    const activeAntonioFacts = store.getActiveFacts('Antonio');
    expect(activeAntonioFacts.some(f => f.fact_key === 'peso_corporeo' && f.fact_value.includes('75.3'))).toBe(true);
    expect(activeAntonioFacts.some(f => f.fact_key === 'apporto_calorico' && f.fact_value.includes('2500'))).toBe(true);

    const activeWorkoutFacts = store.getActiveFacts('Allenamento');
    expect(activeWorkoutFacts.some(f => f.fact_key.includes('pull_up') && f.fact_value.includes('30kg'))).toBe(true);

    const { nodes, edges } = store.getBrainGraph();
    expect(nodes.some(n => n.label === 'Pull Up' && n.node_type === 'exercise')).toBe(true);
    expect(edges.some(e => e.relation_type === 'PRATICA')).toBe(true);
  });
});
