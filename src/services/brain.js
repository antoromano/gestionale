// src/services/brain.js
// Motore Cognitivo Tri-Layer Ibrido (Livello 1: Semantic Memory pgvector | Livello 2: Mem0 Atomic Facts | Livello 3: Relational Knowledge Graph)
// Persistenza: sincronizzazione cloud generica (cloud.js). IA: ai-client.js (modelli scoperti da Google, errori espliciti).
// L'estrattore euristico locale resta disponibile ma è SEMPRE dichiarato come tale (engine: 'local').

import { aiGenerate, aiEmbed, isAiConfigured } from './ai-client.js';
import { store } from './store.js';
import { getSupabase } from './supabase.js';
import {
  parseWorkoutNotation,
  calculateBodyTrends,
  calculateColumnRecoveryStatus,
} from '../utils/body-parser.js';

export const BRAIN_DOMAINS = {
  work: { label: 'Lavoro / Dev', icon: '💻', badge: 'badge-blue' },
  client: { label: 'Clienti', icon: '🏢', badge: 'badge-green' },
  tech: { label: 'Architettura & Codice', icon: '⚙️', badge: 'badge-blue' },
  body: { label: 'Body & Salute', icon: '🏋️', badge: 'badge-yellow' },
  personal: { label: 'Personale & Regole', icon: '🧭', badge: 'badge-gray' },
  idea: { label: 'Idee & Ricerca', icon: '💡', badge: 'badge-yellow' },
  cucina: { label: 'Cucina & Ricette', icon: '🍳', badge: 'badge-yellow' },
  finance: { label: 'Finanza & Asset', icon: '📈', badge: 'badge-green' },
  auto: { label: 'Auto & Veicoli', icon: '🚗', badge: 'badge-gray' },
  hobby: { label: 'Hobby & Interessi', icon: '🎯', badge: 'badge-blue' },
};

export const NODE_TYPE_META = {
  person: { label: 'Persona', icon: '👤', color: '#2563eb', bg: '#dbeafe' },
  client: { label: 'Cliente', icon: '🏢', color: '#16a34a', bg: '#dcfce7' },
  technology: { label: 'Tecnologia', icon: '⚡', color: '#7c3aed', bg: '#ede9fe' },
  project: { label: 'Progetto', icon: '🚀', color: '#0284c7', bg: '#e0f2fe' },
  exercise: { label: 'Esercizio', icon: '🏋️', color: '#d97706', bg: '#fef3c7' },
  biometric: { label: 'Biometria / Salute', icon: '❤️', color: '#dc2626', bg: '#fee2e2' },
  concept: { label: 'Concetto', icon: '🧠', color: '#475569', bg: '#f1f5f9' },
  issue: { label: 'Problema / Sintomo', icon: '⚠️', color: '#ea580c', bg: '#ffedd5' },
  recipe: { label: 'Ricetta', icon: '🍳', color: '#d97706', bg: '#fef3c7' },
  asset: { label: 'Asset / Finanza', icon: '📈', color: '#059669', bg: '#d1fae5' },
  vehicle: { label: 'Veicolo', icon: '🚗', color: '#4f46e5', bg: '#e0e7ff' },
};

const KNOWN_TECHNOLOGIES = [
  'Next.js', 'React', 'Vue', 'Nuxt', 'Svelte', 'Angular', 'Node.js', 'TypeScript', 'JavaScript',
  'Python', 'FastAPI', 'Django', 'Laravel', 'PHP', 'Go', 'Rust', 'Supabase', 'PostgreSQL', 'pgvector',
  'Redis', 'MongoDB', 'Tailwind', 'Docker', 'Kubernetes', 'AWS', 'Vercel', 'Hetzner', 'Cloudflare',
  'Stripe', 'Shopify', 'WordPress', 'WooCommerce', 'GraphQL', 'Prisma', 'Git', 'GitHub', 'Vite', 'Vitest'
];

const KNOWN_EXERCISES = [
  'Pull-up', 'Trazioni', 'Squat', 'Panca Piana', 'Panca', 'Dip', 'Stacco da terra', 'Stacco',
  'Military Press', 'Push-up', 'Piegamenti', 'rematore', 'Corsa', 'Plank', 'Stretching', 'Mobilità', 'Calisthenics'
];

const KNOWN_BIOMETRICS = [
  'Peso corporeo', 'Peso', 'Kcal', 'Calorie', 'Proteine', 'Sonno', 'HRV', 'Frequenza cardiaca',
  'Massa magra', 'Body fat', 'Recupero', 'Energia', 'Lombi', 'Spalla', 'Gomito', 'Schiena'
];

let isSyncingEntity = false;

/**
 * Genera un embedding deterministico a 768 dimensioni (normalizzato L2) per uso locale/offline
 * basato su n-grammi e token semantici, garantendo compatibilità con vector(768).
 */
export function computeLocalEmbedding(text = '') {
  const dim = 768;
  const vec = new Array(dim).fill(0);
  const clean = (text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const tokens = clean.split(/\s+/).filter(Boolean);

  if (tokens.length === 0) return vec;

  for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
    const token = tokens[tIdx];
    // Hash token e trigrammi
    const grams = [token];
    for (let i = 0; i <= token.length - 3; i++) {
      grams.push(token.slice(i, i + 3));
    }
    for (const g of grams) {
      let h1 = 2166136261;
      let h2 = 16777619;
      for (let c = 0; c < g.length; c++) {
        const code = g.charCodeAt(c);
        h1 ^= code;
        h1 = Math.imul(h1, 16777619);
        h2 ^= code;
        h2 = Math.imul(h2, 1099511627);
      }
      const pos = Math.abs(h1) % dim;
      const sign = (h2 & 1) === 0 ? 1 : -1;
      vec[pos] += sign * (g === token ? 1.5 : 0.5);
    }
  }

  // Normalizzazione L2
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) {
    vec[i] = Number((vec[i] / norm).toFixed(6));
  }
  return vec;
}

/**
 * Calcola la similarità del coseno tra due vettori della stessa dimensione
 */
export function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Embedding a 768 dimensioni. `source` dichiara chi l'ha calcolato ('gemini' | 'local'): vettori di sorgenti diverse
 * NON sono confrontabili, quindi la ricerca usa solo quelli della stessa sorgente.
 */
export async function generateEmbeddingDetailed(text) {
  if (isAiConfigured()) {
    try {
      const { values, model } = await aiEmbed(text);
      return { values, source: 'gemini', model };
    } catch (err) {
      return { values: computeLocalEmbedding(text), source: 'local', error: { code: err.code, message: err.message } };
    }
  }
  return { values: computeLocalEmbedding(text), source: 'local' };
}

export async function generateEmbedding(text) {
  return (await generateEmbeddingDetailed(text)).values;
}

/**
 * Inferisce il tipo di nodo a partire dall'etichetta
 */
