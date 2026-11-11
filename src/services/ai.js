// src/services/ai.js
// Gestione richieste AI (Gemini Edge Function con fallback euristico locale se non configurata)
// + Profili di Prompt Specializzati (Agent Personas), modalità "Avvocato del Diavolo" e Ingestion Batch.

import { store } from './store.js';
import { aiGenerate, isAiConfigured } from './ai-client.js';
import { querySecondBrain } from './brain.js';
import { DEFAULT_BODY_COLUMNS, parseWorkoutNotation } from '../utils/body-parser.js';
import {
  normalizeTradingItem,
  normalizeTransaction,
  localTodayIso,
  addDaysIso,
  EXPENSE_CATEGORIES,
} from './finances.js';
import {
  buildDevilsAdvocateEvidence,
  buildDevilsAdvocateReport,
  formatDevilsEvidence,
  QUOTE_RISK_BUFFER,
} from './devils-advocate.js';

// ---------------------------------------------------------------------------
// PROFILI SPECIALIZZATI (AGENT PERSONAS)
// ---------------------------------------------------------------------------

export const AI_PROFILES = {
  ingestion_batch: {
    id: 'ingestion_batch',
    label: 'Ingestion Batch',
    icon: '⚡',
    description: 'Estrazione multi-intent compatta da una coda di appunti, in una sola chiamata.',
    temperature: 0.05,
    style: 'extraction',
    systemPrompt: [
      'Sei un motore di ESTRAZIONE BATCH. Ricevi N appunti numerati raccolti nell’arco della giornata (pensieri, spese, incassi, allenamenti, note su clienti).',
      '1. Elabora TUTTI gli appunti in un’unica risposta: ogni appunto può generare più azioni (multi-intent) in sezioni diverse.',
      '2. Output compatto: zero convenevoli, zero spiegazioni, nessun testo fuori dal JSON.',
      '3. Smistamento: allenamenti/peso/sonno/kcal → body_log (notazione compatta, es. 20(10,10,10,10)); spese e incassi → finance_transactions (importo sempre positivo, type income|expense); acquisti/vendite online → trading_items; attività → todos; incontri/rilasci/scadenze → appointments; nuovi clienti → clients_to_create.',
      '4. Più note sullo stesso tema (es. più pasti) vanno sommate/unite nello stesso record, non duplicate.',
      '5. Non inventare dati mancanti: lascia null o ometti il campo.',
      '6. "summary" = una riga per appunto nel formato "n → destinazione", niente altro.',
    ].join('\n'),
  },
  devils_advocate: {
    id: 'devils_advocate',
    label: 'Avvocato del Diavolo',
    icon: '😈',
    description: 'Socio critico: contesta preventivi, margini di compravendita e carichi di allenamento.',
    temperature: 0.3,
    style: 'critique',
    systemPrompt: [
      'Sei il SOCIO CRITICO dell’utente: l’AVVOCATO DEL DIAVOLO. Non sei qui per compiacere ma per evitare errori costosi. Tono diretto, numerico, senza giri di parole; contesta le assunzioni, quantifica i rischi e proponi sempre un’alternativa concreta.',
      'PREVENTIVI: interroga lo storico dei progetti simili nel Second Brain e nelle evidenze; evidenzia scadenze irrealistiche (ore implicite = importo / tariffa dev oraria, contro le ore produttive disponibili); metti in guardia su revisioni infinite non pagate; suggerisci un buffer di rischio del +' + QUOTE_RISK_BUFFER.minPercent + '-' + QUOTE_RISK_BUFFER.maxPercent + '% e pagamenti a milestone.',
      'COMPRAVENDITA: calcola il profitto ORARIO REALE = utile netto (già al netto di commissioni e spese extra) / ore impiegate, e confrontalo con la tariffa oraria da sviluppatore; segnala capitale immobilizzato e articoli fermi.',
      'BODY: incrocia ore di sonno e semaforo di recupero (finestra 48-72h per gruppo muscolare); metti in guardia contro overtraining e infortuni da carichi eccessivi quando il sonno è scarso.',
      'Non creare to-do, eventi o clienti: lascia le liste vuote e compila il campo "critique" con { verdict, risks[], recommendations[], buffer_percent, hourly_profit }. Basa ogni numero sulle EVIDENZE fornite; se un dato manca, dillo.',
    ].join('\n'),
  },
  nutrition_fitness: {
    id: 'nutrition_fitness',
    label: 'Nutrizione & Fitness',
    icon: '🥗',
    description: 'Analisi nutrizionale, scomposizione dei pasti e stima di calorie/macro.',
    temperature: 0.1,
    style: 'extraction',
    systemPrompt: [
      'Sei un coach di NUTRIZIONE e FITNESS. Scomponi ogni pasto in alimenti e porzioni, stima calorie e macro (proteine, carboidrati, grassi) con valori realistici e dichiara l’incertezza quando stimi.',
      'Somma i pasti della stessa giornata nello stesso body_log. Per gli allenamenti usa la notazione compatta della Matrice (es. 20(10,10,10,10), Presa Larga 15(8,7), Singolo Arto 10(12,12)).',
      'Nel "summary" riporta totale kcal e macro del giorno in una riga.',
    ].join('\n'),
  },
  finance_coach: {
    id: 'finance_coach',
    label: 'Finance Coach',
    icon: '💶',
    description: 'Analisi di marginalità e cash flow su entrate, uscite, ricorrenze e compravendita.',
    temperature: 0.1,
    style: 'extraction',
    systemPrompt: [
      'Sei un FINANCE COACH per un libero professionista. Registra entrate e uscite in finance_transactions (importo positivo + type) e le operazioni di compravendita in trading_items.',
      'Ragiona su marginalità e cash flow: separa costi fissi ricorrenti da spese una tantum, evidenzia margine netto e ROI % delle rivendite (netto = vendita - acquisto - extra - commissioni; ROI = netto / (acquisto + extra)).',
      'Categorie spesa consigliate: ' + EXPENSE_CATEGORIES.join(', ') + '. Nel "summary" riporta il saldo netto delle operazioni estratte.',
    ].join('\n'),
  },
  general_brain: {
    id: 'general_brain',
    label: 'Second Brain Generale',
    icon: '🧠',
    description: 'Assistente generale con navigazione a 2 hop nel Knowledge Graph.',
    temperature: 0.1,
    style: 'extraction',
    systemPrompt: [
      'Sei l’assistente del SECOND BRAIN. Sfrutta il contesto fornito (Fatti Mem0 attivi, Knowledge Graph navigato fino a 2 hop, memorie semantiche) per collegare la richiesta a clienti, progetti e fatti già noti prima di proporre azioni.',
      'Quando un fatto nuovo contraddice uno attivo, segnalalo nel "summary" (verrà storicizzato). Non inventare relazioni non supportate dal contesto.',
    ].join('\n'),
  },
};

// Modulo attivo dell'app -> profilo più adatto (fallback: general_brain)
export const MODULE_PROFILE_MAP = {
  body: 'nutrition_fitness',
  finances: 'finance_coach',
  expenses: 'finance_coach',
  reports: 'finance_coach',
  quotes: 'finance_coach',
  brain: 'general_brain',
};

