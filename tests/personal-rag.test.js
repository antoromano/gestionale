// tests/personal-rag.test.js
// Archivio personale interrogabile: schema e vettori (STEP 2), importazione di chat e documenti (STEP 3),
// chat "Chiedi a te stesso" (STEP 4) e comando /ask di Telegram (STEP 5).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { store } from '../src/services/store.js';
import { cloud, toRow } from '../src/services/cloud.js';
import { openaiEmbed, OPENAI_EMBED_MODEL } from '../src/services/ai-providers.js';
import {
  upsertFact, deleteFact, updateFact, updateMemory, deleteNode, upsertGraphRelationship,
  recalculateAllEmbeddings, generateEmbeddingDetailed, computeLocalEmbedding,
} from '../src/services/brain.js';
import {
  parseChatGptExport, parseClaudeExport, parseGeminiExport, parseImportFile, cleanAssistantText,
  conversationToCleanText, chunkText, estimateTokens, estimateImportCost, filterFactsByEvidence, buildFactExtractionRequests,
} from '../src/utils/chat-importer.js';
import {
  importDocument, deleteDocument, reindexDocument, getDocumentRawContent, getDocumentChunks, searchChunks, createImportRunner,
} from '../src/services/brain-docs.js';
import { createFakeCloud } from './helpers/fake-supabase.js';
import { stubOpenAI } from './helpers/stub-openai.js';

async function signedInClient(fake) {
  const { data } = await fake.browser().auth.signUp({ email: 'io@example.com', password: 'segreta123' });
  return { client: fake.browser(), userId: data.user.id };
}

// --- Export di prova -----------------------------------------------------------------------------------------------

/** Export ChatGPT: albero con una risposta rigenerata (ramo morto) e un messaggio di sistema nascosto. */
const CHATGPT_EXPORT = [{
  title: 'Cucina Veloce',
  create_time: 1700000000, // 2023-11-14
  conversation_id: 'conv-cucina',
  current_node: 'n5',
  mapping: {
    root: { id: 'root', message: null, parent: null, children: ['sys'] },
    sys: { id: 'sys', parent: 'root', children: ['n1'], message: { author: { role: 'system' }, content: { content_type: 'text', parts: ['You are ChatGPT'] }, metadata: { is_visually_hidden_from_conversation: true } } },
    n1: { id: 'n1', parent: 'sys', children: ['n2', 'n2b'], message: { author: { role: 'user' }, create_time: 1700000010, content: { content_type: 'text', parts: ['Sono intollerante al lattosio e ho al massimo 20 minuti per cucinare la sera. Cosa mi consigli con il pollo?'] } } },
    n2b: { id: 'n2b', parent: 'n1', children: [], message: { author: { role: 'assistant' }, create_time: 1700000015, content: { content_type: 'text', parts: ['RISPOSTA SCARTATA: prova la carbonara con panna.'] } } },
    n2: { id: 'n2', parent: 'n1', children: ['n3'], message: { author: { role: 'assistant' }, create_time: 1700000020, content: { content_type: 'text', parts: ['Certo! Ecco una ricetta veloce:\n\nStraccetti di pollo con zucchine e riso basmati\n- 150 g di petto di pollo\n- 1 zucchina\n- 70 g di riso basmati\nCuoci il riso 10 minuti, salta il pollo 6 minuti.\n\nDovresti mangiare circa 2500 kcal al giorno per il tuo obiettivo.\n\nSpero di esserti stato utile! Fammi sapere se vuoi altre idee.'] } } },
    n3: { id: 'n3', parent: 'n2', children: ['n4'], message: { author: { role: 'user' }, create_time: 1700000030, content: { content_type: 'text', parts: ['Ottimi gli straccetti, li rifaccio. Il mio obiettivo è 2300 kcal al giorno.'] } } },
    n4: { id: 'n4', parent: 'n3', children: ['n5'], message: { author: { role: 'tool' }, content: { content_type: 'code', text: 'print(1)' } } },
    n5: { id: 'n5', parent: 'n4', children: [], message: { author: { role: 'assistant' }, create_time: 1700000040, content: { content_type: 'text', parts: ['Perfetto. Con 2300 kcal puoi aggiungere 10 g di olio.'] } } },
  },
}, {
  title: 'Chat vuota',
  create_time: 1700000500,
  conversation_id: 'conv-vuota',
  mapping: { root: { id: 'root', message: null, parent: null, children: [] } },
}];

const CLAUDE_EXPORT = [{
  uuid: 'claude-carriera',
  name: 'Trattativa TechCorp',
  created_at: '2025-03-10T09:00:00.000Z',
  chat_messages: [
    { uuid: 'm1', sender: 'human', created_at: '2025-03-10T09:00:00.000Z', text: 'La mia tariffa oraria è 60 euro. TechCorp mi chiede uno sconto del 20% sul progetto Alfa.' },
    { uuid: 'm2', sender: 'assistant', created_at: '2025-03-10T09:00:30.000Z', text: '', content: [{ type: 'text', text: 'Ottima domanda. Ti suggerisco di non scendere sotto i 55 euro e di chiedere in cambio un canone di manutenzione.' }] },
  ],
}];

