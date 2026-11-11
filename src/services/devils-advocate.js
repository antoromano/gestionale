// src/services/devils-advocate.js
// Motore DETERMINISTICO della modalità "Avvocato del Diavolo".
// Raccoglie evidenze numeriche dai dati reali (preventivi, compravendita, Body) che vengono
//   1) iniettate nel payload di sistema per grounding dell'IA, e
//   2) usate come critica di fallback a zero token quando nessun modello IA è raggiungibile.

import { store } from './store.js';
import { computeHourlyProfit, computeTradingMetrics, localTodayIso, toNumber, addDaysIso, parseIsoDate } from './finances.js';

export const QUOTE_RISK_BUFFER = { minPercent: 25, maxPercent: 35 };
export const DEFAULT_ASSUMED_FLIP_HOURS = 2;
export const PRODUCTIVE_HOURS_PER_DAY = 6;
export const STALE_STOCK_DAYS = 45;
export const MIN_HEALTHY_SLEEP_HOURS = 7;
export const LOW_SLEEP_HOURS = 6.5;

const TOPIC_KEYWORDS = {
  quotes: /preventiv|offerta|quotazion|consegn|scadenz|progetto|cliente|sito|e-?commerce|app\b|revision/i,
  trading: /compravendit|vinted|subito|ebay|flip|rivend|margine|acquist|vendit|rivendere/i,
  body: /allenam|allenar|allenat|sonno|dormit|trazion|pull[\s-]?up|dips|squat|stacch|overtrain|palestra|recupero|carich|infortun/i,
};

/** Quali aree critiche analizzare: dal modulo attivo e dalle parole chiave del prompt (se nulla, tutte). */
export function inferDevilsTopics(activeModule = null, prompt = '') {
  const topics = new Set();
  if (activeModule === 'quotes' || activeModule === 'clients') topics.add('quotes');
  if (activeModule === 'finances' || activeModule === 'expenses' || activeModule === 'reports') topics.add('trading');
  if (activeModule === 'body') topics.add('body');
  for (const [topic, regex] of Object.entries(TOPIC_KEYWORDS)) {
    if (regex.test(prompt || '')) topics.add(topic);
  }
  if (topics.size === 0) return ['quotes', 'trading', 'body'];
  return Array.from(topics);
}

export function getDevHourlyRate() {
  const rate = toNumber(store.getSettings().dev_hourly_rate, 0);
  return rate > 0 ? rate : 50;
}

