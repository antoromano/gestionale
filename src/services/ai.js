// src/services/ai.js
// Gestione richieste AI (Gemini Edge Function con fallback euristico locale se non configurata)

import { store } from './store.js';
import { getSupabase } from './supabase.js';
import { querySecondBrain } from './brain.js';
import { DEFAULT_BODY_COLUMNS, parseWorkoutNotation } from '../utils/body-parser.js';

export async function processAiPrompt({
  prompt,
  imageBase64,
  imageMimeType,
  audioBase64,
  audioMimeType,
  preselectedClientId = null,
  existingClients: passedClients = null,
}) {
  const settings = store.getSettings();
  const allClients = store.getAll('clients');

  const existingClients = Array.isArray(passedClients) && passedClients.length > 0
    ? passedClients
    : allClients.map(c => ({
        id: c.id,
        name: c.company_name || `${c.first_name} ${c.last_name}`.trim(),
      }));

  // Recupera il contesto cognitivo ibrido dal Second Brain (Livello 1 + 2 + 3)
  const brainContext = await querySecondBrain(prompt || '');

  const payload = {
    prompt,
    imageBase64,
    imageMimeType,
    audioBase64,
    audioMimeType,
    existingClients,
    secondBrainContext: brainContext.synthesizedContext,
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
      if (!error && data && (data.todos || data.appointments || data.body_log)) {
        return {
          ...normalizeAiResponse(data, existingClients, preselectedClientId),
          brainContext,
        };
      }
    } catch (err) {
      console.warn('Edge function fallita o non raggiungibile:', err);
    }
  }

  // 2. Prova con chiamata diretta a Gemini se l'utente ha inserito la chiave nelle Impostazioni
  if (settings.gemini_api_key) {
    try {
      const res = await callDirectGemini(settings.gemini_api_key, payload, existingClients, preselectedClientId);
      return { ...res, brainContext };
    } catch (err) {
      console.warn('Chiamata diretta Gemini fallita:', err);
    }
  }

  // 3. Fallback Euristico Locale (Smart Parser da client)
  // Consente di testare e utilizzare immediatamente l'applicazione anche offline o prima di inserire le credenziali API
  const localRes = localHeuristicParser(prompt, existingClients, preselectedClientId);
  return { ...localRes, brainContext };
}

