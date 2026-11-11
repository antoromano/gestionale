// src/services/telegram.js
// Servizio Client & Orchestratore per l'Integrazione Telegram Bot:
// - Stato Webhook e invio messaggio di test dalla schermata Impostazioni
// - Pipeline 4° Livello di Protezione (Human-in-the-Loop Confirmation) su telegram_pending_actions
// - Riconoscimento diretto Body & Allenamenti (notazione 20(10,10,10,10), kcal, peso, sonno)
// - Proattività Scheduled (Morning Brief 08:30 & Evening Reminder 21:30)

import { store } from './store.js';
import { getSupabase } from './supabase.js';
import {
  ingestKnowledge,
  upsertFact,
  upsertGraphRelationship,
} from './brain.js';
import {
  parseWorkoutNotation,
  calculateColumnRecoveryStatus,
} from '../utils/body-parser.js';

export const DEFAULT_SUPABASE_PROJECT_ID = 'hbyqofpkkenzgbggvlch';

/**
 * Restituisce l'URL base del progetto Supabase attivo
 */
export function getSupabaseBaseUrl() {
  const settings = store.getSettings();
  const configuredUrl =
    settings.supabase_url ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ||
    (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_URL) ||
    `https://${DEFAULT_SUPABASE_PROJECT_ID}.supabase.co`;
  return configuredUrl.replace(/\/+$/, '');
}

/**
 * Restituisce l'URL completo del Webhook Telegram su Supabase Edge Functions
 */
export function getTelegramWebhookUrl() {
  return `${getSupabaseBaseUrl()}/functions/v1/telegram-webhook`;
}

/**
 * Restituisce l'URL dell'Edge Function di Proattività Scheduled (morning_brief | evening_check)
 */
export function getTelegramProactiveUrl(action = 'morning_brief') {
  return `${getSupabaseBaseUrl()}/functions/v1/telegram-proactive?action=${encodeURIComponent(action)}`;
}

/**
 * Verifica lo stato di configurazione del Bot Telegram
 */
export function getTelegramIntegrationStatus() {
  const settings = store.getSettings();
  const envToken =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TELEGRAM_BOT_TOKEN) ||
    (typeof process !== 'undefined' && process.env?.TELEGRAM_BOT_TOKEN) ||
    '';
  const envUser =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TELEGRAM_ALLOWED_USER_ID) ||
    (typeof process !== 'undefined' && process.env?.TELEGRAM_ALLOWED_USER_ID) ||
    '';

  const botToken = settings.telegram_bot_token || envToken || '';
  const allowedUserId = settings.telegram_allowed_user_id || envUser || '';
  const isConfigured = Boolean((botToken && allowedUserId) || settings.telegram_connected);

  return {
    isConfigured,
    hasBotToken: Boolean(botToken),
    hasAllowedUserId: Boolean(allowedUserId),
    allowedUserId,
    webhookUrl: getTelegramWebhookUrl(),
    morningBriefUrl: getTelegramProactiveUrl('morning_brief'),
    eveningCheckUrl: getTelegramProactiveUrl('evening_check'),
  };
}

/**
 * Invia un messaggio di test su Telegram (tramite Edge Function o chiamata diretta API Telegram)
 */
export async function sendTelegramTestMessage(options = {}) {
  const settings = store.getSettings();
  const botToken = (options.botToken ?? settings.telegram_bot_token ?? '').trim();
  const chatId = (options.chatId ?? settings.telegram_allowed_user_id ?? '').trim();
  const webhookUrl = getTelegramWebhookUrl();

  const testMessageHtml = [
    '🟢 <b>Gestionale & Second Brain Connesso!</b>',
    '',
    'Il bot Telegram è attivo e collegato al tuo workspace.',
    '• 🎙️ <b>Note Vocali & Foto</b>: trascrizione e analisi multimodale Gemini.',
    '• 🏋️ <b>Sezione Body</b>: scrivi es. <code>Pull Up 20(10,10,10,10), peso 75.1kg, 2500 kcal</code> per aggiornare la Matrice.',
    '• 🛡️ <b>4° Livello di Protezione</b>: i nuovi macro-domini (es. Cucina, Finanza, Auto) chiedono conferma con bottoni inline prima di scrivere nel Knowledge Graph.',
  ].join('\n');

  // 1. Se il token e il chat_id sono presenti nelle impostazioni, invia direttamente via API Telegram e registra anche il webhook
  if (botToken && chatId && typeof fetch !== 'undefined') {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: testMessageHtml,
        parse_mode: 'HTML',
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.description || `Errore Telegram API (${res.status})`);
    }
    store.updateSettings({ telegram_connected: true });
    return { ok: true, mode: 'direct_bot_api', response: data };
  }

  // 2. Altrimenti invoca l'Edge Function su Supabase (che legge TELEGRAM_BOT_TOKEN dai Secrets del server)
  const supabase = getSupabase();
  if (supabase) {
    const { data, error } = await supabase.functions.invoke('telegram-webhook', {
      body: { action: 'send_test_message', botToken: botToken || undefined, chatId: chatId || undefined },
    });
    if (error) throw error;
    if (data?.ok) {
      store.updateSettings({ telegram_connected: true });
    }
    return data;
  }

  // 3. Fallback fetch diretto all'URL dell'Edge Function
  const edgeRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'send_test_message', botToken: botToken || undefined, chatId: chatId || undefined }),
  });
  const edgeData = await edgeRes.json();
  if (!edgeRes.ok || !edgeData?.ok) {
    throw new Error(edgeData?.error || 'Configura TELEGRAM_BOT_TOKEN e TELEGRAM_ALLOWED_USER_ID per inviare il messaggio di test.');
  }
  store.updateSettings({ telegram_connected: true });
  return edgeData;
}

