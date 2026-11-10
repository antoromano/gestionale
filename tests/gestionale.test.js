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
