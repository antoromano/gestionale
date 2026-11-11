// supabase/functions/telegram-webhook/index.ts
// Edge Function Webhook Telegram:
// 1. Whitelist & Sicurezza (TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_ID)
// 2. Ingestion Multimodale (Note Vocali OGG, Foto Vision, Testo) tramite Gemini
// 3. Caso A: Riconoscimento diretto Body & Allenamenti (notazione 20(10,10,10,10), kcal, peso, sonno)
// 4. Caso B: 4° Livello di Protezione (Human-in-the-Loop) con Inline Keyboard su telegram_pending_actions per nuovi Macro-Domini
// 5. Coda Appunti: /queue <testo> accoda la nota in ai_note_queue (zero token), /digest le elabora tutte con UNA sola chiamata Gemini
//    (opzionale: secret GESTIONALE_OWNER_USER_ID = UUID Supabase Auth dell'utente, così RLS mostra le note anche all'app web)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ParsedWorkoutBlock {
  type: "strength" | "cardio";
  variant_name: string;
  unilateral: boolean;
  load_kg: number;
  sets: number[];
  total_sets: number;
  total_reps: number;
  max_reps: number;
  tonnage_kg: number;
  display_label: string;
}

/**
 * Parser compatibile con src/utils/body-parser.js per notazione compatta es. 20(10,10,10,10)
 */
function parseWorkoutNotationEdge(raw = "", category = "pull") {
  const text = String(raw || "").trim();
  if (!text) return { raw_notation: "", blocks: [], total_sets: 0, total_reps: 0, max_load_kg: 0 };

  const segments = text.split(/\s*\+\s*|\s*;\s*/).filter(Boolean);
  const blocks: ParsedWorkoutBlock[] = [];

  for (const seg of segments) {
    let working = seg.trim();
    let unilateral = false;
    let variantName = "Standard";

    if (/\b(singolo\s+arto|monopodalic[oa]|unilateral[ei]|1\s+gamba|1\s+braccio|bulgar[oa])\b/i.test(working)) {
      unilateral = true;
      working = working.replace(/\b(singolo\s+arto|monopodalic[oa]|unilateral[ei]|1\s+gamba|1\s+braccio)\b/gi, " ").trim();
    }
    if (/(?:^|\s)(\d+(?:[.,]\d+)?)?[sS]\s*\(/.test(working)) {
      unilateral = true;
      working = working.replace(/(^|\s)(\d+(?:[.,]\d+)?)?[sS]\s*\(/, "$1$2(");
    }

    const variantPatterns: Array<[RegExp, string]> = [
      [/\bpresa\s+larga\b/i, "Presa Larga"],
      [/\bpresa\s+stretta\b|\bchin\s*up\b/i, "Presa Stretta / Chin Up"],
      [/\bpresa\s+neutra\b/i, "Presa Neutra"],
      [/\bpseudo\s+planche\b/i, "Pseudo Planche"],
      [/\bpike\b/i, "Pike"],
      [/\bdiamond\b/i, "Diamond"],
      [/\banelli\b|\bring\b/i, "Anelli"],
      [/\barcier[ea]\b|\barcher\b/i, "Archer"],
      [/\bsissy\s*squat\b|\bsissy\b/i, "Sissy Squat"],
      [/\bbulgar[oi]\b/i, "Bulgaro"],
      [/\brumen[oi]\b|\brdl\b/i, "Rumeno (RDL)"],
    ];

    for (const [regex, full] of variantPatterns) {
      if (regex.test(working)) {
        variantName = full;
        working = working.replace(regex, " ").trim();
        break;
      }
    }

    let loadKg = 0;
    let sets: number[] = [];

    const loadParenMatch = working.match(/(\d+(?:[.,]\d+)?)\s*(?:kg)?\s*\(([^)]+)\)/i);
    if (loadParenMatch) {
      loadKg = parseFloat(loadParenMatch[1].replace(",", ".")) || 0;
      sets = parseSetsListEdge(loadParenMatch[2]);
    } else {
      const parenOnly = working.match(/\(([^)]+)\)/);
      if (parenOnly) {
        sets = parseSetsListEdge(parenOnly[1]);
      } else {
        sets = parseSetsListEdge(working);
      }
    }

    if (sets.length === 0) continue;

    const totalSets = sets.length;
    const totalReps = sets.reduce((acc, r) => acc + r, 0);
    const maxReps = Math.max(...sets, 0);
    const tonnageKg = loadKg > 0 ? loadKg * totalReps : 0;

    blocks.push({
      type: "strength",
      variant_name: variantName,
      unilateral,
      load_kg: loadKg,
      sets,
      total_sets: totalSets,
      total_reps: totalReps,
      max_reps: maxReps,
      tonnage_kg: tonnageKg,
      display_label: `${variantName !== "Standard" ? variantName + " " : ""}${unilateral ? "Singolo Arto " : ""}${loadKg > 0 ? loadKg + "kg " : ""}[${sets.join(", ")}]`,
    });
  }

  return {
    raw_notation: text,
    blocks,
    total_sets: blocks.reduce((s, b) => s + b.total_sets, 0),
    total_reps: blocks.reduce((s, b) => s + b.total_reps, 0),
    max_load_kg: blocks.reduce((m, b) => Math.max(m, b.load_kg || 0), 0),
  };
}