/**
 * Configura automaticamente il Webhook di Telegram puntandolo alla Edge Function di Supabase
 */
export async function registerTelegramWebhook(botTokenInput) {
  const settings = store.getSettings();
  const botToken = (botTokenInput || settings.telegram_bot_token || '').trim();
  if (!botToken) {
    throw new Error('Inserisci prima il TELEGRAM_BOT_TOKEN per registrare il Webhook.');
  }
  const webhookUrl = getTelegramWebhookUrl();
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
  );
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.description || 'Impossibile registrare il Webhook su Telegram.');
  }
  store.updateSettings({ telegram_connected: true });
  return { ok: true, webhookUrl, description: data.description };
}

/**
 * Classifica ed elabora un messaggio Telegram in arrivo:
 * - Caso A: Body & Allenamenti (scrittura diretta in body_daily_logs e body_workout_entries)
 * - Caso B: Nuovo Macro-Dominio / Entità Aperta -> 4° Livello di Protezione (crea record in telegram_pending_actions con Inline Keyboard)
 */
export function processIncomingTelegramMessage({
  text = '',
  chatId = 0,
  fromUserId = 0,
  allowedUserId = null,
  dateIso = new Date().toISOString().split('T')[0],
  date = null,
} = {}) {
  const effectiveAllowedUserId =
    allowedUserId !== null && allowedUserId !== undefined
      ? allowedUserId
      : store.getSettings()?.telegram_allowed_user_id;
  const targetDateIso = date || dateIso;

  // 1. Verifica Whitelist
  if (
    effectiveAllowedUserId !== null &&
    effectiveAllowedUserId !== undefined &&
    String(effectiveAllowedUserId).trim() !== '' &&
    String(fromUserId) !== String(effectiveAllowedUserId) &&
    String(chatId) !== String(effectiveAllowedUserId)
  ) {
    return {
      ok: false,
      unauthorized: true,
      blocked: true,
      reason: 'unauthorized_user',
      replyText: 'Non sei autorizzato ad accedere a questo Gestionale.',
    };
  }

  const clean = String(text || '').trim();
  const lower = clean.toLowerCase();

  // 2. Verifica segnali Body & Allenamento (notazione 20(10,10,10,10), peso, kcal, sonno)
  const weightMatch =
    clean.match(/(?:peso(?:\s+corporeo)?\s*[:=]?\s*|pesato\s+)(\d{2,3}(?:[.,]\d{1,2})?)\s*kg/i) ||
    clean.match(/\b(\d{2}(?:[.,]\d{1,2}))\s*kg\b/i);
  const sleepMatch =
    clean.match(/(?:dormito|sonno)\s*[:=]?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:h|ore)?/i) ||
    clean.match(/\b(\d{1,2}(?:[.,]\d)?)\s*(?:h|ore)\s*(?:di\s+)?sonno\b/i);
  const kcalMatch = clean.match(/(\d{3,4})\s*kcal/i);
  const protMatch = clean.match(/(\d{2,3})\s*g?\s*(?:proteine|prot|pro)\b/i);
  const carbsMatch = clean.match(/(\d{2,3})\s*g?\s*(?:carboidrati|carbo|cho)\b/i);
  const fatMatch = clean.match(/(\d{1,3})\s*g?\s*(?:grassi|fat|lipidi)\b/i);

  const exerciseMatchers = [
    { slug: 'pull_up', name: 'Pull Up', category: 'pull', regex: /(?:pull\s*[-_]?up|trazioni|dorsali|dorso)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i },
    { slug: 'dips', name: 'Dips', category: 'push', regex: /(?:dips?|parallele)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i },
    { slug: 'push_up', name: 'Push Up', category: 'push', regex: /(?:push\s*[-_]?up|piegamenti)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i },
    { slug: 'affondi', name: 'Affondi', category: 'legs_ant', regex: /(?:affondi|lunges?)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i },
    { slug: 'squat_sissy', name: 'Squat / Sissy', category: 'legs_ant', regex: /(?:squat|sissy(?:\s+squat)?)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i },
    { slug: 'femo', name: 'Femo', category: 'legs_post', regex: /(?:femo(?:rali)?|leg\s+curl)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i },
    { slug: 'stacchi', name: 'Stacchi', category: 'legs_post', regex: /(?:stacchi|stacco|deadlift|rdl)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i },
  ];

  const columns = store.getBodyColumns();
  const detectedWorkouts = [];

  for (const matcher of exerciseMatchers) {
    const m = clean.match(matcher.regex);
    if (m && m[1]) {
      const candidateNotation = m[1].trim();
      const parsed = parseWorkoutNotation(candidateNotation, matcher.category);
      if (parsed.blocks.length > 0) {
        const col =
          columns.find(c => c.slug === matcher.slug) ||
          columns.find(c => c.name.toLowerCase().includes(matcher.name.toLowerCase().split(' ')[0])) ||
          columns[0];
        detectedWorkouts.push({
          column_id: col?.id || `col-${matcher.slug}`,
          column_name: col?.name || matcher.name,
          category: matcher.category,
          raw_notation: candidateNotation,
          parsed,
        });
      }
    }
  }

  const hasBodySignals =
    detectedWorkouts.length > 0 ||
    Boolean(kcalMatch) ||
    Boolean(sleepMatch) ||
    Boolean(weightMatch && (sleepMatch || kcalMatch || detectedWorkouts.length > 0));

  // --- CASO A: REGISTRAZIONE DIRETTA IN BODY ---
  if (hasBodySignals) {
    const dailyPayload = { date: targetDateIso };
    if (weightMatch) dailyPayload.body_weight_kg = parseFloat(weightMatch[1].replace(',', '.'));
    if (sleepMatch) dailyPayload.sleep_hours = parseFloat(sleepMatch[1].replace(',', '.'));
    if (kcalMatch) dailyPayload.calories_kcal = parseInt(kcalMatch[1], 10);
    if (protMatch) dailyPayload.protein_g = parseInt(protMatch[1], 10);
    if (carbsMatch) dailyPayload.carbs_g = parseInt(carbsMatch[1], 10);
    if (fatMatch) dailyPayload.fat_g = parseInt(fatMatch[1], 10);

    const savedLog = store.upsertBodyDailyLog(dailyPayload);
    const savedEntries = [];
    const replyLines = ['✅ Registrato in Sezione Body!'];

    for (const w of detectedWorkouts) {
      const entry = store.upsertBodyWorkoutEntry({
        date: targetDateIso,
        column_id: w.column_id,
        raw_notation: w.raw_notation,
        parsed_blocks: w.parsed.blocks,
        feeling: 'buono',
      });
      savedEntries.push(entry);
      const blockStr = w.parsed.blocks
        .map(b => `${b.load_kg > 0 ? `con ${b.load_kg}kg ` : ''}[${(b.sets || []).join(', ')}]`)
        .join(' + ');
      replyLines.push(`• Esercizio: ${w.column_name} ${blockStr}`);
      replyLines.push(`🚦 Semaforo ${w.column_name}: azzerato (prossimo stimolo tra 48-72h)`);
    }

    if (dailyPayload.body_weight_kg != null) {
      replyLines.push(`• Peso corporeo: ${dailyPayload.body_weight_kg} kg`);
    }
    if (dailyPayload.calories_kcal != null) {
      replyLines.push(`• Calorie: ${dailyPayload.calories_kcal} kcal`);
    }
    if (dailyPayload.sleep_hours != null) {
      replyLines.push(`• Sonno: ${dailyPayload.sleep_hours} h`);
    }

    return {
      ok: true,
      intent: 'body_log',
      dailyLog: savedLog,
      workoutEntries: savedEntries,
      replyText: replyLines.join('\n'),
    };
  }

  // --- CASO B: 4° LIVELLO DI PROTEZIONE (HUMAN-IN-THE-LOOP SU NUOVO MACRO-DOMINIO) ---
  let domain = 'general';
  let domainDisplay = 'Nuovo Dominio';
  let domainEmoji = '🧠';
  let nodeType = 'concept';

  if (/\b(ricetta|cucina|ingredienti|tuorli|guanciale|pecorino|cottura|pasta|carbonara|grammi)\b/i.test(lower)) {
    domain = 'cucina';
    domainDisplay = 'Cucina / Ricette';
    domainEmoji = '🍳';
    nodeType = 'recipe';
  } else if (/\b(etf|azioni|portafoglio|investiment[oi]|finanza|crypto|bitcoin|dividendi|risparmio)\b/i.test(lower)) {
    domain = 'finance';
    domainDisplay = 'Finanza & Asset';
    domainEmoji = '📈';
    nodeType = 'asset';
  } else if (/\b(auto|macchina|tagliando|gomme|assicurazione|bollo|km|motore|revisione)\b/i.test(lower)) {
    domain = 'auto';
    domainDisplay = 'Auto & Veicoli';
    domainEmoji = '🚗';
    nodeType = 'vehicle';
  }

  const colonParts = clean.split(/[:\-–]/);
  const nodeLabel =
    colonParts.length > 1 && colonParts[0].trim().length <= 40
      ? colonParts[0].trim().replace(/^ricetta\s+/i, '').trim()
      : clean.split(/\s+/).slice(0, 3).join(' ');
  const propertiesSummary = colonParts.length > 1 ? colonParts.slice(1).join(': ').trim() : clean;

  const proposedPayload = {
    title: `${domainDisplay}: ${nodeLabel}`,
    node_label: nodeLabel,
    node_type: nodeType,
    properties_summary: propertiesSummary,
    properties: { descrizione: propertiesSummary, source: 'telegram' },
    fact_subject: nodeLabel,
    fact_key: domain === 'cucina' ? 'dosi_ottimali' : 'dettagli',
    fact_value: propertiesSummary,
    raw_text: clean,
  };

  const pendingAction = store.create('telegram_pending_actions', {
    telegram_chat_id: Number(chatId) || 0,
    action_type: 'ingest_new_domain',
    domain,
    proposed_payload: proposedPayload,
    status: 'pending',
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });

  const inlineKeyboard = [
    [
      { text: '✅ Conferma e Salva', callback_data: `confirm:${pendingAction.id}` },
      { text: '❌ Ignora', callback_data: `reject:${pendingAction.id}` },
    ],
  ];

  const replyText = [
    `${domainEmoji} Rilevato nuovo argomento: ${domainDisplay}`,
    `• Nodo: ${nodeLabel} (${nodeType})`,
    `• Proprietà: ${propertiesSummary}`,
    `• Fatto: ${proposedPayload.fact_key} = ${proposedPayload.fact_value}`,
    `Vuoi salvare questa entità nel Second Brain?`,
  ].join('\n');

  return {
    ok: true,
    intent: 'new_open_domain',
    pendingAction,
    inlineKeyboard,
    replyText,
  };
}