/**
 * Seleziona il profilo: profilo esplicito > toggle Avvocato del Diavolo > modulo attivo > general_brain.
 * @returns {string} id del profilo
 */
export function selectAiProfile({ profile = null, devilsAdvocate = false, activeModule = null } = {}) {
  if (profile && AI_PROFILES[profile]) return profile;
  if (devilsAdvocate) return 'devils_advocate';
  if (activeModule && MODULE_PROFILE_MAP[activeModule]) return MODULE_PROFILE_MAP[activeModule];
  return 'general_brain';
}

const BASE_SCHEMA_PROMPT = (payload, clientsListStr) => `
Sei l'assistente operativo, on-boarding e bio-tracker per un software engineer/sviluppatore freelance.
Il tuo compito è analizzare la richiesta (anche note informali, audio trascritto, descrizioni di clienti o diario Body di allenamento/nutrizione) ed estrarre:
1. "clients_to_create": se l'utente descrive un cliente da registrare/importare (nome, azienda, email, telefono, staging_url, production_url, github_repo, stack tecnologico, canone di manutenzione mensile/annuale, note).
2. "todos": attività operative e to-do da svolgere.
3. "appointments": appuntamenti, rilasci/deploy, demo sprint, call tecniche o scadenze server/domini.
4. "body_log": se l'utente menziona peso corporeo, ore di sonno, calorie/macronutrienti (proteine, carbo, grassi) o esercizi svolti (Pull Up, Dips, Push Up, Affondi, Squat / Sissy, Femo, Stacchi, Cardio & Sport con notazione es. "30(7,8,8) + Presa Larga (15,15)", "Singolo Arto 10(12,12)").
5. "finance_transactions": entrate (incassi, pagamenti ricevuti, vendite) e uscite (spese, abbonamenti, acquisti) con importo SEMPRE positivo e type "income"|"expense".
6. "trading_items": acquisti/vendite di compravendita online (Vinted, Subito, eBay) con prezzi di acquisto, spese extra, commissioni e prezzo di vendita.

Data odierna: ${payload.currentDateIso}
Fuso orario: ${payload.timezone}
Modulo attivo nell'app: ${payload.activeModule || 'n.d.'}
Clienti già esistenti:
${clientsListStr}

Contesto Second Brain (Fatti Mem0, Memorie Semantiche e Knowledge Graph):
${payload.secondBrainContext || 'Nessun contesto preliminare'}

SCHEMA JSON DA RESTITUIRE OBBLIGATORIAMENTE (e nient'altro):
{
  "summary": "Breve riassunto dell'azione",
  "clients_to_create": [
    {
      "company_name": "string",
      "first_name": "string",
      "last_name": "string",
      "email": "string",
      "phone": "string",
      "staging_url": "string",
      "production_url": "string",
      "github_repo": "string",
      "stack": "string",
      "maintenance_amount": 0,
      "maintenance_frequency": "monthly"|"quarterly"|"annual",
      "notes": "string"
    }
  ],
  "todos": [
    { "title": "string", "notes": "string", "client_id": "string|null", "client_name_proposed": "string", "due_date": "YYYY-MM-DDTHH:mm:ss|null", "priority": "bassa"|"media"|"alta"|"urgente", "compensation_amount": 0 }
  ],
  "appointments": [
    { "title": "string", "description": "string", "location": "string", "client_id": "string|null", "client_name_proposed": "string", "start_time": "YYYY-MM-DDTHH:mm:ss", "end_time": "string|null", "is_all_day": false, "activity_type": "deploy"|"demo"|"call"|"server_deadline"|"general", "compensation_amount": 0 }
  ],
  "body_log": {
    "date": "YYYY-MM-DD",
    "sleep_hours": null,
    "body_weight_kg": null,
    "calories_kcal": null,
    "protein_g": null,
    "carbs_g": null,
    "fat_g": null,
    "workout_entries": [
      { "column_slug": "pull_up|dips|push_up|lunges|squat_sissy|hamstrings|deadlift|cardio_sport", "column_name": "string", "raw_notation": "string" }
    ]
  },
  "finance_transactions": [
    { "type": "income"|"expense", "amount": 0, "description": "string", "category": "string", "date": "YYYY-MM-DD", "client_id": "string|null", "payment_method": "bonifico"|"carta"|"contanti"|"paypal"|"addebito"|"altro" }
  ],
  "trading_items": [
    { "title": "string", "platform": "Vinted"|"Subito"|"eBay"|"Altro", "purchase_price": 0, "extra_costs": 0, "platform_fees": 0, "sale_price": null, "status": "in_stock"|"reserved"|"sold" }
  ],
  "critique": null
}
Per il profilo "Avvocato del Diavolo" compila "critique": { "verdict": "string", "risks": ["string"], "recommendations": ["string"], "buffer_percent": { "min": 0, "max": 0 }|null, "hourly_profit": 0|null } e lascia vuote le altre liste.
`;

/**
 * Compone il PAYLOAD DI SISTEMA: dati della richiesta + profilo selezionato + (se attivo) evidenze dell'Avvocato del Diavolo.
 * Funzione pura rispetto alla rete: testabile senza chiamare alcun modello.
 */
export function buildAiPayload({
  prompt,
  imageBase64,
  imageMimeType,
  audioBase64,
  audioMimeType,
  existingClients = [],
  brainContext = null,
  preselectedClientId = null,
  profile: explicitProfile = null,
  devilsAdvocate = false,
  activeModule = null,
  batchNotes = null,
  timezone = 'Europe/Rome',
} = {}) {
  const profileId = selectAiProfile({ profile: explicitProfile, devilsAdvocate, activeModule });
  const profile = AI_PROFILES[profileId];

  const payload = {
    prompt,
    imageBase64,
    imageMimeType,
    audioBase64,
    audioMimeType,
    existingClients,
    secondBrainContext: brainContext?.synthesizedContext || '',
    currentDateIso: new Date().toISOString(),
    timezone,
    preselectedClientId,
    activeModule,
    batchNotes: Array.isArray(batchNotes) ? batchNotes : null,
    profile: profileId,
    profileLabel: profile.label,
    devilsAdvocate: profileId === 'devils_advocate',
    temperature: profile.temperature,
  };

  let evidenceText = '';
  if (profileId === 'devils_advocate') {
    payload.devilsEvidence = buildDevilsAdvocateEvidence({ activeModule, prompt });
    evidenceText = formatDevilsEvidence(payload.devilsEvidence);
    payload.devilsEvidenceText = evidenceText;
  }
  payload.personaInstruction = evidenceText ? `${profile.systemPrompt}\n\n${evidenceText}` : profile.systemPrompt;
  return payload;
}

/** Istruzione di sistema completa (schema di estrazione + profilo attivo + evidenze). */
export function composeSystemInstruction(payload) {
  const existingClients = payload.existingClients || [];
  const clientsListStr = existingClients.length > 0
    ? existingClients.map(c => `- ID: "${c.id}", Nome: "${c.name}"`).join('\n')
    : 'Nessun cliente registrato.';
  const profile = AI_PROFILES[payload.profile] || AI_PROFILES.general_brain;

  return `${BASE_SCHEMA_PROMPT(payload, clientsListStr)}
=== PROFILO ATTIVO: ${profile.icon} ${profile.label} ===
${payload.personaInstruction || profile.systemPrompt}
`;
}