export function inferNodeType(label = '', hintType = null) {
  const validTypes = ['person', 'client', 'technology', 'project', 'exercise', 'biometric', 'concept', 'issue'];
  if (hintType && validTypes.includes(hintType)) return hintType;

  const clean = (label || '').trim();
  const lower = clean.toLowerCase();

  if (lower === 'antonio' || lower === 'io' || lower.startsWith('dott.') || lower.startsWith('ing.')) {
    return 'person';
  }

  const allClients = store.getAll('clients');
  if (allClients.some(c => (c.company_name || '').toLowerCase() === lower || `${c.first_name || ''} ${c.last_name || ''}`.trim().toLowerCase() === lower)) {
    return 'client';
  }

  if (KNOWN_TECHNOLOGIES.some(t => t.toLowerCase() === lower)) {
    return 'technology';
  }

  if (KNOWN_EXERCISES.some(e => e.toLowerCase() === lower) || /allenamento|workout|serie|ripetizioni/i.test(lower)) {
    return 'exercise';
  }

  if (KNOWN_BIOMETRICS.some(b => b.toLowerCase() === lower) || /kcal|battiti|sonno|peso|dolore/i.test(lower)) {
    if (/dolore|infiammazione|fastidio|affaticamento|bug|errore|latenza|timeout|crash/i.test(lower)) {
      return 'issue';
    }
    return 'biometric';
  }

  if (/bug|errore|latenza|timeout|crash|problema|collo di bottiglia|infiammazione|affaticamento/i.test(lower)) {
    return 'issue';
  }

  if (/srl|spa|snc|corp|studio|agency|tech|group|labs/i.test(lower)) {
    return 'client';
  }

  if (/app|portale|gestionale|sito|piattaforma|ecommerce|mvp/i.test(lower)) {
    return 'project';
  }

  return 'concept';
}

/**
 * LIVELLO 2 — Upsert Fatto Atomico con evoluzione temporale dello stato (Pattern Mem0)
 * Quando un fatto con stesso (subject, fact_key) cambia valore:
 * - il vecchio record viene marcato con is_active = false, valid_to = now() e superseded_by = newFact.id
 * - viene creato il nuovo record attivo con is_active = true, valid_from = now()
 */
export function upsertFact({
  subject,
  fact_key,
  fact_value,
  category = 'status',
  confidence = 1.0,
  source_memory_id = null,
}) {
  if (!subject || !fact_key || fact_value === undefined || fact_value === null) {
    return null;
  }

  const cleanSubject = String(subject).trim();
  const cleanKey = String(fact_key)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_àèéìòù]/gi, '');
  const cleanValue = String(fact_value).trim();
  if (!cleanSubject || !cleanKey || !cleanValue) return null;

  const resolvedCategory = category && String(category).trim().length > 0 ? String(category).trim() : 'status';
  const nowIso = new Date().toISOString();

  const allFacts = store.getAll('brain_facts', true);
  const existingActive = allFacts.find(
    f =>
      !f.is_deleted &&
      f.is_active !== false &&
      (f.subject || '').trim().toLowerCase() === cleanSubject.toLowerCase() &&
      (f.fact_key || '').trim().toLowerCase() === cleanKey.toLowerCase()
  );

  // Caso 1: Esiste già un fatto attivo con lo stesso identico valore -> aggiorna solo updated_at
  if (existingActive && String(existingActive.fact_value).trim().toLowerCase() === cleanValue.toLowerCase()) {
    const updated = store.update('brain_facts', existingActive.id, {
      updated_at: nowIso,
      confidence: Math.max(Number(existingActive.confidence) || 1.0, Number(confidence) || 1.0),
      source_memory_id: source_memory_id || existingActive.source_memory_id || null,
    });
    return { ...updated, action: 'unchanged', previousFact: null };
  }

  // Crea il nuovo fatto attivo
  const newFact = store.create('brain_facts', {
    subject: cleanSubject,
    fact_key: cleanKey,
    fact_value: cleanValue,
    category: resolvedCategory,
    confidence: Number(confidence) || 1.0,
    is_active: true,
    superseded_by: null,
    valid_from: nowIso,
    valid_to: null,
    source_memory_id: source_memory_id || null,
  });

  let supersededOld = null;
  // Caso 2: Esisteva un fatto attivo con valore diverso -> storicizza il vecchio fatto
  if (existingActive) {
    supersededOld = store.update('brain_facts', existingActive.id, {
      is_active: false,
      valid_to: nowIso,
      superseded_by: newFact.id,
    });
  }

  return {
    ...newFact,
    action: existingActive ? 'superseded' : 'created',
    previousFact: supersededOld,
  };
}

/**
 * Invalida (disattiva) un fatto attivo senza sostituirlo
 */
export function invalidateFact(factId) {
  const existing = store.getById('brain_facts', factId);
  if (!existing) return null;
  const nowIso = new Date().toISOString();
  const updated = store.update('brain_facts', factId, {
    is_active: false,
    valid_to: nowIso,
  });
  return updated;
}

/**
 * LIVELLO 3 — Crea o recupera un Nodo nel Knowledge Graph
 * Rispetta il vincolo unique logico su (lower(label), node_type)
 */
export function upsertNode({ label, node_type = null, properties = {} }) {
  if (!label || !String(label).trim()) return null;
  const cleanLabel = String(label).trim();
  const resolvedType = inferNodeType(cleanLabel, node_type);

  const allNodes = store.getAll('brain_nodes');
  const existing = allNodes.find(
    n =>
      (n.label || '').trim().toLowerCase() === cleanLabel.toLowerCase() &&
      (n.node_type === resolvedType || !node_type)
  );

  if (existing) {
    const mergedProps = { ...(existing.properties || {}), ...(properties || {}) };
    const updated = store.update('brain_nodes', existing.id, {
      properties: mergedProps,
    });
    return updated;
  }

  const created = store.create('brain_nodes', {
    label: cleanLabel,
    node_type: resolvedType,
    properties: properties || {},
  });
  return created;
}

/**
 * LIVELLO 3 — Crea o aggiorna una Relazione nel Knowledge Graph (brain_edges)
 * Incrementa weight se la relazione si ripete.
 */
export function upsertGraphRelationship({
  source,
  target,
  source_label,
  target_label,
  source_type = null,
  target_type = null,
  relation_type = 'CORRELATO_A',
  evidence = '',
}) {
  const srcInput = source || source_label;
  const tgtInput = target || target_label;
  if (!srcInput || !tgtInput) return null;

  const srcObj = typeof srcInput === 'object'
    ? srcInput
    : { label: String(srcInput).trim(), node_type: source_type };
  const tgtObj = typeof tgtInput === 'object'
    ? tgtInput
    : { label: String(tgtInput).trim(), node_type: target_type };

  if (!srcObj.label || !tgtObj.label) return null;
  if (srcObj.label.toLowerCase() === tgtObj.label.toLowerCase()) return null;

  const sourceNode = upsertNode(srcObj);
  const targetNode = upsertNode(tgtObj);
  if (!sourceNode || !targetNode) return null;

  const cleanRel = String(relation_type || 'CORRELATO_A')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/g, '') || 'CORRELATO_A';

  const allEdges = store.getAll('brain_edges');
  const existingEdge = allEdges.find(
    e =>
      e.source_node_id === sourceNode.id &&
      e.target_node_id === targetNode.id &&
      (e.relation_type || '').toUpperCase() === cleanRel
  );

  if (existingEdge) {
    const newWeight = Number((Number(existingEdge.weight || 1) + 1).toFixed(2));
    const updatedEdge = store.update('brain_edges', existingEdge.id, {
      weight: newWeight,
      evidence: evidence || existingEdge.evidence || '',
    });
    return {
      edge: updatedEdge,
      sourceNode,
      targetNode,
      isNew: false,
    };
  }

  const newEdge = store.create('brain_edges', {
    source_node_id: sourceNode.id,
    target_node_id: targetNode.id,
    relation_type: cleanRel,
    weight: 1.0,
    evidence: evidence || '',
  });

  return {
    edge: newEdge,
    sourceNode,
    targetNode,
    isNew: true,
  };
}

