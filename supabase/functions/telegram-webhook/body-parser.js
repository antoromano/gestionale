// COPIA GENERATA da src/utils/body-parser.js con scripts/sync-edge-shared.mjs: NON modificare qui.
// src/utils/body-parser.js
// Parser Intelligente per Notazione Diario d'Allenamento (Matrice a Colonne) & Motore di Analisi Biometrica/Progressioni

export const DEFAULT_BODY_COLUMNS = [
  {
    id: 'col-pull-up',
    name: 'Pull Up',
    slug: 'pull_up',
    category: 'pull',
    target_frequency_days: 3,
    available_variants: ['Standard', 'Presa Larga', 'Presa Stretta / Chin Up', 'Anelli', 'Isometriche', 'Archer', 'Muscle Up'],
    position: 0,
    is_active: true,
  },
  {
    id: 'col-dips',
    name: 'Dips',
    slug: 'dips',
    category: 'push',
    target_frequency_days: 3,
    available_variants: ['Standard', 'Anelli', 'Panca Piana', 'Bulgarian Dips', 'Isometriche'],
    position: 1,
    is_active: true,
  },
  {
    id: 'col-push-up',
    name: 'Push Up',
    slug: 'push_up',
    category: 'push',
    target_frequency_days: 3,
    available_variants: ['Standard', 'Pseudo Planche', 'Pike Push Up', 'Presa Larga', 'Diamond', 'Anelli', 'Archer'],
    position: 2,
    is_active: true,
  },
  {
    id: 'col-affondi',
    name: 'Affondi',
    slug: 'affondi',
    category: 'legs_ant',
    target_frequency_days: 3,
    available_variants: ['Standard', 'Bulgaro', 'Camminati', 'Inversi', 'Step Up'],
    position: 3,
    is_active: true,
  },
  {
    id: 'col-squat-sissy',
    name: 'Squat / Sissy',
    slug: 'squat_sissy',
    category: 'legs_ant',
    target_frequency_days: 3,
    available_variants: ['Standard', 'Sissy Squat', 'Pistol Squat', 'Goblet Squat', 'Jump Squat', 'Isometriche Muro'],
    position: 4,
    is_active: true,
  },
  {
    id: 'col-femo',
    name: 'Femo',
    slug: 'femo',
    category: 'legs_post',
    target_frequency_days: 3,
    available_variants: ['Standard', 'Nordic Curl', 'Sliding Curl', 'Leg Curl', 'Ponte Glutei', 'Hip Thrust'],
    position: 5,
    is_active: true,
  },
  {
    id: 'col-stacchi',
    name: 'Stacchi',
    slug: 'stacchi',
    category: 'legs_post',
    target_frequency_days: 3,
    available_variants: ['Standard', 'Rumeno', 'Gambe Tese', 'Sumo', 'Good Morning'],
    position: 6,
    is_active: true,
  },
  {
    id: 'col-cardio-sport',
    name: 'Cardio & Sport',
    slug: 'cardio_sport',
    category: 'cardio',
    target_frequency_days: 2,
    available_variants: ['Basket', 'Corsa', 'Plio Jump', 'Mobilità & Isometriche', 'Corda', 'Camminata Veloce'],
    position: 7,
    is_active: true,
  },
];

// Mappa di espansione sigle -> Parole Complete e Chiare
const VARIANT_ABBREVIATION_MAP = {
  w: 'Presa Larga',
  wide: 'Presa Larga',
  'presa larga': 'Presa Larga',
  larga: 'Presa Larga',
  pp: 'Pseudo Planche',
  'pseudo planche': 'Pseudo Planche',
  planche: 'Pseudo Planche',
  pike: 'Pike Push Up',
  'pike push up': 'Pike Push Up',
  a2: 'Variante A2',
  'variante a2': 'Variante A2',
  r: 'Anelli',
  rings: 'Anelli',
  anelli: 'Anelli',
  c: 'Presa Stretta / Chin Up',
  chin: 'Presa Stretta / Chin Up',
  'chin up': 'Presa Stretta / Chin Up',
  'presa stretta': 'Presa Stretta / Chin Up',
  stretta: 'Presa Stretta / Chin Up',
  iso: 'Isometriche',
  isom: 'Isometriche',
  isometrica: 'Isometriche',
  isometriche: 'Isometriche',
  sissy: 'Sissy Squat',
  'sissy squat': 'Sissy Squat',
  pistol: 'Pistol Squat',
  'pistol squat': 'Pistol Squat',
  bulgaro: 'Bulgaro',
  bulgari: 'Bulgaro',
  rumeno: 'Rumeno',
  rdl: 'Rumeno',
  'gambe tese': 'Gambe Tese',
  sumo: 'Sumo',
  nordic: 'Nordic Curl',
  'nordic curl': 'Nordic Curl',
  archer: 'Archer',
  diamond: 'Diamond',
  diamante: 'Diamond',
  panca: 'Panca Piana',
  'panca piana': 'Panca Piana',
};