/**
 * Gestisce il callback di conferma `[✅ Conferma e Salva]` del 4° Livello di Protezione:
 * consolida l'azione pendente in brain_memories, brain_nodes, brain_edges e brain_facts
 */
export async function confirmTelegramPendingAction(pendingId) {
  const pending = store.getById('telegram_pending_actions', pendingId);
  if (!pending || pending.status !== 'pending') {
    return { ok: false, error: 'Azione non trovata o già processata' };
  }

  const prop = pending.proposed_payload || {};
  const domain = pending.domain || 'general';

  // 1. Crea Memoria Semantica con source_type = 'telegram'
  const ingested = await ingestKnowledge({
    title: prop.title || `Nota Telegram (${domain})`,
    text: prop.raw_text || prop.properties_summary || '',
    domain,
    sourceType: 'telegram',
    sourceId: pending.id,
    tags: [domain, 'telegram', (prop.node_type || 'concept').toLowerCase()],
  });

  // 2. Crea/Aggiorna il Nodo con node_type dinamico (es. recipe, asset, vehicle)
  const existingNodes = store.getAll('brain_nodes');
  let node = existingNodes.find(
    n =>
      n.label?.toLowerCase() === (prop.node_label || '').toLowerCase() &&
      n.node_type === (prop.node_type || 'concept')
  );

  if (node) {
    node = store.update('brain_nodes', node.id, {
      properties: { ...(node.properties || {}), ...(prop.properties || {}) },
    });
  } else if (prop.node_label) {
    node = store.create('brain_nodes', {
      label: prop.node_label,
      node_type: prop.node_type || 'concept',
      properties: prop.properties || {},
    });
  }

  // 3. Registra il Fatto Atomico (Mem0)
  let factResult = null;
  if (prop.fact_subject && prop.fact_key && prop.fact_value) {
    factResult = upsertFact({
      subject: prop.fact_subject,
      fact_key: prop.fact_key,
      fact_value: prop.fact_value,
      category: domain,
      source_memory_id: ingested?.memory?.id || null,
    });
  }

  // 4. Eventuali relazioni extra nel grafo
  const createdEdges = [];
  if (Array.isArray(prop.relations)) {
    for (const rel of prop.relations) {
      const r = upsertGraphRelationship({
        source: rel.source || prop.node_label,
        source_type: rel.source_type || prop.node_type || 'concept',
        target: rel.target,
        target_type: rel.target_type || 'concept',
        relation_type: rel.relation || 'CORRELATO_A',
        evidence: prop.raw_text || '',
      });
      if (r?.edge) createdEdges.push(r.edge);
    }
  }

  // 5. Aggiorna stato della pending action in 'confirmed'
  const updatedPending = store.update('telegram_pending_actions', pendingId, {
    status: 'confirmed',
  });

  return {
    ok: true,
    status: 'confirmed',
    pendingAction: updatedPending,
    memory: ingested.memory,
    node,
    fact: factResult?.fact || null,
    edges: createdEdges,
    replyText: `✅ Salvato nel Second Brain! (${prop.node_label})`,
  };
}

