// supabase/functions/gemini-assistant/index.ts
// Edge Function per l'assistente IA basato su Google Gemini (Multimodal: Testo, Immagini, Audio)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestPayload {
  prompt?: string;
  imageBase64?: string;
  imageMimeType?: string;
  audioBase64?: string;
  audioMimeType?: string;
  existingClients?: Array<{ id: string; name: string }>;
  currentDateIso?: string;
  timezone?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY non configurata sul server." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: RequestPayload = await req.json();
    const {
      prompt = "",
      imageBase64,
      imageMimeType = "image/jpeg",
      audioBase64,
      audioMimeType = "audio/webm",
      existingClients = [],
      currentDateIso = new Date().toISOString(),
      timezone = "Europe/Rome",
    } = body;

    const clientsListStr = existingClients.length > 0
      ? existingClients.map((c) => `- ID: "${c.id}", Nome: "${c.name}"`).join("\n")
      : "Nessun cliente presente nel database.";

    const systemInstruction = `
Sei l'assistente operativo per un gestionale professionale. Il tuo compito è estrarre to-do e/o appuntamenti strutturati a partire da messaggi dell'utente (testo, note vocali o immagini/documenti).

Data corrente di riferimento: ${currentDateIso}
Fuso orario dell'utente: ${timezone}

Clienti attualmente presenti nel gestionale:
${clientsListStr}

REGOLE CRUCIALI:
1. RICONOSCIMENTO MULTIPLO: Se il messaggio contiene più azioni o richieste (es. "Devo attivare un abbonamento per lavorare, fare le foto prodotti per Cliente A e preparare i contenuti per Cliente B"), genera PROPOSTE DISTINTE per ciascuna.
2. NON INVENTARE CLIENTI: Non trasformare mai il nome di un servizio o di un'azione in un cliente (es. "attivare un abbonamento" non ha cliente, client_id deve essere null o vuoto). Associa a un cliente esistente SOLO se il nome o un chiaro riferimento corrisponde a uno dei clienti in elenco. Se il cliente non esiste o è ambiguo, imposta client_name_proposed con il nome rilevato e client_id = null.
3. SCADENZE VS APPUNTAMENTI:
   - Se ha orario preciso o luogo o è un incontro/shooting -> crea un "appointment".
   - Se è un'attività da completare entro una data o senza orario specifico -> crea un "todo".
4. INTERPRETAZIONE DATE:
   - "oggi", "domani", "fra 3 giorni", "prossimo lunedì alle 15" devono essere convertite in ISO 8601 considerando la data corrente e il fuso orario ${timezone}. Se non è indicata una scadenza precisa per un to-do, lascia due_date null.
5. PREZZI/COMPENSI: Se menzionato un compenso o importo economico, estrailo in 'compensation_amount' (numero puro senza valuta).
6. FORMATO RISPOSTA: Rispondi ESCLUSIVAMENTE con un JSON valido strutturato come segue:
{
  "summary": "Breve riassunto di quanto compreso",
  "todos": [
    {
      "title": "Titolo chiaro e sintetico",
      "notes": "Dettagli o note estratte",
      "client_id": "UUID del cliente o null",
      "client_name_proposed": "Nome cliente se trovato ma senza ID o per disambiguazione",
      "due_date": "YYYY-MM-DDTHH:mm:ss o null",
      "priority": "bassa" | "media" | "alta" | "urgente",
      "compensation_amount": 0.00
    }
  ],
  "appointments": [
    {
      "title": "Titolo appuntamento o shooting",
      "description": "Note o dettagli",
      "location": "Luogo se presente",
      "client_id": "UUID del cliente o null",
      "client_name_proposed": "Nome cliente",
      "start_time": "YYYY-MM-DDTHH:mm:ss",
      "end_time": "YYYY-MM-DDTHH:mm:ss o null",
      "is_all_day": false,
      "is_shooting": true/false,
      "shooting_type": "es. Festa, Laurea, Prodotti, Ritratto",
      "compensation_amount": 0.00
    }
  ]
}
`;

    // Costruzione delle parti per Gemini 2.5 Flash / 1.5 Flash
    const contents: any[] = [];
    const parts: any[] = [];

    parts.push({ text: `${systemInstruction}\n\nRichiesta utente:\n${prompt}` });

    if (imageBase64) {
      parts.push({
        inline_data: {
          mime_type: imageMimeType,
          data: imageBase64,
        },
      });
    }

    if (audioBase64) {
      parts.push({
        inline_data: {
          mime_type: audioMimeType,
          data: audioBase64,
        },
      });
    }

    contents.push({ role: "user", parts });

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return new Response(
        JSON.stringify({ error: `Errore Gemini API (${geminiRes.status}): ${errText}` }),
        { status: geminiRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const geminiData = await geminiRes.json();
    const textOutput = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textOutput) {
      return new Response(
        JSON.stringify({ error: "Risposta vuota da Gemini" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let parsedResult;
    try {
      parsedResult = JSON.parse(textOutput);
    } catch {
      // Pulizia markdown backticks se presenti
      const cleanJson = textOutput.replace(/```json/g, "").replace(/```/g, "").trim();
      parsedResult = JSON.parse(cleanJson);
    }

    return new Response(JSON.stringify(parsedResult), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Errore sconosciuto" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