/**
 * Elabora una richiesta con il profilo adatto.
 * Ordine: Edge Function Supabase → Gemini diretto (chiave utente) → euristica locale a zero token.
 */
export async function processAiPrompt({
  prompt,
  imageBase64,
  imageMimeType,
  audioBase64,
  audioMimeType,
  preselectedClientId = null,
  existingClients: passedClients = null,
  profile = null,
  devilsAdvocate = false,
  activeModule = null,
  batchNotes = null,
}) {
  const settings = store.getSettings();
  const allClients = store.getAll('clients');

  const existingClients = Array.isArray(passedClients) && passedClients.length > 0
    ? passedClients
    : allClients.map(c => ({
        id: c.id,
        name: c.company_name || `${c.first_name} ${c.last_name}`.trim(),
      }));

  // Recupera il contesto cognitivo ibrido dal Second Brain (Livello 1 + 2 + 3)
  const brainContext = await querySecondBrain(prompt || '');

  const payload = buildAiPayload({
    prompt,
    imageBase64,
    imageMimeType,
    audioBase64,
    audioMimeType,
    existingClients,
    brainContext,
    preselectedClientId,
    profile,
    devilsAdvocate,
    activeModule,
    batchNotes,
    timezone: settings.timezone || 'Europe/Rome',
  });
  const normalizeOptions = { profile: payload.profile, devilsEvidence: payload.devilsEvidence };
  const finish = (res, source, aiError = null) => {
    // L'Avvocato del Diavolo critica, non propone: scarta qualunque azione operativa restituita dal modello
    const base = payload.profile === 'devils_advocate'
      ? { ...res, clients_to_create: [], todos: [], appointments: [], body_log: null, finance_transactions: [], trading_items: [] }
      : res;
    return {
      ...base,
      brainContext,
      profile: payload.profile,
      source,
      engine: source === 'local_heuristic' ? 'local' : 'ai',
      // Se l'IA non ha risposto il motivo è SEMPRE riportato (l'interfaccia lo mostra): niente fallback silenzioso
      aiError: aiError ? { code: aiError.code || 'unavailable', message: aiError.message } : null,
      aiCalls: source === 'local_heuristic' ? 0 : 1,
    };
  };

  const localFallback = (aiError) => {
    if (payload.profile === 'devils_advocate') return finish(localDevilsAdvocate(payload), 'local_heuristic', aiError);
    if (payload.profile === 'ingestion_batch' && Array.isArray(payload.batchNotes) && payload.batchNotes.length > 0) {
      return finish(localBatchParser(payload.batchNotes, existingClients, preselectedClientId), 'local_heuristic', aiError);
    }
    return finish(localHeuristicParser(prompt, existingClients, preselectedClientId), 'local_heuristic', aiError);
  };

  if (!isAiConfigured()) {
    return localFallback({ code: 'not_configured', message: 'IA non configurata: uso regole semplici (zero token).' });
  }

  try {
    const parts = [{ text: `Richiesta utente:\n${payload.prompt || ''}` }];
    if (payload.imageBase64) parts.push({ inline_data: { mime_type: payload.imageMimeType || 'image/jpeg', data: payload.imageBase64 } });
    if (payload.audioBase64) parts.push({ inline_data: { mime_type: payload.audioMimeType || 'audio/webm', data: payload.audioBase64 } });

    const { data, via } = await aiGenerate({
      system: composeSystemInstruction(payload),
      parts,
      temperature: payload.temperature ?? 0.1,
      json: true,
    });
    return finish(normalizeAiResponse(data, existingClients, preselectedClientId, normalizeOptions), via === 'edge' ? 'edge_function' : 'gemini_direct');
  } catch (err) {
    console.warn('IA non disponibile:', err.code, err.message);
    return localFallback(err);
  }
}

// ---------------------------------------------------------------------------
// CODA APPUNTI: Ingestion Batching (N note → 1 sola chiamata)
// ---------------------------------------------------------------------------

function formatNoteTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Concatena le note accumulate in un unico prompt numerato. */
export function buildBatchPrompt(notes = []) {
  const lines = notes.map((n, i) => `[${i + 1}] ${formatNoteTime(n.created_at)}${n.source === 'telegram' ? ' (Telegram)' : ''} — ${String(n.content || '').trim()}`);
  return [
    `CODA APPUNTI DEL GIORNO — ${notes.length} ${notes.length === 1 ? 'nota' : 'note'} da elaborare in un’unica passata:`,
    ...lines,
  ].join('\n');
}

/**
 * Elabora tutte le note in coda con UNA sola chiamata (profilo `ingestion_batch`).
 * Non segna le note come elaborate: lo fa il chiamante dopo la conferma (UI) o l’applicazione (Telegram).
 */
export async function processNoteQueueBatch(notes = store.getQueuedNotes(), options = {}) {
  if (!Array.isArray(notes) || notes.length === 0) {
    return { ok: false, empty: true, notesCount: 0, noteIds: [], aiCalls: 0 };
  }
  const result = await processAiPrompt({
    ...options,
    prompt: buildBatchPrompt(notes),
    profile: 'ingestion_batch',
    batchNotes: notes.map(n => n.content),
  });
  return { ok: true, ...result, notesCount: notes.length, noteIds: notes.map(n => n.id) };
}

function mergeBodyLogs(logs) {
  const valid = logs.filter(Boolean);
  if (valid.length === 0) return null;
  // Se le note riguardano giorni diversi, il body_log proposto è quello più recente
  const latestDate = valid.map(l => l.date).sort().pop();
  const sameDay = valid.filter(l => l.date === latestDate);

  const sumField = (key) => {
    const values = sameDay.map(l => l[key]).filter(v => v != null);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  };
  const lastField = (key) => {
    const values = sameDay.map(l => l[key]).filter(v => v != null);
    return values.length > 0 ? values[values.length - 1] : null;
  };

  const byColumn = new Map();
  for (const log of sameDay) {
    for (const entry of log.workout_entries || []) {
      const prev = byColumn.get(entry.column_id);
      byColumn.set(entry.column_id, prev ? { ...prev, raw_notation: `${prev.raw_notation} + ${entry.raw_notation}` } : { ...entry });
    }
  }
  const workout_entries = Array.from(byColumn.values()).map(entry => {
    const parsed = parseWorkoutNotation(entry.raw_notation, entry.category || 'pull');
    return { ...entry, raw_notation: parsed.normalized_notation || entry.raw_notation, parsed_blocks: parsed.blocks };
  });

  return {
    date: latestDate,
    sleep_hours: lastField('sleep_hours'),
    body_weight_kg: lastField('body_weight_kg'),
    // Più note nella stessa giornata = più pasti: kcal e macro si sommano
    calories_kcal: sumField('calories_kcal'),
    protein_g: sumField('protein_g'),
    carbs_g: sumField('carbs_g'),
    fat_g: sumField('fat_g'),
    workout_entries,
  };
}

