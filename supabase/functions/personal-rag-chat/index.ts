// supabase/functions/personal-rag-chat/index.ts
// "Chiedi a te stesso": risponde a una domanda usando SOLO l'archivio personale dell'utente collegato
// (pezzi di documenti e vecchie chat, fatti salvati, dati vivi del gestionale consentiti dagli interruttori privacy).
//
// Sicurezza: verify_jwt attivo. Il database viene letto con il token dell'utente che chiama, quindi valgono le
// regole RLS: ognuno può interrogare solo i propri dati. Le chiavi dell'IA restano sul server.
//
// POST JSON: { question, history?: [{role:'user'|'assistant', content}], domain?: 'cucina'|'work'|'body'|'tech'|'personal' }
// Risposta:  { ok:true, answer, sources:[{id,type,label,...}], domain, suggestedRule, model, provider, context }
// Errore:    { ok:false, error:{ code, message } } con HTTP 200 (così l'app lo legge sempre e lo mostra).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { askPersonalRagServer } from "./rag-server.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authorization = req.headers.get("Authorization") || "";
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!url || !anonKey) return json({ ok: false, error: { code: "server_config", message: "Configurazione del server incompleta (SUPABASE_URL / SUPABASE_ANON_KEY)." } });
  if (!authorization) return json({ ok: false, error: { code: "unauthorized", message: "Devi accedere per usare la chat personale." } });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: { code: "bad_request", message: "Richiesta non valida." } });
  }
  const question = String(body?.question || "").trim().slice(0, 4000);
  if (!question) return json({ ok: false, error: { code: "bad_request", message: "Scrivi una domanda." } });

  const env: Record<string, string> = {};
  for (const key of ["OPENAI_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_MODEL", "OPENAI_EMBED_MODEL", "GEMINI_MODEL", "GEMINI_EMBEDDING_MODEL", "ANTHROPIC_MODEL", "TIMEZONE"]) {
    env[key] = Deno.env.get(key) || "";
  }
  if (!env.OPENAI_API_KEY && !env.GEMINI_API_KEY && !env.ANTHROPIC_API_KEY) {
    return json({ ok: false, error: { code: "no_api_key", message: "Nessuna chiave IA configurata sul server." } });
  }

  // Client con il token di chi chiama: le regole RLS limitano ogni lettura ai suoi dati
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const history = Array.isArray(body.history)
      ? body.history.slice(-8).map((h: any) => ({ role: h?.role === "assistant" ? "assistant" : "user", content: String(h?.content || "").slice(0, 4000) }))
      : [];
    const result = await askPersonalRagServer({ client, env, fetchFn: fetch, question, history, domain: typeof body.domain === "string" ? body.domain : null });
    return json({ ok: true, ...result });
  } catch (err: any) {
    return json({ ok: false, error: { code: err?.code || "unavailable", message: err?.message || "Errore sconosciuto" } });
  }
});