function parseSetsListEdge(inner = ""): number[] {
  const clean = inner.trim();
  const mult = clean.match(/^(\d+)\s*[xX*]\s*(\d+)$/);
  if (mult) {
    const a = parseInt(mult[1], 10);
    const b = parseInt(mult[2], 10);
    const [reps, count] = b <= 8 && a > b ? [a, b] : [b, a];
    return Array(Math.min(count, 30)).fill(reps);
  }
  return clean
    .split(/[\s,;/+-]+/)
    .map((n) => parseInt(n, 10))
    .filter((n) => !isNaN(n) && n > 0 && n < 1000);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function sendTelegramMessage(
  botToken: string,
  chatId: number | string,
  text: string,
  replyMarkup?: Record<string, unknown>
) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function editTelegramMessage(
  botToken: string,
  chatId: number | string,
  messageId: number,
  text: string
) {
  const url = `https://api.telegram.org/bot${botToken}/editMessageText`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
    }),
  });
  return res.json();
}

async function answerCallbackQuery(botToken: string, callbackQueryId: string, text?: string) {
  const url = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

async function downloadTelegramFileBase64(botToken: string, fileId: string): Promise<string> {
  const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
  const infoJson = await infoRes.json();
  const filePath = infoJson?.result?.file_path;
  if (!filePath) {
    throw new Error("Impossibile recuperare file_path da Telegram getFile");
  }
  const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
  const buf = await fileRes.arrayBuffer();
  return arrayBufferToBase64(buf);
}

/**
 * Chiama Gemini 1.5 Flash per trascrivere/analizzare testo, audio OGG o foto e classificare l'intento
 */
async function analyzeMultimodalWithGemini(options: {
  geminiKey: string;
  text?: string;
  audioBase64?: string;
  imageBase64?: string;
}) {
  const { geminiKey, text = "", audioBase64, imageBase64 } = options;

  const systemPrompt = `
Sei il motore cognitivo del Second Brain e del modulo Body di "Gestionale".
Ricevi un messaggio da Telegram (testo, nota vocale o immagine).
Devi restituire ESCLUSIVAMENTE un oggetto JSON valido con questa struttura:
{
  "intent": "body_log" | "new_open_domain" | "work_client_note",
  "transcription": "Trascrizione fedele del testo o dell'audio/foto",
  "domain": "body" | "work" | "client" | "tech" | "cucina" | "finance" | "auto" | "hobby" | "general",
  "domain_Display": "Etichetta leggibile es. Cucina / Ricette, Finanza Personale, Auto & Manutenzione",
  "domain_emoji": "🍳",
  "body_data": {
    "body_weight_kg": number | null,
    "sleep_hours": number | null,
    "calories_kcal": number | null,
    "protein_g": number | null,
    "carbs_g": number | null,
    "fat_g": number | null,
    "workouts": [
      {
        "exercise_name": "Pull Up" | "Dips" | "Push Up" | "Affondi" | "Squat / Sissy" | "Femo" | "Stacchi" | "Cardio & Sport",
        "raw_notation": "es. 20(10,10,10,10)"
      }
    ]
  },
  "open_domain_proposal": {
    "title": "Titolo sintetico",
    "node_label": "es. Carbonara",
    "node_type": "es. recipe, asset, vehicle, hobby, concept",
    "properties_summary": "es. 4 tuorli, 200g guanciale, 80g pecorino",
    "properties": { "ingrediente_1": "4 tuorli", "ingrediente_2": "200g guanciale" },
    "fact_subject": "es. Carbonara",
    "fact_key": "es. dosi_ottimali",
    "fact_value": "es. 4 tuorli, 200g guanciale, 80g pecorino",
    "relations": [
      { "source": "Carbonara", "source_type": "recipe", "relation": "RICHIEDE", "target": "Guanciale", "target_type": "concept" }
    ]
  }
}

REGOLE DI CLASSIFICAZIONE:
1. Se il messaggio riguarda allenamenti (es. Trazioni/Pull Up 20(10,10,10,10), Dips, Push Up, Squat, Affondi, serie/ripetizioni), peso corporeo (kg), calorie (kcal), proteine o ore di sonno -> "intent": "body_log", "domain": "body".
2. Se il messaggio riguarda un NUOVO MACRO-DOMINIO (es. Ricette di cucina, Finanza/Investimenti, Auto, Hobby, Libri, Film, Casa) o asserzioni complesse fuori dal lavoro/body -> "intent": "new_open_domain".
3. Altrimenti -> "intent": "work_client_note".
`;

  const parts: Array<Record<string, unknown>> = [{ text: `${systemPrompt}\n\nMessaggio utente:\n${text}` }];

  if (audioBase64) {
    parts.push({
      inline_data: {
        mime_type: "audio/ogg",
        data: audioBase64,
      },
    });
  }

  if (imageBase64) {
    parts.push({
      inline_data: {
        mime_type: "image/jpeg",
        data: imageBase64,
      },
    });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return JSON.parse(rawJson.replace(/```json/g, "").replace(/```/g, "").trim());
}

/**
 * Fallback euristico deterministico quando GEMINI_API_KEY non è attiva o per pattern testuali diretti
 */
function analyzeHeuristicText(text = "") {
  const clean = text.trim();
  const lower = clean.toLowerCase();

  // 1. Verifica pattern Body (notazione 20(10,10,10,10), kcal, peso, sonno)
  const weightMatch = clean.match(/(?:peso(?:\s+corporeo)?\s*[:=]?\s*|pesato\s+)(\d{2,3}(?:[.,]\d{1,2})?)\s*kg/i) ||
                      clean.match(/\b(\d{2}(?:[.,]\d{1,2}))\s*kg\b/i);
  const sleepMatch = clean.match(/(?:dormito|sonno)\s*[:=]?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:h|ore)?/i) ||
                     clean.match(/\b(\d{1,2}(?:[.,]\d)?)\s*(?:h|ore)\s+di\s+sonno\b/i);
  const kcalMatch = clean.match(/(\d{3,4})\s*kcal/i);
  const protMatch = clean.match(/(\d{2,3})\s*g?\s*(?:proteine|prot|pro)\b/i);
  const carbsMatch = clean.match(/(\d{2,3})\s*g?\s*(?:carboidrati|carbo|cho)\b/i);
  const fatMatch = clean.match(/(\d{1,3})\s*g?\s*(?:grassi|fat|lipidi)\b/i);

  const exerciseMap = [
    { name: "Pull Up", regex: /(?:pull\s*[-_]?up|trazioni|dorso)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i },
    { name: "Dips", regex: /(?:dips?|parallele)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i },
    { name: "Push Up", regex: /(?:push\s*[-_]?up|piegamenti)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i },
    { name: "Affondi", regex: /(?:affondi|lunges?)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i },
    { name: "Squat / Sissy", regex: /(?:squat|sissy(?:\s+squat)?)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i },
    { name: "Femo", regex: /(?:femo(?:rali)?|leg\s+curl)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i },
    { name: "Stacchi", regex: /(?:stacchi|stacco|deadlift|rdl)\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/i },
  ];

  const workouts: Array<{ exercise_name: string; raw_notation: string }> = [];
  for (const ex of exerciseMap) {
    const m = clean.match(ex.regex);
    if (m && m[1]) {
      workouts.push({ exercise_name: ex.name, raw_notation: m[1].trim() });
    }
  }

  const hasBodySignals =
    workouts.length > 0 || Boolean(weightMatch && (sleepMatch || kcalMatch)) || Boolean(kcalMatch) || Boolean(sleepMatch);

  if (hasBodySignals) {
    return {
      intent: "body_log",
      transcription: clean,
      domain: "body",
      domain_Display: "Body & Allenamento",
      domain_emoji: "🏋️",
      body_data: {
        body_weight_kg: weightMatch ? parseFloat(weightMatch[1].replace(",", ".")) : null,
        sleep_hours: sleepMatch ? parseFloat(sleepMatch[1].replace(",", ".")) : null,
        calories_kcal: kcalMatch ? parseInt(kcalMatch[1], 10) : null,
        protein_g: protMatch ? parseInt(protMatch[1], 10) : null,
        carbs_g: carbsMatch ? parseInt(carbsMatch[1], 10) : null,
        fat_g: fatMatch ? parseInt(fatMatch[1], 10) : null,
        workouts,
      },
    };
  }

  // 2. Rilevamento Nuovi Macro-Domini (Cucina/Ricette, Finanza, Auto, Hobby, ecc.)
  let domain = "general";
  let domainDisplay = "Conoscenza Generale";
  let domainEmoji = "🧠";
  let nodeType = "concept";

  if (/\b(ricetta|cucina|ingredienti|tuorli|guanciale|pecorino|cottura|pasta|carbonara|forno|grammi)\b/i.test(lower)) {
    domain = "cucina";
    domainDisplay = "Cucina / Ricette";
    domainEmoji = "🍳";
    nodeType = "recipe";
  } else if (/\b(etf|azioni| portafoglio|investiment[oi]|finanza|crypto|bitcoin|dividendi|conto|risparmio)\b/i.test(lower)) {
    domain = "finance";
    domainDisplay = "Finanza & Asset";
    domainEmoji = "📈";
    nodeType = "asset";
  } else if (/\b(auto|macchina|tagliando|gomme|assicurazione|bollo|km|motore|revisione)\b/i.test(lower)) {
    domain = "auto";
    domainDisplay = "Auto & Veicoli";
    domainEmoji = "🚗";
    nodeType = "vehicle";
  }

  const firstColon = clean.split(/[:\-–]/);
  const nodeLabel = firstColon.length > 1 && firstColon[0].trim().length <= 40
    ? firstColon[0].trim()
    : clean.split(/\s+/).slice(0, 3).join(" ");
  const propsSummary = firstColon.length > 1 ? firstColon.slice(1).join(": ").trim() : clean;

  return {
    intent: "new_open_domain",
    transcription: clean,
    domain,
    domain_Display: domainDisplay,
    domain_emoji: domainEmoji,
    open_domain_proposal: {
      title: `${domainDisplay}: ${nodeLabel}`,
      node_label: nodeLabel,
      node_type: nodeType,
      properties_summary: propsSummary,
      properties: { note: propsSummary, source: "telegram" },
      fact_subject: nodeLabel,
      fact_key: domain === "cucina" ? "dosi_e_preparazione" : "dettagli_principali",
      fact_value: propsSummary,
      relations: [],
    },
  };
}


// ---------------------------------------------------------------------------
// CODA APPUNTI (/queue, /digest) — specchio server-side di src/services/telegram.js
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseQueueCommand(text: string): { name: "queue" | "digest"; args: string } | null {
  const m = String(text || "").trim().match(/^\/(queue|digest)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  return { name: m[1].toLowerCase() as "queue" | "digest", args: (m[2] || "").trim() };
}

const INGESTION_BATCH_PROMPT = `
Sei un motore di ESTRAZIONE BATCH per "Gestionale". Ricevi N appunti numerati raccolti nell'arco della giornata.
Elabora TUTTI gli appunti in un'unica risposta (multi-intent), output compatto, ZERO convenevoli, SOLO JSON valido:
{
  "summary": "una riga per appunto nel formato 'n → destinazione'",
  "body_log": { "date": "YYYY-MM-DD", "sleep_hours": null, "body_weight_kg": null, "calories_kcal": null, "protein_g": null, "carbs_g": null, "fat_g": null,
                "workouts": [{ "exercise_name": "Pull Up|Dips|Push Up|Affondi|Squat / Sissy|Femo|Stacchi|Cardio & Sport", "raw_notation": "es. 20(10,10,10,10)" }] } | null,
  "finance_transactions": [{ "type": "income|expense", "amount": 0, "description": "", "category": "", "date": "YYYY-MM-DD" }],
  "trading_items": [{ "title": "", "platform": "Vinted|Subito|eBay|Altro", "purchase_price": 0, "extra_costs": 0, "platform_fees": 0, "sale_price": null, "status": "in_stock|reserved|sold" }],
  "todos": [{ "title": "" }],
  "appointments": [{ "title": "" }]
}
Regole: importi SEMPRE positivi (il segno lo dà "type"); più pasti nella stessa giornata si SOMMANO in un solo body_log; non inventare dati mancanti.
`;

async function extractQueueBatch(geminiKey: string, notes: Array<{ content: string }>, todayIso: string) {
  const numbered = notes.map((n, i) => `[${i + 1}] ${n.content}`).join("\n");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: `${INGESTION_BATCH_PROMPT}\nData odierna: ${todayIso}\n\nCODA APPUNTI (${notes.length}):\n${numbered}` }],
        }],
        generationConfig: { temperature: 0.05, responseMimeType: "application/json" },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return JSON.parse(raw.replace(/```json/g, "").replace(/```/g, "").trim());
}

