// supabase/functions/gemini-assistant/index.ts
// Proxy autenticato verso Gemini: la chiave API resta sul server (secret GEMINI_API_KEY) e solo l'utente loggato può usarla
// (verify_jwt attivo). I modelli NON sono scritti nel codice: si scoprono con models.list (vedi gemini-core.js).
//
// Azioni (POST JSON):
//   { action: "generate", system?, parts: [{text}|{inline_data}], temperature?, json? }  → { ok, data, model }
//   { action: "embed", text }                                                            → { ok, values, model }
//   { action: "diagnose" }                                                               → { ok, generateModel, embedModel, probeOk }
// Errore: { ok: false, error: { code, message } } con HTTP 200 (così il client lo legge sempre e lo mostra).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { generate, embed, diagnose } from "./gemini-core.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const apiKey = Deno.env.get("GEMINI_API_KEY") || "";
  if (!apiKey) {
    return json({ ok: false, error: { code: "no_api_key", message: "La chiave Gemini non è configurata sul server (secret GEMINI_API_KEY)." } });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: { code: "bad_request", message: "Richiesta non valida." } });
  }

  const env = { GEMINI_MODEL: Deno.env.get("GEMINI_MODEL") || "", GEMINI_EMBEDDING_MODEL: Deno.env.get("GEMINI_EMBEDDING_MODEL") || "" };

  try {
    if (body.action === "generate") {
      const parts = Array.isArray(body.parts) ? body.parts : [{ text: String(body.prompt || "") }];
      const { data, model } = await generate({
        apiKey, env, fetchFn: fetch, system: String(body.system || "").slice(0, 60000), parts,
        temperature: typeof body.temperature === "number" ? body.temperature : 0.1, json: body.json !== false,
      });
      return json({ ok: true, data, model });
    }
    if (body.action === "embed") {
      const { values, model } = await embed({ apiKey, env, fetchFn: fetch, text: String(body.text || "").slice(0, 20000) });
      return json({ ok: true, values, model });
    }
    if (body.action === "diagnose") {
      return json({ ok: true, ...(await diagnose({ apiKey, env, fetchFn: fetch })) });
    }
    return json({ ok: false, error: { code: "bad_request", message: "Azione sconosciuta." } });
  } catch (err: any) {
    return json({ ok: false, error: { code: err?.code || "unavailable", message: err?.message || "Errore sconosciuto", details: err?.details || null } });
  }
});
