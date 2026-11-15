// src/services/brain-docs.js
// Libreria delle fonti del Second Brain: importa una chat o un documento, lo divide in pezzi ricercabili,
// ricava i fatti (solo dalle tue parole) e permette di eliminarlo o re-indicizzarlo per intero.
//
// Dove stanno i dati:
//   • con il cloud collegato, i pezzi (con il loro vettore) e il testo originale stanno SOLO nel database:
//     sono troppi per la memoria del browser. Nello store locale resta la scheda del documento (titolo, date, conteggi).
//   • senza cloud (uso locale e test) tutto resta nello store.
// I fatti estratti seguono la strada normale (store → sincronizzazione).

import { store } from './store.js';
import { cloud } from './cloud.js';
import { aiGenerate, aiEmbedBatch, isAiConfigured, GeminiError } from './ai-client.js';
import { upsertFact, deleteFact, computeLocalEmbedding } from './brain.js';
import { searchMemoriesLocal } from './rag-core.js';
import { generateId } from '../utils/id.js';
import {
  itemToCleanText,
  authorText,
  chunkText,
  buildFactExtractionRequests,
  filterFactsByEvidence,
} from '../utils/chat-importer.js';

const EMBED_BATCH = 48;
const INSERT_BATCH = 40;

/** Il cloud è collegato e autenticato: pezzi e testo originale vanno nel database. */
export function isCloudMode() {
  return Boolean(cloud.started && cloud.client && cloud.userId);
}

const fail = (error, what) => {
  throw new Error(`${what}: ${error.message || error}`);
};

// ---------------------------------------------------------------------------
// Vettori e fatti
// ---------------------------------------------------------------------------

/** Vettori per un elenco di testi. Con l'IA configurata un errore interrompe (si potrà riprovare); senza IA si usa il ripiego locale dichiarato. */
async function embedTexts(texts) {
  if (!isAiConfigured()) {
    return { vectors: texts.map(t => computeLocalEmbedding(t)), source: 'local' };
  }
  const vectors = [];
  let source = null;
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const res = await aiEmbedBatch(texts.slice(i, i + EMBED_BATCH));
    vectors.push(...res.vectors);
    source = res.source;
  }
  return { vectors, source: source || 'openai' };
}

/**
 * Ricava i fatti permanenti da una chat/documento. Solo dalle parole dell'autore: ogni fatto deve citare una
 * frase che compare davvero nei tuoi messaggi, altrimenti viene scartato.
 * @returns {Promise<{summary:string, kept:Array, discarded:Array}>}
 */
export async function extractAuthorFacts(item) {
  const requests = buildFactExtractionRequests(item);
  const all = [];
  let summary = '';
  for (const req of requests) {
    const { data } = await aiGenerate({ system: req.system, parts: [{ text: req.text }], temperature: 0, json: true });
    if (data && Array.isArray(data.facts)) all.push(...data.facts);
    if (!summary && data?.summary) summary = String(data.summary);
  }
  const { kept, discarded } = filterFactsByEvidence(all, authorText(item));
  return { summary, kept, discarded };
}

// ---------------------------------------------------------------------------
// Importazione di un elemento
// ---------------------------------------------------------------------------

function findExisting(item) {
  if (!item.external_id) return null;
  return store.getAll('brain_documents').find(d => d.source_provider === item.provider && d.external_conversation_id === item.external_id) || null;
}

/**
 * Importa UNA chat o UN documento. Ordine pensato per non lasciare lavori a metà: prima si prepara tutto
 * (fatti e vettori, le parti che possono fallire), poi si scrive. Se qualcosa va storto non resta nulla di parziale.
 *
 * @param {object} item { provider, external_id, title, date, messages? | text? }
 * @param {object} [opts]
 * @param {string} [opts.domain='personal']
 * @param {boolean} [opts.extractFacts=true]
 * @param {(stage:string)=>void} [opts.onStage]
 * @returns {Promise<{document:object, chunks:number, facts:{created:number, updated:number, historical:number, unchanged:number, discarded:number}, replaced:boolean, embeddingSource:string}>}
 */