/**
 * Estrattore Euristico Locale Deterministico
 * Analizza qualsiasi nota tecnica, cliente, body/allenamento o regola personale ed estrae:
 * - facts: array di { subject, fact_key, fact_value, category }
 * - nodes: array di { label, node_type, properties }
 * - edges: array di { source_label, target_label, source_type, target_type, relation_type, evidence }
 */
export function extractKnowledgeLocally(text = '', domain = 'work', title = '') {
  const fullText = `${title ? title + '. ' : ''}${text}`.trim();
  const facts = [];
  const nodes = [];
  const edges = [];

  if (!fullText) {
    return { summary: '', facts, nodes, edges, tags: [] };
  }

  const lower = fullText.toLowerCase();
  const tags = new Set();

  // Determina il soggetto principale della nota
  let primarySubject = 'Antonio';
  let primarySubjectType = 'person';

  if (domain === 'body') {
    primarySubject = 'Antonio';
    tags.add('body');
  }

  // Controlla se viene menzionato un cliente esistente
  const existingClients = store.getAll('clients');
  for (const c of existingClients) {
    const cName = c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim();
    if (cName && lower.includes(cName.toLowerCase())) {
      primarySubject = cName;
      primarySubjectType = 'client';
      nodes.push({ label: cName, node_type: 'client', properties: { client_id: c.id } });
      tags.add(cName.toLowerCase().replace(/\s+/g, '-'));
      break;
    }
  }

  // Se non c'è un cliente già in store, cerca pattern espliciti "Cliente X", "per X", "con X", o soggetto iniziale
  if (primarySubject === 'Antonio') {
    const clientMatch = fullText.match(/(?:cliente|azienda|progetto|per|con)\s+([A-Z][a-zA-Z0-9_-]{2,25}(?:\s+[A-Z][a-zA-Z0-9_-]{2,25})?)/);
    if (clientMatch && !/^(Antonio|Oggi|Domani|Lunedì|Martedì|Mercoledì|Giovedì|Venerdì|Sabato|Domenica|Next|React|Supabase|Pull|Squat|Panca)$/i.test(clientMatch[1].trim())) {
      primarySubject = clientMatch[1].trim();
      primarySubjectType = inferNodeType(primarySubject, domain === 'client' ? 'client' : null);
      nodes.push({ label: primarySubject, node_type: primarySubjectType, properties: {} });
    } else {
      // Cerca un nome proprio capitalizzato all'inizio della frase es. "TechCorp usa..." o "Nexus ha..."
      const leadingSubj = fullText.match(/^([A-Z][a-zA-Z0-9_.-]{2,25})\s+(?:usa|utilizza|ha|richiede|paga|dipende|passa|aggiorna)/);
      if (leadingSubj && !/^(Oggi|Domani|Nota| Appunto|Regola|Quando)$/i.test(leadingSubj[1])) {
        primarySubject = leadingSubj[1].trim();
        primarySubjectType = inferNodeType(primarySubject, domain === 'client' ? 'client' : null);
        nodes.push({ label: primarySubject, node_type: primarySubjectType, properties: {} });
      }
    }
  }

  // 1. Rilevamento Tecnologie e Relazioni USA_TECNOLOGIA
  const foundTechs = [];
  for (const tech of KNOWN_TECHNOLOGIES) {
    const escaped = tech.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?=$|[^a-zA-Z0-9])`, 'i');
    if (regex.test(fullText)) {
      foundTechs.push(tech);
      nodes.push({ label: tech, node_type: 'technology', properties: { category: 'tech_stack' } });
      tags.add(tech.toLowerCase().replace('.', ''));
      edges.push({
        source_label: primarySubject,
        source_type: primarySubjectType,
        target_label: tech,
        target_type: 'technology',
        relation_type: 'USA_TECNOLOGIA',
        evidence: fullText.slice(0, 160),
      });
    }
  }

  if (foundTechs.length > 0) {
    facts.push({
      subject: primarySubject,
      fact_key: 'stack_principale',
      fact_value: foundTechs.join(', '),
      category: primarySubjectType === 'client' ? 'client_info' : 'preference',
    });
  }

  // 2. Rilevamento Esercizi & Biometria (Body & Salute)
  const foundExercises = [];
  for (const ex of KNOWN_EXERCISES) {
    const regex = new RegExp(`\\b${ex.replace('-', '[-\\s]?')}\\b`, 'i');
    if (regex.test(fullText)) {
      foundExercises.push(ex);
      nodes.push({ label: ex, node_type: 'exercise', properties: {} });
      tags.add(ex.toLowerCase());
    }
  }

  // Metriche di allenamento (es. "massimale pull-up 15", "pull-up: 18 ripetizioni", "panca piana 95kg", "target kcal 2500", "peso 75.5 kg")
  const maxMatch = fullText.match(/massimale\s+([a-zA-Z0-9\s-]+?)\s*(?:[:=è]|di|a)?\s*(\d+(?:[.,]\d+)?\s*(?:kg|rip|ripetizioni|reps|sec|min)?)/i);
  if (maxMatch) {
    const exName = maxMatch[1].trim();
    const val = maxMatch[2].trim();
    const keySlug = `massimale_${exName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
    facts.push({
      subject: 'Allenamento',
      fact_key: keySlug,
      fact_value: val,
      category: 'metric',
    });
  }

  // Target Kcal / Calorie
  const kcalMatch = fullText.match(/(?:target\s+kcal|calorie(?:\s+giornaliere)?|kcal(?:\s+target)?)\s*(?:[:=è]|a|di)?\s*(\d{3,4}(?:\s*kcal)?)/i)
    || fullText.match(/(\d{3,4})\s*kcal/i);
  if (kcalMatch) {
    const val = kcalMatch[1].toLowerCase().includes('kcal') ? kcalMatch[1].trim() : `${kcalMatch[1].trim()} kcal`;
    facts.push({
      subject: 'Antonio',
      fact_key: 'target_kcal',
      fact_value: val,
      category: 'metric',
    });
    nodes.push({ label: 'Target Kcal', node_type: 'biometric', properties: { value: val } });
  }

  // Peso corporeo
  const weightMatch = fullText.match(/\bpeso(?:\s+corporeo)?\s*(?:[:=è]|a|di)?\s*(\d{2,3}(?:[.,]\d+)?\s*kg)/i);
  if (weightMatch) {
    facts.push({
      subject: 'Antonio',
      fact_key: 'peso_corporeo',
      fact_value: weightMatch[1].trim(),
      category: 'metric',
    });
    nodes.push({ label: 'Peso Corporeo', node_type: 'biometric', properties: { value: weightMatch[1].trim() } });
  }

  // Canone / MRR / Budget / Prezzo
  const mrrMatch = fullText.match(/(?:canone(?:\s+mrr|\s+manutenzione|\s+mensile)?|mrr|retainer)\s*(?:[:=è]|a|di)?\s*(\d+(?:[.,]\d+)?\s*(?:€|euro)(?:\s*\/\s*(?:mese|anno|trimestre))?)/i)
    || fullText.match(/(\d+(?:[.,]\d+)?\s*(?:€|euro)\s*\/\s*mese)/i);
  if (mrrMatch) {
    facts.push({
      subject: primarySubject,
      fact_key: 'canone_mrr',
      fact_value: mrrMatch[1].trim(),
      category: primarySubjectType === 'client' ? 'client_info' : 'metric',
    });
  }

  // Repository GitHub
  const repoMatch = fullText.match(/(?:github\.com\/|repo(?:\s+github)?[:\s]+)([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/i);
  if (repoMatch) {
    const repo = repoMatch[1].replace(/\.git$/, '');
    facts.push({
      subject: primarySubject,
      fact_key: 'github_repo',
      fact_value: repo,
      category: 'client_info',
    });
  }

  // Pattern espliciti "chiave: valore" o "Soggetto -> chiave = valore"
  const kvRegex = /([A-Za-zÀ-ÿ0-9_\s]{2,30})\s*[:=]\s*([^\n.;,]{2,60})/g;
  let kvMatch;
  while ((kvMatch = kvRegex.exec(fullText)) !== null) {
    const rawKey = kvMatch[1].trim();
    const rawVal = kvMatch[2].trim();
    if (/^(http|https|es|esempio|nota|nb|ore)$/i.test(rawKey)) continue;
    // Una "chiave" è un'etichetta breve ("stack", "canone mensile"), non l'inizio di una frase ("Ho sentito Marco Rossi di TechCorp")
    if (rawKey.split(/\s+/).length > 3 || /^(ho|ha|hanno|abbiamo|oggi|ieri|domani|ricordarsi|ricordare)\b/i.test(rawKey)) continue;
    const normKey = rawKey.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (normKey.length >= 3 && normKey.length <= 32 && rawVal.length >= 1) {
      const alreadyExists = facts.some(f => f.fact_key === normKey);
      if (!alreadyExists) {
        facts.push({
          subject: primarySubject,
          fact_key: normKey,
          fact_value: rawVal,
          category: domain === 'client' ? 'client_info' : (/\d/.test(rawVal) ? 'metric' : 'status'),
        });
      }
    }
  }

  // Preferenze e Regole esplicite ("Preferisco X", "Regola: X", "Standard: X")
  const prefMatch = fullText.match(/(?:preferisco|uso sempre|scelgo sempre|la mia regola è)\s+([^.,;\n]{4,80})/i);
  if (prefMatch) {
    facts.push({
      subject: 'Antonio',
      fact_key: 'preferenza_operativa',
      fact_value: prefMatch[1].trim(),
      category: 'preference',
    });
  }

  // 3. Estrazione Relazioni Causali e Semantiche per il Knowledge Graph
  // Pattern: [Entità A] (causa|provoca|migliora|riduce|dipende da|lavora con|usa|risolve|blocca) [Entità B]
  const relationPatterns = [
    { regex: /([A-ZÀ-Ÿa-zà-ÿ0-9_.-]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ0-9_.-]+){0,3})\s+(?:causa|provoca|genera|porta a)\s+([A-ZÀ-Ÿa-zà-ÿ0-9_.-]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ0-9_.-]+){0,3})/gi, rel: 'CAUSA' },
    { regex: /([A-ZÀ-Ÿa-zà-ÿ0-9_.-]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ0-9_.-]+){0,3})\s+(?:migliora|ottimizza|potenzia|aumenta|favorisce)\s+([A-ZÀ-Ÿa-zà-ÿ0-9_.-]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ0-9_.-]+){0,3})/gi, rel: 'MIGLIORA' },
    { regex: /([A-ZÀ-Ÿa-zà-ÿ0-9_.-]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ0-9_.-]+){0,3})\s+(?:riduce|diminuisce|allevia|elimina|previene)\s+([A-ZÀ-Ÿa-zà-ÿ0-9_.-]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ0-9_.-]+){0,3})/gi, rel: 'RIDUCE' },
    { regex: /([A-ZÀ-Ÿa-zà-ÿ0-9_.-]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ0-9_.-]+){0,3})\s+(?:dipende da|richiede|si basa su|necessita di)\s+([A-ZÀ-Ÿa-zà-ÿ0-9_.-]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ0-9_.-]+){0,3})/gi, rel: 'DIPENDE_DA' },
    { regex: /([A-ZÀ-Ÿa-zà-ÿ0-9_.-]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ0-9_.-]+){0,3})\s+(?:lavora con|collabora con|è cliente di)\s+([A-ZÀ-Ÿa-zà-ÿ0-9_.-]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ0-9_.-]+){0,3})/gi, rel: 'LAVORA_CON' },
    { regex: /([A-ZÀ-Ÿa-zà-ÿ0-9_.-]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ0-9_.-]+){0,3})\s+(?:usa|utilizza|adotta|integra)\s+([A-ZÀ-Ÿa-zà-ÿ0-9_.-]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ0-9_.-]+){0,3})/gi, rel: 'USA_TECNOLOGIA' },
  ];

  const cleanEntityLabel = (str = '') => {
    return str
      .replace(/^(il|lo|la|i|gli|le|un|uno|una|del|della|dei|delle|al|alla|con|per|su|da|che|quando|se)\s+/i, '')
      .replace(/\s+(il|lo|la|i|gli|le|un|uno|una)$/i, '')
      .trim();
  };

  for (const { regex, rel } of relationPatterns) {
    let m;
    while ((m = regex.exec(fullText)) !== null) {
      const src = cleanEntityLabel(m[1]);
      const tgt = cleanEntityLabel(m[2]);
      if (src.length >= 2 && tgt.length >= 2 && src.toLowerCase() !== tgt.toLowerCase()) {
        const srcType = inferNodeType(src);
        const tgtType = inferNodeType(tgt, rel === 'USA_TECNOLOGIA' ? 'technology' : null);
        nodes.push({ label: src, node_type: srcType, properties: {} });
        nodes.push({ label: tgt, node_type: tgtType, properties: {} });
        edges.push({
          source_label: src,
          source_type: srcType,
          target_label: tgt,
          target_type: tgtType,
          relation_type: rel,
          evidence: m[0].trim(),
        });
      }
    }
  }

  // Se sono stati trovati più nodi tecnologici o esercizi nella stessa nota, collega soggetto -> nodo
  for (const ex of foundExercises) {
    edges.push({
      source_label: primarySubject,
      source_type: primarySubjectType,
      target_label: ex,
      target_type: 'exercise',
      relation_type: 'PRATICA',
      evidence: fullText.slice(0, 140),
    });
  }

  // Se non è stato estratto alcun fatto specifico ma il testo contiene informazioni rilevanti, crea un fatto di stato sintetico
  if (facts.length === 0 && fullText.length >= 8) {
    const autoKey = title
      ? title.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 28)
      : `nota_${domain}`;
    facts.push({
      subject: primarySubject,
      fact_key: autoKey || `stato_${domain}`,
      fact_value: fullText.slice(0, 140),
      category: domain === 'client' ? 'client_info' : (domain === 'personal' ? 'rule' : 'status'),
    });
  }

  return {
    summary: fullText.length > 110 ? `${fullText.slice(0, 107)}...` : fullText,
    facts,
    nodes,
    edges,
    tags: Array.from(tags),
  };
}

