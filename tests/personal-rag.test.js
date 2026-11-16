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
import { getAssistantProfile, saveAssistantProfile } from '../src/services/assistant-profile.js';
import { askPersonalRag, saveRuleFromChat } from '../src/services/personal-rag.js';
import { askPersonalRagServer } from '../src/services/rag-server.js';
import { detectDomain, formatAnswerText, todayIn } from '../src/services/rag-core.js';
import { handleUpdate } from '../supabase/functions/telegram-webhook/handler.js';
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

describe('24. Chat "Chiedi a te stesso" — privacy, regole per argomento, fonti e salva regola (STEP 4)', () => {
  beforeEach(() => {
    store.clearAll();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    cloud.stop();
    vi.unstubAllGlobals();
  });

  it('1. interruttori privacy: di partenza le finanze e i clienti sono SPENTI (non arrivano mai all\'IA); Corpo e Agenda sono accesi', async () => {
    const profile = getAssistantProfile();
    expect(profile.live_data_permissions).toEqual({
      body: true,
      todos_calendar: true,
      clients: false,
      finances: false,
    });

    const today = todayIn(store.getSettings().timezone || 'Europe/Rome');
    store.upsertBodyDailyLog({ date: today, calories_kcal: 1650, protein_g: 105, body_weight_kg: 74.4 });
    store.create('todos', { title: 'Consegnare bozza sito', is_completed: false, priority: 'alta' });
    store.create('clients', { type: 'company', company_name: 'ClienteRiservatoSrl', stack: 'Rust' });
    store.create('finance_transactions', { date: today, type: 'expense', amount: 9876, description: 'BonificoSegreto', category: 'Altro' });

    const { calls } = stubOpenAI(() => ({
      answer: 'Ti mancano circa 650 kcal.',
      used_sources: ['L1', 'L2'],
      suggested_rule: null,
    }));

    const resOff = await askPersonalRag({ question: 'Come sono messo oggi?' });
    expect(resOff.context.live).toEqual(['body', 'todos_calendar']);
    const sysOff = calls.generate[0].system;
    expect(sysOff).toContain('1650 kcal');
    expect(sysOff).toContain('Consegnare bozza sito');
    expect(sysOff).not.toContain('BonificoSegreto');
    expect(sysOff).not.toContain('9.876');
    expect(sysOff).not.toContain('ClienteRiservatoSrl');

    // Accendendo finanze e clienti (e spegnendo body), il prompt cambia di conseguenza
    saveAssistantProfile({
      live_data_permissions: { body: false, todos_calendar: true, clients: true, finances: true },
    });
    const resOn = await askPersonalRag({ question: 'Qual è la situazione conti e clienti?' });
    expect(resOn.context.live).toEqual(['todos_calendar', 'clients', 'finances']);
    const sysOn = calls.generate[1].system;
    expect(sysOn).not.toContain('1650 kcal');
    expect(sysOn).toContain('BonificoSegreto');
    expect(sysOn).toContain('ClienteRiservatoSrl');
  });

  it('2. regole a strati: istruzioni generali + regole automatiche per l\'argomento della domanda (o forzate a mano)', async () => {
    expect(detectDomain('Cosa cucino per cena in padella?')).toBe('cucina');
    expect(detectDomain('Come imposto il preventivo per il cliente?')).toBe('work');
    expect(detectDomain('Quante serie di trazioni e squat?')).toBe('body');
    expect(detectDomain('Errore nella query del database Supabase')).toBe('tech');

    saveAssistantProfile({
      global_instructions: 'Parla sempre in modo ultra sintetico da ingegnere.',
      domain_rules: {
        cucina: 'Zero latticini, massimo 15 minuti ai fornelli.',
        work: 'Chiedi sempre il 30% di acconto.',
      },
    });

    const { calls } = stubOpenAI(() => ({ answer: 'Pollo alla piastra.', used_sources: [], suggested_rule: null }));

    const r1 = await askPersonalRag({ question: 'Cosa posso cucinare per cena stasera?' });
    expect(r1.domain).toBe('cucina');
    expect(calls.generate[0].system).toContain('Parla sempre in modo ultra sintetico da ingegnere.');
    expect(calls.generate[0].system).toContain('Zero latticini, massimo 15 minuti ai fornelli.');
    expect(calls.generate[0].system).not.toContain('Chiedi sempre il 30% di acconto.');

    // Forzando l'ambito a mano ("work"), si applica la regola di lavoro anche su una domanda neutra
    const r2 = await askPersonalRag({ question: 'Dammi un consiglio.', domain: 'work' });
    expect(r2.domain).toBe('work');
    expect(calls.generate[1].system).toContain('Chiedi sempre il 30% di acconto.');
  });

  it('3. combina le 3 fonti (pezzi di documenti, fatti attivi, dati di oggi), restituisce le fonti citate e permette di salvare una regola in memoria', async () => {
    const today = todayIn(store.getSettings().timezone || 'Europe/Rome');
    store.upsertBodyDailyLog({ date: today, calories_kcal: 1500, protein_g: 95 });

    // Importa la chat di cucina
    stubOpenAI(() => ({
      summary: 'Ricetta straccetti di pollo',
      facts: [{ subject: 'Io', fact_key: 'intolleranza', fact_value: 'lattosio', category: 'rule', evidence: 'Sono intollerante al lattosio' }],
    }));
    await importDocument(parseChatGptExport(CHATGPT_EXPORT)[0], { domain: 'cucina' });

    // Ora chiediamo al RAG
    const { calls } = stubOpenAI(() => ({
      answer: 'Fai gli straccetti di pollo con zucchine e riso basmati: ti restano circa 800 kcal.',
      used_sources: ['S1', 'F1', 'L1'],
      suggested_rule: { subject: 'Io', fact_key: 'cena_veloce_preferita', fact_value: 'straccetti di pollo e zucchine', category: 'preference' },
    }));

    const res = await askPersonalRag({
      question: 'Cosa cucino stasera per chiudere i macro? Da oggi segna che gli straccetti sono la mia cena veloce preferita.',
      history: [{ role: 'user', content: 'Ho del pollo in frigo.' }, { role: 'assistant', content: 'Ottimo, vediamo.' }],
    });

    expect(res.answer).toContain('straccetti di pollo');
    expect(res.sources.map(s => s.type)).toEqual(['chunk', 'fact', 'live']);
    expect(res.sources[0].label).toContain('Cucina Veloce');
    expect(res.sources[1].label).toContain('intolleranza = lattosio');
    expect(res.sources[2].kind).toBe('body');
    expect(calls.generate[0].text).toContain('Conversazione finora:');
    expect(calls.generate[0].text).toContain('Ho del pollo in frigo.');

    // "Salva regola in memoria": la regola proposta diventa un fatto attivo; se aggiornata, la vecchia va nello storico
    expect(res.suggestedRule).toMatchObject({ fact_key: 'cena_veloce_preferita', fact_value: 'straccetti di pollo e zucchine' });
    const saved = saveRuleFromChat(res.suggestedRule);
    expect(saved.action).toBe('created');
    expect(store.getActiveFacts('Io').find(f => f.fact_key === 'cena_veloce_preferita')?.fact_value).toBe('straccetti di pollo e zucchine');

    const updated = saveRuleFromChat({ subject: 'Io', fact_key: 'cena_veloce_preferita', fact_value: 'salmone e patate', category: 'preference' });
    expect(updated.action).toBe('superseded');
    expect(store.getFactHistory('Io', 'cena_veloce_preferita')).toHaveLength(2);
  });

  it('4. lato server (cloud): non legge nemmeno la tabella delle finanze dal database se l\'interruttore è spento', async () => {
    const fake = createFakeCloud();
    const { client, userId } = await signedInClient(fake);
    await cloud.start(client, userId);

    const today = todayIn('Europe/Rome');
    store.upsertBodyDailyLog({ date: today, calories_kcal: 1800 });
    store.create('finance_transactions', { date: today, type: 'expense', amount: 500, description: 'AffittoSegreto', category: 'Casa' });
    await cloud.flush();

    const { fn } = stubOpenAI(() => ({ answer: 'Hai registrato 1800 kcal.', used_sources: ['L1'], suggested_rule: null }));
    fake.state.calls.length = 0;

    const out = await askPersonalRagServer({
      client: fake.browser(),
      env: { OPENAI_API_KEY: 'sk-test', TIMEZONE: 'Europe/Rome' },
      fetchFn: fn,
      question: 'Quante calorie ho segnato oggi?',
      today,
    });

    expect(out.answer).toContain('1800 kcal');
    const queriedTables = fake.state.calls.map(c => c.table);
    expect(queriedTables).toContain('body_daily_logs');
    expect(queriedTables).not.toContain('finance_transactions');
    expect(queriedTables).not.toContain('trading_items');
    expect(queriedTables).not.toContain('clients');
  });
});

