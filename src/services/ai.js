// src/services/ai.js
// Gestione richieste AI (solo IA: se non risponde, errore esplicito con il motivo; nessun ripiego a regole locali)
// + Profili di Prompt Specializzati (Agent Personas), modalità "Avvocato del Diavolo" e Ingestion Batch.

import { store } from './store.js';
import { aiGenerate, isAiConfigured, GeminiError } from './ai-client.js';
import { querySecondBrain } from './brain.js';
import { DEFAULT_BODY_COLUMNS, parseWorkoutNotation } from '../utils/body-parser.js';
import {
  normalizeTradingItem,
  normalizeTransaction,
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
      { "column_slug": "pull_up|dips|push_up|affondi|squat_sissy|femo|stacchi|cardio_sport", "column_name": "string", "raw_notation": "string" }
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
      engine: 'ai',
      aiCalls: 1,
    };
  };

  if (!isAiConfigured()) {
    throw new GeminiError('not_configured', 'L\'IA non è configurata: apri Impostazioni → Verifica IA.');
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
    // Niente regole di ripiego: se l'IA non risponde l'errore arriva all'utente con il motivo
    console.warn('IA non disponibile:', err.code, err.message);
    throw err;
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
        );
        // Esercizio non riconosciuto: si scarta (meglio nulla che finire per sbaglio in "Pull Up")
        if (!col) return null;
        const parsed = parseWorkoutNotation(e.raw_notation, col.category || 'pull');
        return {
          column_id: col.id,
          column_slug: col.slug,
          column_name: col.name,
          category: col.category || 'pull',
          raw_notation: parsed.normalized_notation || e.raw_notation,
          parsed_blocks: parsed.blocks,
        };
      })
      .filter(Boolean);

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
