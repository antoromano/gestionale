// supabase/functions/notion-sync/index.ts
// Edge Function per sincronizzazione To-do con Notion Database

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
    const NOTION_DATABASE_ID = Deno.env.get("NOTION_DATABASE_ID");

    if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
      return new Response(
        JSON.stringify({
          status: "unconfigured",
          message: "Integrazione Notion non configurata sul server. Inserisci NOTION_API_KEY e NOTION_DATABASE_ID.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { action, todoData } = await req.json();

    if (action === "sync_todo") {
      const notionHeaders = {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      };

      if (!todoData.notion_page_id) {
        // Creazione nuova pagina to-do in Notion
        const payload: any = {
          parent: { database_id: NOTION_DATABASE_ID },
          properties: {
            Name: {
              title: [{ text: { content: todoData.title } }],
            },
            Completato: {
              checkbox: Boolean(todoData.is_completed),
            },
          },
        };

        if (todoData.due_date) {
          payload.properties["Scadenza"] = {
            date: { start: todoData.due_date.split("T")[0] },
          };
        }

        const res = await fetch("https://api.notion.com/v1/pages", {
          method: "POST",
          headers: notionHeaders,
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        return new Response(JSON.stringify({ status: "success", notionPageId: data.id }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else {
        // Aggiornamento pagina esistente
        const payload: any = {
          properties: {
            Name: {
              title: [{ text: { content: todoData.title } }],
            },
            Completato: {
              checkbox: Boolean(todoData.is_completed),
            },
          },
        };

        const res = await fetch(`https://api.notion.com/v1/pages/${todoData.notion_page_id}`, {
          method: "PATCH",
          headers: notionHeaders,
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        return new Response(JSON.stringify({ status: "success", notionPageId: data.id }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Azione non supportata" }), {
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