function businessDaysBetween(fromIso, toIso) {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  if (!from || !to) return null;
  let count = 0;
  let cursor = fromIso;
  for (let i = 0; i < 800 && cursor < toIso; i++) {
    cursor = addDaysIso(cursor, 1);
    const day = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

function clientLabel(clientId) {
  const c = clientId ? store.getById('clients', clientId) : null;
  if (!c) return null;
  return c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || null;
}

/** Estrae importo e termine di consegna da una descrizione libera ("e-commerce a 3000€ in 10 giorni"). */
export function analyzePromptEstimate(prompt = '', rate = getDevHourlyRate()) {
  const text = String(prompt || '');
  const amountMatch = text.match(/(\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:€|euro\b|eur\b)/i);
  const daysMatch = text.match(/\b(?:in|entro|tra|fra)\s+(\d{1,3})\s*(giorni|gg|settiman[ae]|mesi)\b/i);
  if (!amountMatch || !daysMatch) return null;

  const amount = toNumber(amountMatch[1].replace(/[.\s](?=\d{3})/g, '').replace(',', '.'));
  const n = Number(daysMatch[1]);
  const unit = daysMatch[2].toLowerCase();
  const calendarDays = unit.startsWith('settiman') ? n * 7 : unit.startsWith('mes') ? n * 30 : n;
  // giorni di calendario -> giorni lavorativi (5/7)
  const workingDays = Math.max(1, Math.round(calendarDays * (5 / 7)));
  const impliedHours = rate > 0 ? amount / rate : null;
  const availableHours = workingDays * PRODUCTIVE_HOURS_PER_DAY;
  return {
    amount,
    calendarDays,
    workingDays,
    hourlyRate: rate,
    impliedHours: impliedHours !== null ? Math.round(impliedHours * 10) / 10 : null,
    availableHours,
    loadRatio: impliedHours !== null && availableHours > 0 ? Math.round((impliedHours / availableHours) * 100) / 100 : null,
  };
}

// ---------------------------------------------------------------------------
// PREVENTIVI
// ---------------------------------------------------------------------------

export function buildQuoteEvidence(prompt = '', todayIso = localTodayIso()) {
  const rate = getDevHourlyRate();
  const quotes = store.getAll('quotes');
  const open = quotes
    .filter(q => q.status === 'bozza' || q.status === 'inviato')
    .sort((a, b) => String(b.issue_date || '').localeCompare(String(a.issue_date || '')))
    .slice(0, 5);
  const accepted = quotes.filter(q => q.status === 'accettato');

  const words = (title) => String(title || '').toLowerCase().split(/[^a-zà-ù0-9]+/).filter(w => w.length >= 4);

  const pipeline = open.map(q => {
    const total = toNumber(q.agreed_total);
    const warnings = [];
    const conditions = String(q.conditions || '');
    const delivery = q.expected_delivery || null;

    if (!/revision|modific|correzion|round|feedback/i.test(conditions)) {
      warnings.push('Le condizioni non limitano le revisioni: rischio di revisioni infinite non pagate. Fissa max 2 round inclusi e una tariffa oraria per ogni round extra.');
    }
    if (!delivery) {
      warnings.push('Nessuna data di consegna concordata: senza una scadenza contrattuale il cliente può dilatare i tempi e l’acconto resta bloccato.');
    } else if (total > 0) {
      const impliedHours = total / rate;
      const workingDays = businessDaysBetween(todayIso, delivery);
      if (workingDays !== null) {
        if (workingDays <= 0) {
          warnings.push(`La consegna prevista (${delivery}) è già passata o è oggi.`);
        } else if (impliedHours > workingDays * PRODUCTIVE_HOURS_PER_DAY) {
          warnings.push(`Scadenza irrealistica: ~${Math.round(impliedHours)}h di lavoro implicite (a ${rate}€/h) in ${workingDays} giorni lavorativi (~${workingDays * PRODUCTIVE_HOURS_PER_DAY}h produttive).`);
        }
      }
    }

    const mine = words(q.title);
    const similar = accepted
      .filter(a => a.id !== q.id && (a.client_id === q.client_id || words(a.title).some(w => mine.includes(w))))
      .slice(0, 3)
      .map(a => ({ quote_number: a.quote_number, title: a.title, total: toNumber(a.agreed_total), work_status: a.work_status || null }));
    if (similar.length > 0 && total > 0) {
      const avg = similar.reduce((s, x) => s + x.total, 0) / similar.length;
      if (avg > 0 && total < avg * 0.8) {
        warnings.push(`Prezzo ${Math.round((1 - total / avg) * 100)}% sotto la media dei progetti simili già accettati (${Math.round(avg)}€).`);
      }
    }

    return {
      quote_number: q.quote_number,
      title: q.title,
      client: clientLabel(q.client_id),
      status: q.status,
      total,
      expected_delivery: delivery,
      bufferedRange: total > 0
        ? {
            min: Math.round(total * (1 + QUOTE_RISK_BUFFER.minPercent / 100)),
            max: Math.round(total * (1 + QUOTE_RISK_BUFFER.maxPercent / 100)),
          }
        : null,
      similarProjects: similar,
      warnings,
    };
  });

  const promptEstimate = analyzePromptEstimate(prompt, rate);
  const promptWarnings = [];
  if (promptEstimate && promptEstimate.loadRatio !== null) {
    if (promptEstimate.loadRatio > 1) {
      promptWarnings.push(`Con ${promptEstimate.amount}€ a ${rate}€/h hai ~${promptEstimate.impliedHours}h di lavoro, ma in ${promptEstimate.workingDays} giorni lavorativi ne hai ~${promptEstimate.availableHours}h produttive (carico ${Math.round(promptEstimate.loadRatio * 100)}%): scadenza irrealistica.`);
    } else if (promptEstimate.loadRatio > 0.8) {
      promptWarnings.push(`Carico al ${Math.round(promptEstimate.loadRatio * 100)}% delle ore produttive disponibili: nessun margine per imprevisti, applica il buffer.`);
    }
  }

  return {
    hourlyRate: rate,
    riskBuffer: { ...QUOTE_RISK_BUFFER },
    pipeline,
    promptEstimate,
    promptWarnings,
  };
}

// ---------------------------------------------------------------------------
// COMPRAVENDITA
// ---------------------------------------------------------------------------

export function buildTradingEvidence(todayIso = localTodayIso()) {
  const rate = getDevHourlyRate();
  const items = store.getAll('trading_items');
  const sold = items
    .filter(i => i.status === 'sold' && i.sale_price != null)
    .sort((a, b) => String(b.sale_date || '').localeCompare(String(a.sale_date || '')))
    .slice(0, 10);

  const evaluated = sold.map(item => {
    const hp = computeHourlyProfit(item, DEFAULT_ASSUMED_FLIP_HOURS);
    return {
      title: item.title,
      platform: item.platform,
      netProfit: hp ? hp.netProfit : null,
      hours: hp ? hp.hours : null,
      hoursAreEstimated: hp ? hp.isEstimated : true,
      hourlyProfit: hp ? hp.hourlyProfit : null,
      belowDevRate: hp && hp.hourlyProfit !== null ? hp.hourlyProfit < rate : false,
    };
  });

  const withHourly = evaluated.filter(e => e.hourlyProfit !== null);
  const avgHourlyProfit = withHourly.length > 0
    ? Math.round((withHourly.reduce((s, e) => s + e.hourlyProfit, 0) / withHourly.length) * 100) / 100
    : null;

  const staleStock = items
    .filter(i => i.status === 'in_stock')
    .map(i => ({
      title: i.title,
      capital: computeTradingMetrics(i).total_cost,
      daysInStock: Math.max(0, Math.round((Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${String(i.purchase_date).slice(0, 10)}T00:00:00Z`)) / 86400000)),
    }))
    .filter(i => i.daysInStock >= STALE_STOCK_DAYS);

  const warnings = [];
  if (avgHourlyProfit !== null && avgHourlyProfit < rate) {
    warnings.push(`Profitto orario medio reale ${avgHourlyProfit}€/h (commissioni incluse) contro ${rate}€/h della tua tariffa dev: ogni ora sulle rivendite ti costa ${Math.round((rate - avgHourlyProfit) * 100) / 100}€ di mancato guadagno.`);
  }
  const estimatedCount = evaluated.filter(e => e.hoursAreEstimated).length;
  if (estimatedCount > 0) {
    warnings.push(`${estimatedCount} articoli senza ore registrate: stimate ${DEFAULT_ASSUMED_FLIP_HOURS}h ciascuno (ricerca, foto, messaggi, spedizione). Registra il tempo reale per un dato affidabile.`);
  }
  if (staleStock.length > 0) {
    const capital = staleStock.reduce((s, i) => s + i.capital, 0);
    warnings.push(`${staleStock.length} articoli fermi da oltre ${STALE_STOCK_DAYS} giorni immobilizzano ${Math.round(capital)}€: valuta un ribasso o l’uscita.`);
  }

  return {
    devHourlyRate: rate,
    soldItems: evaluated,
    avgHourlyProfit,
    belowRateCount: evaluated.filter(e => e.belowDevRate).length,
    staleStock,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// BODY
// ---------------------------------------------------------------------------

export function buildBodyEvidence(todayIso = localTodayIso()) {
  const logs = store.getAll('body_daily_logs');
  const entries = store.getAll('body_workout_entries');
  const since7 = addDaysIso(todayIso, -6);
  const since3 = addDaysIso(todayIso, -2);

  const lastWeekLogs = logs.filter(l => String(l.date).slice(0, 10) >= since7 && String(l.date).slice(0, 10) <= todayIso);
  const sleeps = lastWeekLogs.map(l => toNumber(l.sleep_hours, null)).filter(v => v !== null && v > 0);
  const avgSleep = sleeps.length > 0 ? Math.round((sleeps.reduce((s, v) => s + v, 0) / sleeps.length) * 100) / 100 : null;
  const shortNights = sleeps.filter(v => v < LOW_SLEEP_HOURS).length;

  const recent = entries.filter(e => {
    const d = String(e.date).slice(0, 10);
    return d >= since3 && d <= todayIso && String(e.raw_notation || '').trim();
  });
  const sessionDates = new Set(recent.map(e => String(e.date).slice(0, 10)));
  const perColumn = new Map();
  for (const e of recent) {
    perColumn.set(e.column_id, (perColumn.get(e.column_id) || 0) + 1);
  }
  const columns = store.getBodyColumns();
  const hitTwice = columns.filter(c => (perColumn.get(c.id) || 0) >= 2).map(c => c.name);
  const rpes = recent.map(e => toNumber(e.rpe, null)).filter(v => v !== null);
  const avgRpe = rpes.length > 0 ? Math.round((rpes.reduce((s, v) => s + v, 0) / rpes.length) * 10) / 10 : null;
  const trainedToday = entries.filter(e => String(e.date).slice(0, 10) === todayIso && String(e.raw_notation || '').trim()).length;

  let overtrainingRisk = 'basso';
  if (avgSleep !== null) {
    if (avgSleep < LOW_SLEEP_HOURS && sessionDates.size >= 2) overtrainingRisk = 'alto';
    else if (avgSleep < MIN_HEALTHY_SLEEP_HOURS && sessionDates.size >= 2) overtrainingRisk = 'medio';
  }
  if (hitTwice.length > 0 && overtrainingRisk === 'basso') overtrainingRisk = 'medio';
  if (avgRpe !== null && avgRpe >= 9 && sessionDates.size >= 2) overtrainingRisk = 'alto';

  const warnings = [];
  if (avgSleep !== null && avgSleep < MIN_HEALTHY_SLEEP_HOURS) {
    warnings.push(`Sonno medio ultimi 7 giorni ${avgSleep}h (${shortNights} notti sotto ${LOW_SLEEP_HOURS}h): il recupero muscolare e il sistema nervoso ne risentono.`);
  }
  if (sessionDates.size >= 2 && avgSleep !== null && avgSleep < MIN_HEALTHY_SLEEP_HOURS) {
    warnings.push(`${sessionDates.size} giorni di allenamento negli ultimi 3 con sonno scarso: rischio overtraining e infortuni da carichi eccessivi.`);
  }
  if (hitTwice.length > 0) {
    warnings.push(`Stesso gruppo allenato 2+ volte in 72h (${hitTwice.join(', ')}): fuori dalla finestra di recupero 48-72h.`);
  }
  if (avgRpe !== null && avgRpe >= 9) {
    warnings.push(`RPE medio recente ${avgRpe}/10: troppe serie vicine al cedimento.`);
  }
  if (sleeps.length === 0) {
    warnings.push('Nessun dato sul sonno negli ultimi 7 giorni: senza semaforo di recupero non puoi giudicare se allenarti oggi.');
  }

  return {
    avgSleep7d: avgSleep,
    shortNights,
    sessionsLast72h: sessionDates.size,
    trainedToday,
    columnsHitTwiceIn72h: hitTwice,
    avgRpe,
    overtrainingRisk,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Aggregazione, testo per il prompt e critica di fallback
// ---------------------------------------------------------------------------

export function buildDevilsAdvocateEvidence({ activeModule = null, prompt = '', todayIso = localTodayIso() } = {}) {
  const topics = inferDevilsTopics(activeModule, prompt);
  const evidence = { generatedAt: todayIso, topics };
  if (topics.includes('quotes')) evidence.quotes = buildQuoteEvidence(prompt, todayIso);
  if (topics.includes('trading')) evidence.trading = buildTradingEvidence(todayIso);
  if (topics.includes('body')) evidence.body = buildBodyEvidence(todayIso);
  return evidence;
}

/** Testo compatto delle evidenze da allegare al system prompt. */
export function formatDevilsEvidence(evidence) {
  if (!evidence) return '';
  const lines = [`EVIDENZE CALCOLATE DAI DATI REALI (data ${evidence.generatedAt}, aree: ${evidence.topics.join(', ')}):`];

  if (evidence.quotes) {
    const q = evidence.quotes;
    lines.push(`• PREVENTIVI — tariffa dev ${q.hourlyRate}€/h, buffer di rischio consigliato +${q.riskBuffer.minPercent}-${q.riskBuffer.maxPercent}%.`);
    for (const p of q.pipeline) {
      lines.push(`  - ${p.quote_number} "${p.title}" (${p.client || 'senza cliente'}, ${p.status}) ${p.total}€${p.bufferedRange ? ` → con buffer ${p.bufferedRange.min}-${p.bufferedRange.max}€` : ''}${p.expected_delivery ? `, consegna ${p.expected_delivery}` : ''}`);
      for (const s of p.similarProjects) lines.push(`    simile: ${s.quote_number} "${s.title}" ${s.total}€`);
      for (const w of p.warnings) lines.push(`    ⚠ ${w}`);
    }
    for (const w of q.promptWarnings) lines.push(`  ⚠ ${w}`);
  }
  if (evidence.trading) {
    const t = evidence.trading;
    lines.push(`• COMPRAVENDITA — profitto orario medio ${t.avgHourlyProfit ?? 'n.d.'}€/h vs tariffa dev ${t.devHourlyRate}€/h; ${t.belowRateCount} vendite sotto tariffa.`);
    for (const s of t.soldItems.slice(0, 5)) {
      lines.push(`  - ${s.title}: netto ${s.netProfit}€ in ${s.hours}h${s.hoursAreEstimated ? ' (stimate)' : ''} = ${s.hourlyProfit}€/h`);
    }
    for (const w of t.warnings) lines.push(`  ⚠ ${w}`);
  }
  if (evidence.body) {
    const b = evidence.body;
    lines.push(`• BODY — sonno medio 7gg ${b.avgSleep7d ?? 'n.d.'}h, sessioni ultime 72h ${b.sessionsLast72h}, rischio overtraining ${b.overtrainingRisk}.`);
    for (const w of b.warnings) lines.push(`  ⚠ ${w}`);
  }
  return lines.join('\n');
}

/**
 * Critica strutturata a zero token costruita SOLO dalle evidenze.
 * Stessa forma del campo `critique` che l'IA restituisce con il profilo devils_advocate.
 */
export function buildDevilsAdvocateReport(evidence) {
  const risks = [];
  const recommendations = [];
  let bufferPercent = null;
  let hourlyProfit = null;

  if (evidence?.quotes) {
    const q = evidence.quotes;
    for (const w of q.promptWarnings) risks.push(w);
    for (const p of q.pipeline) for (const w of p.warnings) risks.push(`${p.quote_number}: ${w}`);
    if (q.pipeline.length > 0 || q.promptEstimate) {
      bufferPercent = { min: q.riskBuffer.minPercent, max: q.riskBuffer.maxPercent };
      recommendations.push(`Applica un buffer di rischio del +${q.riskBuffer.minPercent}-${q.riskBuffer.maxPercent}% sul prezzo o sulle ore stimate, e lega ogni pagamento a milestone (acconto 30-50% prima di iniziare).`);
      recommendations.push('Limita le revisioni incluse (max 2 round) e prezza ogni round extra a tariffa oraria.');
    }
  }
  if (evidence?.trading) {
    const t = evidence.trading;
    for (const w of t.warnings) risks.push(w);
    hourlyProfit = t.avgHourlyProfit;
    if (t.avgHourlyProfit !== null && t.avgHourlyProfit < t.devHourlyRate) {
      recommendations.push(`Tieni solo le rivendite con margine netto ≥ ${t.devHourlyRate}€ per ora di lavoro (o automatizza/riduci i passaggi): sotto questa soglia il tempo rende di più sui progetti dev.`);
    }
  }
  if (evidence?.body) {
    const b = evidence.body;
    for (const w of b.warnings) risks.push(w);
    if (b.overtrainingRisk !== 'basso') {
      recommendations.push(`Rischio overtraining ${b.overtrainingRisk}: oggi riposo attivo o sessione leggera (RPE ≤ 7), e porta il sonno ≥ ${MIN_HEALTHY_SLEEP_HOURS}h prima di aumentare i carichi.`);
    }
  }

  let verdict;
  if (risks.length === 0) {
    verdict = 'Nessun segnale critico dai dati attuali — ma i dati sono pochi: più registri, più posso contraddirti.';
  } else if (risks.length >= 4) {
    verdict = `ALTO RISCHIO: ${risks.length} segnali critici. Non procedere finché non sono risolti.`;
  } else {
    verdict = `ATTENZIONE: ${risks.length} segnal${risks.length === 1 ? 'e critico' : 'i critici'} da risolvere prima di procedere.`;
  }

  return { verdict, risks, recommendations, buffer_percent: bufferPercent, hourly_profit: hourlyProfit, topics: evidence?.topics || [] };
}