describe('22. Personal RAG — schema, vettori OpenAI e fatti con la data (STEP 2)', () => {
  beforeEach(() => {
    store.clearAll();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cloud.stop();
    vi.unstubAllGlobals();
  });

  it('1. i vettori si chiedono a OpenAI con text-embedding-3-small a 768 numeri, anche in blocco', async () => {
    const { fn, calls } = stubOpenAI();
    const res = await openaiEmbed({ apiKey: 'sk-test', fetchFn: fn, texts: ['uno', 'due'] });
    expect(calls.embed[0]).toMatchObject({ model: 'text-embedding-3-small', dimensions: 768, input: ['uno', 'due'] });
    expect(OPENAI_EMBED_MODEL).toBe('text-embedding-3-small');
    expect(res.vectors).toHaveLength(2);
    expect(res.vectors[0]).toHaveLength(768);
  });

  it('2. il vettore di una nota dichiara chi l\'ha calcolato: "openai" se l\'IA risponde, "local" (ripiego) se manca la chiave', async () => {
    stubOpenAI();
    const withAi = await generateEmbeddingDetailed('pollo e riso');
    expect(withAi.source).toBe('openai');
    expect(withAi.values).toHaveLength(768);

    store.updateSettings({ openai_api_key: '' });
    const offline = await generateEmbeddingDetailed('pollo e riso');
    expect(offline.source).toBe('local');
    expect(offline.values).toHaveLength(768);
  });

  it('3. "Ricalcola tutto" rigenera i vettori esistenti e ne aggiorna la sorgente', async () => {
    const m = store.create('brain_memories', { title: 'Vecchia nota', content: 'canone TechCorp 450 euro', domain: 'work', source_type: 'manual', embedding: new Array(768).fill(0.01), embedding_source: 'gemini' });
    const { calls } = stubOpenAI();
    const res = await recalculateAllEmbeddings();
    expect(res).toMatchObject({ total: 1, updated: 1, source: 'openai' });
    const after = store.getById('brain_memories', m.id);
    expect(after.embedding_source).toBe('openai');
    expect(after.embedding).toEqual(computeLocalEmbedding('Vecchia nota\ncanone TechCorp 450 euro'));
    expect(calls.embed).toHaveLength(1);
  });

  it('4. modificare il testo di una nota ricalcola il vettore; modificare solo le etichette no', async () => {
    const { calls } = stubOpenAI();
    const m = store.create('brain_memories', { title: 'Nota', content: 'testo vecchio', domain: 'work', source_type: 'manual', embedding: [1], embedding_source: 'local' });
    await updateMemory(m.id, { tags: 'a, b' });
    expect(calls.embed).toHaveLength(0);
    expect(store.getById('brain_memories', m.id).tags).toEqual(['a', 'b']);
    await updateMemory(m.id, { content: 'testo nuovo', domain: 'cucina' });
    expect(calls.embed).toHaveLength(1);
    const after = store.getById('brain_memories', m.id);
    expect(after).toMatchObject({ content: 'testo nuovo', domain: 'cucina', embedding_source: 'openai' });
    expect(after.embedding).toHaveLength(768);
  });

  it('5. INTEGRITÀ TEMPORALE: un fatto del 2023 importato oggi NON scavalca quello attivo del 2026, finisce nello storico', () => {
    const recent = upsertFact({ subject: 'Io', fact_key: 'target_kcal', fact_value: '2600' }, { valid_from: '2026-05-01T00:00:00Z' });
    const old = upsertFact({ subject: 'Io', fact_key: 'target_kcal', fact_value: '2300', source_document_id: 'doc-1' }, { valid_from: '2023-11-14T00:00:00Z' });

    expect(old.action).toBe('archived_historical');
    expect(old.is_active).toBe(false);
    expect(old.valid_to).toBe(recent.valid_from);
    expect(old.superseded_by).toBe(recent.id);
    expect(old.source_document_id).toBe('doc-1');

    const active = store.getActiveFacts('Io');
    expect(active).toHaveLength(1);
    expect(active[0].fact_value).toBe('2600');
    const history = store.getFactHistory('Io', 'target_kcal');
    expect(history.map(h => h.fact_value)).toEqual(['2600', '2300']); // dal più recente al più vecchio

    // reimportare la stessa chat non crea doppioni nello storico
    const again = upsertFact({ subject: 'Io', fact_key: 'target_kcal', fact_value: '2300' }, { valid_from: '2023-11-14T00:00:00Z' });
    expect(again.action).toBe('unchanged');
    expect(store.getFactHistory('Io', 'target_kcal')).toHaveLength(2);
  });

  it('6. una fonte più recente del fatto attivo lo aggiorna normalmente, con la data della fonte', () => {
    upsertFact({ subject: 'Io', fact_key: 'tariffa_oraria', fact_value: '50' }, { valid_from: '2024-01-10T00:00:00Z' });
    const newer = upsertFact({ subject: 'Io', fact_key: 'tariffa_oraria', fact_value: '60' }, { valid_from: '2025-03-10T09:00:00Z' });
    expect(newer.action).toBe('superseded');
    expect(newer.valid_from).toBe('2025-03-10T09:00:00.000Z');
    expect(newer.previousFact.valid_to).toBe('2025-03-10T09:00:00.000Z');
    expect(store.getActiveFacts('Io')[0].fact_value).toBe('60');
  });

  it('7. eliminare un fatto sbagliato fa tornare attivo quello di prima; correggere un refuso non crea storico', () => {
    const first = upsertFact({ subject: 'Io', fact_key: 'peso', fact_value: '80 kg' });
    const wrong = upsertFact({ subject: 'Io', fact_key: 'peso', fact_value: '800 kg' });
    expect(store.getActiveFacts('Io')[0].id).toBe(wrong.id);

    const res = deleteFact(wrong.id);
    expect(res.restored.id).toBe(first.id);
    const active = store.getActiveFacts('Io');
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ fact_value: '80 kg', is_active: true, valid_to: null, superseded_by: null });

    updateFact(first.id, { fact_value: '81 kg' });
    expect(store.getFactHistory('Io', 'peso')).toHaveLength(1);
    expect(store.getActiveFacts('Io')[0].fact_value).toBe('81 kg');
  });

  it('8. eliminare un nodo della mappa elimina anche i suoi collegamenti (niente archi orfani)', () => {
    const rel = upsertGraphRelationship({ source: 'TechCorp', source_type: 'client', target: 'Supabase', target_type: 'technology', relation_type: 'USA_TECNOLOGIA' });
    upsertGraphRelationship({ source: 'TechCorp', source_type: 'client', target: 'Next.js', target_type: 'technology', relation_type: 'USA_TECNOLOGIA' });
    expect(store.getBrainGraph().edges).toHaveLength(2);
    const out = deleteNode(rel.sourceNode.id);
    expect(out.deletedEdges).toBe(2);
    expect(store.getAll('brain_edges')).toHaveLength(0);
    expect(store.getAll('brain_nodes').map(n => n.label).sort()).toEqual(['Next.js', 'Supabase']);
  });

  it('9. cloud: la sorgente del vettore è una colonna vera; la colonna calcolata "fts" non viene mai inviata; le chiavi personali restano sul dispositivo', async () => {
    const row = toRow('brain_memories', { id: '00000000-0000-4000-8000-0000000000aa', title: 'T', content: 'C', embedding: [0.1, 0.2], embedding_source: 'openai', fts: 'x', document_id: null }, 'u1');
    expect(row.embedding_source).toBe('openai');
    expect(row.extra).toEqual({});
    expect('fts' in row).toBe(false);

    const fake = createFakeCloud();
    const { client, userId } = await signedInClient(fake);
    store.updateSettings({ openai_api_key: 'sk-segreta', openai_chat_model: 'gpt-x-mini' });
    await cloud.start(client, userId);
    await cloud.flush();
    const settingsRow = fake.tables.settings[0];
    expect(JSON.stringify(settingsRow)).not.toContain('sk-segreta');
    expect(settingsRow.extra.openai_chat_model).toBe('gpt-x-mini');
  });
});

