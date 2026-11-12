// src/services/telegram.js
// Servizio Client & Orchestratore per l'Integrazione Telegram Bot:
// - Stato Webhook e invio messaggio di test dalla schermata Impostazioni
// Il bot vero vive nella Edge Function (supabase/functions/telegram-webhook): qui resta solo la configurazione.

import { store } from './store.js';
import { getSupabase } from './supabase.js';

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
 * Riconosce i comandi del bot: "/queue testo", "/queue@NomeBot testo", "/digest".
 * @returns {{name: string, args: string}|null}
 */
export function parseTelegramCommand(text = '') {
  const m = String(text || '').trim().match(/^\/(queue|digest)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  return { name: m[1].toLowerCase(), args: (m[2] || '').trim() };
}

/** /queue <testo>: accoda la nota in ai_note_queue senza alcuna chiamata IA. */
function handleQueueCommand(args) {
  if (!args) {
    return {
      ok: true,
      intent: 'queue_help',
      replyText: [
        '📝 Usa /queue <testo> per accodare una nota senza consumare token.',
        'Esempio: /queue Pull Up 20(10,10,10,10) e ho speso 45€ di benzina',
        'Quando vuoi elaborarle tutte in una sola chiamata: /digest',
      ].join('\n'),
    };
  }
  const note = store.addQueuedNote(args, 'telegram');
  const count = store.getQueuedNotes().length;
  return {
    ok: true,
    intent: 'queue_add',
    note,
    queueSize: count,
    replyText: `📝 Nota accodata (${count} in coda). Usa /digest per elaborarle tutte insieme.`,
  };
}