// deno-lint-ignore no-explicit-any
async function applyQueueBatch(supabase: any, extraction: any, ownerUserId: string | null, todayIso: string) {
  const owner = ownerUserId ? { user_id: ownerUserId } : {};
  const applied = { body: false, workouts: 0, finance: 0, trading: 0, todos: 0, appointments: 0 };

  // Body: upsert del log giornaliero + celle esercizio
  const bd = extraction?.body_log;
  if (bd && typeof bd === "object") {
    const date = String(bd.date || todayIso).slice(0, 10);
    const daily: Record<string, unknown> = { date, ...owner };
    for (const key of ["body_weight_kg", "sleep_hours", "calories_kcal", "protein_g", "carbs_g", "fat_g"]) {
      if (bd[key] != null) daily[key] = bd[key];
    }
    const { data: existing } = await supabase.from("body_daily_logs").select("id").eq("date", date).limit(1);
    let dailyLogId: string | null = existing?.[0]?.id || null;
    if (dailyLogId) {
      await supabase.from("body_daily_logs").update({ ...daily, updated_at: new Date().toISOString() }).eq("id", dailyLogId);
    } else {
      const { data: inserted } = await supabase.from("body_daily_logs").insert(daily).select().single();
      dailyLogId = inserted?.id || null;
    }
    applied.body = true;

    for (const w of Array.isArray(bd.workouts) ? bd.workouts : []) {
      if (!w?.exercise_name || !w?.raw_notation) continue;
      const parsed = parseWorkoutNotationEdge(w.raw_notation);
      const { data: cols } = await supabase.from("body_exercise_columns").select("id").ilike("name", `%${w.exercise_name}%`).limit(1);
      const columnId = cols?.[0]?.id;
      if (!columnId) continue;
      await supabase.from("body_workout_entries").insert({
        daily_log_id: dailyLogId, date, column_id: columnId, raw_notation: w.raw_notation,
        parsed_blocks: parsed.blocks, feeling: "buono", ...owner,
      });
      applied.workouts++;
    }
  }

  // Finanze: importo sempre positivo, il segno è dato da type
  const finance = (Array.isArray(extraction?.finance_transactions) ? extraction.finance_transactions : [])
    .filter((t: any) => (t?.type === "income" || t?.type === "expense") && Number(t?.amount) > 0 && t?.description)
    .map((t: any) => ({
      type: t.type, amount: Math.abs(Number(t.amount)), description: String(t.description),
      category: t.category || "generale", date: String(t.date || todayIso).slice(0, 10), payment_method: "bonifico", ...owner,
    }));
  if (finance.length > 0) {
    const { error } = await supabase.from("finance_transactions").insert(finance);
    if (!error) applied.finance = finance.length;
  }

  // Compravendita: net_profit e roi_percent sono colonne GENERATED, non vanno inserite
  const trading = (Array.isArray(extraction?.trading_items) ? extraction.trading_items : [])
    .filter((t: any) => t?.title && Number(t?.purchase_price) >= 0)
    .map((t: any) => ({
      title: String(t.title), platform: ["Vinted", "Subito", "eBay"].includes(t.platform) ? t.platform : "Altro",
      purchase_price: Number(t.purchase_price) || 0, extra_costs: Number(t.extra_costs) || 0, platform_fees: Number(t.platform_fees) || 0,
      sale_price: t.sale_price != null ? Number(t.sale_price) : null,
      status: ["in_stock", "reserved", "sold"].includes(t.status) ? t.status : (t.sale_price != null ? "sold" : "in_stock"),
      purchase_date: todayIso, ...owner,
    }));
  if (trading.length > 0) {
    const { error } = await supabase.from("trading_items").insert(trading);
    if (!error) applied.trading = trading.length;
  }

  // To-do e appuntamenti vivono nel database locale dell'app: qui vengono solo elencati nella risposta
  applied.todos = Array.isArray(extraction?.todos) ? extraction.todos.length : 0;
  applied.appointments = Array.isArray(extraction?.appointments) ? extraction.appointments.length : 0;
  return applied;
}