/** Parser locale della coda: applica l'euristica a ogni nota e unisce i risultati (zero token). */
function localBatchParser(noteTexts, existingClients, preselectedClientId) {
  const merged = {
    summary: '',
    clients_to_create: [],
    todos: [],
    appointments: [],
    body_log: null,
    finance_transactions: [],
    trading_items: [],
    critique: null,
  };
  const bodyLogs = [];
  const routing = [];

  noteTexts.forEach((text, idx) => {
    const r = localHeuristicParser(text, existingClients, preselectedClientId);
    merged.clients_to_create.push(...r.clients_to_create);
    merged.todos.push(...r.todos);
    merged.appointments.push(...r.appointments);
    merged.finance_transactions.push(...(r.finance_transactions || []));
    merged.trading_items.push(...(r.trading_items || []));
    if (r.body_log) bodyLogs.push(r.body_log);

    const dest = [];
    if (r.body_log) dest.push('Body');
    if ((r.finance_transactions || []).length) dest.push('Finanze');
    if ((r.trading_items || []).length) dest.push('Compravendita');
    if (r.todos.length) dest.push('To-do');
    if (r.appointments.length) dest.push('Agenda');
    if (r.clients_to_create.length) dest.push('Cliente');
    routing.push(`${idx + 1} → ${dest.length ? dest.join(' + ') : 'Second Brain'}`);
  });

  merged.body_log = mergeBodyLogs(bodyLogs);
  merged.summary = `Coda elaborata in 1 passata (${noteTexts.length} note): ${routing.join(' · ')}`;
  return merged;
}

/**
 * Applica direttamente un risultato di estrazione allo store (usato dal comando Telegram /digest,
 * dove non c'è anteprima: l'utente ha richiesto esplicitamente l'elaborazione).
 * I nuovi clienti NON vengono creati automaticamente: restano da confermare nell'app.
 */
export function applyAiResultToStore(result = {}) {
  const applied = { body: false, workouts: 0, finance: 0, trading: 0, todos: 0, appointments: 0, clientsPending: (result.clients_to_create || []).length };

  store.runBatch(() => {
    if (result.body_log) {
      const bl = result.body_log;
      const daily = { date: bl.date };
      for (const key of ['body_weight_kg', 'sleep_hours', 'calories_kcal', 'protein_g', 'carbs_g', 'fat_g']) {
        if (bl[key] != null) daily[key] = bl[key];
      }
      store.upsertBodyDailyLog(daily);
      for (const w of bl.workout_entries || []) {
        store.upsertBodyWorkoutEntry({ date: bl.date, column_id: w.column_id, raw_notation: w.raw_notation, parsed_blocks: w.parsed_blocks });
        applied.workouts++;
      }
      applied.body = true;
    }
    if ((result.finance_transactions || []).length) {
      applied.finance = store.createBatch('finance_transactions', result.finance_transactions).length;
    }
    if ((result.trading_items || []).length) {
      applied.trading = store.createBatch('trading_items', result.trading_items).length;
    }
    for (const t of result.todos || []) {
      store.create('todos', {
        title: t.title,
        client_id: t.client_id || null,
        due_date: t.due_date || null,
        priority: t.priority || 'media',
        compensation_mode: t.compensation_amount > 0 ? 'autonomous' : 'none',
        compensation_amount: t.compensation_amount || 0,
        is_completed: false,
        source: 'ai',
      });
      applied.todos++;
    }
    for (const a of result.appointments || []) {
      store.create('appointments', {
        title: a.title,
        client_id: a.client_id || null,
        start_time: a.start_time,
        end_time: a.end_time || null,
        location: a.location || '',
        is_all_day: Boolean(a.is_all_day),
        activity_type: a.activity_type || 'general',
        compensation_amount: a.compensation_amount || 0,
      });
      applied.appointments++;
    }
  });
  return applied;
}

/** Critica a zero token dell'Avvocato del Diavolo (solo evidenze deterministiche). */
function localDevilsAdvocate(payload) {
  const evidence = payload.devilsEvidence || buildDevilsAdvocateEvidence({ activeModule: payload.activeModule, prompt: payload.prompt });
  const critique = buildDevilsAdvocateReport(evidence);
  return {
    summary: `😈 Avvocato del Diavolo — ${critique.verdict}`,
    clients_to_create: [],
    todos: [],
    appointments: [],
    body_log: null,
    finance_transactions: [],
    trading_items: [],
    critique,
  };
}