export async function importDocument(item, { domain = 'personal', extractFacts = true, onStage = null } = {}) {
  const cleanText = itemToCleanText(item);
  if (!cleanText) throw new Error('Non c\'è testo da importare.');
  const title = String(item.title || 'Senza titolo').trim().slice(0, 200) || 'Senza titolo';
  const originalDate = item.date || null;

  onStage?.('Leggo i fatti');
  let extraction = { summary: '', kept: [], discarded: [] };
  if (extractFacts) {
    if (!isAiConfigured()) throw new GeminiError('not_configured', 'L\'IA non è configurata: apri Impostazioni → Verifica IA.');
    extraction = await extractAuthorFacts(item);
  }

  onStage?.('Preparo la ricerca');
  const chunks = chunkText(cleanText);
  const { vectors, source } = await embedTexts(chunks.map(c => `${title}\n${c}`));

  onStage?.('Salvo');
  const existing = findExisting(item);
  if (existing) await deleteDocument(existing.id); // stessa chat importata di nuovo: si sostituisce, niente doppioni

  const id = generateId();
  const meta = {
    id,
    title,
    source_provider: ['chatgpt', 'claude', 'gemini', 'pdf', 'markdown', 'text', 'manual'].includes(item.provider) ? item.provider : 'manual',
    external_conversation_id: item.external_id || null,
    domain: domain || 'personal',
    original_date: originalDate,
    chunk_count: chunks.length,
    facts_extracted_count: 0,
    summary: extraction.summary || '',
    message_count: Array.isArray(item.messages) ? item.messages.length : null,
    char_count: cleanText.length,
    embedding_source: source,
  };
  const chunkRows = chunks.map((content, i) => ({
    id: generateId(),
    document_id: id,
    chunk_index: i,
    title,
    content,
    summary: '',
    domain: meta.domain,
    source_type: 'document',
    source_id: id,
    source_date: originalDate,
    tags: [],
    embedding: vectors[i],
    embedding_source: source,
  }));

  if (isCloudMode()) {
    const { summary, message_count, char_count, embedding_source, ...columns } = meta;
    const docRow = { ...columns, raw_content: cleanText, user_id: cloud.userId, extra: { summary, message_count, char_count, embedding_source } };
    const { error: docErr } = await cloud.client.from('brain_documents').upsert(docRow, { onConflict: 'id' });
    if (docErr) fail(docErr, 'Salvataggio del documento non riuscito');
    for (let i = 0; i < chunkRows.length; i += INSERT_BATCH) {
      const batch = chunkRows.slice(i, i + INSERT_BATCH).map(r => ({ ...r, user_id: cloud.userId, embedding: JSON.stringify(r.embedding) }));
      const { error } = await cloud.client.from('brain_memories').insert(batch);
      if (error) {
        await cloud.client.from('brain_documents').delete().eq('id', id); // niente documento a metà: l'eliminazione porta via i pezzi già scritti
        fail(error, 'Salvataggio dei pezzi non riuscito');
      }
    }
    // la scheda (senza testo originale) entra nello store; se l'aggiornamento in tempo reale è arrivato prima, c'è già
    if (store.getById('brain_documents', id)) store.update('brain_documents', id, meta);
    else store.create('brain_documents', meta);
  } else {
    store.runBatch(() => {
      store.create('brain_documents', { ...meta, raw_content: cleanText });
      for (const row of chunkRows) store.create('brain_memories', row);
    });
  }

  // Regola 3: ogni fatto porta la data vera della fonte; se esiste già un'informazione più recente finisce nello storico
  const tally = { created: 0, updated: 0, historical: 0, unchanged: 0, discarded: extraction.discarded.length };
  store.runBatch(() => {
    for (const f of extraction.kept) {
      const res = upsertFact(
        { subject: f.subject, fact_key: f.fact_key, fact_value: f.fact_value, category: f.category || 'status', source_document_id: id },
        originalDate ? { valid_from: originalDate } : {},
      );
      if (!res) { tally.discarded++; continue; }
      if (res.action === 'created') tally.created++;
      else if (res.action === 'superseded') tally.updated++;
      else if (res.action === 'archived_historical') tally.historical++;
      else tally.unchanged++;
    }
    const written = tally.created + tally.updated + tally.historical;
    if (written > 0) store.update('brain_documents', id, { facts_extracted_count: written });
  });

  return { document: store.getById('brain_documents', id), chunks: chunkRows.length, facts: tally, replaced: Boolean(existing), embeddingSource: source };
}