// deno-lint-ignore no-explicit-any
async function handleQueueCommand(opts: {
  command: { name: "queue" | "digest"; args: string };
  supabase: any;
  geminiKey: string;
  ownerUserId: string | null;
  todayIso: string;
}): Promise<string> {
  const { command, supabase, geminiKey, ownerUserId, todayIso } = opts;
  if (!supabase) {
    return "⚠️ Coda appunti non disponibile: configura SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.";
  }

  if (command.name === "queue") {
    if (!command.args) {
      return [
        "📝 Usa <code>/queue &lt;testo&gt;</code> per accodare una nota senza consumare token.",
        "Esempio: <code>/queue Pull Up 20(10,10,10,10) e ho speso 45€ di benzina</code>",
        "Quando vuoi elaborarle tutte in una sola chiamata: <code>/digest</code>",
      ].join("\n");
    }
    const row: Record<string, unknown> = { content: command.args, source: "telegram", status: "queued" };
    if (ownerUserId) row.user_id = ownerUserId;
    const { error } = await supabase.from("ai_note_queue").insert(row);
    if (error) return `⚠️ Impossibile accodare la nota: ${escapeHtml(error.message)}`;
    const { count } = await supabase.from("ai_note_queue").select("id", { count: "exact", head: true }).eq("status", "queued");
    return `📝 Nota accodata (${count ?? "?"} in coda). Usa /digest per elaborarle tutte insieme.`;
  }

  // /digest: UNA sola chiamata Gemini per tutte le note in coda
  const { data: notes, error: notesErr } = await supabase
    .from("ai_note_queue").select("id, content, created_at").eq("status", "queued").order("created_at", { ascending: true }).limit(100);
  if (notesErr) return `⚠️ Impossibile leggere la coda: ${escapeHtml(notesErr.message)}`;
  if (!notes || notes.length === 0) return "📭 La coda appunti è vuota. Aggiungi note con /queue &lt;testo&gt;.";
  if (!geminiKey) return "⚠️ GEMINI_API_KEY non configurata: l'elaborazione in blocco non è disponibile.";

  try {
    const extraction = await extractQueueBatch(geminiKey, notes, todayIso);
    const applied = await applyQueueBatch(supabase, extraction, ownerUserId, todayIso);
    await supabase
      .from("ai_note_queue")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .in("id", notes.map((n: { id: string }) => n.id));

    const lines = [`✅ <b>Digest completato</b>: ${notes.length} ${notes.length === 1 ? "nota" : "note"} in 1 chiamata.`];
    if (applied.body) lines.push(`• 🏋️ Body: log del giorno aggiornato${applied.workouts ? ` (${applied.workouts} esercizi)` : ""}`);
    if (applied.finance) lines.push(`• 💶 Finanze: ${applied.finance} ${applied.finance === 1 ? "movimento" : "movimenti"}`);
    if (applied.trading) lines.push(`• 🏷️ Compravendita: ${applied.trading} ${applied.trading === 1 ? "articolo" : "articoli"}`);
    if (applied.todos) lines.push(`• 📋 ${applied.todos} to-do individuati (da inserire nell'app)`);
    if (applied.appointments) lines.push(`• 📅 ${applied.appointments} eventi individuati (da inserire nell'app)`);
    if (extraction?.summary) lines.push("", escapeHtml(String(extraction.summary)).slice(0, 900));
    return lines.join("\n");
  } catch (err) {
    // Le note restano in coda: nessuna perdita di dati
    return `⚠️ Digest non riuscito (le note restano in coda): ${escapeHtml((err as Error).message || "errore sconosciuto")}`;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
    const TELEGRAM_ALLOWED_USER_ID = Deno.env.get("TELEGRAM_ALLOWED_USER_ID") || "";
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const OWNER_USER_ID = Deno.env.get("GESTIONALE_OWNER_USER_ID") || null;

    const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      : null;

    const payload = await req.json();

    // --- SUPPORTO CHIAMATA DI TEST / STATO DALLA SCHERMATA IMPOSTAZIONI ---
    if (payload?.action === "check_status") {
      return new Response(
        JSON.stringify({
          ok: true,
          configured: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_ALLOWED_USER_ID),
          has_bot_token: Boolean(TELEGRAM_BOT_TOKEN),
          has_allowed_user: Boolean(TELEGRAM_ALLOWED_USER_ID),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (payload?.action === "send_test_message") {
      const tokenToUse = payload.botToken || TELEGRAM_BOT_TOKEN;
      const chatIdToUse = payload.chatId || TELEGRAM_ALLOWED_USER_ID;

      if (!tokenToUse || !chatIdToUse) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "Configura TELEGRAM_BOT_TOKEN e TELEGRAM_ALLOWED_USER_ID nei Secrets di Supabase o nei campi di test.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tgRes = await sendTelegramMessage(
        tokenToUse,
        chatIdToUse,
        "🟢 <b>Gestionale & Second Brain Connesso!</b>\n\nIl Webhook Telegram è operativo.\n• Puoi inviare note vocali, foto o testo.\n• Gli allenamenti (es. <code>Pull Up 20(10,10,10,10)</code>) vengono registrati nella Matrice Body.\n• I nuovi macro-domini attivano il <b>4° Livello di Protezione</b> con conferma Inline Keyboard."
      );

      return new Response(JSON.stringify({ ok: Boolean(tgRes?.ok), telegram_response: tgRes }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- 1. GESTIONE CALLBACK QUERIES (4° LIVELLO DI PROTEZIONE: CONFERMA / IGNORA) ---
    if (payload?.callback_query) {
      const cb = payload.callback_query;
      const cbId = cb.id;
      const chatId = cb.message?.chat?.id;
      const messageId = cb.message?.message_id;
      const fromId = cb.from?.id;
      const dataStr: string = cb.data || "";

      if (
        TELEGRAM_ALLOWED_USER_ID &&
        String(fromId) !== String(TELEGRAM_ALLOWED_USER_ID) &&
        String(chatId) !== String(TELEGRAM_ALLOWED_USER_ID)
      ) {
        await answerCallbackQuery(TELEGRAM_BOT_TOKEN, cbId, "Non autorizzato.");
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
      }

      const [actionVerb, pendingId] = dataStr.split(":");

      if (actionVerb === "reject" && pendingId) {
        if (supabase) {
          await supabase
            .from("telegram_pending_actions")
            .update({ status: "rejected" })
            .eq("id", pendingId);
        }
        await answerCallbackQuery(TELEGRAM_BOT_TOKEN, cbId, "Operazione ignorata");
        if (chatId && messageId) {
          await editTelegramMessage(
            TELEGRAM_BOT_TOKEN,
            chatId,
            messageId,
            "❌ <b>Operazione ignorata.</b>\nNessun dato è stato scritto nel Second Brain."
          );
        }
        return new Response(JSON.stringify({ ok: true, status: "rejected" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (actionVerb === "confirm" && pendingId && supabase) {
        const { data: pendingRow, error: pendErr } = await supabase
          .from("telegram_pending_actions")
          .select("*")
          .eq("id", pendingId)
          .single();

        if (pendErr || !pendingRow || pendingRow.status !== "pending") {
          await answerCallbackQuery(TELEGRAM_BOT_TOKEN, cbId, "Richiesta già elaborata o scaduta.");
          return new Response(JSON.stringify({ ok: false, error: "Pending action not found" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const prop = pendingRow.proposed_payload || {};
        const domain = pendingRow.domain || "general";
        const userId = pendingRow.user_id || null;

        // 1. Inserisce Memoria Semantica (Livello 1)
        const { data: memRow } = await supabase
          .from("brain_memories")
          .insert({
            user_id: userId,
            title: prop.title || `Nota Telegram (${domain})`,
            content: prop.raw_text || prop.properties_summary || "",
            summary: prop.properties_summary || "",
            domain,
            source_type: "telegram",
            tags: [domain, "telegram"],
          })
          .select()
          .single();

        // 2. Upsert Nodo nel Knowledge Graph (Livello 3)
        let createdNodeId: string | null = null;
        if (prop.node_label) {
          const { data: existingNodes } = await supabase
            .from("brain_nodes")
            .select("*")
            .ilike("label", prop.node_label)
            .eq("node_type", prop.node_type || "concept")
            .limit(1);

          if (existingNodes && existingNodes.length > 0) {
            createdNodeId = existingNodes[0].id;
            await supabase
              .from("brain_nodes")
              .update({
                properties: { ...(existingNodes[0].properties || {}), ...(prop.properties || {}) },
                updated_at: new Date().toISOString(),
              })
              .eq("id", createdNodeId);
          } else {
            const { data: newNode } = await supabase
              .from("brain_nodes")
              .insert({
                user_id: userId,
                label: prop.node_label,
                node_type: prop.node_type || "concept",
                properties: prop.properties || {},
              })
              .select()
              .single();
            createdNodeId = newNode?.id || null;
          }
        }

        // 3. Upsert Fatto Atomico Mem0 (Livello 2) con storicizzazione
        if (prop.fact_subject && prop.fact_key && prop.fact_value) {
          const { data: prevFacts } = await supabase
            .from("brain_facts")
            .select("*")
            .ilike("subject", prop.fact_subject)
            .ilike("fact_key", prop.fact_key)
            .eq("is_active", true);

          const { data: newFact } = await supabase
            .from("brain_facts")
            .insert({
              user_id: userId,
              subject: prop.fact_subject,
              fact_key: prop.fact_key,
              fact_value: prop.fact_value,
              category: domain,
              is_active: true,
              source_memory_id: memRow?.id || null,
            })
            .select()
            .single();

          if (prevFacts && prevFacts.length > 0 && newFact) {
            for (const pf of prevFacts) {
              if (pf.id !== newFact.id) {
                await supabase
                  .from("brain_facts")
                  .update({
                    is_active: false,
                    superseded_by: newFact.id,
                    valid_to: new Date().toISOString(),
                  })
                  .eq("id", pf.id);
              }
            }
          }
        }

        // 4. Aggiorna stato in telegram_pending_actions
        await supabase
          .from("telegram_pending_actions")
          .update({ status: "confirmed" })
          .eq("id", pendingId);

        await answerCallbackQuery(TELEGRAM_BOT_TOKEN, cbId, "Salvato nel Second Brain!");
        if (chatId && messageId) {
          await editTelegramMessage(
            TELEGRAM_BOT_TOKEN,
            chatId,
            messageId,
            `✅ <b>Salvato nel Second Brain!</b>\n• Dominio: <code>${domain}</code>\n• Nodo: <b>${prop.node_label || "-"}</b> (${prop.node_type || "concept"})\n• Fatto Mem0: <code>${prop.fact_key || "info"}</code> = ${prop.fact_value || "-"}`
          );
        }

        return new Response(JSON.stringify({ ok: true, status: "confirmed" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // --- 2. GESTIONE MESSAGGIO IN INGRESSO (TESTO, VOCALE OGG, FOTO) ---
    const msg = payload?.message || payload?.edited_message;
    if (!msg) {
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const chatId = msg.chat?.id;
    const fromId = msg.from?.id;

    // Controllo Whitelist Utente Autorizzato
    if (
      TELEGRAM_ALLOWED_USER_ID &&
      String(fromId) !== String(TELEGRAM_ALLOWED_USER_ID) &&
      String(chatId) !== String(TELEGRAM_ALLOWED_USER_ID)
    ) {
      if (TELEGRAM_BOT_TOKEN && chatId) {
        await sendTelegramMessage(
          TELEGRAM_BOT_TOKEN,
          chatId,
          "⛔ Non sei autorizzato ad accedere a questo Gestionale."
        );
      }
      return new Response(JSON.stringify({ ok: false, unauthorized: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Registra/aggiorna il subscriber autorizzato
    if (supabase && chatId) {
      await supabase.from("telegram_bot_subscribers").upsert(
        {
          chat_id: chatId,
          username: msg.from?.username || null,
          first_name: msg.from?.first_name || "Antonio",
          is_authorized: true,
        },
        { onConflict: "chat_id" }
      );
    }

    // Comandi Coda Appunti: /queue <testo> (accoda, zero token) e /digest (elabora tutto in 1 chiamata)
    const queueCommand = parseQueueCommand(msg.text || "");
    if (queueCommand) {
      const replyText = await handleQueueCommand({
        command: queueCommand,
        supabase,
        geminiKey: GEMINI_API_KEY,
        ownerUserId: OWNER_USER_ID,
        todayIso: new Date().toISOString().split("T")[0],
      });
      if (TELEGRAM_BOT_TOKEN && chatId) {
        await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, replyText);
      }
      return new Response(JSON.stringify({ ok: true, intent: queueCommand.name, reply: replyText }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Estrazione contenuto multimodale (Testo, Audio OGG o Foto JPEG)
    const rawText = msg.text || msg.caption || "";
    let audioBase64: string | undefined;
    let imageBase64: string | undefined;

    if ((msg.voice?.file_id || msg.audio?.file_id) && TELEGRAM_BOT_TOKEN) {
      const fileId = msg.voice?.file_id || msg.audio?.file_id;
      audioBase64 = await downloadTelegramFileBase64(TELEGRAM_BOT_TOKEN, fileId);
    }

    if (Array.isArray(msg.photo) && msg.photo.length > 0 && TELEGRAM_BOT_TOKEN) {
      const largestPhoto = msg.photo[msg.photo.length - 1];
      imageBase64 = await downloadTelegramFileBase64(TELEGRAM_BOT_TOKEN, largestPhoto.file_id);
    }

    // Analisi con Gemini Multimodal (o fallback euristico se solo testo)
    let analysis: any;
    if (GEMINI_API_KEY && (audioBase64 || imageBase64 || rawText)) {
      try {
        analysis = await analyzeMultimodalWithGemini({
          geminiKey: GEMINI_API_KEY,
          text: rawText,
          audioBase64,
          imageBase64,
        });
      } catch {
        analysis = analyzeHeuristicText(rawText);
      }
    } else {
      analysis = analyzeHeuristicText(rawText);
    }

    const todayIso = new Date().toISOString().split("T")[0];

    // --- CASO A: BODY & ALLENAMENTI (SCRITTURA DIRETTA NELLA MATRICE BODY) ---
    if (analysis.intent === "body_log" && analysis.body_data) {
      const bd = analysis.body_data;
      const summaryLines: string[] = ["✅ <b>Registrato in Sezione Body!</b>"];

      if (supabase) {
        const dailyPayload: Record<string, unknown> = { date: todayIso };
        if (bd.body_weight_kg != null) dailyPayload.body_weight_kg = bd.body_weight_kg;
        if (bd.sleep_hours != null) dailyPayload.sleep_hours = bd.sleep_hours;
        if (bd.calories_kcal != null) dailyPayload.calories_kcal = bd.calories_kcal;
        if (bd.protein_g != null) dailyPayload.protein_g = bd.protein_g;
        if (bd.carbs_g != null) dailyPayload.carbs_g = bd.carbs_g;
        if (bd.fat_g != null) dailyPayload.fat_g = bd.fat_g;

        const { data: existingLog } = await supabase
          .from("body_daily_logs")
          .select("*")
          .eq("date", todayIso)
          .limit(1);

        let dailyLogId: string | null = null;
        if (existingLog && existingLog.length > 0) {
          dailyLogId = existingLog[0].id;
          await supabase
            .from("body_daily_logs")
            .update({ ...dailyPayload, updated_at: new Date().toISOString() })
            .eq("id", dailyLogId);
        } else {
          const { data: insertedLog } = await supabase
            .from("body_daily_logs")
            .insert(dailyPayload)
            .select()
            .single();
          dailyLogId = insertedLog?.id || null;
        }

        // Registra gli esercizi in body_workout_entries
        if (Array.isArray(bd.workouts)) {
          for (const w of bd.workouts) {
            const parsed = parseWorkoutNotationEdge(w.raw_notation);
            const { data: cols } = await supabase
              .from("body_exercise_columns")
              .select("*")
              .ilike("name", `%${w.exercise_name}%`)
              .limit(1);

            let columnId = cols?.[0]?.id || null;
            if (!columnId) {
              const { data: newCol } = await supabase
                .from("body_exercise_columns")
                .insert({
                  name: w.exercise_name,
                  slug: w.exercise_name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
                  category: "pull",
                  target_frequency_days: 3,
                })
                .select()
                .single();
              columnId = newCol?.id || null;
            }

            if (columnId) {
              await supabase.from("body_workout_entries").insert({
                daily_log_id: dailyLogId,
                date: todayIso,
                column_id: columnId,
                raw_notation: w.raw_notation,
                parsed_blocks: parsed.blocks,
                feeling: "buono",
              });
            }

            const blockSummary = parsed.blocks.map((b) => b.display_label).join(" + ") || w.raw_notation;
            summaryLines.push(`• Esercizio: <b>${w.exercise_name}</b> ${blockSummary}`);
            summaryLines.push(`🚦 Semaforo ${w.exercise_name}: azzerato (prossimo stimolo tra 48-72h)`);
          }
        }
      }

      if (bd.body_weight_kg != null) summaryLines.push(`• Peso corporeo: <b>${bd.body_weight_kg} kg</b>`);
      if (bd.sleep_hours != null) summaryLines.push(`• Sonno: <b>${bd.sleep_hours} h</b>`);
      if (bd.calories_kcal != null) {
        const macroStr = bd.protein_g ? ` (P:${bd.protein_g}g C:${bd.carbs_g || 0}g G:${bd.fat_g || 0}g)` : "";
        summaryLines.push(`• Nutrizione: <b>${bd.calories_kcal} kcal</b>${macroStr}`);
      }

      if (TELEGRAM_BOT_TOKEN && chatId) {
        await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, summaryLines.join("\n"));
      }

      return new Response(
        JSON.stringify({ ok: true, intent: "body_log", summary: summaryLines.join("\n") }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- CASO B: NUOVO MACRO-DOMINIO / ENTITÀ APERTE (4° LIVELLO DI PROTEZIONE CON INLINE KEYBOARD) ---
    const prop = analysis.open_domain_proposal || {
      title: analysis.transcription?.slice(0, 50) || "Nuova Nota Telegram",
      node_label: "Nota",
      node_type: "concept",
      properties_summary: analysis.transcription || rawText,
      properties: { text: analysis.transcription || rawText },
      fact_subject: "Generale",
      fact_key: "nota",
      fact_value: analysis.transcription || rawText,
    };

    let pendingId = crypto.randomUUID();
    if (supabase && chatId) {
      const { data: insertedPending } = await supabase
        .from("telegram_pending_actions")
        .insert({
          telegram_chat_id: chatId,
          action_type: "ingest_new_domain",
          domain: analysis.domain || "general",
          proposed_payload: {
            ...prop,
            raw_text: analysis.transcription || rawText,
          },
          status: "pending",
        })
        .select()
        .single();

      if (insertedPending?.id) {
        pendingId = insertedPending.id;
      }
    }

    const emoji = analysis.domain_emoji || "🧠";
    const domainDisplay = analysis.domain_Display || analysis.domain || "Nuovo Argomento";
    const confirmationText = [
      `${emoji} <b>Rilevato nuovo argomento: ${domainDisplay}</b>`,
      `• Nodo: <b>${prop.node_label}</b> (${prop.node_type})`,
      `• Proprietà: ${prop.properties_summary}`,
      `• Fatto: <code>${prop.fact_key}</code> = ${prop.fact_value}`,
      ``,
      `Vuoi salvare questa entità nel Second Brain?`,
    ].join("\n");

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: "✅ Conferma e Salva", callback_data: `confirm:${pendingId}` },
          { text: "❌ Ignora", callback_data: `reject:${pendingId}` },
        ],
      ],
    };

    if (TELEGRAM_BOT_TOKEN && chatId) {
      await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, confirmationText, inlineKeyboard);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        intent: "new_open_domain",
        pending_id: pendingId,
        domain: analysis.domain,
        proposed_payload: prop,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message || "Errore interno telegram-webhook" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