/**
 * Converte una sigla o nome parziale nella Variante con Parole Complete
 */
export function resolveFullVariantName(rawVariant = '', exerciseCategory = '') {
  const clean = (rawVariant || '').trim();
  if (!clean) return 'Standard';

  const lower = clean.toLowerCase().replace(/[.]/g, '').trim();
  if (VARIANT_ABBREVIATION_MAP[lower]) {
    return VARIANT_ABBREVIATION_MAP[lower];
  }

  // Capitalizza elegantemente ogni parola se è una variante custom scritta dall'utente
  return clean
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Espande una stringa di serie come "10,10,10,10" oppure "10x4" in un array di interi [10, 10, 10, 10]
 */
function parseSetsList(setsStr = '') {
  const clean = (setsStr || '').trim();
  if (!clean) return [];

  // Supporta blocchi multipli separati da virgola, spazio o barra, inclusi moltiplicatori "10x4"
  const parts = clean.split(/\s*[,/]\s*|\s+/).filter(Boolean);
  const sets = [];

  for (const part of parts) {
    const multMatch = part.match(/^(\d+)\s*[xX*]\s*(\d+)$/);
    if (multMatch) {
      const reps = parseInt(multMatch[1], 10);
      const count = parseInt(multMatch[2], 10);
      if (reps > 0 && count > 0 && count <= 30) {
        for (let i = 0; i < count; i++) sets.push(reps);
      }
      continue;
    }

    const numMatch = part.match(/^(\d+)$/);
    if (numMatch) {
      const val = parseInt(numMatch[1], 10);
      if (!isNaN(val) && val >= 0) {
        sets.push(val);
      }
    }
  }

  return sets;
}

/**
 * Riconosce se un singolo blocco rappresenta un'attività Cardio / Sport / Mobilità
 */
function tryParseCardioOrSportBlock(blockStr = '', exerciseCategory = '') {
  const clean = blockStr.trim();
  const lower = clean.toLowerCase();

  const hasParensWithNumbers = /\(\s*\d+(?:\s*[,xX*]\s*\d+)*\s*\)/.test(clean);
  const hasMultiplierOnly = /^\d+\s*[xX*]\s*\d+$/.test(clean);
  if (hasParensWithNumbers || hasMultiplierOnly) return null;

  const isCardioKeyword = /basket|corsa|running|calcio|padel|tennis|nuoto|bici|ciclismo|plio|jump|corda|mobilit|stretching|isom|camminata|trekking|hiit/i.test(clean);
  const durationMatch = clean.match(/(\d+(?:[.,]\d+)?)\s*(h|ora|ore|min|minuti|m)\b/i);

  if (exerciseCategory !== 'cardio' && !isCardioKeyword && !durationMatch) {
    return null;
  }

  // Se è una semplice lista di numeri separati da virgola (es. 14,14,14,14,14), NON è cardio
  if (/^\d+(?:\s*,\s*\d+)+$/.test(clean)) {
    return null;
  }

  let durationMinutes = 0;
  if (durationMatch) {
    const val = parseFloat(durationMatch[1].replace(',', '.'));
    const unit = durationMatch[2].toLowerCase();
    if (unit.startsWith('h') || unit.startsWith('or')) {
      durationMinutes = Math.round(val * 60);
    } else {
      durationMinutes = Math.round(val);
    }
  }

  // Determina il nome leggibile dell'attività
  let activityName = clean
    .replace(/(\d+(?:[.,]\d+)?)\s*(h|ora|ore|min|minuti|m)\b/gi, '')
    .replace(/^[+,-:\s]+|[+,-:\s]+$/g, '')
    .trim();

  if (!activityName) {
    activityName = 'Cardio / Attività';
  } else if (/^basket$/i.test(activityName)) {
    activityName = 'Basket';
  } else if (/^plio\s*jump$/i.test(activityName)) {
    activityName = 'Plio Jump';
  } else if (/mobilit/i.test(activityName)) {
    activityName = activityName.replace(/isom\.?/i, 'Isometriche');
    activityName = activityName.charAt(0).toUpperCase() + activityName.slice(1);
  } else {
    activityName = activityName.charAt(0).toUpperCase() + activityName.slice(1);
  }

  return {
    type: 'cardio',
    variant_name: activityName,
    activity_name: activityName,
    unilateral: false,
    execution_mode: 'Standard',
    load_kg: 0,
    sets: [],
    total_sets: 1,
    total_reps: 0,
    tonnage_kg: 0,
    duration_minutes: durationMinutes || null,
    display_label: durationMinutes
      ? `${activityName} (${durationMinutes >= 60 && durationMinutes % 60 === 0 ? `${durationMinutes / 60}h` : `${durationMinutes} min`})`
      : activityName,
  };
}

/**
 * Analizza un singolo blocco di allenamento (es. "20(10,10,10,10)", "10S(10,10,10)", "W(15,15)", "Presa Larga 10(8,8,8)", "14,14,14,14,14", "10x5")
 */
function parseSingleWorkoutBlock(rawBlock = '', exerciseCategory = 'pull') {
  let working = (rawBlock || '').trim();
  if (!working) return null;

  // 1. Verifica prima se è un blocco Cardio / Sport / Mobilità
  const cardioBlock = tryParseCardioOrSportBlock(working, exerciseCategory);
  if (cardioBlock) return cardioBlock;

  let unilateral = false;
  let variantRaw = '';
  let loadKg = 0;
  let sets = [];

  // 2. Rileva diciture esplicite per Singolo Arto / Monopodalico / Unilaterale
  const explicitUnilateralRegex = /\b(singolo\s+arto|monopodalic[oa]|unilaterale|ad?\s+un[ao]\s+(?:gamba|braccio))\b/i;
  if (explicitUnilateralRegex.test(working)) {
    unilateral = true;
    working = working.replace(explicitUnilateralRegex, ' ').replace(/\s+/g, ' ').trim();
  }

  // 3. Caso con parentesi: es. "20(10,10,10,10)", "10S(10,10,10)", "S(15,20,20)", "W(15,15)", "Presa Larga 15(8,8,8)", "(15,15,15)"
  const parenMatch = working.match(/^(.*?)\(\s*([^)]+?)\s*\)(.*)$/);
  if (parenMatch) {
    let prefix = parenMatch[1].trim();
    const insideParens = parenMatch[2].trim();
    const suffix = parenMatch[3].trim();

    if (/^s$/i.test(suffix)) {
      unilateral = true;
    }

    // Controlla se alla fine del prefix c'è il carico + eventuale "S" (es. "10S", "20kg S", "20", "S 10", "S")
    // Pattern: [variante opzionale] [carico opzionale] [S opzionale]
    const loadAtEndMatch = prefix.match(/^(.*?)(?:^|\s+)?(\d+(?:[.,]\d+)?)\s*(?:kg)?\s*(s)?$/i);
    if (loadAtEndMatch && loadAtEndMatch[2]) {
      const beforeLoad = (loadAtEndMatch[1] || '').trim();
      loadKg = parseFloat(loadAtEndMatch[2].replace(',', '.')) || 0;
      if (loadAtEndMatch[3] && /^s$/i.test(loadAtEndMatch[3])) {
        unilateral = true;
      }
      // Se prima del carico c'era solo "S" (es. "S 10(10,10,10)")
      if (/^s$/i.test(beforeLoad)) {
        unilateral = true;
        variantRaw = '';
      } else {
        variantRaw = beforeLoad;
      }
    } else if (/^s$/i.test(prefix)) {
      // Es: "S(15,20,20)"
      unilateral = true;
      loadKg = 0;
      variantRaw = '';
    } else {
      // Es: "W(15,15)", "PP(10,10,10)", "Presa Stretta (12,12,12)"
      // Controlla se finisce con " S"
      if (/\bs$/i.test(prefix)) {
        unilateral = true;
        prefix = prefix.replace(/\bs$/i, '').trim();
      }
      variantRaw = prefix;
    }

    sets = parseSetsList(insideParens);
  } else {
    // 4. Caso senza parentesi: es. "14,14,14,14,14", "10x5", "20kg 10x4", "Presa Larga 10x4", "S 15,15,15"
    // Controlla se inizia o finisce con S isolata
    if (/^s\s+/i.test(working)) {
      unilateral = true;
      working = working.replace(/^s\s+/i, '').trim();
    }

    // Cerca eventuale carico esplicito "20kg"
    const explicitKgMatch = working.match(/(\d+(?:[.,]\d+)?)\s*kg\b/i);
    if (explicitKgMatch) {
      loadKg = parseFloat(explicitKgMatch[1].replace(',', '.')) || 0;
      working = working.replace(explicitKgMatch[0], ' ').trim();
    }

    // Estrae la parte numerica finale (es. "14,14,14,14,14" o "10x5")
    const trailingSetsMatch = working.match(/^(.*?)\b(\d+(?:\s*[,xX*]\s*\d+)+|\d+)$/);
    if (trailingSetsMatch) {
      variantRaw = trailingSetsMatch[1].trim();
      sets = parseSetsList(trailingSetsMatch[2].trim());
    } else {
      variantRaw = working;
    }
  }

  const variantName = resolveFullVariantName(variantRaw, exerciseCategory);
  const totalSets = sets.length;
  const totalReps = sets.reduce((sum, r) => sum + r, 0);
  const tonnageKg = Number((loadKg * totalReps).toFixed(1));
  const executionMode = unilateral ? 'Singolo Arto' : 'Standard';

  // Costruisce etichetta leggibile con parole complete
  const partsLabel = [];
  if (variantName !== 'Standard') partsLabel.push(variantName);
  if (unilateral) partsLabel.push('Singolo Arto');
  if (loadKg > 0) partsLabel.push(`${loadKg} kg`);
  if (sets.length > 0) partsLabel.push(`(${sets.join(', ')})`);

  return {
    type: 'strength',
    variant_name: variantName,
    unilateral,
    execution_mode: executionMode,
    load_kg: loadKg,
    sets,
    total_sets: totalSets,
    total_reps: totalReps,
    tonnage_kg: tonnageKg,
    duration_minutes: null,
    display_label: partsLabel.join(' • ') || rawBlock.trim(),
  };
}