// ---------------------------------------------------------------------------
// Lettura, eliminazione, re-indicizzazione
// ---------------------------------------------------------------------------

/** Testo originale ripulito del documento (dal cloud, se collegato). */
export async function getDocumentRawContent(documentId) {
  const local = store.getById('brain_documents', documentId);
  if (local?.raw_content) return local.raw_content;
  if (!isCloudMode()) return local?.raw_content || '';
  const { data, error } = await cloud.client.from('brain_documents').select('raw_content').eq('id', documentId).maybeSingle();
  if (error) fail(error, 'Lettura del documento non riuscita');
  return data?.raw_content || '';
}

/** I pezzi di un documento, in ordine. */
export async function getDocumentChunks(documentId) {
  if (!isCloudMode()) {
    return store.getAll('brain_memories').filter(m => m.document_id === documentId).sort((a, b) => (a.chunk_index || 0) - (b.chunk_index || 0));
  }
  const { data, error } = await cloud.client.from('brain_memories').select('id,document_id,chunk_index,title,content,source_date,embedding_source').eq('document_id', documentId).order('chunk_index', { ascending: true });
  if (error) fail(error, 'Lettura dei pezzi non riuscita');
  return data || [];
}

/** Un singolo pezzo o nota per id (per ispezionare la fonte di una risposta). */
export async function getMemoryById(memoryId) {
  const local = store.getById('brain_memories', memoryId);
  if (local || !isCloudMode()) return local;
  const { data, error } = await cloud.client.from('brain_memories').select('id,document_id,chunk_index,title,content,source_date').eq('id', memoryId).maybeSingle();
  if (error) fail(error, 'Lettura della fonte non riuscita');
  return data || null;
}

/**
 * Elimina un documento con tutti i suoi pezzi (nessun frammento orfano) e, se richiesto, i fatti che ne erano stati ricavati.
 * Nel cloud i pezzi spariscono a cascata insieme al documento.
 */
export async function deleteDocument(documentId, { deleteFacts = true } = {}) {
  const doc = store.getById('brain_documents', documentId);
  if (!doc) return { deleted: false, facts: 0, chunks: 0 };
  const localChunks = store.getAll('brain_memories', true).filter(m => m.document_id === documentId);
  const facts = deleteFacts ? store.getAll('brain_facts', true).filter(f => f.source_document_id === documentId) : [];

  if (isCloudMode()) {
    const { error } = await cloud.client.from('brain_documents').delete().eq('id', documentId);
    if (error) fail(error, 'Eliminazione non riuscita');
  }
  store.allowBulkDelete();
  store.runBatch(() => {
    for (const f of facts) deleteFact(f.id);
    for (const c of localChunks) store.permanentDelete('brain_memories', c.id);
    store.permanentDelete('brain_documents', documentId);
  });
  return { deleted: true, facts: facts.length, chunks: localChunks.length || doc.chunk_count || 0 };
}

/**
 * Ricostruisce i pezzi e i vettori di un documento a partire dal suo testo originale (che non viene mai buttato).
 * Utile se cambia il modo di dividere il testo o il fornitore dei vettori. I fatti non vengono toccati.
 */
