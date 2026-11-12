// tests/gestionale.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { clearModelCache, setGeminiTimeout } from '../src/services/gemini-core.js';
import { processAiPrompt } from '../src/services/ai.js';
import {
  ingestKnowledge,
  proposeKnowledge,
  commitKnowledge,
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
import {
  getTelegramWebhookUrl,
  parseTelegramCommand,
} from '../src/services/telegram.js';
import {
  computeTradingMetrics,
  getRecurrenceDates,
  normalizeFrequency,
  localTodayIso,
  addDaysIso,
} from '../src/services/finances.js';
import {
  parseCsv,
  parseNumber,
  parseDateValue,
  detectTemplate,
  analyzeRows,
  buildImportPlan,
  buildWizardPlan,
  suggestWizardMapping,
  commitImportPlan,
  autoImportRows,
} from '../src/utils/csv-importer.js';
import { readXlsx } from '../src/utils/xlsx-reader.js';
import {
  AI_PROFILES,
  selectAiProfile,
  buildAiPayload,
  composeSystemInstruction,
  buildBatchPrompt,
  processNoteQueueBatch,
} from '../src/services/ai.js';


/**
 * IA simulata: la chiave è "presente", Google risponde con l'elenco modelli e, per generateContent, con il JSON dato
 * (un oggetto fisso o una funzione del corpo della richiesta). Serve a provare cosa fa l'app DOPO la risposta dell'IA.
 */
function stubAi(response, { status = 200 } = {}) {
  clearModelCache();
  store.updateSettings({ gemini_api_key: 'TEST_KEY' });
  const fn = vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (/\/v1beta\/models(\?|$)/.test(u)) {
      return { ok: true, json: async () => ({ models: [{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] }] }) };
    }
    if (u.includes(':generateContent')) {
      if (status !== 200) return { ok: false, status, text: async () => JSON.stringify({ error: { message: 'errore simulato' } }) };
      const body = init.body ? JSON.parse(init.body) : {};
      const json = typeof response === 'function' ? response(body) : response;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] }) };
    }
    if (u.includes(':embedContent')) return { ok: true, json: async () => ({ embedding: { values: new Array(768).fill(0.05) } }) };
    return { ok: false, status: 404, text: async () => '' };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

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
  afterEach(() => vi.unstubAllGlobals());

  it('riconosce richieste multiple distinte senza trasformare nomi di servizi in clienti', async () => {
    // Esempio cardine della specifica:
    // "Devo attivare un abbonamento per lavorare, fare le foto prodotti per Cliente A e preparare i contenuti per Cliente B."
    const prompt = "Devo attivare un abbonamento per lavorare, fare le foto prodotti per Cliente A e preparare i contenuti per Cliente B";

    const existingClients = [
      { id: 'c-a', name: 'Cliente A' },
      { id: 'c-b', name: 'Cliente B' },
    ];

    stubAi({
      summary: '3 attività',
      todos: [
        { title: 'Attivare abbonamento per lavorare', client_id: null },
        { title: 'Foto prodotti', client_id: 'c-a', client_name_proposed: 'Cliente A' },
        { title: 'Preparare contenuti', client_id: null, client_name_proposed: 'Cliente B' },
      ],
    });
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
  afterEach(() => vi.unstubAllGlobals());

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

    stubAi({
      summary: 'Cliente storico',
      clients_to_create: [{ company_name: 'TechCorp', first_name: 'Marco', production_url: 'https://www.techcorp.it', staging_url: 'https://stage.techcorp.dev', github_repo: 'antoromano/techcorp-web', stack: 'Next.js, Supabase', maintenance_amount: 300, maintenance_frequency: 'monthly' }],
      appointments: [{ title: 'Deploy TechCorp', start_time: '2026-11-18T15:00:00', activity_type: 'deploy' }],
    });
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
  afterEach(() => vi.unstubAllGlobals());

  it('1. esegue l\'ingestione nel Second Brain salvando memoria 768-dim, fatti atomici e grafo', async () => {
    stubAi({
      summary: 'TechCorp usa Next.js e Supabase',
      tags: ['saas'],
      facts: [
        { subject: 'TechCorp', fact_key: 'stack_principale', fact_value: 'Next.js, Supabase, PostgreSQL', category: 'client_info' },
        { subject: 'TechCorp', fact_key: 'canone_mrr', fact_value: '350€/mese', category: 'metric' },
      ],
      nodes: [{ label: 'Next.js', node_type: 'technology' }, { label: 'Supabase', node_type: 'technology' }, { label: 'TechCorp', node_type: 'client' }],
      edges: [{ source_label: 'TechCorp', target_label: 'Next.js', relation_type: 'USA_TECNOLOGIA' }, { source_label: 'TechCorp', target_label: 'Supabase', relation_type: 'USA_TECNOLOGIA' }],
    });
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
    stubAi({ summary: 'TechCorp usa Supabase', facts: [{ subject: 'TechCorp', fact_key: 'database', fact_value: 'Supabase', category: 'client_info' }], nodes: [], edges: [] });
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
  afterEach(() => vi.unstubAllGlobals());

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

    stubAi({
      summary: 'Diario Body',
      body_log: {
        date: '2026-11-11', body_weight_kg: 75.3, sleep_hours: 7.5, calories_kcal: 2500, protein_g: 165, carbs_g: 290, fat_g: 75,
        workout_entries: [
          { column_slug: 'pull_up', raw_notation: '30(7,8,8) + Presa Larga (15,15)' },
          { column_slug: 'affondi', raw_notation: '20(15,15,15)' },
          { column_slug: 'stacchi', raw_notation: 'Singolo Arto 10(12,12)' },
          { column_slug: 'cardio_sport', raw_notation: '1h basket' },
        ],
      },
    });
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
    expect(res.body_log.workout_entries.map(e => e.column_slug)).toEqual(['pull_up', 'affondi', 'stacchi', 'cardio_sport']); // ogni esercizio nella sua colonna

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

describe('11. Integrazione Telegram Bot & 4° Livello di Protezione (Human-in-the-Loop)', () => {
  beforeEach(() => {
    store.clearAll();
    store.updateSettings({
      telegram_bot_token: '123456:TEST_TOKEN',
      telegram_allowed_user_id: '99887766',
      telegram_connected: true,
    });
  });

  it('Il webhook del bot punta alla Edge Function del progetto Supabase', () => {
    expect(getTelegramWebhookUrl()).toBe('https://hbyqofpkkenzgbggvlch.supabase.co/functions/v1/telegram-webhook');
  });
});



// ===========================================================================
// EVOLUZIONE: FINANZE & CASH FLOW, COMPRAVENDITA, IMPORTATORE, CODA APPUNTI, AVVOCATO DEL DIAVOLO
// ===========================================================================

describe('12. Compravendita / Flipping: Margine Netto e ROI % automatici', () => {
  beforeEach(() => {
    store.clearAll();
  });

  it('1. replica le colonne GENERATED di trading_items: netto = vendita - acquisto - extra - commissioni, ROI = netto / (acquisto + extra)', () => {
    const m = computeTradingMetrics({ purchase_price: 40, extra_costs: 10, sale_price: 80, platform_fees: 6 });
    expect(m.net_profit).toBe(24); // 80 - 40 - 10 - 6
    expect(m.roi_percent).toBe(48); // 24 / 50 * 100
    expect(m.margin_percent).toBe(30); // 24 / 80
    expect(m.total_cost).toBe(50);
  });

  it('2. articolo non venduto: netto e ROI sono NULL; base costi zero: ROI NULL; arrotondamento ROUND(x,2) come PostgreSQL', () => {
    expect(computeTradingMetrics({ purchase_price: 40, extra_costs: 0 })).toMatchObject({ net_profit: null, roi_percent: null });
    expect(computeTradingMetrics({ purchase_price: 0, extra_costs: 0, sale_price: 30 })).toMatchObject({ net_profit: 30, roi_percent: null });
    // 10.01 / 30 * 100 = 33.3666... -> 33.37
    expect(computeTradingMetrics({ purchase_price: 30, sale_price: 40.01 }).roi_percent).toBe(33.37);
    // perdita: -10 / 100 -> -10
    expect(computeTradingMetrics({ purchase_price: 100, sale_price: 90 }).roi_percent).toBe(-10);
    // niente errori di virgola mobile: 0.1 + 0.2
    expect(computeTradingMetrics({ purchase_price: 0.1, sale_price: 0.3 }).net_profit).toBe(0.2);
  });

  it('3. lo store calcola e ricalcola automaticamente net_profit e roi_percent in creazione e modifica', () => {
    const item = store.create('trading_items', { title: 'GoPro Hero 9', platform: 'Vinted', purchase_price: 100, extra_costs: 20 });
    expect(item.status).toBe('in_stock');
    expect(item.net_profit).toBeNull();
    expect(item.roi_percent).toBeNull();

    const sold = store.update('trading_items', item.id, { sale_price: 180, platform_fees: 12, status: 'sold' });
    expect(sold.net_profit).toBe(48); // 180 - 100 - 20 - 12
    expect(sold.roi_percent).toBe(40); // 48 / 120
  });

  it('4. getTradingStats: capitale in giacenza, utile realizzato e ROI medio (esclusi resi e cestinati)', () => {
    store.create('trading_items', { title: 'In vendita', purchase_price: 100, status: 'in_stock' });
    store.create('trading_items', { title: 'Riservato', purchase_price: 50, extra_costs: 10, status: 'reserved' });
    store.create('trading_items', { title: 'Venduto A', purchase_price: 40, extra_costs: 10, sale_price: 80, platform_fees: 6 }); // +24, ROI 48
    store.create('trading_items', { title: 'Venduto B', purchase_price: 100, sale_price: 90 }); // -10, ROI -10
    store.create('trading_items', { title: 'Reso', purchase_price: 999, status: 'returned' });
    const trashed = store.create('trading_items', { title: 'Cestinato', purchase_price: 500, status: 'in_stock' });
    store.moveToTrash('trading_items', trashed.id);

    const stats = store.getTradingStats();
    expect(stats.stockCapital).toBe(100);
    expect(stats.reservedCapital).toBe(60);
    expect(stats.activeCapital).toBe(160);
    expect(stats.realizedProfit).toBe(14); // 24 - 10
    expect(stats.avgRoiPercent).toBe(19); // (48 - 10) / 2
    expect(stats.soldCount).toBe(2);
  });
});

describe('13. Finanze: Cash Flow mensile, Ricorrenze idempotenti e retrocompatibilità Spese', () => {
  beforeEach(() => {
    store.clearAll();
  });

  it('1. Cashflow Netto = Entrate - Uscite del mese (ignora altri mesi e cestinati, senza errori di virgola mobile)', () => {
    store.create('finance_transactions', { type: 'income', amount: 1500, description: 'Saldo sito', date: '2026-11-03' });
    store.create('finance_transactions', { type: 'income', amount: 500, description: 'Canone', date: '2026-11-20' });
    store.create('finance_transactions', { type: 'expense', amount: 200, description: 'Hosting', category: 'Server & Hosting', date: '2026-11-05' });
    store.create('finance_transactions', { type: 'expense', amount: 100, description: 'Adobe', category: 'Software & Abbonamenti', date: '2026-11-28' });
    store.create('finance_transactions', { type: 'expense', amount: 999, description: 'Mese scorso', date: '2026-10-31' });
    const trashed = store.create('finance_transactions', { type: 'expense', amount: 777, description: 'Cestinata', date: '2026-11-10' });
    store.moveToTrash('finance_transactions', trashed.id);

    const summary = store.getFinancialSummary(11, 2026);
    expect(summary.totalIncome).toBe(2000);
    expect(summary.totalExpenses).toBe(300);
    expect(summary.netCashflow).toBe(1700);
    expect(summary.byCategory.expense.map(c => [c.category, c.total])).toEqual([['Server & Hosting', 200], ['Software & Abbonamenti', 100]]);

    store.create('finance_transactions', { type: 'income', amount: 0.1, description: 'a', date: '2026-12-01' });
    store.create('finance_transactions', { type: 'income', amount: 0.2, description: 'b', date: '2026-12-02' });
    expect(store.getFinancialSummary(12, 2026).totalIncome).toBe(0.3);
  });

  it('2. Previsione Uscite Ricorrenti del mese: mensili, settimanali, annuali; esclude sospese e terminate', () => {
    const mk = (extra) => store.create('finance_transactions', { type: 'expense', category: 'Software & Abbonamenti', is_recurring: true, ...extra });
    mk({ description: 'Hosting', amount: 20, date: '2026-01-15', recurrence_start_date: '2026-01-15', recurrence_frequency: 'monthly' });
    mk({ description: 'Coworking', amount: 10, date: '2026-11-02', recurrence_start_date: '2026-11-02', recurrence_frequency: 'weekly' }); // 2, 9, 16, 23, 30 novembre
    mk({ description: 'Dominio', amount: 120, date: '2025-11-20', recurrence_start_date: '2025-11-20', recurrence_frequency: 'annual' }); // alias legacy
    mk({ description: 'Licenza marzo', amount: 300, date: '2025-03-01', recurrence_start_date: '2025-03-01', recurrence_frequency: 'yearly' });
    mk({ description: 'Sospesa', amount: 99, date: '2026-01-01', recurrence_start_date: '2026-01-01', recurrence_frequency: 'monthly', is_suspended: true });
    mk({ description: 'Terminata', amount: 50, date: '2026-01-01', recurrence_start_date: '2026-01-01', recurrence_end_date: '2026-06-30', recurrence_frequency: 'monthly' });

    const before = store.getFinancialSummary(11, 2026);
    expect(before.forecastRecurringExpenses).toBe(190); // 20 + 5x10 + 120
    expect(before.recurringItemsCount).toBe(3);
    expect(before.recurringPendingExpenses).toBeGreaterThan(0);

    // Dopo la generazione fino a fine mese non resta nulla da addebitare
    store.generateRecurringTransactions('2026-11-30');
    const after = store.getFinancialSummary(11, 2026);
    expect(after.recurringPendingExpenses).toBe(0);
    expect(after.forecastRecurringExpenses).toBe(190);
    expect(after.totalExpenses).toBe(190);
  });

  it('3. la generazione è IDEMPOTENTE, non rigenera le occorrenze cestinate e gestisce i fine mese', () => {
    store.create('finance_transactions', {
      type: 'expense', description: 'Server', amount: 25, date: '2026-01-31',
      is_recurring: true, recurrence_start_date: '2026-01-31', recurrence_frequency: 'monthly',
    });

    const first = store.generateRecurringTransactions('2026-05-31');
    expect(first).toBe(4); // feb, mar, apr, mag
    expect(store.generateRecurringTransactions('2026-05-31')).toBe(0);

    const dates = store.getAll('finance_transactions').map(t => t.date).sort();
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);

    // Una occorrenza cestinata dall'utente non ricompare
    const feb = store.getAll('finance_transactions').find(t => t.date === '2026-02-28');
    store.moveToTrash('finance_transactions', feb.id);
    expect(store.generateRecurringTransactions('2026-05-31')).toBe(0);

    expect(getRecurrenceDates({ start: '2026-01-31', frequency: 'monthly' }, '2026-01-01', '2026-03-31'))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(normalizeFrequency('annual')).toBe('yearly');
  });

  it('4. retrocompatibilità: la collezione `expenses` è una vista su finance_transactions con type = expense', () => {
    const exp = store.create('expenses', { description: 'Abbonamento Adobe', amount: 60, category: 'Software', date: '2026-11-04' });
    store.create('finance_transactions', { type: 'income', amount: 800, description: 'Incasso', date: '2026-11-05' });

    const ledger = store.getAll('finance_transactions');
    expect(ledger.find(t => t.id === exp.id).type).toBe('expense');
    expect(store.getAll('expenses').map(e => e.id)).toEqual([exp.id]); // le entrate non compaiono come spese
    expect(store.getById('expenses', exp.id).description).toBe('Abbonamento Adobe');

    store.update('expenses', exp.id, { amount: 65 });
    expect(store.getFinancialSummary(11, 2026).totalExpenses).toBe(65);

    store.moveToTrash('expenses', exp.id);
    expect(store.getAll('expenses')).toHaveLength(0);
    expect(store.getAllTrash().some(t => t.id === exp.id && t.collection === 'finance_transactions')).toBe(true);
    expect(store.restoreFromTrash('expenses', exp.id)).toBe(true);
    expect(store.getAll('expenses')).toHaveLength(1);
  });

  it('5. le vecchie spese (data.expenses da localStorage o backup) migrano nel ledger in modo idempotente', () => {
    store.data.expenses = [
      { id: 'legacy-1', description: 'Server annuale', amount: 120, category: 'Hosting', date: '2025-06-01', is_recurring: true, recurrence_frequency: 'annual', recurrence_start_date: '2025-06-01' },
      { id: 'legacy-2', description: 'Cestinata', amount: 10, date: '2025-07-01', is_deleted: true },
    ];
    expect(store.migrateLegacyExpenses()).toBe(2);
    expect(store.data.expenses).toBeUndefined();
    const migrated = store.getById('finance_transactions', 'legacy-1');
    expect(migrated.type).toBe('expense');
    expect(migrated.recurrence_frequency).toBe('yearly');
    expect(store.getAll('finance_transactions')).toHaveLength(1);

    store.data.expenses = [{ id: 'legacy-1', description: 'Server annuale', amount: 120, date: '2025-06-01' }];
    expect(store.migrateLegacyExpenses()).toBe(0); // già presente
  });
});

describe('14. Importatore Universale CSV / Excel (zero token)', () => {
  beforeEach(() => {
    store.clearAll();
  });

  it('1. parser CSV: virgolette, separatore ; , BOM e riga "sep=;"', () => {
    expect(parseCsv('a;b;c\n1;"due; con punto e virgola";3\r\n')).toEqual([['a', 'b', 'c'], ['1', 'due; con punto e virgola', '3']]);
    expect(parseCsv('﻿x,y\n"he said ""hi""",2')).toEqual([['x', 'y'], ['he said "hi"', '2']]);
    expect(parseCsv('sep=;\nA;B\n1;2')).toEqual([['A', 'B'], ['1', '2']]);
    expect(parseNumber('1.234,56', { money: true })).toBe(1234.56);
    expect(parseNumber('€ 12,50', { money: true })).toBe(12.5);
    expect(parseNumber('(12.50)')).toBe(-12.5);
    expect(parseNumber('72.456')).toBe(72.456); // peso: il punto singolo è decimale
    expect(parseDateValue('11/11/2026')).toBe('2026-11-11');
    expect(parseDateValue('2026-11-11 08:30:00')).toBe('2026-11-11');
    expect(parseDateValue('31/02/2026')).toBeNull();
  });

  it('2. auto-detection MyFitnessPal: aggrega i pasti per data e scrive in body_daily_logs (re-import senza duplicati)', () => {
    const csv = [
      'Date,Meal,Calories,Fat (g),Saturated Fat,Carbohydrates (g),Sugar,Protein (g)',
      '2026-11-10,Breakfast,500,10,3,60,12,30',
      '2026-11-10,Lunch,800,20,6,90,10,50',
      '2026-11-11,Dinner,"1,200",40,12,120,20,70',
    ].join('\n');

    const { table, detection } = analyzeRows(parseCsv(csv));
    expect(detection.template).toBe('nutrition');
    expect(detection.target).toBe('body_daily_logs');

    const plan = buildImportPlan(table, detection.template, detection.mapping);
    expect(plan.records).toEqual([
      { date: '2026-11-10', calories_kcal: 1300, protein_g: 80, carbs_g: 150, fat_g: 30 },
      { date: '2026-11-11', calories_kcal: 1200, protein_g: 70, carbs_g: 120, fat_g: 40 },
    ]);

    const first = commitImportPlan(plan, store);
    expect(first.imported).toBe(2);
    const day = store.getAll('body_daily_logs').find(l => l.date === '2026-11-10');
    expect(day.calories_kcal).toBe(1300);

    const second = commitImportPlan(plan, store);
    expect(second.imported).toBe(0);
    expect(second.updated).toBe(2);
    expect(store.getAll('body_daily_logs')).toHaveLength(2);
  });

  it('3. auto-detection Compravendita (oggetto/acquisto/vendita/piattaforma): calcola margine e ROI e salta i duplicati', () => {
    const csv = [
      'Oggetto;Acquisto;Vendita;Piattaforma;Spese Extra;Commissioni',
      'GoPro Hero 9;"100,00";"180,00";Vinted;"20,00";"12,00"',
      'Tastiera meccanica;35;;Subito;0;0',
      ';10;20;eBay;0;0',
    ].join('\n');

    const { table, detection } = analyzeRows(parseCsv(csv));
    expect(detection.template).toBe('trading');
    expect(detection.target).toBe('trading_items');

    const plan = buildImportPlan(table, detection.template, detection.mapping);
    expect(plan.records).toHaveLength(2);
    expect(plan.errors).toHaveLength(1); // riga senza oggetto
    const gopro = plan.records.find(r => r.title === 'GoPro Hero 9');
    expect(gopro).toMatchObject({ platform: 'Vinted', status: 'sold', net_profit: 48, roi_percent: 40 });
    expect(plan.records.find(r => r.title === 'Tastiera meccanica').status).toBe('in_stock');

    expect(commitImportPlan(plan, store).imported).toBe(2);
    const again = commitImportPlan(plan, store);
    expect(again.imported).toBe(0);
    expect(again.duplicates).toBe(2);
    expect(store.getAll('trading_items')).toHaveLength(2);
    expect(store.getTradingStats().realizedProfit).toBe(48);
  });

  it('4. auto-detection Estratto Conto (data/descrizione/entrata/uscita) e importo con segno; righe identiche nello stesso file restano entrambe', () => {
    const csv = [
      'Data;Descrizione;Entrata;Uscita',
      '03/11/2026;Saldo sito Rossi;"1.500,00";',
      '05/11/2026;Caffè;;"1,20"',
      '05/11/2026;Caffè;;"1,20"',
      'non-una-data;Errore;;10',
    ].join('\n');
    const { table, detection } = analyzeRows(parseCsv(csv));
    expect(detection.template).toBe('finance');

    const plan = buildImportPlan(table, detection.template, detection.mapping);
    expect(plan.records.map(r => [r.type, r.amount])).toEqual([['income', 1500], ['expense', 1.2], ['expense', 1.2]]);
    expect(plan.errors).toHaveLength(1);

    expect(commitImportPlan(plan, store).imported).toBe(3);
    expect(commitImportPlan(plan, store)).toMatchObject({ imported: 0, duplicates: 3 });
    expect(store.getFinancialSummary(11, 2026).netCashflow).toBe(1497.6);

    // Variante a colonna unica con segno (tipico estratto conto bancario)
    store.clearAll();
    const signed = autoImportRows(parseCsv('Data operazione,Causale,Importo\n2026-11-02,Bonifico cliente,800.50\n2026-11-03,Carburante,-45.00'), store);
    expect(signed.needsMapping).toBe(false);
    expect(signed.result.imported).toBe(2);
    expect(store.getFinancialSummary(11, 2026)).toMatchObject({ totalIncome: 800.5, totalExpenses: 45 });
  });

  it('5. Wizard di Mapping: header sconosciuti -> nessun template, mappatura manuale Finanze e accoppiamento Acquisto/Vendita', () => {
    const csv = [
      'Giorno X;Cosa;Soldi;Natura',
      '2026-11-01;Stipendio;2000;Entrata',
      '2026-11-02;Affitto;700;Uscita',
    ].join('\n');
    const { table, detection } = analyzeRows(parseCsv(csv));
    expect(detection.template).toBeNull();

    expect(suggestWizardMapping(table).date).toBe(0); // "Giorno X" suggerito come colonna Data
    const finance = buildWizardPlan(table, { date: 0, description: 1, amount: 2, type: 3 });
    expect(finance.target).toBe('finance_transactions');
    expect(finance.records.map(r => [r.type, r.amount])).toEqual([['income', 2000], ['expense', 700]]);

    const flips = analyzeRows(parseCsv('Quando;Roba;Euro;Mossa\n2026-10-01;Monopattino;60;Acquisto\n2026-10-09;Monopattino;95;Vendita\n2026-10-10;Cuffie;30;Acquisto'));
    const trading = buildWizardPlan(flips.table, { date: 0, description: 1, amount: 2, type: 3 });
    expect(trading.target).toBe('trading_items');
    const monopattino = trading.records.find(r => r.title === 'Monopattino');
    expect(monopattino).toMatchObject({ purchase_price: 60, sale_price: 95, status: 'sold', net_profit: 35 });
    expect(trading.records.find(r => r.title === 'Cuffie').status).toBe('in_stock');

    // Mappatura incompleta: errore esplicito, nessun record
    expect(buildWizardPlan(table, { date: 0, description: null, amount: 2, type: null }).records).toHaveLength(0);
  });

  it('6. legge un vero file .xlsx (ZIP deflate + sharedStrings + date seriali) senza librerie esterne', async () => {
    const enc = new TextEncoder();
    const deflate = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const files = {
      'xl/workbook.xml': '<workbook xmlns:r="x"><sheets><sheet name="Movimenti" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>Data</t></si><si><t>Descrizione</t></si><si><t>Importo</t></si><si><t>Stipendio &amp; bonus</t></si><si><t>Caffè</t></si></sst>',
      'xl/styles.xml': '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    };
    const serial = Math.round((Date.UTC(2026, 10, 11) - Date.UTC(1899, 11, 30)) / 86400000);
    files['xl/worksheets/sheet1.xml'] = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
      <row r="2"><c r="A2" s="1"><v>${serial}</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>1500.5</v></c></row>
      <row r="3"><c r="A3" s="1"><v>${serial + 1}</v></c><c r="B3" t="s"><v>4</v></c><c r="C3"><v>-1.2</v></c></row>
    </sheetData></worksheet>`;

    const chunks = [];
    const central = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
      const nameBytes = enc.encode(name);
      const raw = enc.encode(content);
      const comp = await deflate(raw);
      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 8, true);
      lv.setUint32(18, comp.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, nameBytes.length, true);
      local.set(nameBytes, 30);
      const cen = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, 8, true);
      cv.setUint32(20, comp.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      cen.set(nameBytes, 46);
      chunks.push(local, comp);
      central.push(cen);
      offset += local.length + comp.length;
    }
    const cdSize = central.reduce((n, c) => n + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    const zip = new Uint8Array(offset + cdSize + 22);
    let pos = 0;
    for (const part of [...chunks, ...central, eocd]) { zip.set(part, pos); pos += part.length; }

    const { sheetName, rows } = await readXlsx(zip);
    expect(sheetName).toBe('Movimenti');
    expect(rows).toEqual([
      ['Data', 'Descrizione', 'Importo'],
      ['2026-11-11', 'Stipendio & bonus', 1500.5],
      ['2026-11-12', 'Caffè', -1.2],
    ]);

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const imported = autoImportRows(rows, store);
    vi.unstubAllGlobals();
    expect(imported.detection.template).toBe('finance');
    expect(imported.result.imported).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled(); // zero token / zero rete
  });
});

describe('15. Coda Appunti & Ingestion Batching', () => {
  beforeEach(() => {
    store.clearAll();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1. accoda senza chiamate IA, mantiene l\'ordine di inserimento e marca le note come elaborate', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(store.addQueuedNote('   ')).toBeNull();
    const a = store.addQueuedNote('Pull Up 20(10,10,10,10)');
    const b = store.addQueuedNote('ho speso 45€ di benzina', 'telegram');
    const c = store.addQueuedNote('richiamare Marco', 'altro-sconosciuto');
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(store.getQueuedNotes().map(n => n.content)).toEqual(['Pull Up 20(10,10,10,10)', 'ho speso 45€ di benzina', 'richiamare Marco']);
    expect(b.source).toBe('telegram');
    expect(c.source).toBe('web');
    expect(a.status).toBe('queued');

    expect(store.markNotesProcessed([a.id, b.id])).toBe(2);
    expect(store.markNotesProcessed([a.id])).toBe(0); // idempotente
    expect(store.getQueuedNotes().map(n => n.id)).toEqual([c.id]);
  });

  it('2. elabora N note con UNA sola chiamata (profilo ingestion_batch) concatenandole in un unico prompt', async () => {
    store.updateSettings({ gemini_api_key: 'TEST_KEY' });
    store.addQueuedNote('Pull Up 20(10,10,10,10), peso 75.1kg');
    store.addQueuedNote('ho speso 45€ di benzina');
    store.addQueuedNote('devo richiamare Marco domani per il preventivo');

    const fetchMock = vi.fn(async (url) => {
      if (/\/v1beta\/models(\?|$)/.test(String(url))) {
        return { ok: true, json: async () => ({ models: [{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }] }) };
      }
      if (String(url).includes(':generateContent')) {
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: JSON.stringify({
              summary: '1 → Body · 2 → Finanze · 3 → To-do',
              body_log: { date: '2026-11-11', body_weight_kg: 75.1, workout_entries: [{ column_slug: 'pull_up', column_name: 'Pull Up', raw_notation: '20(10,10,10,10)' }] },
              finance_transactions: [{ type: 'expense', amount: 45, description: 'Benzina', category: 'Trasporti & Viaggi', date: '2026-11-11' }],
              todos: [{ title: 'Richiamare Marco', due_date: null, priority: 'media' }],
            }) }] } }],
          }),
        };
      }
      return { ok: false, status: 404 }; // embedding non disponibile -> fallback locale
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await processNoteQueueBatch(store.getQueuedNotes());

    const generateCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes(':generateContent'));
    expect(generateCalls).toHaveLength(1); // 3 note -> 1 sola chiamata
    const sentBody = JSON.parse(generateCalls[0][1].body);
    const sentText = `${sentBody.systemInstruction.parts[0].text}\n${sentBody.contents[0].parts[0].text}`;
    expect(sentText).toContain('Pull Up 20(10,10,10,10)');
    expect(sentText).toContain('ho speso 45€ di benzina');
    expect(sentText).toContain('richiamare Marco');
    expect(sentText).toContain('PROFILO ATTIVO');
    expect(sentText).toContain('Ingestion Batch');

    expect(result.profile).toBe('ingestion_batch');
    expect(result.source).toBe('gemini_direct');
    expect(result.aiCalls).toBe(1);
    expect(result.notesCount).toBe(3);
    expect(result.finance_transactions[0]).toMatchObject({ type: 'expense', amount: 45 });
    expect(result.todos).toHaveLength(1);
    expect(result.body_log.workout_entries).toHaveLength(1);

    // Le note restano in coda finché il chiamante non conferma
    expect(store.getQueuedNotes()).toHaveLength(3);
    expect(buildBatchPrompt(store.getQueuedNotes())).toContain('3 note');
  });

  it('3. il batch manda TUTTE le note in UNA sola chiamata e restituisce i risultati; senza IA dà un errore esplicito (nessun ripiego)', async () => {
    store.addQueuedNote('colazione 400 kcal');
    store.addQueuedNote('pranzo 700 kcal con 50g proteine');
    store.addQueuedNote('ho speso 30€ di hosting Vercel');

    const fn = stubAi({
      summary: 'Pasti e una spesa',
      body_log: { date: '2026-11-11', calories_kcal: 1100, protein_g: 50, workout_entries: [] },
      finance_transactions: [{ type: 'expense', amount: 30, description: 'Hosting Vercel', category: 'Server & Hosting', date: '2026-11-11' }],
    });
    const result = await processNoteQueueBatch(store.getQueuedNotes());
    const generateCalls = fn.mock.calls.filter(([u]) => String(u).includes(':generateContent'));
    expect(generateCalls).toHaveLength(1);
    expect(result.aiCalls).toBe(1);
    expect(JSON.stringify(JSON.parse(generateCalls[0][1].body).contents)).toContain('3 note');
    expect(result.body_log.calories_kcal).toBe(1100);
    expect(result.finance_transactions[0]).toMatchObject({ type: 'expense', amount: 30, category: 'Server & Hosting' });
    expect(store.getQueuedNotes()).toHaveLength(3); // restano in coda finché non confermi

    vi.unstubAllGlobals();
    store.updateSettings({ gemini_api_key: '' });
    await expect(processNoteQueueBatch(store.getQueuedNotes())).rejects.toMatchObject({ code: 'not_configured' });
    expect(store.getQueuedNotes()).toHaveLength(3);
  });

  it('4. i comandi /queue e /digest vengono riconosciuti (il bot vero è provato in tests/telegram-e2e.test.js)', () => {
    expect(parseTelegramCommand('/queue@MioBot ciao mondo')).toEqual({ name: 'queue', args: 'ciao mondo' });
    expect(parseTelegramCommand('/digest')).toEqual({ name: 'digest', args: '' });
    expect(parseTelegramCommand('Pull Up 20(10,10)')).toBeNull();
  });
});

describe('16. Profili Specializzati & modalità "Avvocato del Diavolo"', () => {
  beforeEach(() => {
    store.clearAll();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1. selezione automatica del profilo dal modulo attivo; il toggle forza devils_advocate; il profilo esplicito vince', () => {
    expect(Object.keys(AI_PROFILES).sort()).toEqual(['devils_advocate', 'finance_coach', 'general_brain', 'ingestion_batch', 'nutrition_fitness']);
    expect(selectAiProfile({ activeModule: 'body' })).toBe('nutrition_fitness');
    expect(selectAiProfile({ activeModule: 'finances' })).toBe('finance_coach');
    expect(selectAiProfile({ activeModule: 'expenses' })).toBe('finance_coach');
    expect(selectAiProfile({ activeModule: 'brain' })).toBe('general_brain');
    expect(selectAiProfile({ activeModule: 'todos' })).toBe('general_brain');
    expect(selectAiProfile({})).toBe('general_brain');
    expect(selectAiProfile({ activeModule: 'body', devilsAdvocate: true })).toBe('devils_advocate');
    expect(selectAiProfile({ activeModule: 'body', devilsAdvocate: true, profile: 'ingestion_batch' })).toBe('ingestion_batch');
  });

  it('2. con il toggle attivo il payload di sistema contiene la persona critica e le evidenze calcolate dai dati reali', () => {
    const today = localTodayIso();
    // Preventivo ambizioso, senza limiti alle revisioni, consegna fra 5 giorni
    store.create('quotes', { quote_number: 'PREV-2026-001', title: 'E-commerce Rossi', status: 'bozza', issue_date: today, agreed_total: 3000, conditions: 'Pagamento a 30 giorni.', expected_delivery: addDaysIso(today, 5) });
    // Rivendita con profitto orario basso: netto 20€ in 5 ore
    store.create('trading_items', { title: 'Console retro', purchase_price: 20, sale_price: 45, platform_fees: 5, hours_spent: 5, sale_date: today });
    // Sonno scarso + due giorni di allenamento ravvicinati
    for (const offset of [0, -1, -2]) store.upsertBodyDailyLog({ date: addDaysIso(today, offset), sleep_hours: 5.5 });
    store.upsertBodyWorkoutEntry({ date: today, column_id: 'col-pull-up', raw_notation: '20(10,10,10)' });
    store.upsertBodyWorkoutEntry({ date: addDaysIso(today, -1), column_id: 'col-pull-up', raw_notation: '20(10,10,10)' });

    const on = buildAiPayload({ prompt: 'Conviene accettare questo preventivo, continuare le rivendite su Vinted e allenarmi oggi?', activeModule: 'body', devilsAdvocate: true });
    expect(on.profile).toBe('devils_advocate');
    expect(on.devilsAdvocate).toBe(true);
    expect(on.personaInstruction).toContain('AVVOCATO DEL DIAVOLO');
    expect(on.personaInstruction).toContain('+25-35%');

    const system = composeSystemInstruction(on);
    expect(system).toContain('PROFILO ATTIVO');
    expect(system).toContain('AVVOCATO DEL DIAVOLO');
    expect(system).toContain('EVIDENZE CALCOLATE DAI DATI REALI');

    const q = on.devilsEvidence.quotes.pipeline[0];
    expect(q.bufferedRange).toEqual({ min: 3750, max: 4050 }); // +25% / +35%
    expect(q.warnings.join(' ')).toMatch(/revisioni/i);
    expect(q.warnings.join(' ')).toMatch(/Scadenza irrealistica/);

    const t = on.devilsEvidence.trading;
    expect(t.soldItems[0].hourlyProfit).toBe(4); // 20€ / 5h, ben sotto la tariffa dev di 50€/h
    expect(t.belowRateCount).toBe(1);

    const b = on.devilsEvidence.body;
    expect(b.avgSleep7d).toBe(5.5);
    expect(b.overtrainingRisk).toBe('alto');
    expect(b.warnings.join(' ')).toMatch(/overtraining/i);

    // Senza toggle: profilo automatico, nessuna persona critica nel payload
    const off = buildAiPayload({ prompt: 'Conviene fare questo preventivo?', activeModule: 'quotes', devilsAdvocate: false });
    expect(off.profile).toBe('finance_coach');
    expect(off.devilsAdvocate).toBe(false);
    expect(composeSystemInstruction(off)).not.toContain('AVVOCATO DEL DIAVOLO');
    expect(off.devilsEvidence).toBeUndefined();
  });

  it('3. processAiPrompt in modalità Avvocato del Diavolo: invia la persona al modello e non crea to-do/eventi', async () => {
    store.updateSettings({ gemini_api_key: 'TEST_KEY' });
    const fetchMock = vi.fn(async (url) => {
      if (/\/v1beta\/models(\?|$)/.test(String(url))) {
        return { ok: true, json: async () => ({ models: [{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }] }) };
      }
      if (String(url).includes(':generateContent')) {
        return {
          ok: true,
          json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
            summary: 'Preventivo troppo ottimista',
            todos: [{ title: 'NON dovrebbe essere creato' }],
            critique: { verdict: 'Non accettare così', risks: ['Scadenza irrealistica'], recommendations: ['Aggiungi +30% di buffer'], buffer_percent: { min: 25, max: 35 }, hourly_profit: null },
          }) }] } }] }),
        };
      }
      return { ok: false, status: 404 };
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await processAiPrompt({ prompt: 'E-commerce a 3000€ in 10 giorni, revisioni illimitate', devilsAdvocate: true, activeModule: 'quotes' });
    const calls = fetchMock.mock.calls.filter(([url]) => String(url).includes(':generateContent'));
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0][1].body).systemInstruction.parts[0].text).toContain('AVVOCATO DEL DIAVOLO');
    expect(JSON.parse(calls[0][1].body).generationConfig.temperature).toBe(AI_PROFILES.devils_advocate.temperature);

    expect(res.profile).toBe('devils_advocate');
    expect(res.todos).toHaveLength(0); // anche se il modello ne restituisce, la persona critica non crea azioni
    expect(res.critique.verdict).toBe('Non accettare così');
    expect(res.critique.buffer_percent).toEqual({ min: 25, max: 35 });
  });

  it('3b. se l\'IA NON risponde (modello sparito, non configurata) l\'app lancia un errore con il motivo: niente ripiego a regole locali', async () => {
    clearModelCache();
    store.updateSettings({ gemini_api_key: 'TEST_KEY' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, text: async () => JSON.stringify({ error: { message: 'models/gemini-1.5-flash is not found' } }) })));

    await expect(processAiPrompt({ prompt: 'Devo richiamare Marco domani' })).rejects.toMatchObject({ code: 'model_unavailable' });
    await expect(processAiPrompt({ prompt: 'Devo richiamare Marco domani' })).rejects.toThrow(/non è più disponibile/);

    // senza alcuna configurazione: errore "non configurata"
    vi.unstubAllGlobals();
    store.updateSettings({ gemini_api_key: '' });
    await expect(processAiPrompt({ prompt: 'Devo richiamare Marco domani' })).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('3c. se Google non risponde entro il tempo limite l\'errore è "timeout" (prima la funzione restava appesa per minuti)', async () => {
    clearModelCache();
    store.updateSettings({ gemini_api_key: 'TEST_KEY' });
    setGeminiTimeout(80);
    vi.stubGlobal('fetch', vi.fn((url, init = {}) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })));
    try {
      await expect(processAiPrompt({ prompt: 'Devo richiamare Marco domani' })).rejects.toMatchObject({ code: 'timeout' });
    } finally {
      setGeminiTimeout(40000);
    }
  });

  it('4. con l\'Avvocato del Diavolo le azioni operative vengono scartate e, se il modello non dà la critica, arriva quella calcolata sui dati reali (buffer 25-35%)', async () => {
    stubAi({ summary: 'Valutazione', todos: [{ title: 'Da non creare' }], appointments: [{ title: 'Neppure questo', start_time: '2026-11-20T10:00:00' }], critique: null });
    const res = await processAiPrompt({ prompt: 'Ti sembra fattibile un e-commerce a 3000€ in 10 giorni?', devilsAdvocate: true, activeModule: 'quotes' });
    expect(res.engine).toBe('ai');
    expect(res.todos).toHaveLength(0);
    expect(res.appointments).toHaveLength(0);
    expect(res.critique.risks.join(' ')).toMatch(/scadenza irrealistica/i);
    expect(res.critique.buffer_percent).toEqual({ min: 25, max: 35 });
    expect(res.critique.recommendations.join(' ')).toMatch(/revisioni/i);
  });
});


describe('20. Second Brain: proponi → anteprima → conferma, con motore sempre dichiarato', () => {
  const NOTE = 'Ho sentito Marco Rossi di TechCorp: vuole rifare il sito in Next.js, budget circa 4000 euro, consegna entro fine mese. Ricordarsi di proporre un canone di manutenzione. Marco preferisce essere contattato via WhatsApp il pomeriggio.';
  beforeEach(() => {
    store.clearAll();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1. con l\'IA la nota su Marco/TechCorp diventa fatti corretti PRIMA di salvare; salvando nulla va perso né attribuito alla persona sbagliata', async () => {
    clearModelCache(); // la cache dei modelli è per chiave: i test precedenti usavano la stessa chiave finta
    store.updateSettings({ gemini_api_key: 'TEST_KEY' });
    const aiFacts = {
      summary: 'Marco Rossi (TechCorp) vuole rifare il sito',
      tags: ['techcorp'],
      facts: [
        { subject: 'TechCorp', fact_key: 'stack_richiesto', fact_value: 'Next.js', category: 'client_info' },
        { subject: 'TechCorp', fact_key: 'budget', fact_value: '4000 euro', category: 'metric' },
        { subject: 'TechCorp', fact_key: 'scadenza', fact_value: 'fine mese', category: 'status' },
        { subject: 'Marco Rossi', fact_key: 'canale_preferito', fact_value: 'WhatsApp, pomeriggio', category: 'preference' },
      ],
      nodes: [{ label: 'TechCorp', node_type: 'client', properties: {} }, { label: 'Marco Rossi', node_type: 'person', properties: {} }, { label: 'Next.js', node_type: 'technology', properties: {} }],
      edges: [{ source_label: 'TechCorp', target_label: 'Next.js', relation_type: 'USA_TECNOLOGIA', evidence: 'vuole rifare il sito in Next.js' }],
    };
    const fetchMock = vi.fn(async (url) => {
      const u = String(url);
      if (/\/v1beta\/models(\?|$)/.test(u)) {
        return { ok: true, json: async () => ({ models: [{ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] }] }) };
      }
      if (u.includes(':generateContent')) return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(aiFacts) }] } }] }) };
      if (u.includes(':embedContent')) return { ok: true, json: async () => ({ embedding: { values: new Array(768).fill(0.05) } }) };
      return { ok: false, status: 404, text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    const proposal = await proposeKnowledge({ text: NOTE, domain: 'client' });
    expect(proposal.engine).toBe('ai');
    expect(proposal.error).toBeUndefined();
    expect(proposal.facts.map(f => `${f.subject}.${f.fact_key}=${f.fact_value}`)).toEqual([
      'TechCorp.stack_richiesto=Next.js', 'TechCorp.budget=4000 euro', 'TechCorp.scadenza=fine mese', 'Marco Rossi.canale_preferito=WhatsApp, pomeriggio',
    ]);
    expect(store.getAll('brain_memories')).toHaveLength(0); // l'anteprima non salva nulla

    // L'utente corregge un fatto e deseleziona l'arco del grafo, poi conferma
    const edited = { ...proposal, facts: proposal.facts.map(f => (f.fact_key === 'budget' ? { ...f, fact_value: '4500 euro' } : f)), edges: [] };
    const res = await commitKnowledge({ text: NOTE, domain: 'client' }, edited);
    expect(res.engine).toBe('ai');
    expect(res.facts).toHaveLength(4);
    expect(store.getActiveFacts('TechCorp').find(f => f.fact_key === 'budget').fact_value).toBe('4500 euro');
    expect(store.getActiveFacts('Antonio')).toHaveLength(0); // niente fatti attribuiti a "Antonio" per sbaglio
    expect(res.memory.embedding_source).toBe('gemini');
    expect(res.memory.embedding).toHaveLength(768);
  });

  it('2. senza IA o con IA guasta NON si salva e NON si inventa nulla: errore esplicito con il motivo', async () => {
    clearModelCache();
    store.updateSettings({ gemini_api_key: '' });
    await expect(proposeKnowledge({ text: NOTE, domain: 'client' })).rejects.toMatchObject({ code: 'not_configured' });

    store.updateSettings({ gemini_api_key: 'TEST_KEY' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ error: { message: 'quota' } }) })));
    await expect(proposeKnowledge({ text: NOTE, domain: 'client' })).rejects.toThrow(/limite di richieste/);
    expect(store.getAll('brain_memories')).toHaveLength(0);
  });
});