describe('23. Importazione di chat e documenti (STEP 3)', () => {
  beforeEach(() => {
    store.clearAll();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cloud.stop();
    vi.unstubAllGlobals();
  });

  it('1. export ChatGPT: segue il ramo attivo dell\'albero, salta sistema/strumenti/risposte scartate e prende la data vera', () => {
    const convs = parseChatGptExport(CHATGPT_EXPORT);
    expect(convs).toHaveLength(1); // la chat vuota non entra
    const c = convs[0];
    expect(c).toMatchObject({ provider: 'chatgpt', external_id: 'conv-cucina', title: 'Cucina Veloce' });
    expect(c.date).toBe('2023-11-14T22:13:20.000Z');
    expect(c.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    const all = c.messages.map(m => m.text).join(' ');
    expect(all).not.toContain('RISPOSTA SCARTATA');
    expect(all).not.toContain('You are ChatGPT');
    expect(all).not.toContain('print(1)');
  });

  it('2. export Claude: human/assistant con data; il testo può stare in `text` o nei blocchi `content`', () => {
    const convs = parseClaudeExport(CLAUDE_EXPORT);
    expect(convs).toHaveLength(1);
    expect(convs[0]).toMatchObject({ provider: 'claude', external_id: 'claude-carriera', title: 'Trattativa TechCorp', date: '2025-03-10T09:00:00.000Z' });
    expect(convs[0].messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(convs[0].messages[1].text).toContain('55 euro');
  });

  it('3. il tipo di file si riconosce dal contenuto: ChatGPT, Claude, Gemini (Takeout), testo e markdown', () => {
    expect(parseImportFile('conversations.json', JSON.stringify(CHATGPT_EXPORT)).kind).toBe('chatgpt');
    expect(parseImportFile('conversations.json', JSON.stringify(CLAUDE_EXPORT)).kind).toBe('claude');

    const takeout = [
      { header: 'Gemini Apps', title: 'Prompted Come miglioro le trazioni?', time: '2025-06-01T08:00:00.000Z', products: ['Gemini Apps'], safeHtmlItem: [{ html: '<p>Fai <b>negative</b> lente.</p><ul><li>3 serie</li></ul>' }] },
      { header: 'Gemini Apps', title: 'Prompted E il recupero?', time: '2025-06-01T08:05:00.000Z', products: ['Gemini Apps'], safeHtmlItem: [{ html: '<p>48 ore.</p>' }] },
    ];
    const g = parseImportFile('MyActivity.json', JSON.stringify(takeout));
    expect(g.kind).toBe('gemini');
    expect(g.items).toHaveLength(1); // raggruppate per giorno
    expect(g.items[0].messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(g.items[0].messages[1].text).toContain('Fai negative lente.');
    expect(g.items[0].messages[1].text).not.toContain('<');
    expect(parseGeminiExport([{ foo: 1 }])).toEqual([]);

    const md = parseImportFile('Piano allenamento.md', '# Piano\n\nLunedì trazioni', { lastModified: Date.parse('2026-01-05T00:00:00Z') });
    expect(md.kind).toBe('markdown');
    expect(md.items[0]).toMatchObject({ provider: 'markdown', title: 'Piano allenamento', date: '2026-01-05T00:00:00.000Z' });
    expect(parseImportFile('rotto.json', '{non json').warnings[0]).toMatch(/non è un file JSON/);
    expect(parseImportFile('altro.json', JSON.stringify({ a: 1 })).items).toHaveLength(0);
  });

  it('4. REGOLA 1: si tolgono solo i convenevoli; ricetta, numeri e risposte utili dell\'assistente restano parola per parola', () => {
    const conv = parseChatGptExport(CHATGPT_EXPORT)[0];
    const clean = conversationToCleanText(conv);
    expect(clean).not.toMatch(/^\[Assistente\] Certo!/m);
    expect(clean).not.toContain('Spero di esserti stato utile');
    expect(clean).not.toContain('Fammi sapere');
    expect(clean).toContain('Straccetti di pollo con zucchine e riso basmati');
    expect(clean).toContain('- 150 g di petto di pollo');
    expect(clean).toContain('Cuoci il riso 10 minuti');
    expect(clean).toContain('[Io] Sono intollerante al lattosio');
    expect(clean).toContain('[Assistente] Perfetto. Con 2300 kcal puoi aggiungere 10 g di olio.');

    // una risposta che è SOLO contenuto non viene toccata
    const recipe = 'Ecco:\n- 1 uovo\n- sale';
    expect(cleanAssistantText(recipe)).toBe(recipe);
    expect(cleanAssistantText('Certo! La capitale è Roma.')).toBe('La capitale è Roma.');
  });

  it('5. divisione in pezzi: circa 400-500 token l\'uno, con sovrapposizione, senza perdere testo e senza spezzare il codice', () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragrafo numero ${i + 1}. ${'Questa è una frase di prova abbastanza lunga da occupare spazio. '.repeat(4)}`);
    const text = paragraphs.join('\n\n');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(estimateTokens(c)).toBeLessThanOrEqual(580);
    expect(estimateTokens(chunks[0])).toBeGreaterThan(300);
    for (let i = 1; i <= 40; i++) expect(chunks.some(c => c.includes(`Paragrafo numero ${i}.`))).toBe(true);
    // sovrapposizione: l'inizio del secondo pezzo riprende la coda del primo
    const head = chunks[1].slice(0, 60);
    expect(chunks[0]).toContain(head.split('\n\n')[0].trim());

    const code = `Spiegazione\n\n\`\`\`js\nconst a = 1;\n\nconst b = 2;\n\`\`\`\n\nFine`;
    const codeChunks = chunkText(code);
    expect(codeChunks).toHaveLength(1);
    expect(codeChunks[0]).toContain('const a = 1;\n\nconst b = 2;');
    expect(chunkText('')).toEqual([]);

    const huge = chunkText('parola '.repeat(3000));
    expect(huge.length).toBeGreaterThan(5);
    for (const c of huge) expect(estimateTokens(c)).toBeLessThanOrEqual(580);
  });

  it('6. stima dei costi prima di partire: token e euro crescono con il materiale', () => {
    const convs = [...parseChatGptExport(CHATGPT_EXPORT), ...parseClaudeExport(CLAUDE_EXPORT)];
    const one = estimateImportCost([convs[0]]);
    const two = estimateImportCost(convs);
    expect(one.items).toBe(1);
    expect(one.tokens).toBeGreaterThan(0);
    expect(one.eur).toBeGreaterThan(0);
    expect(one.eur).toBeLessThan(0.01); // una chat piccola costa una frazione di centesimo
    expect(two.tokens).toBeGreaterThan(one.tokens);
    expect(two.chunks).toBeGreaterThanOrEqual(2);
  });

  it('7. REGOLA 2: all\'IA arrivano interi solo i TUOI messaggi; un fatto senza una tua citazione viene scartato', () => {
    const conv = parseChatGptExport(CHATGPT_EXPORT)[0];
    const reqs = buildFactExtractionRequests(conv);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].text).toContain('IO: Sono intollerante al lattosio');
    expect(reqs[0].text).toContain('ASSISTENTE (contesto, NON è una fonte)');
    expect(reqs[0].text).not.toContain('Cuoci il riso 10 minuti'); // la risposta dell'assistente arriva solo abbreviata

    const authored = conv.messages.filter(m => m.role === 'user').map(m => m.text).join('\n');
    const { kept, discarded } = filterFactsByEvidence([
      { subject: 'Io', fact_key: 'intolleranza', fact_value: 'lattosio', category: 'status', evidence: 'Sono intollerante al lattosio' },
      { subject: 'Io', fact_key: 'target_kcal', fact_value: '2300 kcal', category: 'metric', evidence: 'Il mio obiettivo è 2300 kcal al giorno.' },
      // consiglio dell'assistente spacciato per fatto: la citazione non è tra le frasi dell'utente
      { subject: 'Io', fact_key: 'target_kcal_consigliato', fact_value: '2500 kcal', category: 'metric', evidence: 'Dovresti mangiare circa 2500 kcal al giorno' },
      { subject: 'Io', fact_key: 'senza_prova', fact_value: 'x', evidence: '' },
    ], authored);
    expect(kept.map(f => f.fact_key)).toEqual(['intolleranza', 'target_kcal']);
    expect(discarded.map(f => f.fact_key)).toEqual(['target_kcal_consigliato', 'senza_prova']);
  });

  it('8. importazione completa (senza cloud): documento padre, pezzi con le risposte utili, fatti solo dai tuoi messaggi e con la data della chat', async () => {
    // esiste già un obiettivo calorico più recente della chat del 2023
    upsertFact({ subject: 'Io', fact_key: 'target_kcal', fact_value: '2600 kcal' }, { valid_from: '2026-05-01T00:00:00Z' });
    const { calls } = stubOpenAI(() => ({
      summary: 'Cena veloce senza lattosio',
      facts: [
        { subject: 'Io', fact_key: 'intolleranza', fact_value: 'lattosio', category: 'status', evidence: 'Sono intollerante al lattosio' },
        { subject: 'Io', fact_key: 'tempo_cucina_sera', fact_value: 'massimo 20 minuti', category: 'rule', evidence: 'ho al massimo 20 minuti per cucinare la sera' },
        { subject: 'Io', fact_key: 'target_kcal', fact_value: '2300 kcal', category: 'metric', evidence: 'Il mio obiettivo è 2300 kcal al giorno' },
        { subject: 'Io', fact_key: 'fabbisogno', fact_value: '2500 kcal', category: 'metric', evidence: 'Dovresti mangiare circa 2500 kcal al giorno' },
      ],
    }));
    const conv = parseChatGptExport(CHATGPT_EXPORT)[0];
    const res = await importDocument(conv, { domain: 'cucina' });

    // documento padre
    const docs = store.getAll('brain_documents');
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ title: 'Cucina Veloce', source_provider: 'chatgpt', external_conversation_id: 'conv-cucina', domain: 'cucina', original_date: '2023-11-14T22:13:20.000Z', chunk_count: res.chunks, summary: 'Cena veloce senza lattosio' });
    expect(docs[0].raw_content).toContain('Straccetti di pollo'); // il testo originale ripulito non si butta
    expect(docs[0].raw_content).not.toContain('Spero di esserti stato utile');

    // pezzi collegati al padre, con il vettore
    const chunks = store.getAll('brain_memories').filter(m => m.document_id === docs[0].id);
    expect(chunks.length).toBe(res.chunks);
    expect(chunks.every(c => c.source_type === 'document' && c.embedding_source === 'openai' && c.embedding.length === 768 && c.source_date === '2023-11-14T22:13:20.000Z')).toBe(true);
    expect(chunks.map(c => c.chunk_index).sort()).toEqual(chunks.map((_, i) => i));
    expect(chunks.map(c => c.content).join('\n')).toContain('Cuoci il riso 10 minuti');

    // all'IA, per i fatti, non è arrivata la risposta intera dell'assistente
    expect(calls.generate[0].text).not.toContain('Cuoci il riso 10 minuti');

    // fatti: il consiglio dell'assistente (2500 kcal) è stato scartato
    expect(res.facts).toMatchObject({ created: 2, historical: 1, updated: 0, discarded: 1 });
    const all = store.getAll('brain_facts');
    expect(all.some(f => f.fact_value === '2500 kcal')).toBe(false);
    const intol = all.find(f => f.fact_key === 'intolleranza');
    expect(intol).toMatchObject({ is_active: true, valid_from: '2023-11-14T22:13:20.000Z', source_document_id: docs[0].id });
    // REGOLA 3: l'obiettivo del 2023 è nello storico, quello del 2026 resta attivo
    expect(store.getActiveFacts('Io').find(f => f.fact_key === 'target_kcal').fact_value).toBe('2600 kcal');
    const oldGoal = all.find(f => f.fact_value === '2300 kcal');
    expect(oldGoal).toMatchObject({ is_active: false, valid_to: '2026-05-01T00:00:00.000Z' });
    expect(docs[0].facts_extracted_count).toBe(3);
  });

  it('9. reimportare la stessa chat la sostituisce (niente doppioni); eliminarla porta via pezzi e fatti, a cascata', async () => {
    stubOpenAI(() => ({ summary: 's', facts: [{ subject: 'Io', fact_key: 'intolleranza', fact_value: 'lattosio', category: 'status', evidence: 'Sono intollerante al lattosio' }] }));
    const conv = parseChatGptExport(CHATGPT_EXPORT)[0];
    await importDocument(conv, { domain: 'cucina' });
    const second = await importDocument(conv, { domain: 'cucina' });
    expect(second.replaced).toBe(true);
    expect(store.getAll('brain_documents')).toHaveLength(1);
    const docId = store.getAll('brain_documents')[0].id;
    expect(store.getAll('brain_memories').every(m => m.document_id === docId)).toBe(true);
    expect(store.getActiveFacts('Io').filter(f => f.fact_key === 'intolleranza')).toHaveLength(1);

    // una nota scritta a mano non deve essere toccata dall'eliminazione del documento
    store.create('brain_memories', { title: 'Nota mia', content: 'ricordati il pane', domain: 'personal', source_type: 'manual' });
    const out = await deleteDocument(docId);
    expect(out.deleted).toBe(true);
    expect(store.getAll('brain_documents', true)).toHaveLength(0);
    expect(store.getAll('brain_memories', true).filter(m => m.document_id)).toHaveLength(0); // nessun pezzo orfano
    expect(store.getAll('brain_memories')).toHaveLength(1);
    expect(store.getAll('brain_facts', true).filter(f => f.source_document_id === docId)).toHaveLength(0);
  });

  it('10. documenti di testo/PDF: tutto il testo è tuo, quindi i fatti si cercano nell\'intero documento; re-indicizzare rigenera i pezzi dal testo conservato', async () => {
    stubOpenAI(() => ({ summary: 'Piano', facts: [{ subject: 'Io', fact_key: 'frequenza_trazioni', fact_value: 'ogni 3 giorni', category: 'rule', evidence: 'Trazioni ogni 3 giorni' }] }));
    const text = `Piano allenamento 2026\n\nTrazioni ogni 3 giorni, 5 serie.\n\n${'Riga di dettaglio sulla scheda. '.repeat(120)}`.trim();
    const res = await importDocument({ provider: 'pdf', external_id: '', title: 'Piano Allenamento 2026.pdf', date: '2026-01-05T00:00:00.000Z', text }, { domain: 'body' });
    expect(res.chunks).toBeGreaterThan(1);
    expect(res.facts.created).toBe(1);
    const doc = res.document;
    expect(await getDocumentRawContent(doc.id)).toBe(text);

    const before = (await getDocumentChunks(doc.id)).map(c => c.id);
    const re = await reindexDocument(doc.id);
    const after = await getDocumentChunks(doc.id);
    expect(re.chunks).toBe(after.length);
    expect(after.map(c => c.id).some(id => before.includes(id))).toBe(false); // pezzi nuovi, i vecchi non restano
    expect(store.getAll('brain_memories', true).filter(m => m.document_id === doc.id)).toHaveLength(after.length);
    expect(store.getActiveFacts('Io')).toHaveLength(1); // i fatti non vengono toccati
  });

  it('11. se l\'IA non risponde non si salva NULLA (né documento, né pezzi, né fatti): si potrà riprovare', async () => {
    stubOpenAI(() => ({}), { generateFail: 500 });
    const conv = parseChatGptExport(CHATGPT_EXPORT)[0];
    await expect(importDocument(conv, { domain: 'cucina' })).rejects.toMatchObject({ code: 'unavailable' });
    expect(store.getAll('brain_documents')).toHaveLength(0);
    expect(store.getAll('brain_memories')).toHaveLength(0);
    expect(store.getAll('brain_facts')).toHaveLength(0);

    stubOpenAI(() => ({ summary: 's', facts: [] }), { embedFail: true });
    await expect(importDocument(conv, { domain: 'cucina' })).rejects.toBeTruthy();
    expect(store.getAll('brain_documents')).toHaveLength(0);
    expect(store.getAll('brain_memories')).toHaveLength(0);
  });

  it('12. importazione di più chat: una alla volta, con pausa, ripresa e nuovi tentativi; un elemento fallito non blocca gli altri', async () => {
    const order = [];
    let failB = 2; // B fallisce due volte per un problema passeggero, poi riesce
    const importFn = vi.fn(async (item) => {
      order.push(item.title);
      if (item.title === 'B' && failB-- > 0) throw Object.assign(new Error('Il servizio non risponde'), { code: 'unavailable' });
      if (item.title === 'C') throw Object.assign(new Error('La chiave non è valida'), { code: 'invalid_api_key' });
      return { chunks: 2 };
    });
    const updates = [];
    const jobs = ['A', 'B', 'C', 'D'].map(title => ({ item: { title }, domain: 'personal' }));
    let runner;
    let pausedOnce = false;
    runner = createImportRunner(jobs, {
      importFn,
      sleep: async () => {},
      onUpdate: (s) => {
        updates.push(s);
        if (!pausedOnce && s.jobs[0].status === 'done') { pausedOnce = true; runner.pause(); } // pausa dopo A
      },
    });
    await runner.start();
    expect(runner.state.status).toBe('paused');
    expect(runner.state.jobs.map(j => j.status)).toEqual(['done', 'pending', 'pending', 'pending']);
    expect(order).toEqual(['A']);

    await runner.resume();
    expect(runner.state.status).toBe('done');
    expect(runner.state.jobs.map(j => j.status)).toEqual(['done', 'done', 'failed', 'done']);
    expect(runner.state.jobs[1].attempts).toBe(3);      // due errori passeggeri + il tentativo riuscito
    expect(runner.state.jobs[2].attempts).toBe(1);      // errore non passeggero: non si insiste
    expect(runner.state.jobs[2].error).toMatch(/chiave/);
    expect(order).toEqual(['A', 'B', 'B', 'B', 'C', 'D']); // A non viene rifatta
    const last = updates[updates.length - 1];
    expect(last).toMatchObject({ done: 3, failed: 1, total: 4 });
  });

  it('13. con il cloud: pezzi e testo originale stanno SOLO nel database; nel browser resta la scheda del documento', async () => {
    const fake = createFakeCloud();
    const { client, userId } = await signedInClient(fake);
    await cloud.start(client, userId);
    stubOpenAI(() => ({ summary: 'Trattativa', facts: [{ subject: 'Io', fact_key: 'tariffa_oraria', fact_value: '60 euro', category: 'metric', evidence: 'La mia tariffa oraria è 60 euro' }] }));

    const conv = parseClaudeExport(CLAUDE_EXPORT)[0];
    const res = await importDocument(conv, { domain: 'work' });
    await cloud.flush();

    // nel database: documento con testo originale + pezzi con vettore e sorgente
    const docRow = fake.tables.brain_documents.find(d => d.id === res.document.id);
    expect(docRow.user_id).toBe(userId);
    expect(docRow.raw_content).toContain('La mia tariffa oraria è 60 euro');
    expect(docRow.extra.summary).toBe('Trattativa');
    const chunkRows = fake.tables.brain_memories.filter(m => m.document_id === docRow.id);
    expect(chunkRows.length).toBe(res.chunks);
    expect(chunkRows.every(r => r.user_id === userId && r.embedding_source === 'openai' && typeof r.embedding === 'string')).toBe(true);

    // nel browser: la scheda sì, i pezzi e il testo originale no
    expect(store.getAll('brain_documents')).toHaveLength(1);
    expect(store.getAll('brain_documents')[0].raw_content).toBeUndefined();
    expect(store.getAll('brain_memories').filter(m => m.document_id)).toHaveLength(0);
    // il fatto invece viaggia con la sincronizzazione normale
    expect(fake.tables.brain_facts.map(f => f.fact_value)).toEqual(['60 euro']);
    expect(fake.tables.brain_facts[0].extra.source_document_id).toBe(docRow.id);

    // il testo originale si rilegge dal cloud quando serve; il salvataggio della scheda non lo cancella
    store.update('brain_documents', docRow.id, { domain: 'personal' });
    await cloud.flush();
    expect(fake.tables.brain_documents[0].domain).toBe('personal');
    expect(fake.tables.brain_documents[0].raw_content).toContain('tariffa oraria');
    expect(await getDocumentRawContent(docRow.id)).toContain('tariffa oraria');

    // un secondo dispositivo che si collega riceve la scheda ma non scarica pezzi né testo originale
    cloud.stop();
    store.clearAll();
    await cloud.start(fake.browser(), userId);
    expect(store.getAll('brain_documents')).toHaveLength(1);
    expect(store.getAll('brain_documents')[0].raw_content).toBeUndefined();
    expect(store.getAll('brain_memories')).toHaveLength(0);
    await cloud.flush();
    expect(fake.tables.brain_memories.filter(m => m.document_id === docRow.id).length).toBe(res.chunks); // nulla è stato cancellato per errore

    // la ricerca la fa il database: trova il pezzo per parole esatte (nome proprio) e per significato
    const hits = await searchChunks({ embedding: computeLocalEmbedding('sconto TechCorp'), source: 'openai', text: 'sconto TechCorp', limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ document_id: docRow.id, document_title: 'Trattativa TechCorp', document_provider: 'claude' });

    // eliminazione a cascata anche nel database
    await deleteDocument(docRow.id);
    await cloud.flush();
    expect(fake.tables.brain_documents).toHaveLength(0);
    expect(fake.tables.brain_memories).toHaveLength(0);
    expect(fake.tables.brain_facts).toHaveLength(0);
  });
});

