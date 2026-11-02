// supabase/functions/google-calendar-sync/index.ts
// Edge Function per sincronizzazione bidirezionale con Google Calendar API

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Non autorizzato" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Identifica l'utente dal token JWT
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Token non valido" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, appointmentData, calendarId = "primary" } = await req.json();

    // Recupera le credenziali OAuth protette (salvate nelle impostazioni di sistema)
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const GOOGLE_REFRESH_TOKEN = Deno.env.get("GOOGLE_REFRESH_TOKEN");

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
      return new Response(
        JSON.stringify({
          status: "unconfigured",
          message: "Integrazione Google Calendar non configurata sul server. Imposta le credenziali nelle variabili d'ambiente di Supabase.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Refresh token per ottenere l'access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return new Response(
        JSON.stringify({ error: `Impossibile aggiornare il token Google: ${err}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { access_token } = await tokenRes.json();

    if (action === "push_event") {
      // Crea o aggiorna evento su Google Calendar
      const eventPayload: any = {
        summary: appointmentData.title,
        description: appointmentData.description || "",
        location: appointmentData.location || "",
      };

      if (appointmentData.is_all_day) {
        const dateStr = appointmentData.start_time.split("T")[0];
        eventPayload.start = { date: dateStr };
        eventPayload.end = { date: dateStr };
      } else {
        eventPayload.start = {
          dateTime: new Date(appointmentData.start_time).toISOString(),
          timeZone: appointmentData.timezone || "Europe/Rome",
        };
        eventPayload.end = {
          dateTime: new Date(appointmentData.end_time || appointmentData.start_time).toISOString(),
          timeZone: appointmentData.timezone || "Europe/Rome",
        };
      }

      let googleUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
      let method = "POST";

      if (appointmentData.google_event_id) {
        googleUrl += `/${encodeURIComponent(appointmentData.google_event_id)}`;
        method = "PUT";
      }

      const gRes = await fetch(googleUrl, {
        method,
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventPayload),
      });

      const gData = await gRes.json();
      return new Response(JSON.stringify({ status: "success", googleEvent: gData }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "pull_events") {
      // Importa eventi da Google Calendar
      const timeMin = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const googleUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&singleEvents=true&orderBy=startTime`;

      const gRes = await fetch(googleUrl, {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      const gData = await gRes.json();
      return new Response(JSON.stringify({ status: "success", items: gData.items || [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Azione sconosciuta" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
