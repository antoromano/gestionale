// supabase/functions/gemini-assistant/index.ts
// Proxy autenticato verso l'IA: le chiavi restano sul server (secret GEMINI_API_KEY e ANTHROPIC_API_KEY) e solo
// l'utente loggato può usarle (verify_jwt attivo). I modelli NON sono scritti nel codice: si scoprono dai fornitori.
//
// Due fornitori in fila: Gemini (modello "lite", senza ragionamento, con un tetto di pochi secondi) e, se fallisce,
// Claude. La risposta dice sempre chi ha risposto, così nell'app non ci sono successi finti.
//
// Azioni (POST JSON):
//   { action: "generate", system?, parts: [{text}|{inline_data}], temperature?, json? }  → { ok, data, model, provider, ms }
//   { action: "embed", text }                                                            → { ok, values, model }
//   { action: "diagnose" }                                                               → { ok, openai: {...}, gemini: {...}, anthropic: {...} }
// Errore: { ok: false, error: { code, message } } con HTTP 200 (così il client lo legge sempre e lo mostra).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { embed, diagnose } from "./gemini-core.js";
import { generateStructured, resolveAnthropicModel, anthropicGenerate, resolveOpenAIModel, openaiGenerate } from "./ai-providers.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const openaiKey = Deno.env.get("OPENAI_API_KEY") || "";
  const geminiKey = Deno.env.get("GEMINI_API_KEY") || "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (!openaiKey && !geminiKey && !anthropicKey) {
    return json({ ok: false, error: { code: "no_api_key", message: "Nessuna chiave IA configurata sul server (servono OPENAI_API_KEY, GEMINI_API_KEY o ANTHROPIC_API_KEY)." } });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: { code: "bad_request", message: "Richiesta non valida." } });
  }

  const env = {
    GEMINI_MODEL: Deno.env.get("GEMINI_MODEL") || "",
    GEMINI_EMBEDDING_MODEL: Deno.env.get("GEMINI_EMBEDDING_MODEL") || "",
    ANTHROPIC_MODEL: Deno.env.get("ANTHROPIC_MODEL") || "",
    OPENAI_MODEL: Deno.env.get("OPENAI_MODEL") || "",
    OPENAI_TRANSCRIBE_MODEL: Deno.env.get("OPENAI_TRANSCRIBE_MODEL") || "",
  };

  try {
    if (body.action === "generate") {
      const parts = Array.isArray(body.parts) ? body.parts : [{ text: String(body.prompt || "") }];
      const res = await generateStructured({
        openaiKey, geminiKey, anthropicKey, env, fetchFn: fetch,
        system: String(body.system || "").slice(0, 60000), parts,
        temperature: typeof body.temperature === "number" ? body.temperature : 0.1,
        json: body.json !== false,
      });
      return json({ ok: true, data: res.data, model: res.model, provider: res.provider, ms: res.ms, fallbackReason: res.fallbackReason });
    }

    if (body.action === "embed") {
      if (!geminiKey) return json({ ok: false, error: { code: "no_api_key", message: "Gli embedding richiedono GEMINI_API_KEY." } });
      const { values, model } = await embed({ apiKey: geminiKey, env, fetchFn: fetch, text: String(body.text || "").slice(0, 20000) });
      return json({ ok: true, values, model });
    }

    if (body.action === "diagnose") {
      const out: Record<string, unknown> = {};
      if (openaiKey) {
        try {
          const t0 = Date.now();
          const model = await resolveOpenAIModel(openaiKey, { fetchFn: fetch, env, force: true });
          const probe = await openaiGenerate({ apiKey: openaiKey, env, fetchFn: fetch, parts: [{ text: 'Rispondi con questo JSON: {"ok":true}' }], timeoutMs: 20000 });
          out.openai = { ok: true, model, probeOk: probe.data?.ok === true, ms: Date.now() - t0 };
        } catch (err: any) {
          out.openai = { ok: false, code: err?.code || "unavailable", message: err?.message };
        }
      } else {
        out.openai = { ok: false, code: "no_api_key", message: "OPENAI_API_KEY non configurata." };
      }
      if (geminiKey) {
        try {
          out.gemini = { ok: true, ...(await diagnose({ apiKey: geminiKey, env, fetchFn: fetch })) };
        } catch (err: any) {
          out.gemini = { ok: false, code: err?.code || "unavailable", message: err?.message };
        }
      } else {
        out.gemini = { ok: false, code: "no_api_key", message: "GEMINI_API_KEY non configurata." };
      }
      if (anthropicKey) {
        try {
          const t0 = Date.now();
          const model = await resolveAnthropicModel(anthropicKey, { fetchFn: fetch, env, force: true });
          const probe = await anthropicGenerate({ apiKey: anthropicKey, env, fetchFn: fetch, parts: [{ text: 'Rispondi con {"ok":true}' }], temperature: 0 });
          out.anthropic = { ok: true, model, probeOk: probe.data?.ok === true, ms: Date.now() - t0 };
        } catch (err: any) {
          out.anthropic = { ok: false, code: err?.code || "unavailable", message: err?.message };
        }
      } else {
        out.anthropic = { ok: false, code: "no_api_key", message: "ANTHROPIC_API_KEY non configurata (riserva assente)." };
      }
      return json({ ok: true, ...out });
    }

    return json({ ok: false, error: { code: "bad_request", message: "Azione sconosciuta." } });
  } catch (err: any) {
    return json({ ok: false, error: { code: err?.code || "unavailable", message: err?.message || "Errore sconosciuto", details: err?.details || null } });
  }
});