async function callDirectGemini(apiKey, payload, existingClients, preselectedClientId) {
  const clientsListStr = existingClients.length > 0
    ? existingClients.map(c => `- ID: "${c.id}", Nome: "${c.name}"`).join('\n')
    : 'Nessun cliente registrato.';

  const systemInstruction = `
Sei l'assistente operativo, on-boarding e bio-tracker per un software engineer/sviluppatore freelance.
Il tuo compito è analizzare la richiesta (anche note informali, audio trascritto, descrizioni di clienti o diario Body di allenamento/nutrizione) ed estrarre:
1. "clients_to_create": se l'utente descrive un cliente da registrare/importare (nome, azienda, email, telefono, staging_url, production_url, github_repo, stack tecnologico, canone di manutenzione mensile/annuale, note).
2. "todos": attività operative e to-do da svolgere.
3. "appointments": appuntamenti, rilasci/deploy, demo sprint, call tecniche o scadenze server/domini.
4. "body_log": se l'utente menziona peso corporeo, ore di sonno, calorie/macronutrienti (proteine, carbo, grassi) o esercizi svolti (Pull Up, Dips, Push Up, Affondi, Squat / Sissy, Femo, Stacchi, Cardio & Sport con notazione es. "30(7,8,8) + Presa Larga (15,15)", "Singolo Arto 10(12,12)").

Data odierna: ${payload.currentDateIso}
Fuso orario: ${payload.timezone}
Clienti già esistenti:
${clientsListStr}

Contesto Second Brain (Fatti Mem0, Memorie Semantiche e Knowledge Graph):
${payload.secondBrainContext || 'Nessun contesto preliminare'}

SCHEMA JSON DA RESTITUIRE OBBLIGATORIAMENTE (e nient'altro):
{
  "summary": "Breve riassunto dell'azione",
  "clients_to_create": [
    {
      "company_name": "string",
      "first_name": "string",
      "last_name": "string",
      "email": "string",
      "phone": "string",
      "staging_url": "string",
      "production_url": "string",
      "github_repo": "string",
      "stack": "string",
      "maintenance_amount": 0,
      "maintenance_frequency": "monthly"|"quarterly"|"annual",
      "notes": "string"
    }
  ],
  "todos": [
    { "title": "string", "notes": "string", "client_id": "string|null", "client_name_proposed": "string", "due_date": "YYYY-MM-DDTHH:mm:ss|null", "priority": "bassa"|"media"|"alta"|"urgente", "compensation_amount": 0 }
  ],
  "appointments": [
    { "title": "string", "description": "string", "location": "string", "client_id": "string|null", "client_name_proposed": "string", "start_time": "YYYY-MM-DDTHH:mm:ss", "end_time": "string|null", "is_all_day": false, "activity_type": "deploy"|"demo"|"call"|"server_deadline"|"general", "compensation_amount": 0 }
  ],
  "body_log": {
    "date": "YYYY-MM-DD",
    "sleep_hours": null,
    "body_weight_kg": null,
    "calories_kcal": null,
    "protein_g": null,
    "carbs_g": null,
    "fat_g": null,
    "workout_entries": [
      { "column_slug": "pull_up|dips|push_up|lunges|squat_sissy|hamstrings|deadlift|cardio_sport", "column_name": "string", "raw_notation": "string" }
    ]
  }
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

// Estrazione euristica Body Log (Biometria, Macro e Allenamento Matrice)
export function extractBodyLogFromText(text = '') {
  if (!text || !text.trim()) return null;

  const weightMatch = text.match(/(?:peso(?:\s+corporeo)?[:\s]*|pesato\s*)(\d{2,3}(?:[.,]\d{1,2})?)\s*kg\b/i)
    || text.match(/\b(\d{2,3}[.,]\d{1,2})\s*kg\b/i);
  const sleepMatch = text.match(/(?:dormito|sonno)[:\s]*(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:ore|h\b)/i)
    || text.match(/\b(\d{1,2}(?:[.,]\d{1,2})?)\s*ore\s+di\s+sonno/i);
  const kcalMatch = text.match(/(\d{3,4})\s*(?:kcal|calorie)\b/i);
  const protMatch = text.match(/(\d{2,3})\s*g?\s*(?:proteine|prot\b|pro\b)/i)
    || text.match(/(?:proteine|prot)[:\s]*(\d{2,3})\s*g?\b/i);
  const carbsMatch = text.match(/(\d{2,3})\s*g?\s*(?:carboidrati|carbo\b|cho\b)/i)
    || text.match(/(?:carboidrati|carbo)[:\s]*(\d{2,3})\s*g?\b/i);
  const fatMatch = text.match(/(\d{1,3})\s*g?\s*(?:grassi|fat\b|lipidi)/i)
    || text.match(/(?:grassi|fat)[:\s]*(\d{1,3})\s*g?\b/i);

  const columns = store.getBodyColumns?.() || DEFAULT_BODY_COLUMNS;
  const colFind = (slug, fallbackId) => columns.find(c => c.slug === slug || c.id === fallbackId) || { id: fallbackId, name: slug, category: 'pull', slug };

  const exerciseMatchers = [
    { col: colFind('pull_up', 'col-pull-up'), regex: /\b(?:pull[\s-]*up|trazioni|chin[\s-]*up)\b\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/gi },
    { col: colFind('dips', 'col-dips'), regex: /\b(?:dips|dip|parallele)\b\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/gi },
    { col: colFind('push_up', 'col-push-up'), regex: /\b(?:push[\s-]*up|piegamenti|flessioni|pike|pseudo\s+planche)\b\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/gi },
    { col: colFind('lunges', 'col-affondi'), regex: /\b(?:affondi(?:\s+bulgari|\s+camminati)?|bulgarian\s+split\s+squat)\b\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/gi },
    { col: colFind('squat_sissy', 'col-squat-sissy'), regex: /\b(?:squat|sissy(?:\s+squat)?|pistol\s+squat)\b\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/gi },
    { col: colFind('hamstrings', 'col-femo'), regex: /\b(?:femo|femorali|nordic\s+curl|leg\s+curl|sliding\s+curl)\b\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/gi },
    { col: colFind('deadlift', 'col-stacchi'), regex: /\b(?:stacchi(?:\s+rumeni|\s+sumo)?|stacco|rdl|deadlift)\b\s*[:=-]?\s*((?:[^,.;\n()]|\([^)]*\))+)/gi },
  ];

  const workoutMap = new Map();

  for (const item of exerciseMatchers) {
    let m;
    while ((m = item.regex.exec(text)) !== null) {
      let rawSeg = (m[1] || '').trim();
      // Normalizza eventuale "e <variante> (...)" interno allo stesso esercizio in " + <variante> (...)"
      rawSeg = rawSeg.replace(/\s+e\s+(?=(?:presa|anelli|archer|isometr|singolo|monopod|sissy|rumeno|bulgar|\d+\s*\(|\())/gi, ' + ');
      if (rawSeg && /\d/.test(rawSeg)) {
        const prev = workoutMap.get(item.col.id);
        const combined = prev ? `${prev.raw_notation} + ${rawSeg}` : rawSeg;
        workoutMap.set(item.col.id, {
          column_id: item.col.id,
          column_slug: item.col.slug,
          column_name: item.col.name,
          category: item.col.category,
          raw_notation: combined,
        });
      }
    }
  }

  // Rilevamento Cardio & Sport (es. "1h basket", "45 min corsa", "calcetto 1h", "stretching 20 min")
  const cardioCol = colFind('cardio_sport', 'col-cardio-sport');
  const cardioMatches = text.match(/\b(?:\d+(?:[.,]\d+)?\s*(?:h|ora|ore|min|minuti|'|\bkm)\s*(?:di\s+)?(?:basket|corsa|running|calcetto|bici|nuoto|corda|stretching|camminata|padel|tennis|cardio)|(?:basket|corsa|running|calcetto|bici|nuoto|corda|stretching|padel|tennis)\s+\d+(?:[.,]\d+)?\s*(?:h|ora|ore|min|minuti|'|km))\b/gi);
  if (cardioMatches && cardioMatches.length > 0) {
    workoutMap.set(cardioCol.id, {
      column_id: cardioCol.id,
      column_slug: cardioCol.slug,
      column_name: cardioCol.name,
      category: 'cardio',
      raw_notation: cardioMatches.map(s => s.trim()).join(' + '),
    });
  }

  const workout_entries = Array.from(workoutMap.values()).map(entry => {
    const parsed = parseWorkoutNotation(entry.raw_notation, entry.category);
    return {
      ...entry,
      raw_notation: parsed.normalized_notation || entry.raw_notation,
      parsed_blocks: parsed.blocks,
    };
  });

  const hasBiometrics = Boolean(weightMatch || sleepMatch || kcalMatch || protMatch || carbsMatch || fatMatch);
  if (!hasBiometrics && workout_entries.length === 0) {
    return null;
  }

  const now = new Date();
  let logDate = now.toISOString().split('T')[0];
  if (/\bieri\b/i.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    logDate = d.toISOString().split('T')[0];
  }

  return {
    date: logDate,
    sleep_hours: sleepMatch ? parseFloat(sleepMatch[1].replace(',', '.')) : null,
    body_weight_kg: weightMatch ? parseFloat(weightMatch[1].replace(',', '.')) : null,
    calories_kcal: kcalMatch ? parseInt(kcalMatch[1], 10) : null,
    protein_g: protMatch ? parseInt(protMatch[1], 10) : null,
    carbs_g: carbsMatch ? parseInt(carbsMatch[1], 10) : null,
    fat_g: fatMatch ? parseInt(fatMatch[1], 10) : null,
    workout_entries,
  };
}

// Parser locale intelligente per fallback
function localHeuristicParser(text = '', existingClients = [], preselectedClientId = null) {
  const result = {
    summary: 'Proposte generate tramite analisi del testo',
    clients_to_create: [],
    todos: [],
    appointments: [],
    body_log: null,
  };

  if (!text.trim()) {
    return result;
  }

  const lowerText = text.toLowerCase();

  // 0. Riconoscimento Diario Body (Biometria, Kcal/Macro e Allenamenti)
  const extractedBodyLog = extractBodyLogFromText(text);
  if (extractedBodyLog) {
    result.body_log = extractedBodyLog;
    const parts = [];
    if (extractedBodyLog.body_weight_kg) parts.push(`${extractedBodyLog.body_weight_kg} kg`);
    if (extractedBodyLog.calories_kcal) parts.push(`${extractedBodyLog.calories_kcal} kcal`);
    if (extractedBodyLog.workout_entries.length > 0) parts.push(`${extractedBodyLog.workout_entries.length} esercizi`);
    result.summary = `Rilevato Log Body giornaliero (${parts.join(' · ')})`;
  }

  // 1. Riconoscimento On-boarding Nuovo Cliente / Cliente Storico
  // Es: "Lavoro da mesi con Marco di TechCorp, canone 300€/mese, sito techcorp.it, staging stage.techcorp.it, repo antoromano/techcorp-web, stack Next.js e Supabase"
  const isOnboarding = /(?:lavoro|collaboro).+?con|nuovo cliente|cliente storico|aggiungi cliente|onboard|gestisco il cliente/i.test(text)
    || (/(?:sito|staging|repo|canone|stack)/i.test(text) && /(?:per|cliente|con)\s+([A-Z][a-zA-Z0-9_\s]{2,25})/i.test(text));

  if (isOnboarding) {
    let companyName = '';
    let firstName = '';
    let lastName = '';

    // Estrazione nome e azienda
    const withCompanyMatch = text.match(/(?:lavoro\s+(?:da\s+[\w\s]+\s+)?con|collaboro\s+(?:da\s+[\w\s]+\s+)?con|per|cliente)\s+([A-Z][a-zA-Z]+)(?:\s+([A-Z][a-zA-Z]+))?\s+di\s+([A-Z][a-zA-Z0-9_\s.-]+?)(?:,|\.|\s+da|\s+canone|\s+sito|\s+repo|$)/i);
    if (withCompanyMatch) {
      firstName = withCompanyMatch[1].trim();
      if (withCompanyMatch[2]) lastName = withCompanyMatch[2].trim();
      companyName = withCompanyMatch[3].trim();
    } else {
      const companyDirectMatch = text.match(/(?:cliente|azienda|ragione sociale)[:\s]+([A-Z][a-zA-Z0-9_\s.-]+?)(?:,|\.|\n|sito|repo|$)/i);
      if (companyDirectMatch) {
        companyName = companyDirectMatch[1].trim();
      } else {
        const nameMatch = text.match(/(?:lavoro(?:\s+da\s+[\w\s]+\s+)?con|collaboro\s+con|cliente)\s+([A-Z][a-zA-Z0-9_\s.-]{2,25})/i);
        if (nameMatch) {
          companyName = nameMatch[1].trim();
        }
      }
    }

    // Estrazione URLs
    const urls = text.match(/https?:\/\/[^\s,;)]+|www\.[^\s,;)]+|[a-zA-Z0-9-]+\.(?:it|com|io|app|dev|net|org)(?:\/[^\s,;)]*)?/gi) || [];
    let prodUrl = '';
    let stagingUrl = '';

    for (const u of urls) {
      const fullUrl = u.startsWith('http') ? u : `https://${u}`;
      if (/stage|staging|dev|test/i.test(u)) {
        if (!stagingUrl) stagingUrl = fullUrl;
      } else if (!/github\.com/i.test(u)) {
        if (!prodUrl) prodUrl = fullUrl;
      }
    }

    // Estrazione GitHub Repo
    let githubRepo = '';
    const repoMatch = text.match(/(?:github\.com\/|repo(?:\s+github)?[:\s]+)([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/i);
    if (repoMatch) {
      githubRepo = repoMatch[1].replace(/\.git$/, '');
    }

    // Estrazione Stack Tecnologico
    const techKeywords = ['React', 'Next.js', 'Next', 'Vue', 'Nuxt', 'Node.js', 'Node', 'TypeScript', 'JavaScript', 'Python', 'Django', 'FastAPI', 'Laravel', 'PHP', 'Supabase', 'PostgreSQL', 'Tailwind', 'Docker', 'AWS', 'Vercel', 'Shopify', 'WordPress', 'WooCommerce'];
    const detectedStack = [];
    for (const kw of techKeywords) {
      const reg = new RegExp(`\\b${kw.replace('.', '\\.')}\\b`, 'i');
      if (reg.test(text) && !detectedStack.includes(kw)) {
        detectedStack.push(kw);
      }
    }

    // Canone di manutenzione / ricorrente
    let maintenanceAmount = 0;
    let maintenanceFrequency = 'monthly';
    const canoneMatch = text.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro)\s*(?:\/|\s*al\s*)?(mese|mensile|mensili|anno|annuale|annui)?/i);
    if (canoneMatch && (lowerText.includes('canone') || lowerText.includes('manutenzione') || lowerText.includes('sla') || lowerText.includes('/mese') || lowerText.includes('mensil'))) {
      maintenanceAmount = parseFloat(canoneMatch[1].replace(',', '.'));
      if (canoneMatch[2] && /anno|annuale|annui/i.test(canoneMatch[2])) {
        maintenanceFrequency = 'annual';
      }
    }

    // Email & Phone
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = text.match(/(?:\+39\s?)?(?:3\d{2}[-.\s]?\d{6,7}|\d{2,4}[-.\s]?\d{5,8})/);

    if (companyName || firstName) {
      result.clients_to_create.push({
        company_name: companyName || (firstName ? `${firstName} ${lastName}`.trim() : 'Nuovo Cliente'),
        first_name: firstName,
        last_name: lastName,
        email: emailMatch ? emailMatch[0] : '',
        phone: phoneMatch ? phoneMatch[0] : '',
        staging_url: stagingUrl,
        production_url: prodUrl,
        github_repo: githubRepo,
        stack: detectedStack.join(', '),
        maintenance_amount: maintenanceAmount,
        maintenance_frequency: maintenanceFrequency,
        notes: text,
      });
      result.summary = `Rilevato nuovo profilo cliente (${companyName || firstName}) da acquisire nel gestionale`;
    }
  }

  // Separa frasi, periodi e congiunzioni ("e", virgole, punti, punti e virgola, "devo")
  const clauses = text
    .split(/\s*,\s*|\s+e\s+|\s*;\s*|\.\s+|\n+/)
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
      if (clientMatch && !/abbonamento|software|lavoro|casa|studio|server|dominio|deploy/i.test(clientMatch[1])) {
        proposedClientName = clientMatch[1].trim();
      }
    }

    // Rilevamento data/scadenza
    let dueDate = null;
    let isAppointment = false;
    let activityType = 'general';

    // Rilevamento tipologia attività dev
    if (lower.includes('deploy') || lower.includes('rilascio') || lower.includes('go-live') || lower.includes('messa in produzione')) {
      activityType = 'deploy';
      isAppointment = true;
    } else if (lower.includes('demo') || lower.includes('sprint') || lower.includes('review') || lower.includes('presentazione')) {
      activityType = 'demo';
      isAppointment = true;
    } else if (lower.includes('call') || lower.includes('meeting') || lower.includes('allineamento') || lower.includes('riunione')) {
      activityType = 'call';
      isAppointment = true;
    } else if (lower.includes('scadenza server') || lower.includes('scadenza dominio') || lower.includes('rinnovo ssl') || lower.includes('scadenza licenza')) {
      activityType = 'server_deadline';
      isAppointment = true;
    }

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
      .replace(/^eseguire\s+/i, 'Eseguire ')
      .trim();

    cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);

    // Salta frasi che descrivono puramente parametri del cliente onboarded
    if (isOnboarding && /^(sito|staging|repo|stack|canone|lavoro con|collaboro con)/i.test(clause)) {
      continue;
    }

    // Salta clausole che appartengono al Diario Body (peso, sonno, kcal, macro o serie di allenamento)
    if (result.body_log && /(?:peso|kg\b|dormito|sonno|kcal|calorie|proteine|carbo|grassi|allenamento|pull[\s-]*up|trazioni|dips|push[\s-]*up|piegamenti|affondi|squat|sissy|femo|stacchi|basket|corsa|calcetto|presa\s+larga|singolo\s+arto|\d+\s*\(\d+)/i.test(clause)) {
      continue;
    }

    if (isAppointment) {
      const startTime = dueDate || new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
      const endTime = new Date(new Date(startTime).getTime() + 1 * 3600 * 1000).toISOString();
      result.appointments.push({
        title: cleanTitle,
        description: `Rilevato da nota: "${clause}"`,
        location: activityType === 'call' ? 'Online / Google Meet' : '',
        client_id: assignedClientId,
        client_name_proposed: proposedClientName,
        start_time: startTime,
        end_time: endTime,
        is_all_day: !timeMatch,
        activity_type: activityType,
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
  const clients_to_create = (data.clients_to_create || []).map(c => ({
    company_name: c.company_name || 'Nuovo Cliente',
    first_name: c.first_name || '',
    last_name: c.last_name || '',
    email: c.email || '',
    phone: c.phone || '',
    staging_url: c.staging_url || '',
    production_url: c.production_url || '',
    github_repo: c.github_repo || '',
    stack: c.stack || '',
    maintenance_amount: Number(c.maintenance_amount) || 0,
    maintenance_frequency: c.maintenance_frequency || 'monthly',
    notes: c.notes || '',
  }));

  const todos = (data.todos || []).map(t => {
    let clientId = t.client_id || preselectedClientId || null;
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
      title: a.title || 'Nuovo Evento',
      description: a.description || '',
      location: a.location || '',
      client_id: clientId,
      client_name_proposed: a.client_name_proposed || '',
      start_time: a.start_time || new Date().toISOString(),
      end_time: a.end_time || null,
      is_all_day: Boolean(a.is_all_day),
      activity_type: a.activity_type || (a.is_shooting ? 'deploy' : 'general'),
      compensation_amount: Number(a.compensation_amount) || 0,
    };
  });

  let body_log = null;
  if (data.body_log && typeof data.body_log === 'object') {
    const columns = store.getBodyColumns?.() || DEFAULT_BODY_COLUMNS;
    const rawEntries = Array.isArray(data.body_log.workout_entries) ? data.body_log.workout_entries : [];
    const workout_entries = rawEntries
      .filter(e => e && e.raw_notation)
      .map(e => {
        const col = columns.find(c =>
          c.id === e.column_id
          || c.slug === e.column_slug
          || c.name.toLowerCase() === String(e.column_name || '').toLowerCase()
        ) || columns[0];
        const parsed = parseWorkoutNotation(e.raw_notation, col?.category || 'pull');
        return {
          column_id: col?.id || 'col-pull-up',
          column_slug: col?.slug || 'pull_up',
          column_name: col?.name || e.column_name || 'Esercizio',
          category: col?.category || 'pull',
          raw_notation: parsed.normalized_notation || e.raw_notation,
          parsed_blocks: parsed.blocks,
        };
      });

    const hasAnyValue = Boolean(
      data.body_log.sleep_hours
      || data.body_log.body_weight_kg
      || data.body_log.calories_kcal
      || data.body_log.protein_g
      || data.body_log.carbs_g
      || data.body_log.fat_g
      || workout_entries.length > 0
    );

    if (hasAnyValue) {
      body_log = {
        date: data.body_log.date || new Date().toISOString().split('T')[0],
        sleep_hours: data.body_log.sleep_hours != null ? Number(data.body_log.sleep_hours) : null,
        body_weight_kg: data.body_log.body_weight_kg != null ? Number(data.body_log.body_weight_kg) : null,
        calories_kcal: data.body_log.calories_kcal != null ? Number(data.body_log.calories_kcal) : null,
        protein_g: data.body_log.protein_g != null ? Number(data.body_log.protein_g) : null,
        carbs_g: data.body_log.carbs_g != null ? Number(data.body_log.carbs_g) : null,
        fat_g: data.body_log.fat_g != null ? Number(data.body_log.fat_g) : null,
        workout_entries,
      };
    }
  }

  return {
    summary: data.summary || 'Proposte estratte con successo',
    clients_to_create,
    todos,
    appointments,
    body_log,
  };
}