/**
 * Estrazione strutturata con l'IA. Lancia GeminiError se l'IA non è disponibile (il chiamante lo mostra all'utente).
 */
async function extractKnowledgeWithAi(text, domain, title) {
  const prompt = `
Sei il motore cognitivo di un Second Brain Tri-Layer (Semantic Memory, Mem0 Atomic Facts, Knowledge Graph).
Analizza il seguente contenuto (Dominio: ${domain}, Titolo: "${title || ''}"):
"""
${text}
"""

Estrai un oggetto JSON valido con questa esatta struttura:
{
  "summary": "Riassunto conciso di 1 frase",
  "tags": ["tag1", "tag2"],
  "facts": [
    {
      "subject": "Nome entità o soggetto (es. 'Antonio', 'TechCorp', 'Allenamento')",
      "fact_key": "chiave_snake_case (es. 'stack_principale', 'canone_mrr', 'massimale_pull_up', 'target_kcal')",
      "fact_value": "valore puntuale aggiornato",
      "category": "preference" | "status" | "metric" | "rule" | "client_info"
    }
  ],
  "nodes": [
    {
      "label": "Nome nodo",
      "node_type": "person" | "client" | "technology" | "project" | "exercise" | "biometric" | "concept" | "issue",
      "properties": {}
    }
  ],
  "edges": [
    {
      "source_label": "Nodo A",
      "target_label": "Nodo B",
      "relation_type": "USA_TECNOLOGIA" | "LAVORA_CON" | "CAUSA" | "MIGLIORA" | "RIDUCE" | "DIPENDE_DA" | "CORRELATO_A",
      "evidence": "Breve citazione"
    }
  ]
}
`;
  const { data, model } = await aiGenerate({ parts: [{ text: prompt }], temperature: 0.1, json: true });
  return { ...data, model };
}