/**
 * Gestisce il callback `[❌ Ignora]` del 4° Livello di Protezione
 */
export function rejectTelegramPendingAction(pendingId) {
  const pending = store.getById('telegram_pending_actions', pendingId);
  if (!pending) {
    return { ok: false, error: 'Azione non trovata' };
  }
  const updatedPending = store.update('telegram_pending_actions', pendingId, {
    status: 'rejected',
  });
  return {
    ok: true,
    status: 'rejected',
    pendingAction: updatedPending,
    replyText: '❌ Operazione ignorata',
  };
}

/**
 * Genera i messaggi proattivi (Morning Brief 08:30 & Evening Check 21:30)
 */
export function buildProactiveMessages(referenceDateIso = new Date().toISOString().split('T')[0]) {
  const columns = store.getBodyColumns();
  const workoutEntries = store.getAll('body_workout_entries');
  const dailyLogs = store.getAll('body_daily_logs');
  const quotes = store.getAll('quotes');
  const todos = store.getAll('todos');

  const readyCols = [];
  for (const col of columns) {
    const rec = calculateColumnRecoveryStatus(col, workoutEntries, referenceDateIso);
    if (rec.status === 'optimal' || rec.status === 'overdue') {
      readyCols.push({ col, rec });
    }
  }

  const pendingQuotes = quotes.filter(q => q.status === 'in_attesa' || q.status === 'bozza');
  const urgentTodos = todos.filter(t => !t.is_completed && (t.priority === 'urgente' || t.priority === 'alta'));

  const morningBriefText = [
    '🌅 Buongiorno Antonio! Briefing di oggi:',
    readyCols.length > 0
      ? `🏋️ Recupero Muscolare: ${readyCols.slice(0, 3).map(r => `${r.col.name} (${r.rec.days_since_last !== null ? `recuperato da ${r.rec.days_since_last} giorni` : 'fresco'})`).join(', ')} consigliati oggi.`
      : '🏋️ Recupero Muscolare: Tutti i gruppi allenati di recente, recupero attivo.',
    `💼 Lavoro: ${pendingQuotes.length} preventiv${pendingQuotes.length === 1 ? 'o' : 'i'} da verificare • ${urgentTodos.length} task prioritari.`,
  ].join('\n');

  const todayLog = dailyLogs.find(l => String(l.date).split('T')[0] === referenceDateIso);
  const needsEveningReminder = !todayLog || todayLog.calories_kcal == null || todayLog.sleep_hours == null;

  const eveningReminderText = needsEveningReminder
    ? [
        '🌙 Ciao Antonio! Non hai ancora registrato le calorie o il sonno di oggi.',
        'Rispondi direttamente a questo messaggio con i dati (es. "2450 kcal, 160g pro, 7h sonno") e li registro io!',
      ].join('\n')
    : null;

  return {
    morningBriefText,
    needsEveningReminder,
    eveningReminderText,
    readyCols,
    pendingQuotesCount: pendingQuotes.length,
    urgentTodosCount: urgentTodos.length,
  };
}
