// supabase/functions/telegram-proactive/index.ts
// Edge Function per Proattività Scheduled su Telegram:
// - ?action=morning_brief (ore 08:30): Semaforo Recupero Muscolare (48-72h) + Scadenze Clienti & Preventivi
// - ?action=evening_check (ore 21:30): Controllo Biometria/Calorie/Sonno mancanti in data odierna

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendTelegramPush(botToken: string, chatId: string | number, text: string) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    }),
  });
  return res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
    const TELEGRAM_ALLOWED_USER_ID = Deno.env.get("TELEGRAM_ALLOWED_USER_ID") || "";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const urlObj = new URL(req.url);
    let action = urlObj.searchParams.get("action") || "";

    let reqBody: any = {};
    if (req.method === "POST") {
      try {
        reqBody = await req.json();
        if (!action && reqBody?.action) {
          action = reqBody.action;
        }
      } catch {
        // body non JSON o vuoto
      }
    }

    if (!action) {
      action = "morning_brief";
    }

    const botToken = reqBody?.botToken || TELEGRAM_BOT_TOKEN;
    const targetChatId = reqBody?.chatId || TELEGRAM_ALLOWED_USER_ID;

    if (!botToken || !targetChatId) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "TELEGRAM_BOT_TOKEN o TELEGRAM_ALLOWED_USER_ID mancanti nei Secrets.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      : null;

    const todayIso = new Date().toISOString().split("T")[0];

    // --- 1. EVENING REMINDER (ORE 21:30) ---
    if (action === "evening_check") {
      let hasCalories = false;
      let hasSleep = false;

      if (supabase) {
        const { data: todayLogs } = await supabase
          .from("body_daily_logs")
          .select("*")
          .eq("date", todayIso)
          .limit(1);

        const row = todayLogs?.[0];
        hasCalories = Boolean(row && row.calories_kcal != null);
        hasSleep = Boolean(row && row.sleep_hours != null);
      }

      if (!hasCalories || !hasSleep) {
        const eveningText = [
          "🌙 <b>Ciao Antonio! Non hai ancora registrato le calorie o il sonno di oggi.</b>",
          "",
          'Rispondi direttamente a questo messaggio con i dati (es. <code>"2450 kcal, 160g pro, 7.5h sonno, peso 75.1kg"</code>) e li registro io nella Matrice Body!',
        ].join("\n");

        const tgRes = await sendTelegramPush(botToken, targetChatId, eveningText);
        return new Response(
          JSON.stringify({ ok: true, action: "evening_check", reminder_sent: true, telegram_response: tgRes }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, action: "evening_check", reminder_sent: false, reason: "Dati odierni già completi" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- 2. MORNING BRIEF (ORE 08:30) ---
    const readyExercises: string[] = [];
    const recoveringExercises: string[] = [];
    let pendingQuotesCount = 0;
    let urgentTodosCount = 0;

    if (supabase) {
      const { data: columns } = await supabase
        .from("body_exercise_columns")
        .select("*")
        .eq("is_active", true)
        .order("position", { ascending: true });

      const { data: recentWorkouts } = await supabase
        .from("body_workout_entries")
        .select("column_id, date, raw_notation")
        .order("date", { ascending: false })
        .limit(100);

      const nowMs = new Date(`${todayIso}T08:30:00Z`).getTime();

      if (Array.isArray(columns) && columns.length > 0) {
        for (const col of columns) {
          const latest = (recentWorkouts || []).find(
            (w) => w.column_id === col.id && w.raw_notation && String(w.raw_notation).trim() !== ""
          );
          if (!latest) {
            readyExercises.push(`${col.name} (fresco)`);
            continue;
          }
          const lastMs = new Date(`${latest.date}T08:30:00Z`).getTime();
          const diffDays = Math.round((nowMs - lastMs) / (1000 * 60 * 60 * 24));
          if (diffDays >= 2) {
            readyExercises.push(`${col.name} (recuperato da ${diffDays}gg)`);
          } else {
            recoveringExercises.push(`${col.name} (${diffDays}gg fa)`);
          }
        }
      }

      // Controllo preventivi in attesa e to-do urgenti
      const { data: quotes } = await supabase
        .from("quotes")
        .select("id, title, status")
        .in("status", ["in_attesa", "bozza"]);
      pendingQuotesCount = quotes?.length || 0;

      const { data: todos } = await supabase
        .from("todos")
        .select("id, title, priority, is_completed")
        .eq("is_completed", false);
      urgentTodosCount = (todos || []).filter((t) => t.priority === "urgente" || t.priority === "alta").length;
    }

    const muscleLine =
      readyExercises.length > 0
        ? `🏋️ <b>Recupero Muscolare (Finestra 48-72h):</b> ${readyExercises.slice(0, 4).join(", ")} al 100%.`
        : `🏋️ <b>Recupero Muscolare:</b> Sessioni recenti registrate (${recoveringExercises.join(", ") || "Riposo attivo consigliato"}).`;

    const workLine =
      pendingQuotesCount > 0 || urgentTodosCount > 0
        ? `💼 <b>Lavoro:</b> ${pendingQuotesCount} preventiv${pendingQuotesCount === 1 ? "o" : "i"} da verificare • ${urgentTodosCount} task ad alta priorità.`
        : `💼 <b>Lavoro:</b> Nessuna scadenza critica pendente oggi.`;

    const briefMessage = [
      "🌅 <b>Buongiorno Antonio! Briefing di oggi:</b>",
      "",
      muscleLine,
      workLine,
      "",
      "<i>Invia una nota vocale o un messaggio quando vuoi per aggiornare Body o Second Brain.</i>",
    ].join("\n");

    const tgRes = await sendTelegramPush(botToken, targetChatId, briefMessage);

    return new Response(
      JSON.stringify({
        ok: true,
        action: "morning_brief",
        ready_exercises: readyExercises,
        pending_quotes: pendingQuotesCount,
        urgent_todos: urgentTodosCount,
        telegram_response: tgRes,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message || "Errore interno telegram-proactive" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