/**
 * PASSO 1 — Propone cosa estrarre da una nota SENZA salvare nulla (per l'anteprima).
 * @returns {{engine:'ai'|'local', model?:string, error?:{code:string,message:string}, summary:string, tags:string[], facts:Array, nodes:Array, edges:Array}}
 *   engine 'local' = regole semplici (poco affidabili): l'interfaccia deve dirlo, con il motivo in `error`.
 */
export async function proposeKnowledge({ text, content, title = '', domain = 'work' }) {
  const rawText = (text || content || '').trim();
  if (!rawText) throw new Error('Il contenuto da memorizzare nel Second Brain non può essere vuoto.');
  const resolvedDomain = domain && String(domain).trim().length > 0 ? String(domain).trim() : 'work';
  const local = extractKnowledgeLocally(rawText, resolvedDomain, title);

  if (!isAiConfigured()) {
    return { engine: 'local', error: { code: 'not_configured', message: 'IA non configurata: uso regole semplici, poco affidabili.' }, ...local };
  }
  try {
    const ai = await extractKnowledgeWithAi(rawText, resolvedDomain, title);
    return {
      engine: 'ai',
      model: ai.model,
      summary: ai.summary || local.summary,
      tags: Array.from(new Set([...(ai.tags || []), ...(local.tags || [])].map(t => String(t).trim()).filter(Boolean))),
      facts: Array.isArray(ai.facts) ? ai.facts : [],
      nodes: Array.isArray(ai.nodes) ? ai.nodes : [],
      edges: Array.isArray(ai.edges) ? ai.edges : [],
    };
  } catch (err) {
    return { engine: 'local', error: { code: err.code || 'unavailable', message: err.message }, ...local };
  }
}

/**
 * PASSO 2 — Salva memoria (Livello 1), fatti Mem0 (Livello 2) e grafo (Livello 3) a partire da una proposta
 * (eventualmente corretta dall'utente). `proposal.facts/nodes/edges` possono essere vuoti: si salva solo la memoria.
 */