/**
 * PARSER PRINCIPALE DELLA NOTAZIONE D'ALLENAMENTO
 * Supporta:
 * - "20(10,10,10,10)" -> 4 serie da 10 con 20kg
 * - "10S(10,10,10)" o "S(15,20,20)" o "Singolo Arto 10(10,10,10)" -> unilateral: true, execution_mode: "Singolo Arto"
 * - "W(15,15)" o "Presa Larga (15,15)" -> variant_name: "Presa Larga"
 * - "PP(10,10,12)" -> variant_name: "Pseudo Planche"
 * - "14,14,14,14,14" o "10x5" -> corpo libero (0kg), 5 serie
 * - Sessioni multiple separate da "+" o ";" o "\n": es. "30(5,6,6) + Presa Larga (15,15)"
 * - Cardio/Sport: "1h basket", "30 min plio jump"
 */
export function parseWorkoutNotation(inputString = '', exerciseCategory = 'pull') {
  const raw = String(inputString || '').trim();
  if (!raw) {
    return {
      raw: '',
      blocks: [],
      total_sets: 0,
      total_reps: 0,
      max_load_kg: 0,
      tonnage_kg: 0,
      has_unilateral: false,
      variants: [],
      summary_label: '',
    };
  }

  // Se l'intera stringa è un'attività cardio/mobilità senza parentesi di serie (es. "mobilità + isom."), non spezzare sul "+"
  const wholeAsCardio = tryParseCardioOrSportBlock(raw, exerciseCategory);
  if (wholeAsCardio && !/\d+\s*\(/.test(raw)) {
    return {
      raw,
      blocks: [wholeAsCardio],
      total_sets: 1,
      total_reps: 0,
      max_load_kg: 0,
      tonnage_kg: 0,
      duration_minutes: wholeAsCardio.duration_minutes || 0,
      has_unilateral: false,
      variants: [wholeAsCardio.variant_name],
      summary_label: wholeAsCardio.display_label,
      normalized_notation: wholeAsCardio.display_label,
    };
  }

  // Divide in blocchi su "+", ";", o newline
  const rawChunks = raw
    .split(/\s*[;\n]\s*|\s+\+\s+|\s*\+\s*(?=[A-Za-z0-9(])/)
    .map(s => s.trim())
    .filter(Boolean);

  const blocks = rawChunks
    .map(chunk => parseSingleWorkoutBlock(chunk, exerciseCategory))
    .filter(Boolean);

  const totalSets = blocks.reduce((acc, b) => acc + (b.total_sets || 0), 0);
  const totalReps = blocks.reduce((acc, b) => acc + (b.total_reps || 0), 0);
  const maxLoadKg = blocks.reduce((max, b) => Math.max(max, Number(b.load_kg) || 0), 0);
  const tonnageKg = Number(blocks.reduce((acc, b) => acc + (b.tonnage_kg || 0), 0).toFixed(1));
  const hasUnilateral = blocks.some(b => Boolean(b.unilateral));
  const variants = Array.from(new Set(blocks.map(b => b.variant_name).filter(Boolean)));
  const totalDurationMinutes = blocks.reduce((acc, b) => acc + (b.duration_minutes || 0), 0);
  const summaryLabel = blocks.map(b => b.display_label).join(' + ');

  return {
    raw,
    blocks,
    total_sets: totalSets,
    total_reps: totalReps,
    max_load_kg: maxLoadKg,
    tonnage_kg: tonnageKg,
    duration_minutes: totalDurationMinutes || null,
    has_unilateral: hasUnilateral,
    variants,
    summary_label: summaryLabel,
    normalized_notation: summaryLabel,
  };
}

/**
 * Calcola i giorni trascorsi dall'ultimo allenamento per una colonna e restituisce il semaforo di recupero (target 2-3 giorni)
 */
export function calculateColumnRecoveryStatus(columnOrId, entries = [], targetDaysOrRefDate = 3, referenceDate = new Date()) {
  const columnId = typeof columnOrId === 'object' && columnOrId !== null ? columnOrId.id : columnOrId;
  let targetDays = typeof columnOrId === 'object' && columnOrId !== null
    ? (columnOrId.target_frequency_days || 3)
    : 3;
  let resolvedRefDate = referenceDate;

  if (typeof targetDaysOrRefDate === 'number') {
    targetDays = targetDaysOrRefDate;
  } else if (typeof targetDaysOrRefDate === 'string' || targetDaysOrRefDate instanceof Date) {
    resolvedRefDate = targetDaysOrRefDate;
  }

  const colEntries = (entries || [])
    .filter(e => e && e.column_id === columnId && String(e.raw_notation || '').trim().length > 0 && !e.is_deleted)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  if (colEntries.length === 0) {
    return {
      columnId,
      lastTrainedDate: null,
      daysSinceLast: null,
      days_since_last: null,
      status: 'overdue',
      statusKey: 'da_allenare',
      label: 'Da allenare (nessuna sessione recente)',
      shortBadge: '🔴 Da iniziare',
      badgeClass: 'badge-red',
      isRecommendedToday: true,
    };
  }

  const lastDateStr = String(colEntries[0].date).split('T')[0];
  const refDateStr = (resolvedRefDate instanceof Date ? resolvedRefDate.toISOString() : String(resolvedRefDate)).split('T')[0];

  const dLast = new Date(`${lastDateStr}T00:00:00Z`);
  const dRef = new Date(`${refDateStr}T00:00:00Z`);
  const diffDays = Math.max(0, Math.round((dRef.getTime() - dLast.getTime()) / (1000 * 60 * 60 * 24)));

  if (diffDays <= 1) {
    return {
      columnId,
      lastTrainedDate: lastDateStr,
      daysSinceLast: diffDays,
      days_since_last: diffDays,
      status: 'recovery',
      statusKey: 'recupero',
      label: diffDays === 0 ? 'Allenato oggi (Recupero attivo)' : 'Allenato ieri (Recupero attivo)',
      shortBadge: diffDays === 0 ? '🔵 Oggi' : '🔵 1gg fa',
      badgeClass: 'badge-blue',
      isRecommendedToday: false,
    };
  }

  if (diffDays >= 2 && diffDays <= targetDays) {
    return {
      columnId,
      lastTrainedDate: lastDateStr,
      daysSinceLast: diffDays,
      days_since_last: diffDays,
      status: 'optimal',
      statusKey: 'finestra_ideale',
      label: `Finestra Ideale (${diffDays}gg fa)`,
      shortBadge: `🟢 ${diffDays}gg fa`,
      badgeClass: 'badge-green',
      isRecommendedToday: true,
    };
  }

  return {
    columnId,
    lastTrainedDate: lastDateStr,
    daysSinceLast: diffDays,
    days_since_last: diffDays,
    status: 'overdue',
    statusKey: 'da_allenare',
    label: `Da allenare (${diffDays}gg fa)`,
    shortBadge: `🔴 ${diffDays}gg fa`,
    badgeClass: 'badge-red',
    isRecommendedToday: true,
  };
}

/**
 * Calcola i trend biometrici (media mobile peso 7gg, sonno, kcal e macro) e le progressioni per ogni esercizio
 */
export function calculateBodyTrends(dailyLogsOrObj = [], workoutEntries = [], columns = DEFAULT_BODY_COLUMNS) {
  let dailyLogs = dailyLogsOrObj;
  if (!Array.isArray(dailyLogsOrObj) && typeof dailyLogsOrObj === 'object' && dailyLogsOrObj !== null) {
    dailyLogs = dailyLogsOrObj.dailyLogs || [];
    workoutEntries = dailyLogsOrObj.workoutEntries || [];
    columns = dailyLogsOrObj.columns || DEFAULT_BODY_COLUMNS;
  }
  const sortedLogs = [...(dailyLogs || [])]
    .filter(l => l && !l.is_deleted)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // Serie storica con media mobile a 7 rilevazioni per il peso corporeo
  const logsWithWeight = sortedLogs.filter(l => Number(l.body_weight_kg) > 0);
  const weightMovingAverageSeries = logsWithWeight.map((log, idx) => {
    const windowSlice = logsWithWeight.slice(Math.max(0, idx - 6), idx + 1);
    const avg = windowSlice.reduce((s, item) => s + Number(item.body_weight_kg), 0) / windowSlice.length;
    return {
      date: log.date,
      weight: Number(log.body_weight_kg),
      movingAvg7d: Number(avg.toFixed(2)),
    };
  });

  const recent7Weight = logsWithWeight.slice(-7);
  const prev7Weight = logsWithWeight.slice(-14, -7);

  const avgWeight7d = recent7Weight.length > 0
    ? Number((recent7Weight.reduce((s, l) => s + Number(l.body_weight_kg), 0) / recent7Weight.length).toFixed(2))
    : null;

  const prevWeight7d = prev7Weight.length > 0
    ? Number((prev7Weight.reduce((s, l) => s + Number(l.body_weight_kg), 0) / prev7Weight.length).toFixed(2))
    : null;

  const weightDelta7d = avgWeight7d !== null && prevWeight7d !== null
    ? Number((avgWeight7d - prevWeight7d).toFixed(2))
    : 0;

  // Medie Sonno, Kcal e Macronutrienti sugli ultimi 7 log disponibili
  const recent7Logs = sortedLogs.slice(-7);
  const sleepLogs = recent7Logs.filter(l => Number(l.sleep_hours) > 0);
  const avgSleep7d = sleepLogs.length > 0
    ? Number((sleepLogs.reduce((s, l) => s + Number(l.sleep_hours), 0) / sleepLogs.length).toFixed(1))
    : null;

  const kcalLogs = recent7Logs.filter(l => Number(l.calories_kcal) > 0);
  const avgCalories7d = kcalLogs.length > 0
    ? Math.round(kcalLogs.reduce((s, l) => s + Number(l.calories_kcal), 0) / kcalLogs.length)
    : null;

  const protLogs = recent7Logs.filter(l => Number(l.protein_g) > 0);
  const avgProtein7d = protLogs.length > 0
    ? Math.round(protLogs.reduce((s, l) => s + Number(l.protein_g), 0) / protLogs.length)
    : null;

  const carbsLogs = recent7Logs.filter(l => Number(l.carbs_g) > 0);
  const avgCarbs7d = carbsLogs.length > 0
    ? Math.round(carbsLogs.reduce((s, l) => s + Number(l.carbs_g), 0) / carbsLogs.length)
    : null;

  const fatLogs = recent7Logs.filter(l => Number(l.fat_g) > 0);
  const avgFat7d = fatLogs.length > 0
    ? Math.round(fatLogs.reduce((s, l) => s + Number(l.fat_g), 0) / fatLogs.length)
    : null;

  // Progressioni per ciascuna colonna esercizio
  const exerciseProgressions = {};
  const validEntries = (workoutEntries || [])
    .filter(e => e && !e.is_deleted && String(e.raw_notation || '').trim())
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  for (const col of columns) {
    const colEntries = validEntries.filter(e => e.column_id === col.id);
    let maxLoadKg = 0;
    let maxTotalReps = 0;
    let maxSingleSetReps = 0;
    let maxTonnageKg = 0;

    const history = colEntries.map(entry => {
      const parsed = Array.isArray(entry.parsed_blocks) && entry.parsed_blocks.length > 0
        ? {
            blocks: entry.parsed_blocks,
            total_sets: entry.parsed_blocks.reduce((s, b) => s + (b.total_sets || 0), 0),
            total_reps: entry.parsed_blocks.reduce((s, b) => s + (b.total_reps || 0), 0),
            max_load_kg: entry.parsed_blocks.reduce((m, b) => Math.max(m, Number(b.load_kg) || 0), 0),
            tonnage_kg: entry.parsed_blocks.reduce((s, b) => s + (b.tonnage_kg || 0), 0),
          }
        : parseWorkoutNotation(entry.raw_notation, col.category);

      if (parsed.max_load_kg > maxLoadKg) maxLoadKg = parsed.max_load_kg;
      if (parsed.total_reps > maxTotalReps) maxTotalReps = parsed.total_reps;
      if (parsed.tonnage_kg > maxTonnageKg) maxTonnageKg = parsed.tonnage_kg;

      for (const b of parsed.blocks) {
        for (const r of b.sets || []) {
          if (r > maxSingleSetReps) maxSingleSetReps = r;
        }
      }

      return {
        id: entry.id,
        date: entry.date,
        raw_notation: entry.raw_notation,
        blocks: parsed.blocks,
        total_sets: parsed.total_sets,
        total_reps: parsed.total_reps,
        max_load_kg: parsed.max_load_kg,
        tonnage_kg: parsed.tonnage_kg,
        rpe: entry.rpe,
        rest_seconds: entry.rest_seconds,
        feeling: entry.feeling,
        detailed_notes: entry.detailed_notes,
      };
    });

    exerciseProgressions[col.id] = {
      column_id: col.id,
      column_name: col.name,
      sessions_count: history.length,
      max_load_kg: maxLoadKg,
      max_total_reps: maxTotalReps,
      max_single_set_reps: maxSingleSetReps,
      max_tonnage_kg: Number(maxTonnageKg.toFixed(1)),
      latest_session: history.length > 0 ? history[history.length - 1] : null,
      history,
    };
  }

  return {
    avgWeight7d,
    prevWeight7d,
    weightDelta7d,
    weightMovingAverageSeries,
    avgSleep7d,
    avgCalories7d,
    avgProtein7d,
    avgCarbs7d,
    avgFat7d,
    exerciseProgressions,
  };
}
