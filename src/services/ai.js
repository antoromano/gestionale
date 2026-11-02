// src/services/ai.js
// Gestione richieste AI (Gemini Edge Function con fallback euristico locale se non configurata)

import { store } from './store.js';
import { getSupabase } from './supabase.js';

export async function processAiPrompt({ prompt, imageBase64, imageMimeType, audioBase64, audioMimeType, preselectedClientId = null }) {
  const settings = store.getSettings();
  const allClients = store.getAll('clients');

  const existingClients = allClients.map(c => ({
    id: c.id,
    name: c.company_name || `${c.first_name} ${c.last_name}`.trim(),
  }));

  const payload = {
    prompt,
    imageBase64,
    imageMimeType,
    audioBase64,
    audioMimeType,
    existingClients,
    currentDateIso: new Date().toISOString(),
    timezone: settings.timezone || 'Europe/Rome',
    preselectedClientId,
  };

  const supabase = getSupabase();

  // 1. Prova prima con Supabase Edge Function se disponibile
  if (supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('gemini-assistant', {
        body: payload,
      });
      if (!error && data && (data.todos || data.appointments)) {
        return normalizeAiResponse(data, existingClients, preselectedClientId);
      }
    } catch (err) {
      console.warn('Edge function fallita o non raggiungibile:', err);
    }
  }

  // 2. Prova con chiamata diretta a Gemini se l'utente ha inserito la chiave nelle Impostazioni
  if (settings.gemini_api_key) {
    try {
      return await callDirectGemini(settings.gemini_api_key, payload, existingClients, preselectedClientId);
    } catch (err) {
      console.warn('Chiamata diretta Gemini fallita:', err);
    }
  }

  // 3. Fallback Euristico Locale (Smart Parser da client)
  // Consente di testare e utilizzare immediatamente l'applicazione anche offline o prima di inserire le credenziali API
  return localHeuristicParser(prompt, existingClients, preselectedClientId);
}

async function callDirectGemini(apiKey, payload, existingClients, preselectedClientId) {
  const clientsListStr = existingClients.length > 0
    ? existingClients.map(c => `- ID: "${c.id}", Nome: "${c.name}"`).join('\n')
    : 'Nessun cliente registrato.';

  const systemInstruction = `
Sei l'assistente operativo per un gestionale professionale. Estrai to-do e appuntamenti da questa richiesta.
Data odierna: ${payload.currentDateIso}
Fuso orario: ${payload.timezone}
Clienti registrati:
${clientsListStr}

REGOLE ESSENZIALI:
1. Riconosci richieste multiple (es. "Devo attivare un abbonamento per lavorare, fare le foto prodotti per Cliente A e preparare i contenuti per Cliente B") e genera proposte distinte.
2. NON inventare clienti. I servizi o le azioni non sono clienti. Se il cliente non è tra quelli elencati o è ambiguo, lascia client_id: null e compila client_name_proposed.
3. Distingui scadenze (todos) da appuntamenti (orario preciso, luogo o shooting).
4. Restituisci SOLO un JSON con questo schema:
{
  "summary": "Riassunto",
  "todos": [
    { "title": "string", "notes": "string", "client_id": "string|null", "client_name_proposed": "string", "due_date": "YYYY-MM-DDTHH:mm:ss|null", "priority": "bassa"|"media"|"alta"|"urgente", "compensation_amount": 0 }
  ],
  "appointments": [
    { "title": "string", "description": "string", "location": "string", "client_id": "string|null", "client_name_proposed": "string", "start_time": "YYYY-MM-DDTHH:mm:ss", "end_time": "string|null", "is_all_day": false, "is_shooting": false, "compensation_amount": 0 }
  ]
}
`;

  const parts = [{ text: `${systemInstruction}\n\nRichiesta utente:\n${payload.prompt}` }];

  if (payload.imageBase64) {
    parts.push({
      inline_data: {
        mime_type: payload.imageMimeType || 'image/jpeg',
        data: payload.imageBase64,
      },
    });
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    }),
  });

  if (!res.ok) {
    throw new Error(`Errore Gemini API: ${res.statusText}`);
  }

  const resData = await res.json();
  const text = resData.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = JSON.parse(text);
  return normalizeAiResponse(parsed, existingClients, preselectedClientId);
}