export async function commitKnowledge({ text, content, title = '', domain = 'work', sourceType = 'manual', sourceId = null, tags = [] }, proposal) {
  const rawText = (text || content || '').trim();
  if (!rawText) throw new Error('Il contenuto da memorizzare nel Second Brain non può essere vuoto.');
  const resolvedDomain = domain && String(domain).trim().length > 0 ? String(domain).trim() : 'work';
  const validSources = ['manual', 'ai_chat', 'client_event', 'todo', 'body_log', 'telegram'];
  const resolvedSource = validSources.includes(sourceType) ? sourceType : 'manual';

  const mergedTags = Array.from(new Set([...(Array.isArray(tags) ? tags : []), ...(proposal.tags || [])].map(t => String(t).trim()).filter(Boolean)));
  const summary = proposal.summary || rawText.slice(0, 120);
  const autoTitle = title.trim() || summary.slice(0, 65);

  const emb = await generateEmbeddingDetailed(`${autoTitle}\n${rawText}`);

  const memory = store.create('brain_memories', {
    title: autoTitle,
    content: rawText,
    summary,
    domain: resolvedDomain,
    source_type: resolvedSource,
    source_id: sourceId ? String(sourceId) : null,
    tags: mergedTags,
    embedding: emb.values,
    embedding_source: emb.source,
    extraction_engine: proposal.engine || 'local',
  });

  const seenFactKeys = new Set();
  const upsertedFacts = [];
  for (const f of proposal.facts || []) {
    if (!f || !f.subject || !f.fact_key || f.fact_value === undefined) continue;
    const dedupId = `${String(f.subject).toLowerCase()}::${String(f.fact_key).toLowerCase()}`;
    if (seenFactKeys.has(dedupId)) continue;
    seenFactKeys.add(dedupId);
    const res = upsertFact({ subject: f.subject, fact_key: f.fact_key, fact_value: f.fact_value, category: f.category || 'status', source_memory_id: memory.id });
    if (res) upsertedFacts.push(res);
  }

  const upsertedNodesMap = new Map();
  for (const n of proposal.nodes || []) {
    if (!n || !n.label) continue;
    const node = upsertNode({ label: n.label, node_type: n.node_type, properties: n.properties || {} });
    if (node) upsertedNodesMap.set(node.id, node);
  }

  const upsertedEdges = [];
  const seenEdges = new Set();
  for (const e of proposal.edges || []) {
    const srcLabel = e.source_label || e.source;
    const tgtLabel = e.target_label || e.target;
    if (!srcLabel || !tgtLabel) continue;
    const edgeKey = `${String(srcLabel).toLowerCase()}->${String(e.relation_type || 'CORRELATO_A').toUpperCase()}->${String(tgtLabel).toLowerCase()}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    const relRes = upsertGraphRelationship({ source: srcLabel, target: tgtLabel, source_type: e.source_type, target_type: e.target_type, relation_type: e.relation_type || 'CORRELATO_A', evidence: e.evidence || summary });
    if (relRes) {
      upsertedEdges.push(relRes.edge);
      upsertedNodesMap.set(relRes.sourceNode.id, relRes.sourceNode);
      upsertedNodesMap.set(relRes.targetNode.id, relRes.targetNode);
    }
  }

  return {
    memory,
    facts: upsertedFacts,
    nodes: Array.from(upsertedNodesMap.values()),
    edges: upsertedEdges,
    engine: proposal.engine || 'local',
    aiError: proposal.error || null,
  };
}

/**
 * Ingestione in un solo passo (uso programmatico: flussi automatici e test). L'interfaccia usa propose + commit
 * per mostrare l'anteprima. `engine` e `aiError` dichiarano sempre quale motore ha lavorato.
 */
export async function ingestKnowledge(args) {
  const proposal = await proposeKnowledge(args);
  return commitKnowledge(args, proposal);
}

/**
 * INTERROGAZIONE IBRIDA (Hybrid GraphRAG Retrieval — Livello 1 + Livello 2 + Livello 3 a 2 Hop)
 */
export async function querySecondBrain(queryText = '', options = {}) {
  const { domain = null, limit = 8 } = options;
  const cleanQuery = (queryText || '').trim();
  const lowerQuery = cleanQuery.toLowerCase();

  // Tokenizzazione query (rimuove stopword comuni italiane)
  const stopwords = new Set([
    'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'a', 'da', 'in', 'con', 'su', 'per',
    'tra', 'fra', 'che', 'chi', 'cosa', 'come', 'quando', 'dove', 'perché', 'qual', 'quale', 'quali',
    'sono', 'è', 'ha', 'hanno', 'suo', 'sua', 'mio', 'mia', 'del', 'della', 'dei', 'delle', 'nel', 'nella'
  ]);
  const queryTokens = lowerQuery
    .replace(/[^\p{L}\p{N}\s._-]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !stopwords.has(t));

  // --- LIVELLO 3: Knowledge Graph Traversal fino a 2 Hop ---
  const { nodes: allNodes, edges: allEdges } = store.getBrainGraph();
  const seedNodeIds = new Set();

  for (const node of allNodes) {
    const nLabel = (node.label || '').toLowerCase();
    if (
      (lowerQuery && (lowerQuery.includes(nLabel) || nLabel.includes(lowerQuery))) ||
      queryTokens.some(tok => nLabel.includes(tok) || tok.includes(nLabel))
    ) {
      seedNodeIds.add(node.id);
    }
  }

  const hop1NodeIds = new Set(seedNodeIds);
  const visitedEdgeIds = new Set();
  const graphConnections = [];

  // Hop 1: Connessioni dirette dai nodi seme
  for (const edge of allEdges) {
    if (seedNodeIds.has(edge.source_node_id) || seedNodeIds.has(edge.target_node_id)) {
      visitedEdgeIds.add(edge.id);
      hop1NodeIds.add(edge.source_node_id);
      hop1NodeIds.add(edge.target_node_id);
      graphConnections.push({ ...edge, hop: 1 });
    }
  }

  // Hop 2: Scoperta correlazioni indirette (nodi raggiungibili dai vicini di 1° livello)
  const hop2NodeIds = new Set(hop1NodeIds);
  for (const edge of allEdges) {
    if (visitedEdgeIds.has(edge.id)) continue;
    if (hop1NodeIds.has(edge.source_node_id) || hop1NodeIds.has(edge.target_node_id)) {
      visitedEdgeIds.add(edge.id);
      hop2NodeIds.add(edge.source_node_id);
      hop2NodeIds.add(edge.target_node_id);
      graphConnections.push({ ...edge, hop: 2 });
    }
  }

  // Espande i termini di ricerca con le etichette dei nodi trovati nel grafo
  const expandedEntityLabels = allNodes
    .filter(n => hop2NodeIds.has(n.id))
    .map(n => (n.label || '').toLowerCase());

  // --- LIVELLO 2: Recupero Fatti Atomici Attivi (Mem0) ---
  const allActiveFacts = store.getActiveFacts();
  let activeFacts = allActiveFacts.filter(f => {
    const s = (f.subject || '').toLowerCase();
    const k = (f.fact_key || '').toLowerCase();
    const v = (f.fact_value || '').toLowerCase();
    if (!cleanQuery) return true;
    if (lowerQuery.includes(s) || expandedEntityLabels.includes(s)) return true;
    return queryTokens.some(tok => s.includes(tok) || k.includes(tok) || v.includes(tok));
  });

  // Se la query è generica e non ha match puntuali ma ci sono fatti attivi, restituisce i più recenti
  if (activeFacts.length === 0 && allActiveFacts.length > 0 && queryTokens.length === 0) {
    activeFacts = allActiveFacts.slice(0, limit);
  }

  // --- LIVELLO 1: Ricerca Ibrida Memorie Semantiche (Cosine Similarity + BM25-like Lexical Ranking) ---
  const queryEmb = cleanQuery ? await generateEmbeddingDetailed(cleanQuery) : null;
  const queryEmbedding = queryEmb ? queryEmb.values : null;
  const candidateMemories = store.getMemoriesByDomain(domain);

  const scoredMemories = candidateMemories.map(mem => {
    const titleLower = (mem.title || '').toLowerCase();
    const contentLower = (mem.content || '').toLowerCase();
    const tagsLower = (mem.tags || []).map(t => t.toLowerCase());

    let lexicalScore = 0;
    for (const tok of queryTokens) {
      if (titleLower.includes(tok)) lexicalScore += 0.35;
      if (contentLower.includes(tok)) lexicalScore += 0.2;
      if (tagsLower.some(t => t.includes(tok))) lexicalScore += 0.3;
    }

    for (const entLabel of expandedEntityLabels) {
      if (entLabel && contentLower.includes(entLabel)) {
        lexicalScore += 0.15;
      }
    }

    let vectorScore = 0;
    // Si confrontano solo vettori della stessa sorgente (Gemini con Gemini, locale con locale)
    if (queryEmbedding && Array.isArray(mem.embedding) && (mem.embedding_source || 'local') === queryEmb.source) {
      vectorScore = Math.max(0, cosineSimilarity(queryEmbedding, mem.embedding));
    }

    const totalScore = cleanQuery ? Number((lexicalScore + vectorScore * 0.65).toFixed(4)) : 1;
    return {
      ...mem,
      similarity: totalScore,
      vectorScore: Number(vectorScore.toFixed(4)),
      lexicalScore: Number(lexicalScore.toFixed(4)),
    };
  });

  const relevantMemories = scoredMemories
    .filter(m => !cleanQuery || m.lexicalScore > 0 || m.vectorScore > 0.12)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  // --- SINTESI COGNITIVA (Hybrid GraphRAG Context) ---
  const contextLines = [];
  if (activeFacts.length > 0) {
    contextLines.push(
      `📌 FATTI ATTIVI (Mem0 State):\n` +
        activeFacts.map(f => `- [${f.subject}] ${f.fact_key} = ${f.fact_value} (${f.category})`).join('\n')
    );
  }
  if (graphConnections.length > 0) {
    contextLines.push(
      `🕸️ CONNESSIONI KNOWLEDGE GRAPH (fino a 2 Hop):\n` +
        graphConnections
          .map(e => `- [${e.source_label}] ──(${e.relation_type})──> [${e.target_label}] (Hop ${e.hop}, peso ${e.weight})`)
          .join('\n')
    );
  }
  if (relevantMemories.length > 0) {
    contextLines.push(
      `📚 MEMORIE SEMANTICHE RILEVANTI:\n` +
        relevantMemories.map(m => `- (${m.domain}) ${m.title}: ${m.content}`).join('\n')
    );
  }

  const synthesizedContext = contextLines.length > 0
    ? contextLines.join('\n\n')
    : 'Nessuna informazione specifica trovata nel Second Brain per questa query.';

  return {
    query: cleanQuery,
    relevantMemories,
    activeFacts,
    graphConnections,
    synthesizedContext,
  };
}

/**
 * AUTO-SYNC CON IL GESTIONALE: Sincronizza un Cliente (stack, repo, URL, canone MRR) nel Second Brain
 */
export function syncClientToBrain(client) {
  if (!client || client.is_deleted || isSyncingEntity) return;
  isSyncingEntity = true;
  try {
    const clientName = client.company_name || `${client.first_name || ''} ${client.last_name || ''}`.trim();
    if (!clientName) return;

    // Nodo Cliente e relazione con Antonio
    upsertNode({
      label: clientName,
      node_type: 'client',
      properties: { client_id: client.id, email: client.email || '' },
    });

    upsertGraphRelationship({
      source: 'Antonio',
      source_type: 'person',
      target: clientName,
      target_type: 'client',
      relation_type: 'LAVORA_CON',
      evidence: 'Anagrafica Clienti Gestionale',
    });

    // Stack tecnologico -> Fatto Mem0 + Nodi Tecnologici nel Grafo
    if (client.stack && String(client.stack).trim()) {
      upsertFact({
        subject: clientName,
        fact_key: 'stack_principale',
        fact_value: String(client.stack).trim(),
        category: 'client_info',
      });

      const techs = String(client.stack)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      for (const tech of techs) {
        upsertGraphRelationship({
          source: clientName,
          source_type: 'client',
          target: tech,
          target_type: 'technology',
          relation_type: 'USA_TECNOLOGIA',
          evidence: `Stack dichiarato su scheda cliente ${clientName}`,
        });
      }
    }

    // Repository GitHub
    if (client.github_repo && String(client.github_repo).trim()) {
      upsertFact({
        subject: clientName,
        fact_key: 'github_repo',
        fact_value: String(client.github_repo).trim(),
        category: 'client_info',
      });
    }

    // URL Produzione e Staging
    if (client.production_url && String(client.production_url).trim()) {
      upsertFact({
        subject: clientName,
        fact_key: 'production_url',
        fact_value: String(client.production_url).trim(),
        category: 'client_info',
      });
    }
    if (client.staging_url && String(client.staging_url).trim()) {
      upsertFact({
        subject: clientName,
        fact_key: 'staging_url',
        fact_value: String(client.staging_url).trim(),
        category: 'client_info',
      });
    }

    // Calcolo MRR attivo dai contratti di manutenzione
    const contracts = Array.isArray(client.maintenance_contracts) ? client.maintenance_contracts : [];
    const activeContracts = contracts.filter(c => c.status === 'active');
    if (activeContracts.length > 0) {
      const mrr = activeContracts.reduce((sum, c) => {
        const val = Number(c.amount) || 0;
        if (c.frequency === 'annual') return sum + val / 12;
        if (c.frequency === 'quarterly') return sum + val / 3;
        return sum + val;
      }, 0);
      upsertFact({
        subject: clientName,
        fact_key: 'canone_mrr',
        fact_value: `${mrr.toFixed(2).replace(/\.00$/, '')}€/mese`,
        category: 'client_info',
      });
    }
  } finally {
    isSyncingEntity = false;
  }
}

/**
 * AUTO-SYNC CON IL GESTIONALE: Sincronizza un To-do completato o importante nel Second Brain
 */
export function syncTodoToBrain(todo) {
  if (!todo || todo.is_deleted || isSyncingEntity) return;
  if (!todo.is_completed && todo.priority !== 'urgente' && todo.priority !== 'alta') return;

  isSyncingEntity = true;
  try {
    const client = todo.client_id ? store.getById('clients', todo.client_id) : null;
    const subject = client
      ? client.company_name || `${client.first_name || ''} ${client.last_name || ''}`.trim()
      : 'Antonio';

    if (todo.is_completed) {
      upsertFact({
        subject,
        fact_key: 'ultimo_task_completato',
        fact_value: todo.title,
        category: 'status',
      });
    }
  } finally {
    isSyncingEntity = false;
  }
}

/**
 * AUTO-SYNC CON IL MODULO BODY: Sincronizza la riga giornaliera (Peso, Sonno, Kcal, Macro) nel Second Brain
 */
export function syncBodyDailyLogToBrain(dailyLog) {
  if (!dailyLog || dailyLog.is_deleted || isSyncingEntity) return;
  isSyncingEntity = true;
  try {
    if (Number(dailyLog.body_weight_kg) > 0) {
      upsertFact({
        subject: 'Antonio',
        fact_key: 'peso_corporeo',
        fact_value: `${Number(dailyLog.body_weight_kg).toFixed(1)} kg`,
        category: 'metric',
      });
      upsertNode({
        label: 'Peso Corporeo',
        node_type: 'biometric',
        properties: { latest_kg: Number(dailyLog.body_weight_kg), date: dailyLog.date },
      });
    }

    if (Number(dailyLog.sleep_hours) > 0) {
      upsertFact({
        subject: 'Antonio',
        fact_key: 'sonno_ore',
        fact_value: `${Number(dailyLog.sleep_hours)} h`,
        category: 'metric',
      });
      upsertNode({
        label: 'Sonno',
        node_type: 'biometric',
        properties: { latest_hours: Number(dailyLog.sleep_hours), date: dailyLog.date },
      });
    }

    if (Number(dailyLog.calories_kcal) > 0) {
      upsertFact({
        subject: 'Antonio',
        fact_key: 'apporto_calorico',
        fact_value: `${Number(dailyLog.calories_kcal)} kcal`,
        category: 'metric',
      });
    }

    if (Number(dailyLog.protein_g) > 0 || Number(dailyLog.carbs_g) > 0 || Number(dailyLog.fat_g) > 0) {
      const p = Number(dailyLog.protein_g) || 0;
      const c = Number(dailyLog.carbs_g) || 0;
      const f = Number(dailyLog.fat_g) || 0;
      upsertFact({
        subject: 'Antonio',
        fact_key: 'macronutrienti_giornalieri',
        fact_value: `Proteine ${p}g • Carboidrati ${c}g • Grassi ${f}g`,
        category: 'metric',
      });
    }
  } finally {
    isSyncingEntity = false;
  }
}

/**
 * AUTO-SYNC CON IL MODULO BODY: Sincronizza una cella d'allenamento (Esercizio, Carico, Serie, Varianti, Singolo Arto) nel Second Brain
 */
export function syncBodyWorkoutEntryToBrain(entry) {
  if (!entry || entry.is_deleted || !entry.raw_notation || isSyncingEntity) return;
  isSyncingEntity = true;
  try {
    const columns = store.getBodyColumns();
    const col = columns.find(c => c.id === entry.column_id);
    const colName = col ? col.name : 'Esercizio';
    const colSlug = (col?.slug || colName).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

    const parsed = Array.isArray(entry.parsed_blocks) && entry.parsed_blocks.length > 0
      ? {
          blocks: entry.parsed_blocks,
          summary_label: entry.parsed_blocks.map(b => b.display_label).join(' + '),
        }
      : parseWorkoutNotation(entry.raw_notation, col?.category || 'pull');

    // Nodo esercizio e legame con Antonio
    upsertGraphRelationship({
      source: 'Antonio',
      source_type: 'person',
      target: colName,
      target_type: 'exercise',
      relation_type: 'PRATICA',
      evidence: `Sessione del ${entry.date}: ${entry.raw_notation}`,
    });

    // Fatto complessivo per la colonna esercizio
    upsertFact({
      subject: 'Allenamento',
      fact_key: colSlug,
      fact_value: parsed.summary_label || entry.raw_notation,
      category: 'metric',
    });

    // Fatti atomici per ciascun blocco/variante (es. Pull Up Standard, Stacchi Singolo Arto)
    for (const block of parsed.blocks || []) {
      const varSlug = (block.variant_name || 'standard').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const uniSlug = block.unilateral ? '_singolo_arto' : '';
      const key = `${colSlug}_${varSlug}${uniSlug}`;

      let valStr = '';
      if (block.type === 'cardio') {
        valStr = block.display_label || block.activity_name;
      } else {
        const loadPart = block.load_kg > 0 ? `${block.load_kg}kg ` : 'Corpo libero ';
        const setsPart = `(${(block.sets || []).join(', ')})`;
        const modePart = block.unilateral ? ' • Singolo Arto' : '';
        valStr = `${loadPart}${setsPart}${modePart}`;
      }

      upsertFact({
        subject: 'Allenamento',
        fact_key: key,
        fact_value: valStr.trim(),
        category: 'metric',
      });

      if (block.variant_name && block.variant_name !== 'Standard') {
        upsertGraphRelationship({
          source: colName,
          source_type: 'exercise',
          target: block.variant_name,
          target_type: 'exercise',
          relation_type: 'VARIANTE',
          evidence: `${colName}: ${valStr}`,
        });
      }
    }

    // Se sono presenti note tecniche o fastidi, crea relazione nel Knowledge Graph
    if (entry.feeling === 'dolore_fastidio' || (entry.detailed_notes && /dolore|fastidio|tensione|affaticamento/i.test(entry.detailed_notes))) {
      const issueLabel = entry.detailed_notes ? entry.detailed_notes.slice(0, 60) : `Fastidio in ${colName}`;
      upsertGraphRelationship({
        source: colName,
        source_type: 'exercise',
        target: issueLabel,
        target_type: 'issue',
        relation_type: 'CAUSA',
        evidence: `Rilevato il ${entry.date}`,
      });
    }
  } finally {
    isSyncingEntity = false;
  }
}

/**
 * Analisi Cognitiva Incrociata (Body + Second Brain):
 * Incrocia Sonno, Kcal/Macro, Peso e Progressioni negli esercizi per generare insight operativi
 */
export function analyzeBodyWithSecondBrain() {
  const columns = store.getBodyColumns();
  const dailyLogs = store.getAll('body_daily_logs');
  const workoutEntries = store.getAll('body_workout_entries');
  const trends = calculateBodyTrends(dailyLogs, workoutEntries, columns);

  const recoveryStatuses = columns.map(col => ({
    column: col,
    recovery: calculateColumnRecoveryStatus(col.id, workoutEntries, col.target_frequency_days || 3),
  }));

  const recommendedToday = recoveryStatuses
    .filter(r => r.recovery.isRecommendedToday)
    .map(r => `${r.column.name} (${r.recovery.shortBadge})`);

  const insights = [];

  if (trends.avgWeight7d !== null) {
    const deltaStr = trends.weightDelta7d > 0
      ? `+${trends.weightDelta7d} kg`
      : `${trends.weightDelta7d} kg`;
    insights.push(
      `⚖️ **Trend Peso Corporeo (Media Mobile 7gg):** **${trends.avgWeight7d} kg** (${deltaStr} rispetto alla settimana precedente).`
    );
  }

  if (trends.avgSleep7d !== null) {
    const sleepMsg = trends.avgSleep7d < 7
      ? `⚠️ Media sonno sotto le 7 ore (${trends.avgSleep7d} h): considera di gestire il buffer (RPE ≤ 8) sui fondamentali pesanti.`
      : `✅ Ottimo recupero neurale: media sonno di **${trends.avgSleep7d} h** negli ultimi 7 giorni.`;
    insights.push(`😴 **Sonno & Recupero:** ${sleepMsg}`);
  }

  if (trends.avgCalories7d !== null) {
    insights.push(
      `🍽️ **Bilancio Nutrizionale & Macro (Media 7gg):** **${trends.avgCalories7d} kcal/giorno** — Proteine: **${trends.avgProtein7d || 0}g**, Carboidrati: **${trends.avgCarbs7d || 0}g**, Grassi: **${trends.avgFat7d || 0}g**.`
    );
  }

  if (recommendedToday.length > 0) {
    insights.push(
      `🎯 **Focus Consigliato Oggi (Finestra 2-3+ giorni):** ${recommendedToday.join(' • ')}.`
    );
  }

  // Top PR / Progressioni recenti
  const prHighlights = [];
  for (const col of columns) {
    const prog = trends.exerciseProgressions[col.id];
    if (prog && prog.sessions_count > 0 && prog.latest_session) {
      prHighlights.push(
        `**${col.name}**: ultima sessione \`${prog.latest_session.raw_notation}\` (Picco carico: ${prog.max_load_kg} kg • Max rep: ${prog.max_total_reps} tot)`
      );
    }
  }
  if (prHighlights.length > 0) {
    insights.push(`📈 **Stato Progressioni Attive:** ${prHighlights.join(' | ')}.`);
  }

  return {
    trends,
    recoveryStatuses,
    recommendedToday,
    insights,
    summaryText: insights.join('\n'),
  };
}

// Registra l'hook automatico sullo store per mantenere sincronizzati Clienti, To-do e Modulo Body col Second Brain
store.onEntityChange((collection, _action, item) => {
  if (collection === 'clients') {
    syncClientToBrain(item);
  } else if (collection === 'todos') {
    syncTodoToBrain(item);
  } else if (collection === 'body_daily_logs') {
    syncBodyDailyLogToBrain(item);
  } else if (collection === 'body_workout_entries') {
    syncBodyWorkoutEntryToBrain(item);
  }
});