import { askRag, buildLiveSections, normalizeProfile, detectDomain, selectRelevantFacts, formatAnswerText, todayIn } from '../src/services/rag-core.js';
import { askPersonalRag, saveRuleFromChat } from '../src/services/personal-rag.js';
import { saveAssistantProfile, getAssistantProfile } from '../src/services/assistant-profile.js';
import { handleUpdate, parseCommand, splitForTelegram } from '../supabase/functions/telegram-webhook/handler.js';
import { askPersonalRagServer } from '../src/services/rag-server.js';

const TODAY = todayIn('Europe/Rome'); // la chat in locale usa la data di oggi: i dati di prova devono essere di oggi

/** Archivio di prova: un documento con due pezzi, qualche fatto, e dati vivi (corpo, agenda, clienti, soldi). */
function seedArchive({ withDocs = true } = {}) {
  if (withDocs) {
    store.create('brain_documents', { id: 'doc-cucina', title: 'Chat Cucina Veloce', source_provider: 'chatgpt', domain: 'cucina', original_date: '2025-11-03T10:00:00.000Z', chunk_count: 2, facts_extracted_count: 0 });
    store.create('brain_memories', { id: 'm-1', document_id: 'doc-cucina', chunk_index: 0, title: 'Chat Cucina Veloce', content: 'Straccetti di pollo con zucchine e riso basmati: 150 g di pollo, 70 g di riso. Pronti in 16 minuti.', domain: 'cucina', source_type: 'document', source_date: '2025-11-03T10:00:00.000Z', embedding: computeLocalEmbedding('Straccetti di pollo con zucchine e riso basmati'), embedding_source: 'local' });
    store.create('brain_memories', { id: 'm-2', document_id: 'doc-cucina', chunk_index: 1, title: 'Chat Cucina Veloce', content: 'Merluzzo al forno con patate, 35 minuti.', domain: 'cucina', source_type: 'document', source_date: '2025-11-03T10:00:00.000Z', embedding: computeLocalEmbedding('Merluzzo al forno con patate'), embedding_source: 'local' });
  }
  upsertFact({ subject: 'Io', fact_key: 'latticini', fact_value: 'intollerante al lattosio', category: 'rule' });
  upsertFact({ subject: 'TechCorp', fact_key: 'stack', fact_value: 'Next.js', category: 'client_info' });
  store.create('body_daily_logs', { date: TODAY, calories_kcal: 1650, protein_g: 95 });
  store.create('todos', { title: 'Richiamare Marco', due_date: `${TODAY}T10:00`, is_completed: false, priority: 'alta' });
  store.create('clients', { type: 'company', company_name: 'TechCorp Srl', stack: 'Next.js', notes: 'cliente storico' });
  store.create('finance_transactions', { type: 'expense', amount: 777.77, description: 'Spesa segretissima', date: `${TODAY}`, category: 'Altro' });
}