// Parser locale intelligente per fallback
function localHeuristicParser(text = '', existingClients = [], preselectedClientId = null) {
  const result = {
    summary: 'Proposte generate tramite analisi del testo',
    todos: [],
    appointments: [],
  };

  if (!text.trim()) {
    return result;
  }

  // Separa frasi e congiunzioni ("e", virgole, punti e virgola, "devo")
  const clauses = text
    .split(/\s*,\s*|\s+e\s+|\s*;\s*|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 3);

  const now = new Date();

  for (const clause of clauses) {
    const lower = clause.toLowerCase();
    let assignedClientId = preselectedClientId || null;
    let proposedClientName = '';

    // Cerca corrispondenza con clienti esistenti
    for (const client of existingClients) {
      if (lower.includes(client.name.toLowerCase())) {
        assignedClientId = client.id;
        proposedClientName = client.name;
        break;
      }
    }

    // Se non ha trovato un cliente esistente ma menziona "per [Nome]" o "cliente [Nome]"
    if (!assignedClientId) {
      const clientMatch = clause.match(/(?:per\s+(?:il\s+cliente\s+)?|cliente\s+)([A-Z][a-zA-Z0-9_\s]{2,20})/i);
      if (clientMatch && !/abbonamento|software|lavoro|casa|studio/i.test(clientMatch[1])) {
        proposedClientName = clientMatch[1].trim();
      }
    }

    // Rilevamento data/scadenza
    let dueDate = null;
    let isAppointment = false;
    let isShooting = lower.includes('shooting') || lower.includes('foto') || lower.includes('servizio fotografico');

    if (lower.includes('domani')) {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      dueDate = d.toISOString().split('T')[0] + 'T18:00:00';
    } else if (lower.includes('oggi')) {
      dueDate = now.toISOString().split('T')[0] + 'T18:00:00';
    } else if (lower.includes('fra 3 giorni') || lower.includes('tra 3 giorni')) {
      const d = new Date(now);
      d.setDate(d.getDate() + 3);
      dueDate = d.toISOString().split('T')[0] + 'T18:00:00';
    }

    // Riconoscimento orario es. "alle 15", "alle 10:30"
    const timeMatch = clause.match(/alle\s+(\d{1,2})(?::(\d{2}))?/i);
    if (timeMatch) {
      isAppointment = true;
      const h = parseInt(timeMatch[1], 10);
      const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const baseDate = dueDate ? new Date(dueDate) : new Date(now);
      baseDate.setHours(h, m, 0, 0);
      dueDate = baseDate.toISOString();
    }

    // Riconoscimento importo economico es. "500€", "300 euro"
    const priceMatch = clause.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro)/i);
    const compensation = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : 0;

    // Pulizia titolo
    let cleanTitle = clause
      .replace(/devo\s+/i, '')
      .replace(/^fare\s+/i, 'Fare ')
      .replace(/^preparare\s+/i, 'Preparare ')
      .replace(/^attivare\s+/i, 'Attivare ')
      .trim();

    cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);

    if (isAppointment || isShooting) {
      const startTime = dueDate || new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
      const endTime = new Date(new Date(startTime).getTime() + 2 * 3600 * 1000).toISOString();
      result.appointments.push({
        title: cleanTitle,
        description: `Rilevato da nota: "${clause}"`,
        location: '',
        client_id: assignedClientId,
        client_name_proposed: proposedClientName,
        start_time: startTime,
        end_time: endTime,
        is_all_day: !timeMatch,
        is_shooting: isShooting,
        shooting_type: isShooting ? 'Servizio fotografico' : '',
        compensation_amount: compensation,
      });
    } else {
      result.todos.push({
        title: cleanTitle,
        notes: `Generato automaticamente da nota: "${clause}"`,
        client_id: assignedClientId,
        client_name_proposed: proposedClientName,
        due_date: dueDate,
        priority: lower.includes('urgente') ? 'urgente' : 'media',
        compensation_amount: compensation,
      });
    }
  }

  return result;
}

function normalizeAiResponse(data, existingClients, preselectedClientId) {
  const todos = (data.todos || []).map(t => {
    let clientId = t.client_id || preselectedClientId || null;
    // Se il client_id non corrisponde a un ID valido reale, tenta di matcharlo per nome
    if (clientId && !existingClients.some(c => c.id === clientId)) {
      const found = existingClients.find(c => c.name.toLowerCase() === (t.client_name_proposed || '').toLowerCase());
      clientId = found ? found.id : null;
    }
    return {
      title: t.title || 'Nuovo To-do',
      notes: t.notes || '',
      client_id: clientId,
      client_name_proposed: t.client_name_proposed || '',
      due_date: t.due_date || null,
      priority: t.priority || 'media',
      compensation_amount: Number(t.compensation_amount) || 0,
    };
  });

  const appointments = (data.appointments || []).map(a => {
    let clientId = a.client_id || preselectedClientId || null;
    if (clientId && !existingClients.some(c => c.id === clientId)) {
      const found = existingClients.find(c => c.name.toLowerCase() === (a.client_name_proposed || '').toLowerCase());
      clientId = found ? found.id : null;
    }
    return {
      title: a.title || 'Nuovo Appuntamento',
      description: a.description || '',
      location: a.location || '',
      client_id: clientId,
      client_name_proposed: a.client_name_proposed || '',
      start_time: a.start_time || new Date().toISOString(),
      end_time: a.end_time || null,
      is_all_day: Boolean(a.is_all_day),
      is_shooting: Boolean(a.is_shooting),
      shooting_type: a.shooting_type || '',
      compensation_amount: Number(a.compensation_amount) || 0,
    };
  });

  return {
    summary: data.summary || 'Proposte estratte con successo',
    todos,
    appointments,
  };
}