export async function reindexDocument(documentId, { onStage = null } = {}) {
  const doc = store.getById('brain_documents', documentId);
  if (!doc) throw new Error('Documento non trovato.');
  onStage?.('Rileggo il testo');
  const raw = await getDocumentRawContent(documentId);
  if (!raw) throw new Error('Il testo originale non è disponibile: non posso re-indicizzare.');
  const chunks = chunkText(raw);
  onStage?.('Preparo la ricerca');
  const { vectors, source } = await embedTexts(chunks.map(c => `${doc.title}\n${c}`));
  const rows = chunks.map((content, i) => ({
    id: generateId(), document_id: documentId, chunk_index: i, title: doc.title, content, summary: '', domain: doc.domain,
    source_type: 'document', source_id: documentId, source_date: doc.original_date || null, tags: [], embedding: vectors[i], embedding_source: source,
  }));

  onStage?.('Salvo');
  if (isCloudMode()) {
    const { error: delErr } = await cloud.client.from('brain_memories').delete().eq('document_id', documentId);
    if (delErr) fail(delErr, 'Pulizia dei vecchi pezzi non riuscita');
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const batch = rows.slice(i, i + INSERT_BATCH).map(r => ({ ...r, user_id: cloud.userId, embedding: JSON.stringify(r.embedding) }));
      const { error } = await cloud.client.from('brain_memories').insert(batch);
      if (error) fail(error, 'Salvataggio dei nuovi pezzi non riuscito');
    }
  } else {
    store.allowBulkDelete();
    store.runBatch(() => {
      for (const old of store.getAll('brain_memories', true).filter(m => m.document_id === documentId)) store.permanentDelete('brain_memories', old.id);
      for (const row of rows) store.create('brain_memories', row);
    });
  }
  store.update('brain_documents', documentId, { chunk_count: rows.length, embedding_source: source });
  return { chunks: rows.length, embeddingSource: source };
}

/**
 * Ricalcola i vettori dei pezzi di TUTTI i documenti che stanno nel cloud (le note le ricalcola brain.js).
 * Senza cloud non c'è nulla da fare qui: i pezzi sono nello store e li gestisce già recalculateAllEmbeddings.
 */
export async function recalculateDocumentEmbeddings({ onProgress = null } = {}) {
  if (!isCloudMode()) return { total: 0, updated: 0, source: null };
  if (!isAiConfigured()) throw new GeminiError('not_configured', 'L\'IA non è configurata.');
  const all = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await cloud.client.from('brain_memories').select('id,title,content').order('created_at', { ascending: true }).range(from, from + 499);
    if (error) fail(error, 'Lettura dei pezzi non riuscita');
    all.push(...(data || []).filter(r => r.content));
    if (!data || data.length < 500) break;
  }
  const docChunks = all.filter(r => !store.getById('brain_memories', r.id)); // le note locali le ha già fatte brain.js
  let updated = 0;
  let source = null;
  for (let i = 0; i < docChunks.length; i += EMBED_BATCH) {
    const batch = docChunks.slice(i, i + EMBED_BATCH);
    const res = await aiEmbedBatch(batch.map(r => `${r.title || ''}\n${r.content}`));
    source = res.source;
    for (let k = 0; k < batch.length; k++) {
      const { error } = await cloud.client.from('brain_memories').update({ embedding: JSON.stringify(res.vectors[k]), embedding_source: res.source }).eq('id', batch[k].id);
      if (error) fail(error, 'Aggiornamento dei vettori non riuscito');
      updated++;
    }
    onProgress?.({ done: Math.min(i + EMBED_BATCH, docChunks.length), total: docChunks.length });
  }
  return { total: docChunks.length, updated, source };
}

// ---------------------------------------------------------------------------
// Ricerca (fonte 1 della chat personale)
// ---------------------------------------------------------------------------

/**
 * Ricerca ibrida (significato + parole esatte). Con il cloud la fa il database su tutti i pezzi;
 * senza cloud la fa il browser su ciò che ha in memoria.
 */