describe('24. Chat "Chiedi a te stesso" (STEP 4)', () => {
  beforeEach(() => { store.clearAll(); vi.unstubAllGlobals(); });
  afterEach(() => { cloud.stop(); vi.unstubAllGlobals(); });

  it('1. PRIVACY: con finanze spente (predefinito) i movimenti non arrivano mai all\'IA; con l\'interruttore acceso sì', () => {
    seedArchive();
    const raw = { transactions: store.getAll('finance_transactions'), clients: store.getAll('clients'), dailyLogs: store.getAll('body_daily_logs') };
    const defaults = normalizeProfile(null).live_data_permissions;
    expect(defaults).toEqual({ body: true, todos_calendar: true, clients: false, finances: false });

    const off = buildLiveSections(raw, defaults, { today: TODAY });
    expect(off.map(s => s.kind)).toEqual(['body', 'todos_calendar']);
    expect(JSON.stringify(off)).not.toContain('segretissima');
    expect(JSON.stringify(off)).not.toContain('TechCorp');

    const on = buildLiveSections(raw, { ...defaults, finances: true, clients: true }, { today: TODAY });
    expect(on.map(s => s.kind)).toEqual(['body', 'todos_calendar', 'clients', 'finances']);
    expect(JSON.stringify(on)).toContain('segretissima');
    expect(on.find(s => s.kind === 'body').text).toContain('1650 kcal');
    // un valore non booleano non accende nulla
    expect(normalizeProfile({ live_data_permissions: { finances: 'true' } }).live_data_permissions.finances).toBe(false);
  });

  it('2. istruzioni a strati: regole generali sempre, regole dell\'ambito solo quando la domanda lo riguarda', async () => {
    seedArchive();
    saveAssistantProfile({ global_instructions: 'Sono Antonio. Risposte secche.', domain_rules: { cucina: 'Porzioni per 1 persona.', work: 'Valuta il rischio cliente unico.' } });
    expect(getAssistantProfile().global_instructions).toBe('Sono Antonio. Risposte secche.');
    const { calls } = stubOpenAI(() => ({ answer: 'Straccetti di pollo.', used_sources: ['S1'], suggested_rule: null }));

    const res = await askPersonalRag({ question: 'Cosa posso cucinare stasera con il pollo?' });
    const system = calls.generate[0].system;
    expect(res.domain).toBe('cucina');
    expect(system).toContain('Sono Antonio. Risposte secche.');
    expect(system).toContain('Porzioni per 1 persona.');
    expect(system).not.toContain('Valuta il rischio cliente unico.');

    await askPersonalRag({ question: 'Come negozio la tariffa con il cliente?' });
    expect(calls.generate[1].system).toContain('Valuta il rischio cliente unico.');
    expect(calls.generate[1].system).not.toContain('Porzioni per 1 persona.');
    expect(detectDomain('ciao come stai')).toBe('personal');
  });

  it('3. le tre fonti arrivano insieme e le fonti citate sono quelle davvero usate, con etichetta leggibile', async () => {
    seedArchive();
    const { calls } = stubOpenAI(() => ({ answer: 'Fai gli straccetti: hai 1650 kcal, te ne mancano circa 750. Niente latticini.', used_sources: ['S1', 'F1', 'L1', 'S9'], suggested_rule: null }));
    const res = await askPersonalRag({ question: 'Cosa cucino con il pollo per chiudere i macro di oggi?' });

    const system = calls.generate[0].system;
    expect(system).toContain('Straccetti di pollo con zucchine');     // fonte 1: pezzo del documento
    expect(system).toContain('intollerante al lattosio');              // fonte 2: fatto
    expect(system).toContain('1650 kcal');                             // fonte 3: dati vivi
    expect(system).not.toContain('segretissima');

    expect(res.sources.map(s => s.id)).toEqual(['S1', 'F1', 'L1']);    // S9 non esiste: scartata
    const labels = res.sources.map(s => s.label);
    expect(labels[0]).toBe('📄 Chat Cucina Veloce (2025-11) • pezzo #1');
    expect(labels[1]).toMatch(/^📌 Fatto: latticini = intollerante al lattosio/);
    expect(labels[2]).toMatch(/Diario corpo/);
    expect(res.sources[0]).toMatchObject({ type: 'chunk', document_id: 'doc-cucina', chunk_index: 0 });
    expect(formatAnswerText(res)).toContain('Fonti usate:\n• 📄 Chat Cucina Veloce');
  });

  it('4. una domanda di seguito ("e con il riso?") ricorda la precedente; senza fonti la risposta lo dice', async () => {
    seedArchive();
    const { calls } = stubOpenAI(() => ({ answer: 'Non ho dati su questo.', used_sources: [] }));
    await askPersonalRag({ question: 'Che cena veloce con pollo e zucchine?' });
    await askPersonalRag({ question: 'e con il riso?', history: [{ role: 'user', content: 'Che cena veloce con pollo e zucchine?' }, { role: 'assistant', content: 'Straccetti.' }] });
    expect(calls.generate[1].text).toContain('Conversazione finora:');
    expect(calls.generate[1].text).toContain('Straccetti.');
    expect(calls.generate[1].system).toContain('Straccetti di pollo'); // la ricerca ha usato anche la domanda precedente
    const res = await askPersonalRag({ question: 'Qualcosa?' });
    expect(res.sources).toEqual([]);
    expect(formatAnswerText(res)).toContain('Fonti usate: nessuna');
  });

  it('5. se i vettori non sono disponibili la ricerca continua per parole esatte; se l\'IA non risponde l\'errore è chiaro', async () => {
    seedArchive();
    stubOpenAI(() => ({ answer: 'ok', used_sources: ['S1'] }), { embedFail: true });
    const res = await askPersonalRag({ question: 'merluzzo' });
    // l'app ripiega sui vettori locali dichiarandolo (source 'local'): la ricerca per parole esatte funziona comunque
    expect(res.context.embeddingSource).toBe('local');
    expect(res.context.chunks).toBeGreaterThan(0);

    stubOpenAI(() => ({}), { generateFail: 500 });
    await expect(askPersonalRag({ question: 'ciao' })).rejects.toMatchObject({ code: 'unavailable' });
    await expect(askPersonalRag({ question: '   ' })).rejects.toThrow(/Scrivi una domanda/);
  });

  it('6. VOLANO: "Salva regola in memoria" crea un fatto attivo che compare nelle risposte successive; una regola nuova mette la vecchia nello storico', async () => {
    const { calls } = stubOpenAI(() => ({ answer: 'ok', used_sources: [], suggested_rule: { subject: 'Io', fact_key: 'latticini_a_pranzo', fact_value: 'niente latticini a pranzo', category: 'rule' } }));
    const first = await askPersonalRag({ question: 'Da questa settimana tolgo i latticini a pranzo' });
    expect(first.suggestedRule).toMatchObject({ fact_key: 'latticini_a_pranzo', category: 'rule' });

    const saved = saveRuleFromChat(first.suggestedRule);
    expect(saved.action).toBe('created');
    await askPersonalRag({ question: 'Cosa mangio a pranzo?' });
    expect(calls.generate[1].system).toContain('niente latticini a pranzo');

    const changed = saveRuleFromChat({ subject: 'Io', fact_key: 'latticini_a_pranzo', fact_value: 'latticini ammessi solo a colazione' });
    expect(changed.action).toBe('superseded');
    expect(store.getFactHistory('Io', 'latticini_a_pranzo')).toHaveLength(2);
    expect(() => saveRuleFromChat({ fact_key: '', fact_value: '' })).toThrow();
  });

  it('7. regole e preferenze valgono sempre; gli altri fatti entrano solo se c\'entrano con la domanda', () => {
    upsertFact({ subject: 'Io', fact_key: 'regola_sveglia', fact_value: 'alle 6', category: 'rule' });
    upsertFact({ subject: 'TechCorp', fact_key: 'stack', fact_value: 'Next.js', category: 'client_info' });
    upsertFact({ subject: 'Zeta', fact_key: 'colore', fact_value: 'blu', category: 'status' });
    const picked = selectRelevantFacts(store.getActiveFacts(), 'Che stack usa TechCorp?').map(f => f.fact_key);
    expect(picked).toContain('regola_sveglia');
    expect(picked).toContain('stack');
    expect(picked).not.toContain('colore');
    expect(todayIn('Europe/Rome', new Date('2026-11-14T23:30:00Z'))).toBe('2026-11-15'); // dopo mezzanotte a Roma è già il giorno dopo
  });

  it('8. con il cloud: la chat sul server legge SOLO i dati di chi chiede, rispetta gli interruttori e cerca nel database', async () => {
    const fake = createFakeCloud();
    const { client, userId } = await signedInClient(fake);
    await cloud.start(client, userId);
    seedArchive({ withDocs: false });
    const DOC = '00000000-0000-4000-8000-0000000000e1';
    fake.tables.brain_documents.push({ id: DOC, user_id: userId, title: 'Chat Cucina Veloce', source_provider: 'chatgpt', domain: 'cucina', original_date: '2025-11-03T10:00:00.000Z', chunk_count: 1, facts_extracted_count: 0, is_deleted: false, extra: {} });
    fake.tables.brain_memories.push({ id: '00000000-0000-4000-8000-0000000000e2', user_id: userId, document_id: DOC, chunk_index: 0, title: 'Chat Cucina Veloce', content: 'Straccetti di pollo con zucchine e riso basmati: 16 minuti.', domain: 'cucina', source_type: 'document', is_deleted: false, embedding_source: 'openai', embedding: JSON.stringify(computeLocalEmbedding('Straccetti di pollo con zucchine e riso basmati')), extra: {} });
    store.create('brain_assistant_profiles', { global_instructions: 'Dritto al punto.', domain_rules: {}, live_data_permissions: { body: true, todos_calendar: false, clients: false, finances: false } });
    await cloud.flush();
    // dati di un altro utente: non devono comparire mai
    fake.tables.brain_facts.push({ id: '00000000-0000-4000-8000-0000000000f1', user_id: 'altro-utente', subject: 'Altro', fact_key: 'segreto', fact_value: 'DATO-ALTRUI', category: 'rule', is_active: true, extra: {} });
    fake.tables.brain_memories.push({ id: '00000000-0000-4000-8000-0000000000f2', user_id: 'altro-utente', title: 'x', content: 'straccetti di pollo DATO-ALTRUI', domain: 'cucina', source_type: 'manual', is_deleted: false, embedding_source: 'openai', extra: {} });

    const { calls } = stubOpenAI(() => ({ answer: 'Ok', used_sources: ['S1', 'L1'] }));
    const env = { OPENAI_API_KEY: 'sk-test' };
    const res = await askPersonalRagServer({ client: fake.service(), userId, env, fetchFn: fetch, question: 'Cosa cucino con il pollo?', today: TODAY });

    const system = calls.generate[0].system;
    expect(system).toContain('Dritto al punto.');
    expect(system).toContain('Straccetti di pollo');
    expect(system).toContain('1650 kcal');                  // corpo: acceso
    expect(system).not.toContain('Richiamare Marco');       // agenda: spenta
    expect(system).not.toContain('segretissima');           // finanze: spente
    expect(system).not.toContain('DATO-ALTRUI');            // niente dati di altri utenti
    expect(res.sources.map(s => s.id)).toEqual(['S1', 'L1']);
    expect(res.context.embeddingSource).toBe('openai');
  });
});