describe('25. Comando /ask su Telegram (STEP 5)', () => {
  const OWNER_TG = 99887766;
  const baseEnv = { TELEGRAM_BOT_TOKEN: 'TKN', TELEGRAM_ALLOWED_USER_ID: String(OWNER_TG), OPENAI_API_KEY: 'sk-test' };
  let fake;
  let owner;
  let seq = 500;

  const tgMsg = (text) => ({
    update_id: ++seq,
    message: {
      message_id: seq,
      date: Math.floor(Date.parse('2026-11-16T18:00:00Z') / 1000),
      chat: { id: OWNER_TG },
      from: { id: OWNER_TG, username: 'antonio' },
      text,
    },
  });

  beforeEach(async () => {
    store.clearAll();
    vi.unstubAllGlobals();
    fake = createFakeCloud();
    const { data } = await fake.browser().auth.signUp({ email: 'io@example.com', password: 'segreta123' });
    owner = data.user.id;
  });

  afterEach(() => {
    cloud.stop();
    vi.unstubAllGlobals();
  });

  it('1. /ask senza domanda spiega come usarlo; /ask con domanda risponde usando l\'archivio e cita le fonti (escludendo le finanze di default)', async () => {
    await cloud.start(fake.browser(), owner);
    upsertFact({ subject: 'Io', fact_key: 'intolleranza', fact_value: 'lattosio', category: 'rule' });
    store.upsertBodyDailyLog({ date: '2026-11-16', calories_kcal: 1700, protein_g: 110 });
    store.create('finance_transactions', { date: '2026-11-16', type: 'expense', amount: 1200, description: 'SpesaPrivata', category: 'Altro' });
    await cloud.flush();

    const tgLog = [];
    const { fn: openaiFetch, calls } = stubOpenAI(() => ({
      answer: 'Puoi preparare pollo e zucchine: oggi sei a 1700 kcal e rispetti la regola senza lattosio.',
      used_sources: ['F1', 'L1'],
    }));
    const fetchFn = async (url, init = {}) => {
      const u = String(url);
      if (u.includes('api.telegram.org')) {
        tgLog.push({ method: u.split('/').pop(), ...(init.body ? JSON.parse(init.body) : {}) });
        return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
      }
      return openaiFetch(url, init);
    };

    // 1) /ask vuoto -> messaggio d'aiuto, nessuna chiamata IA
    await handleUpdate(tgMsg('/ask'), { env: baseEnv, supabase: fake.service(), fetch: fetchFn });
    expect(tgLog.at(-1).text).toContain('Usa <code>/ask domanda</code>');
    expect(calls.generate).toHaveLength(0);

    // 2) /ask con domanda (anche se contiene la parola "ieri", "oggi" per il RAG resta la data corrente 2026-11-16)
    const res = await handleUpdate(tgMsg('/ask Rispetto a ieri, cosa posso mangiare stasera?'), {
      env: baseEnv,
      supabase: fake.service(),
      fetch: fetchFn,
    });
    expect(res.body).toMatchObject({ ok: true, intent: 'ask' });
    expect(calls.generate).toHaveLength(1);
    expect(calls.generate[0].system).toContain('1700 kcal');
    expect(calls.generate[0].system).toContain('intolleranza: lattosio');
    expect(calls.generate[0].system).not.toContain('SpesaPrivata');

    const reply = tgLog.filter(m => m.method === 'sendMessage').at(-1).text;
    expect(reply).toContain('pollo e zucchine');
    expect(reply).toContain('Fonti usate:');
    expect(reply).toContain('intolleranza = lattosio');
    expect(reply).toContain('Diario corpo di oggi');
    expect(formatAnswerText({ answer: 'Test', sources: [] })).toContain('nessuna');
  });
});