export async function searchChunks({ embedding = null, source = null, text = '', limit = 8, threshold = 0.35 } = {}) {
  if (isCloudMode()) {
    const { data, error } = await cloud.client.rpc('match_brain_memories_hybrid', {
      query_embedding: embedding ? JSON.stringify(embedding) : null,
      query_text: text,
      match_threshold: threshold,
      match_count: limit,
      filter_domain: null,
      filter_source: source || 'openai',
      filter_user: null,
    });
    if (error) fail(error, 'Ricerca non riuscita');
    return data || [];
  }
  return searchMemoriesLocal(store.getAll('brain_memories'), { embedding, source, text, limit, threshold, documents: store.getAll('brain_documents') });
}

// ---------------------------------------------------------------------------
// Importazione di molti elementi: uno alla volta, con pausa, ripresa e nuovi tentativi
// ---------------------------------------------------------------------------

const RETRYABLE = new Set(['timeout', 'network', 'unavailable', 'quota', 'bad_response']);
const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * @param {Array<{item:object, domain:string}>} jobs
 * @param {object} [opts]
 * @param {(state:object)=>void} [opts.onUpdate] chiamata a ogni cambio di stato
 * @param {number} [opts.maxAttempts=3]
 * @param {(ms:number)=>Promise<void>} [opts.sleep]
 * @param {Function} [opts.importFn] sostituibile nei test
 */
export function createImportRunner(jobs, { onUpdate = null, maxAttempts = 3, sleep = defaultSleep, importFn = importDocument } = {}) {
  const state = {
    status: 'idle', // idle | running | paused | done
    current: -1,
    stage: '',
    jobs: jobs.map(j => ({ title: j.item.title, status: 'pending', attempts: 0, error: null, result: null })),
  };
  let pauseRequested = false;
  let loop = null;
  const emit = () => onUpdate?.({ ...state, jobs: state.jobs.map(j => ({ ...j })), done: state.jobs.filter(j => j.status === 'done').length, failed: state.jobs.filter(j => j.status === 'failed').length, total: state.jobs.length });

  async function run() {
    state.status = 'running';
    emit();
    for (let i = 0; i < jobs.length; i++) {
      const job = state.jobs[i];
      if (job.status === 'done') continue;
      if (pauseRequested) {
        state.status = 'paused';
        state.current = -1;
        state.stage = '';
        emit();
        return;
      }
      state.current = i;
      job.status = 'running';
      job.error = null;
      emit();
      let ok = false;
      for (let attempt = 1; attempt <= maxAttempts && !ok; attempt++) {
        job.attempts++;
        try {
          job.result = await importFn(jobs[i].item, { domain: jobs[i].domain, onStage: (s) => { state.stage = s; emit(); } });
          ok = true;
        } catch (err) {
          job.error = err?.message || String(err);
          const retryable = RETRYABLE.has(err?.code);
          if (!retryable || attempt === maxAttempts) break;
          state.stage = `Riprovo tra poco (tentativo ${attempt + 1} di ${maxAttempts})`;
          emit();
          await sleep(1500 * attempt);
        }
      }
      job.status = ok ? 'done' : 'failed';
      if (ok) job.error = null;
      state.stage = '';
      emit();
    }
    state.status = 'done';
    state.current = -1;
    emit();
  }

  return {
    state,
    /** Avvia o riprende. Gli elementi già fatti non si rifanno; quelli falliti si riprovano. */
    start() {
      if (state.status === 'running') return loop;
      pauseRequested = false;
      for (const j of state.jobs) if (j.status === 'failed') j.status = 'pending';
      loop = run();
      return loop;
    },
    /** Si ferma dopo l'elemento in corso (non a metà di un documento). */
    pause() {
      if (state.status === 'running') pauseRequested = true;
    },
    resume() {
      return this.start();
    },
  };
}