describe('25. Telegram /ask (STEP 5)', () => {
  const OWNER_TG = 4242;
  let fake;
  let owner;
  beforeEach(async () => {
    store.clearAll();
    vi.unstubAllGlobals();
    fake = createFakeCloud();
    const { data } = await fake.browser().auth.signUp({ email: 'io@example.com', password: 'segreta123' });
    owner = data.user.id;
  });
  afterEach(() => { cloud.stop(); vi.unstubAllGlobals(); });

  const msg = (text) => ({ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, date: Math.floor(Date.parse('2026-11-15T09:00:00Z') / 1000), chat: { id: OWNER_TG }, from: { id: OWNER_TG }, text } });

  function setup(generate) {
    const stub = stubOpenAI(generate);
    const telegram = [];
    const fn = async (url, init = {}) => {
      if (String(url).includes('api.telegram.org')) {
        telegram.push({ method: String(url).split('/').pop(), ...(init.body ? JSON.parse(init.body) : {}) });
        return { ok: true, json: async () => ({ ok: true, result: {} }) };
      }
      return stub.fn(url, init);
    };
    const deps = { env: { TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_ALLOWED_USER_ID: String(OWNER_TG), OPENAI_API_KEY: 'sk-test' }, supabase: fake.service(), fetch: fn };
    return { stub, telegram, deps };
  }

  function seedCloud() {
    const t = fake.tables;
    t.brain_documents.push({ id: '00000000-0000-4000-8000-0000000000d1', user_id: owner, title: 'Chat Carriera', source_provider: 'claude', domain: 'work', original_date: '2025-03-10T09:00:00.000Z', chunk_count: 1, facts_extracted_count: 0, is_deleted: false, extra: {} });
    t.brain_memories.push({ id: '00000000-0000-4000-8000-0000000000d2', user_id: owner, document_id: '00000000-0000-4000-8000-0000000000d1', chunk_index: 0, title: 'Chat Carriera', content: 'TechCorp chiede uno sconto del 20% sul progetto Alfa. Tariffa 60 euro l\'ora.', domain: 'work', source_type: 'document', is_deleted: false, embedding_source: 'openai', embedding: JSON.stringify(computeLocalEmbedding('TechCorp chiede uno sconto del 20% sul progetto Alfa. Tariffa 60 euro l\'ora.')), extra: {} });
    t.finance_transactions.push({ id: '00000000-0000-4000-8000-0000000000d3', user_id: owner, type: 'expense', amount: 999, description: 'Spesa privata', date: '2026-11-15', is_deleted: false, extra: {} });
  }

  it('1. il comando è riconosciuto (anche con @NomeBot) e senza domanda spiega come usarlo', async () => {
    expect(parseCommand('/ask Cosa avevamo deciso per TechCorp?')).toEqual({ name: 'ask', args: 'Cosa avevamo deciso per TechCorp?' });
    expect(parseCommand('/ask@MioBot ciao')).toEqual({ name: 'ask', args: 'ciao' });
    const { deps, telegram, stub } = setup(() => ({}));
    await handleUpdate(msg('/ask'), deps);
    expect(telegram.at(-1).text).toMatch(/Usa <code>\/ask domanda<\/code>/);
    expect(stub.calls.generate).toHaveLength(0);
  });

  it('2. /ask risponde con lo stesso motore dell\'app: fonti citate, profilo e interruttori privacy identici', async () => {
    seedCloud();
    fake.tables.brain_assistant_profiles.push({ id: '00000000-0000-4000-8000-0000000000d4', user_id: owner, global_instructions: 'Zero convenevoli.', domain_rules: { work: 'Valuta il rischio cliente unico.' }, live_data_permissions: { body: true, todos_calendar: true, clients: false, finances: false }, extra: {} });
    const { deps, telegram, stub } = setup(() => ({ answer: 'Avevate parlato di uno sconto del 20%.', used_sources: ['S1'] }));
    await handleUpdate(msg('/ask Cosa avevamo deciso per TechCorp sulla tariffa?'), deps);

    expect(telegram.some(t => t.method === 'sendChatAction')).toBe(true);
    const system = stub.calls.generate[0].system;
    expect(system).toContain('Zero convenevoli.');
    expect(system).toContain('Valuta il rischio cliente unico.');   // ambito "lavoro" riconosciuto
    expect(system).toContain('sconto del 20%');
    expect(system).not.toContain('Spesa privata');                   // finanze spente
    const reply = telegram.filter(t => t.method === 'sendMessage').at(-1).text;
    expect(reply).toContain('Avevate parlato di uno sconto del 20%.');
    expect(reply).toContain('Fonti usate:');
    expect(reply).toContain('Chat Carriera');
  });

  it('3. se l\'IA non risponde lo dice con il motivo, senza inventare; i messaggi lunghi si dividono sotto il limite di Telegram', async () => {
    const { deps, telegram } = setup(() => ({}));
    const failing = stubOpenAI(() => ({}), { generateFail: 500 });
    const fn = deps.fetch;
    deps.fetch = async (url, init) => (String(url).includes('telegram') ? fn(url, init) : failing.fn(url, init));
    await handleUpdate(msg('/ask ciao'), deps);
    expect(telegram.filter(t => t.method === 'sendMessage').at(-1).text).toMatch(/Non sono riuscito a rispondere/);

    const long = Array.from({ length: 300 }, (_, i) => `Riga numero ${i} con del testo di riempimento abbastanza lungo`).join('\n');
    const pieces = splitForTelegram(long);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every(p => p.length <= 3900)).toBe(true);
    expect(pieces.join('\n').replace(/\s+/g, ' ')).toBe(long.replace(/\s+/g, ' '));
  });

  it('4. chi non è autorizzato non può interrogare l\'archivio', async () => {
    seedCloud();
    const { deps, telegram, stub } = setup(() => ({ answer: 'segreto', used_sources: [] }));
    const intruder = { update_id: 77, message: { message_id: 1, date: 1, chat: { id: 1 }, from: { id: 1 }, text: '/ask tariffa TechCorp' } };
    await handleUpdate(intruder, deps);
    expect(stub.calls.generate).toHaveLength(0);
    expect(telegram.at(-1).text).toMatch(/non sei autorizzato/i);
  });
});