// Estrazione euristica Body Log (Biometria, Macro e Allenamento Matrice)
export function extractBodyLogFromText(text = '') {
  if (!text || !text.trim()) return null;

  const weightMatch = text.match(/(?:peso(?:\s+corporeo)?[:\s]*|pesato\s*)(\d{2,3}(?:[.,]\d{1,2})?)\s*kg\b/i)
    || text.match(/\b(\d{2,3}[.,]\d{1,2})\s*kg\b/i);
  const sleepMatch = text.match(/(?:dormito|sonno)[:\s]*(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:ore|h\b)/i)
    || text.match(/\b(\d{1,2}(?:[.,]\d{1,2})?)\s*ore\s+di\s+sonno/i);
  const kcalMatch = text.match(/(\d{3,4})\s*(?:kcal|calorie)\b/i);
  const protMatch = text.match(/(\d{2,3})\s*g?\s*(?:proteine|prot\b|pro\b)/i)
    || text.match(/(?:proteine|prot)[:\s]*(\d{2,3})\s*g?\b/i);
  const carbsMatch = text.match(/(\d{2,3})\s*g?\s*(?:carboidrati|carbo\b|cho\b)/i)
    || text.match(/(?:carboidrati|carbo)[:\s]*(\d{2,3})\s*g?\b/i);
  const fatMatch = text.match(/(\d{1,3})\s*g?\s*(?:grassi|fat\b|lipidi)/i)
    || text.match(/(?:grassi|fat)[:\s]*(\d{1,3})\s*g?\b/i);

  const columns = store.getBodyColumns?.() || DEFAULT_BODY_COLUMNS;
  const colFind = (slug, fallbackId) => columns.find(c => c.slug === slug || c.id === fallbackId) || { id: fallbackId, name: slug, category: 'pull', slug };

  const exerciseMatchers = [
    { col: colFind('pull_up', 'col-pull-up'), regex: /\b(?:pull[\s-]*up|trazioni|chin[\s-]*up)\b\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/gi },
    { col: colFind('dips', 'col-dips'), regex: /\b(?:dips|dip|parallele)\b\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/gi },
    { col: colFind('push_up', 'col-push-up'), regex: /\b(?:push[\s-]*up|piegamenti|flessioni|pike|pseudo\s+planche)\b\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/gi },
    { col: colFind('lunges', 'col-affondi'), regex: /\b(?:affondi(?:\s+bulgari|\s+camminati)?|bulgarian\s+split\s+squat)\b\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/gi },
    { col: colFind('squat_sissy', 'col-squat-sissy'), regex: /\b(?:squat|sissy(?:\s+squat)?|pistol\s+squat)\b\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/gi },
    { col: colFind('hamstrings', 'col-femo'), regex: /\b(?:femo|femorali|nordic\s+curl|leg\s+curl|sliding\s+curl)\b\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/gi },
    { col: colFind('deadlift', 'col-stacchi'), regex: /\b(?:stacchi(?:\s+rumeni|\s+sumo)?|stacco|rdl|deadlift)\b\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/gi },
  ];

  const workoutMap = new Map();

  for (const item of exerciseMatchers) {
    let m;
    while ((m = item.regex.exec(text)) !== null) {
      let rawSeg = (m[1] || '').trim();
      // Normalizza eventuale "e <variante> (...)" interno allo stesso esercizio in " + <variante> (...)"
      rawSeg = rawSeg.replace(/\s+e\s+(?=(?:presa|anelli|archer|isometr|singolo|monopod|sissy|rumeno|bulgar|\d+\s*\(|\())/gi, ' + ');
      if (rawSeg && /\d/.test(rawSeg)) {
        const prev = workoutMap.get(item.col.id);
        const combined = prev ? `${prev.raw_notation} + ${rawSeg}` : rawSeg;
        workoutMap.set(item.col.id, {
          column_id: item.col.id,
          column_slug: item.col.slug,
          column_name: item.col.name,
          category: item.col.category,
          raw_notation: combined,
        });
      }
    }
  }

  // Rilevamento Cardio & Sport (es. "1h basket", "45 min corsa", "calcetto 1h", "stretching 20 min")
  const cardioCol = colFind('cardio_sport', 'col-cardio-sport');
  const cardioMatches = text.match(/\b(?:\d+(?:[.,]\d+)?\s*(?:h|ora|ore|min|minuti|'|\bkm)\s*(?:di\s+)?(?:basket|corsa|running|calcetto|bici|nuoto|corda|stretching|camminata|padel|tennis|cardio)|(?:basket|corsa|running|calcetto|bici|nuoto|corda|stretching|padel|tennis)\s+\d+(?:[.,]\d+)?\s*(?:h|ora|ore|min|minuti|'|km))\b/gi);
  if (cardioMatches && cardioMatches.length > 0) {
    workoutMap.set(cardioCol.id, {
      column_id: cardioCol.id,
      column_slug: cardioCol.slug,
      column_name: cardioCol.name,
      category: 'cardio',
      raw_notation: cardioMatches.map(s => s.trim()).join(' + '),
    });
  }

  const workout_entries = Array.from(workoutMap.values()).map(entry => {
    const parsed = parseWorkoutNotation(entry.raw_notation, entry.category);
    return {
      ...entry,
      raw_notation: parsed.normalized_notation || entry.raw_notation,
      parsed_blocks: parsed.blocks,
    };
  });

  const hasBiometrics = Boolean(weightMatch || sleepMatch || kcalMatch || protMatch || carbsMatch || fatMatch);
  if (!hasBiometrics && workout_entries.length === 0) {
    return null;
  }

  const now = new Date();
  let logDate = now.toISOString().split('T')[0];
  if (/\bieri\b/i.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    logDate = d.toISOString().split('T')[0];
  }

  return {
    date: logDate,
    sleep_hours: sleepMatch ? parseFloat(sleepMatch[1].replace(',', '.')) : null,
    body_weight_kg: weightMatch ? parseFloat(weightMatch[1].replace(',', '.')) : null,
    calories_kcal: kcalMatch ? parseInt(kcalMatch[1], 10) : null,
    protein_g: protMatch ? parseInt(protMatch[1], 10) : null,
    carbs_g: carbsMatch ? parseInt(carbsMatch[1], 10) : null,
    fat_g: fatMatch ? parseInt(fatMatch[1], 10) : null,
    workout_entries,
  };
}

// ---------------------------------------------------------------------------
// Estrazione euristica Finanze & Compravendita (offline, zero token)
// ---------------------------------------------------------------------------

const EURO_AMOUNT_REGEX = /(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:€|euro\b|eur\b)|€\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i;
const INCOME_VERB_REGEX = /\b(?:incassat[oiae]|ricevut[oiae]|fatturat[oiae]|guadagnat[oiae]|accreditat[oiae]|mi\s+(?:ha|hanno)\s+pagato|pagamento\s+da|entrata)\b/i;
const SALE_VERB_REGEX = /\bvendut[oiae]\b/i;
const EXPENSE_VERB_REGEX = /\b(?:speso|spesa|spese|pagato|pagata|pagati|comprato|comprata|acquistato|acquistata|rinnovato|rinnovata|versato|sborsato|costato|addebitato)\b/i;
const TRADING_PLATFORM_REGEX = /\b(vinted|subito(?:\.it)?|ebay)\b/i;

const EXPENSE_CATEGORY_RULES = [
  [/benzina|carburante|gasolio|autostrada|pedaggio|treno|taxi|uber|biglietto|\bvolo\b|parcheggio/i, 'Trasporti & Viaggi'],
  [/hosting|server|dominio|\bvps\b|\baws\b|vercel|supabase|railway|cloudflare|\bssl\b/i, 'Server & Hosting'],
  [/adobe|figma|notion|github|abbonamento|licenza|saas|software|chatgpt|subscription/i, 'Software & Abbonamenti'],
  [/monitor|tastiera|mouse|laptop|\bpc\b|macbook|hardware|cuffie|webcam|\bssd\b|stampante/i, 'Attrezzatura & Hardware'],
  [/\bads\b|\badv\b|sponsorizz|marketing|campagna/i, 'Marketing & Adv'],
  [/commercialista|tasse|\biva\b|\binps\b|\bf24\b|irpef|fiscal/i, 'Commercialista & Fisco'],
  [/internet|\bluce\b|\bgas\b|affitto|bolletta|ufficio|coworking|telefono/i, 'Ufficio & Utenze'],
  [/collaborator|freelancer|subappalt/i, 'Collaboratori'],
];

function parseEuroAmount(text) {
  const m = String(text).match(EURO_AMOUNT_REGEX);
  if (!m) return null;
  const raw = m[1] || m[2];
  const value = /\.\d{3}/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(',', '.');
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function canonicalPlatform(name = '') {
  const t = name.toLowerCase();
  if (t.startsWith('vinted')) return 'Vinted';
  if (t.startsWith('subito')) return 'Subito';
  if (t.startsWith('ebay')) return 'eBay';
  return 'Altro';
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * Riconosce in una clausola una spesa, un incasso, una vendita o un acquisto di compravendita.
 * Richiede SEMPRE un verbo esplicito e un importo in euro (nessun falso positivo sui to-do con compenso).
 * @returns {{kind: 'finance'|'trading', record: object, type?: 'income'|'expense'}|null}
 */
export function extractFinanceFromClause(clause, { existingClients = [], todayIso = localTodayIso(), inheritedType = null } = {}) {
  const amount = parseEuroAmount(clause);
  if (amount === null) return null;

  const platformMatch = clause.match(TRADING_PLATFORM_REGEX);
  let kind = null;
  let isSale = false;
  if (SALE_VERB_REGEX.test(clause)) {
    kind = 'income';
    isSale = true;
  } else if (INCOME_VERB_REGEX.test(clause)) {
    kind = 'income';
  } else if (/\b(?:comprato|comprata|acquistato|acquistata|preso)\b/i.test(clause) && platformMatch) {
    kind = 'trading_purchase';
  } else if (EXPENSE_VERB_REGEX.test(clause)) {
    kind = 'expense';
  } else if (inheritedType && /^\s*\d/.test(clause)) {
    kind = inheritedType; // "ho speso 45€ di benzina e 12€ di caffè": il secondo importo eredita il tipo
  }
  if (!kind) return null;

  const date = /\bieri\b/i.test(clause) ? addDaysIso(todayIso, -1) : todayIso;
  const lower = clause.toLowerCase();

  if (kind === 'trading_purchase') {
    const titleMatch = clause.match(/(?:comprato|comprata|acquistato|acquistata|preso)\s+(?:un[oa']?\s+|il\s+|lo\s+|la\s+|i\s+|dei\s+|delle\s+|degli\s+)?(.+?)\s+(?:su|da|a|per|con)\b/i);
    return {
      kind: 'trading',
      record: normalizeTradingItem({
        title: capitalize((titleMatch ? titleMatch[1] : 'Articolo').trim()),
        platform: canonicalPlatform(platformMatch[1]),
        purchase_price: amount,
        purchase_date: date,
        status: 'in_stock',
        notes: `Da nota: "${clause.trim()}"`,
      }),
    };
  }

  let description = clause
    .replace(new RegExp(EURO_AMOUNT_REGEX.source, 'gi'), ' ')
    .replace(/\b(?:ho|abbiamo)\b/gi, ' ')
    .replace(new RegExp(`${INCOME_VERB_REGEX.source}|${EXPENSE_VERB_REGEX.source}|${SALE_VERB_REGEX.source}`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:di|per|da|in|a|il|lo|la|un|una)\s+/i, '');
  if (isSale) description = `Vendita ${description}`.trim();
  if (!description) description = kind === 'income' ? 'Incasso' : 'Spesa';

  let category = 'Generale';
  if (kind === 'income') {
    category = isSale ? 'Compravendita' : /canone|manutenzione/i.test(lower) ? 'Canoni & Manutenzione' : 'Servizi & Progetti';
  } else {
    const rule = EXPENSE_CATEGORY_RULES.find(([regex]) => regex.test(lower));
    if (rule) category = rule[1];
  }

  const client = existingClients.find(c => c.name && lower.includes(c.name.toLowerCase()));
  return {
    kind: 'finance',
    type: kind,
    record: normalizeTransaction({
      type: kind,
      amount,
      description: capitalize(description),
      category,
      date,
      client_id: client ? client.id : null,
    }),
  };
}

// Parser locale intelligente per fallback
function localHeuristicParser(text = '', existingClients = [], preselectedClientId = null) {
  const result = {
    summary: 'Proposte generate tramite analisi del testo',
    clients_to_create: [],
    todos: [],
    appointments: [],
    body_log: null,
    finance_transactions: [],
    trading_items: [],
    critique: null,
  };

  if (!text.trim()) {
    return result;
  }

  const lowerText = text.toLowerCase();

  // 0. Riconoscimento Diario Body (Biometria, Kcal/Macro e Allenamenti)
  const extractedBodyLog = extractBodyLogFromText(text);
  if (extractedBodyLog) {
    result.body_log = extractedBodyLog;
    const parts = [];
    if (extractedBodyLog.body_weight_kg) parts.push(`${extractedBodyLog.body_weight_kg} kg`);
    if (extractedBodyLog.calories_kcal) parts.push(`${extractedBodyLog.calories_kcal} kcal`);
    if (extractedBodyLog.workout_entries.length > 0) parts.push(`${extractedBodyLog.workout_entries.length} esercizi`);
    result.summary = `Rilevato Log Body giornaliero (${parts.join(' · ')})`;
  }

  // 1. Riconoscimento On-boarding Nuovo Cliente / Cliente Storico
  // Es: "Lavoro da mesi con Marco di TechCorp, canone 300€/mese, sito techcorp.it, staging stage.techcorp.it, repo antoromano/techcorp-web, stack Next.js e Supabase"
  const isOnboarding = /(?:lavoro|collaboro).+?con|nuovo cliente|cliente storico|aggiungi cliente|onboard|gestisco il cliente/i.test(text)
    || (/(?:sito|staging|repo|canone|stack)/i.test(text) && /(?:per|cliente|con)\s+([A-Z][a-zA-Z0-9_\s]{2,25})/i.test(text));

  if (isOnboarding) {
    let companyName = '';
    let firstName = '';
    let lastName = '';

    // Estrazione nome e azienda
    const withCompanyMatch = text.match(/(?:lavoro\s+(?:da\s+[\w\s]+\s+)?con|collaboro\s+(?:da\s+[\w\s]+\s+)?con|per|cliente)\s+([A-Z][a-zA-Z]+)(?:\s+([A-Z][a-zA-Z]+))?\s+di\s+([A-Z][a-zA-Z0-9_\s.-]+?)(?:,|\.|\s+da|\s+canone|\s+sito|\s+repo|$)/i);
    if (withCompanyMatch) {
      firstName = withCompanyMatch[1].trim();
      if (withCompanyMatch[2]) lastName = withCompanyMatch[2].trim();
      companyName = withCompanyMatch[3].trim();
    } else {
      const companyDirectMatch = text.match(/(?:cliente|azienda|ragione sociale)[:\s]+([A-Z][a-zA-Z0-9_\s.-]+?)(?:,|\.|\n|sito|repo|$)/i);
      if (companyDirectMatch) {
        companyName = companyDirectMatch[1].trim();
      } else {
        const nameMatch = text.match(/(?:lavoro(?:\s+da\s+[\w\s]+\s+)?con|collaboro\s+con|cliente)\s+([A-Z][a-zA-Z0-9_\s.-]{2,25})/i);
        if (nameMatch) {
          companyName = nameMatch[1].trim();
        }
      }
    }

    // Estrazione URLs
    const urls = text.match(/https?:\/\/[^\s,;)]+|www\.[^\s,;)]+|[a-zA-Z0-9-]+\.(?:it|com|io|app|dev|net|org)(?:\/[^\s,;)]*)?/gi) || [];
    let prodUrl = '';
    let stagingUrl = '';

    for (const u of urls) {
      const fullUrl = u.startsWith('http') ? u : `https://${u}`;
      if (/stage|staging|dev|test/i.test(u)) {
        if (!stagingUrl) stagingUrl = fullUrl;
      } else if (!/github\.com/i.test(u)) {
        if (!prodUrl) prodUrl = fullUrl;
      }
    }

    // Estrazione GitHub Repo
    let githubRepo = '';
    const repoMatch = text.match(/(?:github\.com\/|repo(?:\s+github)?[:\s]+)([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/i);
    if (repoMatch) {
      githubRepo = repoMatch[1].replace(/\.git$/, '');
    }

    // Estrazione Stack Tecnologico
    const techKeywords = ['React', 'Next.js', 'Next', 'Vue', 'Nuxt', 'Node.js', 'Node', 'TypeScript', 'JavaScript', 'Python', 'Django', 'FastAPI', 'Laravel', 'PHP', 'Supabase', 'PostgreSQL', 'Tailwind', 'Docker', 'AWS', 'Vercel', 'Shopify', 'WordPress', 'WooCommerce'];
    const detectedStack = [];
    for (const kw of techKeywords) {
      const reg = new RegExp(`\\b${kw.replace('.', '\\.')}\\b`, 'i');
      if (reg.test(text) && !detectedStack.includes(kw)) {
        detectedStack.push(kw);
      }
    }

    // Canone di manutenzione / ricorrente
    let maintenanceAmount = 0;
    let maintenanceFrequency = 'monthly';
    const canoneMatch = text.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro)\s*(?:\/|\s*al\s*)?(mese|mensile|mensili|anno|annuale|annui)?/i);
    if (canoneMatch && (lowerText.includes('canone') || lowerText.includes('manutenzione') || lowerText.includes('sla') || lowerText.includes('/mese') || lowerText.includes('mensil'))) {
      maintenanceAmount = parseFloat(canoneMatch[1].replace(',', '.'));
      if (canoneMatch[2] && /anno|annuale|annui/i.test(canoneMatch[2])) {
        maintenanceFrequency = 'annual';
      }
    }

    // Email & Phone
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = text.match(/(?:\+39\s?)?(?:3\d{2}[-.\s]?\d{6,7}|\d{2,4}[-.\s]?\d{5,8})/);

    if (companyName || firstName) {
      result.clients_to_create.push({
        company_name: companyName || (firstName ? `${firstName} ${lastName}`.trim() : 'Nuovo Cliente'),
        first_name: firstName,
        last_name: lastName,
        email: emailMatch ? emailMatch[0] : '',
        phone: phoneMatch ? phoneMatch[0] : '',
        staging_url: stagingUrl,
        production_url: prodUrl,
        github_repo: githubRepo,
        stack: detectedStack.join(', '),
        maintenance_amount: maintenanceAmount,
        maintenance_frequency: maintenanceFrequency,
        notes: text,
      });
      result.summary = `Rilevato nuovo profilo cliente (${companyName || firstName}) da acquisire nel gestionale`;
    }
  }

  // Separa frasi, periodi e congiunzioni ("e", virgole, punti, punti e virgola, "devo")
  // Le virgole decimali ("45,50€") non devono spezzare la clausola
  const clauses = text
    .replace(/(\d),(\d)/g, '$1\u0001$2')
    .split(/\s*,\s*|\s+e\s+|\s*;\s*|\.\s+|\n+/)
    .map(s => s.replace(/\u0001/g, ',').trim())
    .filter(s => s.length > 3);

  const now = new Date();
  const todayIso = localTodayIso(now);
  let lastFinanceType = null;

  for (const clause of clauses) {
    const lower = clause.toLowerCase();
    let assignedClientId = preselectedClientId || null;
    let proposedClientName = '';

    // Cerca corrispondenza con clienti esistenti
    for (const client of existingClients) {
      if (lower.includes(client.name.toLowerCase())) {
        assignedClientId = client.id;
        proposedClientName = client.name;
        break;
      }
    }

    // Se non ha trovato un cliente esistente ma menziona "per [Nome]" o "cliente [Nome]"
    if (!assignedClientId) {
      const clientMatch = clause.match(/(?:per\s+(?:il\s+cliente\s+)?|cliente\s+)([A-Z][a-zA-Z0-9_\s]{2,20})/i);
      if (clientMatch && !/abbonamento|software|lavoro|casa|studio|server|dominio|deploy/i.test(clientMatch[1])) {
        proposedClientName = clientMatch[1].trim();
      }
    }

    // Rilevamento data/scadenza
    let dueDate = null;
    let isAppointment = false;
    let activityType = 'general';

    // Rilevamento tipologia attività dev
    if (lower.includes('deploy') || lower.includes('rilascio') || lower.includes('go-live') || lower.includes('messa in produzione')) {
      activityType = 'deploy';
      isAppointment = true;
    } else if (lower.includes('demo') || lower.includes('sprint') || lower.includes('review') || lower.includes('presentazione')) {
      activityType = 'demo';
      isAppointment = true;
    } else if (lower.includes('call') || lower.includes('meeting') || lower.includes('allineamento') || lower.includes('riunione')) {
      activityType = 'call';
      isAppointment = true;
    } else if (lower.includes('scadenza server') || lower.includes('scadenza dominio') || lower.includes('rinnovo ssl') || lower.includes('scadenza licenza')) {
      activityType = 'server_deadline';
      isAppointment = true;
    }

    if (lower.includes('domani')) {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      dueDate = d.toISOString().split('T')[0] + 'T18:00:00';
    } else if (lower.includes('oggi')) {
      dueDate = now.toISOString().split('T')[0] + 'T18:00:00';
    } else if (lower.includes('fra 3 giorni') || lower.includes('tra 3 giorni')) {
      const d = new Date(now);
      d.setDate(d.getDate() + 3);
      dueDate = d.toISOString().split('T')[0] + 'T18:00:00';
    }

    // Riconoscimento orario es. "alle 15", "alle 10:30"
    const timeMatch = clause.match(/alle\s+(\d{1,2})(?::(\d{2}))?/i);
    if (timeMatch) {
      isAppointment = true;
      const h = parseInt(timeMatch[1], 10);
      const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const baseDate = dueDate ? new Date(dueDate) : new Date(now);
      baseDate.setHours(h, m, 0, 0);
      dueDate = baseDate.toISOString();
    }

    // Riconoscimento importo economico es. "500€", "300 euro"
    const priceMatch = clause.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro)/i);
    const compensation = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : 0;

    // Pulizia titolo
    let cleanTitle = clause
      .replace(/devo\s+/i, '')
      .replace(/^fare\s+/i, 'Fare ')
      .replace(/^preparare\s+/i, 'Preparare ')
      .replace(/^attivare\s+/i, 'Attivare ')
      .replace(/^eseguire\s+/i, 'Eseguire ')
      .trim();

    cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);

    // Salta frasi che descrivono puramente parametri del cliente onboarded
    if (isOnboarding && /^(sito|staging|repo|stack|canone|lavoro con|collaboro con)/i.test(clause)) {
      continue;
    }

    // Spese, incassi, vendite e acquisti di compravendita (verbo esplicito + importo in euro)
    const finance = extractFinanceFromClause(clause, { existingClients, todayIso, inheritedType: lastFinanceType });
    if (finance) {
      if (finance.kind === 'trading') {
        result.trading_items.push(finance.record);
        lastFinanceType = null;
      } else {
        result.finance_transactions.push(finance.record);
        lastFinanceType = finance.type;
      }
      continue;
    }
    lastFinanceType = null;

    // Salta clausole che appartengono al Diario Body (peso, sonno, kcal, macro o serie di allenamento)
    if (result.body_log && /(?:\bpeso\b|kg\b|dormito|sonno|kcal|calorie|proteine|carbo|grassi|allenamento|pull[\s-]*up|trazioni|dips|push[\s-]*up|piegamenti|affondi|squat|sissy|femo|stacchi|basket|corsa|calcetto|presa\s+larga|singolo\s+arto|\d+\s*\(\d+)/i.test(clause)) {
      continue;
    }

    if (isAppointment) {
      const startTime = dueDate || new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
      const endTime = new Date(new Date(startTime).getTime() + 1 * 3600 * 1000).toISOString();
      result.appointments.push({
        title: cleanTitle,
        description: `Rilevato da nota: "${clause}"`,
        location: activityType === 'call' ? 'Online / Google Meet' : '',
        client_id: assignedClientId,
        client_name_proposed: proposedClientName,
        start_time: startTime,
        end_time: endTime,
        is_all_day: !timeMatch,
        activity_type: activityType,
        compensation_amount: compensation,
      });
    } else {
      result.todos.push({
        title: cleanTitle,
        notes: `Generato automaticamente da nota: "${clause}"`,
        client_id: assignedClientId,
        client_name_proposed: proposedClientName,
        due_date: dueDate,
        priority: lower.includes('urgente') ? 'urgente' : 'media',
        compensation_amount: compensation,
      });
    }
  }

  if (result.finance_transactions.length > 0 || result.trading_items.length > 0) {
    const net = result.finance_transactions.reduce((acc, t) => acc + (t.type === 'income' ? t.amount : -t.amount), 0);
    const bits = [];
    if (result.finance_transactions.length > 0) bits.push(`${result.finance_transactions.length} movimenti (${net >= 0 ? '+' : ''}${net.toFixed(2)}€)`);
    if (result.trading_items.length > 0) bits.push(`${result.trading_items.length} acquisti compravendita`);
    result.summary = result.summary.startsWith('Proposte generate') ? `Rilevati ${bits.join(' · ')}` : `${result.summary} · ${bits.join(' · ')}`;
  }

  return result;
}

function normalizeAiResponse(data, existingClients, preselectedClientId, options = {}) {
  const clients_to_create = (data.clients_to_create || []).map(c => ({
    company_name: c.company_name || 'Nuovo Cliente',
    first_name: c.first_name || '',
    last_name: c.last_name || '',
    email: c.email || '',
    phone: c.phone || '',
    staging_url: c.staging_url || '',
    production_url: c.production_url || '',
    github_repo: c.github_repo || '',
    stack: c.stack || '',
    maintenance_amount: Number(c.maintenance_amount) || 0,
    maintenance_frequency: c.maintenance_frequency || 'monthly',
    notes: c.notes || '',
  }));

  const todos = (data.todos || []).map(t => {
    let clientId = t.client_id || preselectedClientId || null;
    if (clientId && !existingClients.some(c => c.id === clientId)) {
      const found = existingClients.find(c => c.name.toLowerCase() === (t.client_name_proposed || '').toLowerCase());
      clientId = found ? found.id : null;
    }
    return {
      title: t.title || 'Nuovo To-do',
      notes: t.notes || '',
      client_id: clientId,
      client_name_proposed: t.client_name_proposed || '',
      due_date: t.due_date || null,
      priority: t.priority || 'media',
      compensation_amount: Number(t.compensation_amount) || 0,
    };
  });

  const appointments = (data.appointments || []).map(a => {
    let clientId = a.client_id || preselectedClientId || null;
    if (clientId && !existingClients.some(c => c.id === clientId)) {
      const found = existingClients.find(c => c.name.toLowerCase() === (a.client_name_proposed || '').toLowerCase());
      clientId = found ? found.id : null;
    }
    return {
      title: a.title || 'Nuovo Evento',
      description: a.description || '',
      location: a.location || '',
      client_id: clientId,
      client_name_proposed: a.client_name_proposed || '',
      start_time: a.start_time || new Date().toISOString(),
      end_time: a.end_time || null,
      is_all_day: Boolean(a.is_all_day),
      activity_type: a.activity_type || (a.is_shooting ? 'deploy' : 'general'),
      compensation_amount: Number(a.compensation_amount) || 0,
    };
  });

  let body_log = null;
  if (data.body_log && typeof data.body_log === 'object') {
    const columns = store.getBodyColumns?.() || DEFAULT_BODY_COLUMNS;
    const rawEntries = Array.isArray(data.body_log.workout_entries) ? data.body_log.workout_entries : [];
    const workout_entries = rawEntries
      .filter(e => e && e.raw_notation)
      .map(e => {
        const col = columns.find(c =>
          c.id === e.column_id
          || c.slug === e.column_slug
          || c.name.toLowerCase() === String(e.column_name || '').toLowerCase()
        ) || columns[0];
        const parsed = parseWorkoutNotation(e.raw_notation, col?.category || 'pull');
        return {
          column_id: col?.id || 'col-pull-up',
          column_slug: col?.slug || 'pull_up',
          column_name: col?.name || e.column_name || 'Esercizio',
          category: col?.category || 'pull',
          raw_notation: parsed.normalized_notation || e.raw_notation,
          parsed_blocks: parsed.blocks,
        };
      });

    const hasAnyValue = Boolean(
      data.body_log.sleep_hours
      || data.body_log.body_weight_kg
      || data.body_log.calories_kcal
      || data.body_log.protein_g
      || data.body_log.carbs_g
      || data.body_log.fat_g
      || workout_entries.length > 0
    );

    if (hasAnyValue) {
      body_log = {
        date: data.body_log.date || new Date().toISOString().split('T')[0],
        sleep_hours: data.body_log.sleep_hours != null ? Number(data.body_log.sleep_hours) : null,
        body_weight_kg: data.body_log.body_weight_kg != null ? Number(data.body_log.body_weight_kg) : null,
        calories_kcal: data.body_log.calories_kcal != null ? Number(data.body_log.calories_kcal) : null,
        protein_g: data.body_log.protein_g != null ? Number(data.body_log.protein_g) : null,
        carbs_g: data.body_log.carbs_g != null ? Number(data.body_log.carbs_g) : null,
        fat_g: data.body_log.fat_g != null ? Number(data.body_log.fat_g) : null,
        workout_entries,
      };
    }
  }

  const finance_transactions = (data.finance_transactions || [])
    .map(t => {
      let clientId = t.client_id || null;
      if (clientId && !existingClients.some(c => c.id === clientId)) clientId = null;
      return normalizeTransaction({ ...t, client_id: clientId, type: t.type === 'income' ? 'income' : 'expense' });
    })
    .filter(t => t.amount > 0 && t.description);

  const trading_items = (data.trading_items || [])
    .map(t => normalizeTradingItem(t))
    .filter(t => t.title);

  let critique = null;
  if (data.critique && typeof data.critique === 'object') {
    critique = {
      verdict: String(data.critique.verdict || ''),
      risks: Array.isArray(data.critique.risks) ? data.critique.risks.map(String) : [],
      recommendations: Array.isArray(data.critique.recommendations) ? data.critique.recommendations.map(String) : [],
      buffer_percent: data.critique.buffer_percent ?? null,
      hourly_profit: data.critique.hourly_profit ?? null,
      topics: Array.isArray(data.critique.topics) ? data.critique.topics : [],
    };
  } else if (options.profile === 'devils_advocate' && options.devilsEvidence) {
    // Il modello non ha restituito la critica: usa quella deterministica calcolata sui dati reali
    critique = buildDevilsAdvocateReport(options.devilsEvidence);
  }

  return {
    summary: data.summary || 'Proposte estratte con successo',
    clients_to_create,
    todos,
    appointments,
    body_log,
    finance_transactions,
    trading_items,
    critique,
  };
}
