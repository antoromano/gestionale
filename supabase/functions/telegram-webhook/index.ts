// supabase/functions/telegram-webhook/index.ts
// Collegamento a Deno: tutta la logica (e i test) sta in handler.js.
// Secrets necessari: TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_ID (obbligatorio), GEMINI_API_KEY (opzionale, per IA e /digest).
// Opzionali: GEMINI_MODEL, GEMINI_EMBEDDING_MODEL, TIMEZONE (default Europe/Rome).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { handleUpdate } from "./handler.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false, error: "Corpo della richiesta non valido" });
  }

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceKey) {
    return json(500, { ok: false, error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY mancanti: il bot non può salvare." });
  }

  const env: Record<string, string> = {};
  for (const key of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USER_ID", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_MODEL", "GEMINI_EMBEDDING_MODEL", "ANTHROPIC_MODEL", "TIMEZONE"]) {
    env[key] = Deno.env.get(key) || "";
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Le chiamate dal pannello Impostazioni vogliono la risposta vera: si attendono.
  const isPanelCall = typeof payload === "object" && payload !== null && "action" in (payload as Record<string, unknown>);
  if (isPanelCall) {
    const { status, body } = await handleUpdate(payload, { env, supabase, fetch });
    return json(status, body);
  }

  // Telegram vuole una conferma SUBITO: se tarda rimanda lo stesso messaggio e nascono i doppioni.
  // Quindi si conferma all'istante e il lavoro vero prosegue in sottofondo (il bot scrive l'esito in chat).
  const work = handleUpdate(payload, { env, supabase, fetch }).catch((err) => {
    console.error("telegram-webhook (in sottofondo):", err);
  });
  // @ts-ignore EdgeRuntime esiste solo in produzione su Supabase, non in locale
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
    // @ts-ignore
    EdgeRuntime.waitUntil(work);
  } else {
    await work;
  }
  return json(200, { ok: true, accepted: true });
});
