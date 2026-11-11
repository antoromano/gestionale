// src/utils/csv-importer.js
// Importatore Universale CSV / Excel — 100% deterministico, client-side, ZERO token IA.
//
// Pipeline:  file → righe (CSV/XLSX) → tabella (riga intestazione) → auto-detection del template
//            → piano di import (record validati + errori) → commit batch idempotente nello store.
//
// Template riconosciuti dagli header:
//   • MyFitnessPal / Apple Health / Nutrizione  → body_daily_logs
//   • Compravendita / Flipping                  → trading_items
//   • Estratto Conto / Finanze                  → finance_transactions
// Se nessun template combacia, il Wizard di Mapping (UI in modules/import-panel.js) usa buildWizardPlan().

import { store as defaultStore } from '../services/store.js';
import { normalizeTradingItem, normalizeTransaction, round2, localTodayIso } from '../services/finances.js';
import { readXlsx } from './xlsx-reader.js';

// ---------------------------------------------------------------------------
// Parsing CSV
// ---------------------------------------------------------------------------

/** Individua il separatore (; , tab |): vince quello presente in modo più coerente (minimo per riga) nelle prime righe. */
export function detectDelimiter(text) {
  const candidates = [';', ',', '\t', '|'];
  const lines = String(text).split(/\r\n|\n|\r/).filter(l => l.trim()).slice(0, 8);
  if (lines.length === 0) return ',';

  let best = ',';
  let bestMin = 0;
  for (const delim of candidates) {
    let min = Infinity;
    for (const line of lines) {
      let inQuotes = false;
      let count = 0;
      for (const ch of line) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === delim && !inQuotes) count++;
      }
      min = Math.min(min, count);
    }
    if (min > bestMin) {
      best = delim;
      bestMin = min;
    }
  }
  return best;
}

/** Parser CSV RFC4180: virgolette, "" escape, a-capo dentro i campi, CRLF/LF/CR, BOM e riga "sep=;" di Excel. */
export function parseCsv(input, delimiter = null) {
  let text = String(input ?? '').replace(/^﻿/, '');
  const sepLine = text.match(/^sep=(.)\r?\n/i);
  if (sepLine) {
    delimiter = delimiter || sepLine[1];
    text = text.slice(sepLine[0].length);
  }
  const delim = delimiter || detectDelimiter(text);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Legge un File (CSV/TSV/TXT oppure .xlsx) e restituisce la matrice di celle.
 * @returns {Promise<{rows: Array<Array<string|number>>, source: 'csv'|'xlsx', sheetName?: string}>}
 */
export async function readSpreadsheetFile(file) {
  const name = String(file?.name || '').toLowerCase();
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const isZip = bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOldXls = bytes.length > 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;

  if (isOldXls) {
    throw new Error('Il formato Excel 97-2003 (.xls) non è supportato: salvalo come .xlsx oppure come CSV e riprova.');
  }
  if (isZip || /\.xlsx$|\.xlsm$/.test(name)) {
    const { rows, sheetName } = await readXlsx(bytes);
    return { rows, source: 'xlsx', sheetName };
  }

  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.includes('�')) {
    // Molti estratti conto italiani sono esportati in Windows-1252 (€, à, è...)
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return { rows: parseCsv(text), source: 'csv' };
}

// ---------------------------------------------------------------------------
// Normalizzazione header, numeri e date
// ---------------------------------------------------------------------------

export function normalizeHeader(header) {
  return String(header ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'number' ? String(value) : String(value).trim();
}

function isEmptyCell(value) {
  return cellText(value) === '';
}

/**
 * Converte testo in numero gestendo formati italiani e inglesi: "1.234,56", "1,234.56", "€ 12,50", "-5", "(12.50)".
 * In modalità `money` un singolo separatore seguito da esattamente 3 cifre ("1.234", "1,234") è considerato migliaia;
 * nei campi non monetari (peso, sonno, macro) un singolo separatore è sempre decimale.
 * I numeri nativi (celle numeriche Excel) sono restituiti così come sono.
 */
export function parseNumber(value, { money = false } = {}) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value ?? '').trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/^[−–-]/.test(s) || /[−–-]\s*$/.test(s)) negative = !negative;

  s = s.replace(/[^\d,.]/g, '');
  if (!/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    s = s.split(thousandSep).join('').replace(decimalSep, '.');
  } else if (lastComma >= 0) {
    const commas = (s.match(/,/g) || []).length;
    if (commas > 1 || (money && /^[1-9]\d{0,2},\d{3}$/.test(s))) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
  } else if (lastDot >= 0) {
    const dots = (s.match(/\./g) || []).length;
    if (dots > 1 || (money && /^[1-9]\d{0,2}\.\d{3}$/.test(s))) s = s.replace(/\./g, '');
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const MONTH_NAMES = {
  gen: 1, gennaio: 1, jan: 1, january: 1,
  feb: 2, febbraio: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  apr: 4, aprile: 4, april: 4,
  mag: 5, maggio: 5, may: 5,
  giu: 6, giugno: 6, jun: 6, june: 6,
  lug: 7, luglio: 7, jul: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  set: 9, sett: 9, settembre: 9, sep: 9, sept: 9, september: 9,
  ott: 10, ottobre: 10, oct: 10, october: 10,
  nov: 11, novembre: 11, november: 11,
  dic: 12, dicembre: 12, dec: 12, december: 12,
};

function buildIso(y, m, d) {
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  if (m < 1 || m > 12 || d < 1) return null;
  const maxDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > maxDay) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Converte vari formati data in "YYYY-MM-DD" (default italiano GG/MM/AAAA; MM/GG/AAAA solo se inequivocabile). */
export function parseDateValue(value) {
  const s = cellText(value);
  if (!s) return null;

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return buildIso(Number(m[1]), Number(m[2]), Number(m[3]));

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T\s].*)?$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    if (a > 12) return buildIso(y, b, a);
    if (b > 12) return buildIso(y, a, b); // formato USA (MM/DD/YYYY) inequivocabile
    return buildIso(y, b, a);
  }

  m = s.match(/^(\d{1,2})\s+([A-Za-zÀ-ú.]+)\s+(\d{2,4})$/);
  if (m) {
    const month = MONTH_NAMES[normalizeHeader(m[2])];
    if (month) return buildIso(Number(m[3]), month, Number(m[1]));
  }

  m = s.match(/^([A-Za-zÀ-ú.]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const month = MONTH_NAMES[normalizeHeader(m[1])];
    if (month) return buildIso(Number(m[3]), month, Number(m[2]));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Template e Auto-Detection
// ---------------------------------------------------------------------------

// L'ordine dei campi conta (un header viene assegnato al primo campo che lo reclama);
// l'ordine degli alias è la priorità (es. "data operazione" batte "data valuta").
export const IMPORT_TEMPLATES = {
  trading: {
    id: 'trading',
    label: 'Compravendita / Flipping',
    target: 'trading_items',
    targetLabel: 'Compravendita (trading_items)',
    required: ['title', 'purchase_price'],
    fields: {
      title: ['oggetto', 'articolo', 'titolo', 'item', 'prodotto', 'title', 'nome articolo', 'nome'],
      purchase_price: ['prezzo acquisto', 'prezzo di acquisto', 'acquisto', 'costo acquisto', 'costo', 'purchase price', 'purchase', 'buy price', 'comprato a'],
      sale_price: ['prezzo vendita', 'prezzo di vendita', 'vendita', 'venduto a', 'sale price', 'sale', 'sell price', 'ricavo'],
      platform: ['piattaforma', 'platform', 'marketplace', 'canale', 'sito'],
      extra_costs: ['spese extra', 'costi extra', 'extra costs', 'extra', 'riparazione', 'riparazioni', 'spedizione', 'costi aggiuntivi'],
      platform_fees: ['commissioni', 'commissione', 'platform fees', 'fees', 'fee'],
      sale_date: ['data vendita', 'sale date', 'venduto il', 'data di vendita'],
      purchase_date: ['data acquisto', 'purchase date', 'acquistato il', 'data di acquisto', 'data', 'date'],
      status: ['stato', 'status'],
      hours_spent: ['ore impiegate', 'ore', 'hours', 'hours spent', 'tempo'],
      notes: ['note', 'notes', 'nota', 'annotazioni'],
    },
  },
  nutrition: {
    id: 'nutrition',
    label: 'MyFitnessPal / Apple Health / Nutrizione',
    target: 'body_daily_logs',
    targetLabel: 'Body — Diario giornaliero (body_daily_logs)',
    required: ['date'],
    anyOf: ['calories', 'protein', 'carbs', 'fat', 'weight', 'sleep'],
    fields: {
      date: ['date', 'data', 'giorno', 'day', 'start date', 'start', 'data registrazione'],
      meal: ['meal', 'pasto'],
      calories: ['calories', 'calorie', 'kcal', 'dietary energy', 'energy consumed', 'calorie assunte', 'apporto calorico', 'energy', 'energia'],
      protein: ['protein', 'proteins', 'proteine', 'proteina', 'prot'],
      carbs: ['carbohydrates', 'carbohydrate', 'carboidrati', 'carboidrato', 'carbs', 'carbo'],
      fat: ['total fat', 'fat', 'fats', 'grassi', 'grasso', 'lipidi'],
      weight: ['body mass', 'body weight', 'weight', 'peso corporeo', 'peso', 'massa corporea'],
      sleep: ['sleep analysis', 'sleep duration', 'sleep hours', 'sleep', 'ore di sonno', 'ore sonno', 'sonno', 'time asleep', 'asleep'],
    },
  },
  finance: {
    id: 'finance',
    label: 'Estratto Conto / Finanze',
    target: 'finance_transactions',
    targetLabel: 'Finanze (finance_transactions)',
    required: ['date', 'description'],
    anyOf: ['income', 'expense', 'amount'],
    fields: {
      date: ['data operazione', 'data contabile', 'data movimento', 'data transazione', 'transaction date', 'booking date', 'data', 'date', 'data valuta', 'valuta'],
      description: ['descrizione', 'description', 'causale', 'dettagli', 'details', 'operazione', 'movimento', 'memo', 'concetto', 'beneficiario', 'controparte', 'narrative', 'nota', 'note'],
      income: ['entrata', 'entrate', 'accrediti', 'accredito', 'avere', 'income', 'credit', 'credito', 'incassi', 'incasso'],
      expense: ['uscita', 'uscite', 'addebiti', 'addebito', 'dare', 'expense', 'debit', 'debito', 'spesa', 'spese', 'pagamenti'],
      amount: ['importo', 'amount', 'ammontare', 'valore', 'totale', 'importo eur', 'importo euro', 'eur', 'euro'],
      type: ['tipo', 'type', 'segno', 'tipologia'],
      category: ['categoria', 'category', 'voce', 'tag'],
      payment_method: ['metodo pagamento', 'metodo di pagamento', 'payment method', 'mezzo di pagamento'],
    },
  },
};

const TEMPLATE_PRIORITY = ['trading', 'nutrition', 'finance'];

function matchesAlias(normHeader, alias) {
  return normHeader === alias || normHeader.startsWith(`${alias} `);
}

function evaluateTemplate(template, normHeaders) {
  const mapping = {};
  const used = new Set();
  for (const [field, aliases] of Object.entries(template.fields)) {
    let found = -1;
    for (const alias of aliases) {
      found = normHeaders.findIndex((h, i) => !used.has(i) && h && matchesAlias(h, alias));
      if (found >= 0) break;
    }
    if (found >= 0) {
      mapping[field] = found;
      used.add(found);
    }
  }
  const requiredOk =
    template.required.every(f => f in mapping) &&
    (!template.anyOf || template.anyOf.some(f => f in mapping));
  const matched = Object.keys(mapping).length;
  return {
    template,
    mapping,
    requiredOk,
    matched,
    score: requiredOk ? 100 + matched * 5 : matched,
  };
}

/** Auto-detection del template a partire dagli header. */
export function detectTemplate(headers = []) {
  const normHeaders = headers.map(normalizeHeader);
  const evaluations = TEMPLATE_PRIORITY
    .map(id => evaluateTemplate(IMPORT_TEMPLATES[id], normHeaders))
    .sort((a, b) => b.score - a.score || TEMPLATE_PRIORITY.indexOf(a.template.id) - TEMPLATE_PRIORITY.indexOf(b.template.id));

  const best = evaluations[0];
  if (!best || !best.requiredOk) {
    return { template: null, label: null, target: null, mapping: {}, confidence: 0, score: best ? best.score : 0 };
  }
  const totalFields = Object.keys(best.template.fields).length;
  return {
    template: best.template.id,
    label: best.template.label,
    target: best.template.target,
    mapping: best.mapping,
    confidence: Math.round((best.matched / totalFields) * 100) / 100,
    score: best.score,
  };
}

/**
 * Costruisce la tabella (header + righe dati) dalla matrice grezza.
 * Cerca la riga di intestazione nelle prime 10 righe (gli estratti conto spesso hanno un preambolo).
 */
export function buildTable(rawRows = []) {
  const rows = (rawRows || []).map(r => (Array.isArray(r) ? r : []));
  let headerRowIndex = -1;
  let bestScore = -1;

  const limit = Math.min(rows.length, 10);
  for (let i = 0; i < limit; i++) {
    const nonEmpty = rows[i].filter(c => !isEmptyCell(c)).length;
    if (nonEmpty < 2) continue;
    const detection = detectTemplate(rows[i].map(cellText));
    if (detection.template && detection.score > bestScore) {
      bestScore = detection.score;
      headerRowIndex = i;
    }
  }
  if (headerRowIndex < 0) {
    headerRowIndex = rows.findIndex(r => r.filter(c => !isEmptyCell(c)).length >= 2);
    if (headerRowIndex < 0) headerRowIndex = 0;
  }

  const headers = (rows[headerRowIndex] || []).map(cellText);
  const dataRows = [];
  const rowNumbers = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    if (rows[i].every(isEmptyCell)) continue;
    dataRows.push(rows[i]);
    rowNumbers.push(i + 1);
  }

  return {
    headers,
    normHeaders: headers.map(normalizeHeader),
    rows: dataRows,
    rowNumbers,
    headerRowIndex,
  };
}

/** Analizza una matrice: costruisce la tabella e rileva il template. */
export function analyzeRows(rawRows) {
  const table = buildTable(rawRows);
  const detection = detectTemplate(table.headers);
  return { table, detection };
}

// ---------------------------------------------------------------------------
// Costruzione dei record (validazione + conversione)
// ---------------------------------------------------------------------------

const cell = (row, idx) => (idx === undefined || idx === null || idx < 0 ? undefined : row[idx]);

function addError(errors, rowNumber, message) {
  errors.push({ row: rowNumber, message });
}

function looksLikeIncome(text) {
  return /(^|[^a-z])(entrat|incass|accredit|avere|income|credit|ricav|deposit|versament)/i.test(text);
}

function looksLikeExpense(text) {
  return /(^|[^a-z])(uscit|spes|addebit|dare|expense|debit|pagament|prelievo|withdraw|acquist)/i.test(text);
}

/** Dal testo di una colonna "Tipo" ricava entrata/uscita (null se non riconoscibile). */
export function transactionTypeFromText(text) {
  const t = normalizeHeader(text);
  if (!t) return null;
  if (looksLikeIncome(t) && !looksLikeExpense(t)) return 'income';
  if (looksLikeExpense(t) && !looksLikeIncome(t)) return 'expense';
  return null;
}

function normalizePlatform(text) {
  const t = normalizeHeader(text);
  if (!t) return 'Vinted';
  if (t.startsWith('vinted')) return 'Vinted';
  if (t.startsWith('subito')) return 'Subito';
  if (t.startsWith('ebay')) return 'eBay';
  return 'Altro';
}

function normalizePaymentMethod(text) {
  const t = normalizeHeader(text);
  if (!t) return 'bonifico';
  if (/carta|card|visa|mastercard|bancomat|pos/.test(t)) return 'carta';
  if (/contant|cash/.test(t)) return 'contanti';
  if (/paypal/.test(t)) return 'paypal';
  if (/addebito|sdd|rid|domiciliazione/.test(t)) return 'addebito';
  if (/bonifico|sepa|transfer/.test(t)) return 'bonifico';
  return 'altro';
}

function tradingStatusFromText(text) {
  const t = normalizeHeader(text);
  if (!t) return null;
  if (/vendut|sold/.test(t)) return 'sold';
  if (/riserv|reserved|prenotat/.test(t)) return 'reserved';
  if (/\bres[oi]\b|return/.test(t)) return 'returned';
  if (/vendita|stock|disponibil|giacenza|magazzino|in vend/.test(t)) return 'in_stock';
  return null;
}

const MEAL_TOTAL_REGEX = /^(totale?|totals?|daily totals?|riepilogo|summary)$/;

function buildNutritionPlan(table, mapping) {
  const errors = [];
  const warnings = [];
  const groups = new Map();

  const weightLbs = /\blbs?\b|pound/.test(table.normHeaders[mapping.weight] || '');
  const sleepMinutes = /\bmin/.test(table.normHeaders[mapping.sleep] || '');

  table.rows.forEach((row, i) => {
    const rowNumber = table.rowNumbers[i];
    const date = parseDateValue(cell(row, mapping.date));
    if (!date) {
      addError(errors, rowNumber, `Data non valida: "${cellText(cell(row, mapping.date))}"`);
      return;
    }
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push({
      meal: normalizeHeader(cellText(cell(row, mapping.meal))),
      calories: parseNumber(cell(row, mapping.calories), { money: true }), // "1,850" = migliaia
      protein: parseNumber(cell(row, mapping.protein)),
      carbs: parseNumber(cell(row, mapping.carbs)),
      fat: parseNumber(cell(row, mapping.fat)),
      weight: parseNumber(cell(row, mapping.weight)),
      sleep: parseNumber(cell(row, mapping.sleep)),
    });
  });

  const records = [];
  for (const [date, entries] of Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    // MyFitnessPal esporta una riga per pasto: se esistono righe "Totale" si usano solo quelle, altrimenti si somma.
    const totals = entries.filter(e => MEAL_TOTAL_REGEX.test(e.meal));
    const source = totals.length > 0 ? totals : entries;
    const sum = key => {
      const values = source.map(e => e[key]).filter(v => v !== null);
      return values.length > 0 ? values.reduce((acc, v) => acc + v, 0) : null;
    };
    const last = key => {
      const values = entries.map(e => e[key]).filter(v => v !== null);
      return values.length > 0 ? values[values.length - 1] : null;
    };

    const calories = sum('calories');
    const protein = sum('protein');
    const carbs = sum('carbs');
    const fat = sum('fat');
    let weight = last('weight');
    let sleep = last('sleep');
    if (weight !== null && weightLbs) weight = weight * 0.45359237;
    if (sleep !== null && sleepMinutes) sleep = sleep / 60;

    const record = { date };
    if (calories !== null) record.calories_kcal = Math.round(calories);
    if (protein !== null) record.protein_g = Math.round(protein);
    if (carbs !== null) record.carbs_g = Math.round(carbs);
    if (fat !== null) record.fat_g = Math.round(fat);
    if (weight !== null && weight > 0) record.body_weight_kg = round2(weight);
    if (sleep !== null && sleep > 0) record.sleep_hours = round2(sleep);

    if (Object.keys(record).length === 1) {
      warnings.push(`Nessun dato utile per il ${date}`);
      continue;
    }
    records.push(record);
  }
  return { records, errors, warnings };
}

function buildTradingRecord(base) {
  return normalizeTradingItem(base);
}

function buildTradingPlan(table, mapping) {
  const errors = [];
  const records = [];

  table.rows.forEach((row, i) => {
    const rowNumber = table.rowNumbers[i];
    const title = cellText(cell(row, mapping.title));
    if (!title) {
      addError(errors, rowNumber, 'Oggetto mancante');
      return;
    }
    const purchase = parseNumber(cell(row, mapping.purchase_price), { money: true });
    if (purchase === null || purchase < 0) {
      addError(errors, rowNumber, `Prezzo di acquisto non valido per "${title}"`);
      return;
    }
    const salePrice = parseNumber(cell(row, mapping.sale_price), { money: true });
    const explicitStatus = tradingStatusFromText(cellText(cell(row, mapping.status)));

    records.push(buildTradingRecord({
      title,
      platform: normalizePlatform(cellText(cell(row, mapping.platform))),
      purchase_date: parseDateValue(cell(row, mapping.purchase_date)) || localTodayIso(),
      purchase_price: purchase,
      extra_costs: parseNumber(cell(row, mapping.extra_costs), { money: true }) || 0,
      sale_price: salePrice,
      sale_date: parseDateValue(cell(row, mapping.sale_date)),
      platform_fees: parseNumber(cell(row, mapping.platform_fees), { money: true }) || 0,
      status: explicitStatus || undefined,
      hours_spent: parseNumber(cell(row, mapping.hours_spent)),
      notes: cellText(cell(row, mapping.notes)),
    }));
  });
  return { records, errors, warnings: [] };
}

function buildFinancePlan(table, mapping, options = {}) {
  const positiveAs = options.positiveAs === 'expense' ? 'expense' : 'income';
  const errors = [];
  const warnings = [];
  const records = [];
  const hasSplitColumns = 'income' in mapping || 'expense' in mapping;
  let skippedZero = 0;

  table.rows.forEach((row, i) => {
    const rowNumber = table.rowNumbers[i];
    const date = parseDateValue(cell(row, mapping.date));
    if (!date) {
      addError(errors, rowNumber, `Data non valida: "${cellText(cell(row, mapping.date))}"`);
      return;
    }
    const description = cellText(cell(row, mapping.description)) || 'Movimento importato';
    const category = cellText(cell(row, mapping.category)) || 'generale';
    const payment_method = normalizePaymentMethod(cellText(cell(row, mapping.payment_method)));
    const push = (type, amount) => {
      records.push({ date, type, amount: Math.abs(round2(amount)), description, category, payment_method, notes: 'Importato da file' });
    };

    if (hasSplitColumns) {
      const inc = parseNumber(cell(row, mapping.income), { money: true });
      const exp = parseNumber(cell(row, mapping.expense), { money: true });
      let any = false;
      // Nelle colonne dedicate Entrata/Uscita il segno è irrilevante: conta la colonna
      if (inc) {
        push('income', inc);
        any = true;
      }
      if (exp) {
        push('expense', exp);
        any = true;
      }
      if (!any) {
        if (inc === null && exp === null) addError(errors, rowNumber, 'Nessun importo valido');
        else skippedZero++;
      }
      return;
    }

    const amount = parseNumber(cell(row, mapping.amount), { money: true });
    if (amount === null) {
      addError(errors, rowNumber, `Importo non valido: "${cellText(cell(row, mapping.amount))}"`);
      return;
    }
    if (amount === 0) {
      skippedZero++;
      return;
    }
    const typed = mapping.type !== undefined ? transactionTypeFromText(cellText(cell(row, mapping.type))) : null;
    const type = typed || (amount < 0 ? 'expense' : positiveAs);
    push(type, amount);
  });

  if (skippedZero > 0) warnings.push(`${skippedZero} righe a importo zero ignorate`);
  return { records, errors, warnings };
}

/**
 * Piano di import per un template rilevato automaticamente (o scelto a mano).
 * @param {object} table risultato di buildTable()
 * @param {'trading'|'nutrition'|'finance'} templateId
 * @param {object} mapping campo → indice colonna (da detectTemplate o dal wizard)
 * @param {{positiveAs?: 'income'|'expense'}} options
 */
export function buildImportPlan(table, templateId, mapping, options = {}) {
  const template = IMPORT_TEMPLATES[templateId];
  if (!template) throw new Error(`Template di import sconosciuto: ${templateId}`);

  const built =
    templateId === 'nutrition' ? buildNutritionPlan(table, mapping)
    : templateId === 'trading' ? buildTradingPlan(table, mapping)
    : buildFinancePlan(table, mapping, options);

  return {
    template: templateId,
    label: template.label,
    target: template.target,
    targetLabel: template.targetLabel,
    mapping,
    totalRows: table.rows.length,
    ...built,
    preview: built.records.slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// Wizard di mapping manuale (fallback quando gli header non corrispondono a nessun template)
// ---------------------------------------------------------------------------

export const WIZARD_FIELDS = [
  { key: 'date', label: 'Data' },
  { key: 'description', label: 'Descrizione / Titolo' },
  { key: 'amount', label: 'Importo' },
  { key: 'type', label: 'Tipo (Entrata/Uscita o Acquisto/Vendita)' },
];

function wizardTypeKind(text) {
  const t = normalizeHeader(text);
  if (!t) return null;
  if (/(^| )(acquist|buy|purchase|compra|comprat)/.test(t)) return 'purchase';
  if (/(^| )(vend|sale|sell|sold)/.test(t)) return 'sale';
  return null;
}

/** Suggerisce una mappatura iniziale per il wizard a partire da alias molto comuni. */
export function suggestWizardMapping(table) {
  const pick = (aliases) => {
    for (const alias of aliases) {
      const idx = table.normHeaders.findIndex(h => h && matchesAlias(h, alias));
      if (idx >= 0) return idx;
    }
    return null;
  };
  return {
    date: pick(['data', 'date', 'giorno', 'day']),
    description: pick(['descrizione', 'description', 'titolo', 'title', 'nome', 'name', 'oggetto', 'causale', 'dettagli']),
    amount: pick(['importo', 'amount', 'prezzo', 'price', 'valore', 'totale', 'euro']),
    type: pick(['tipo', 'type', 'segno', 'operazione']),
  };
}

/** Decide la destinazione "auto": Compravendita se la colonna Tipo contiene acquisto/vendita, altrimenti Finanze. */
export function inferWizardDestination(table, typeColumn) {
  if (typeColumn === null || typeColumn === undefined) return 'finance';
  const kinds = table.rows.slice(0, 200).map(r => wizardTypeKind(cellText(r[typeColumn]))).filter(Boolean);
  return kinds.length > 0 ? 'trading' : 'finance';
}

/**
 * Piano di import dal wizard manuale.
 * @param {object} table
 * @param {{date,description,amount,type}} wizard indici di colonna (o null)
 * @param {{destination?: 'auto'|'finance'|'trading', positiveAs?: 'income'|'expense'}} options
 */
export function buildWizardPlan(table, wizard, options = {}) {
  const errors = [];
  if (wizard.description === null || wizard.description === undefined) {
    return { template: null, label: 'Mappatura manuale', target: null, records: [], errors: [{ row: 0, message: 'Seleziona almeno la colonna Descrizione / Titolo' }], warnings: [], totalRows: table.rows.length, preview: [] };
  }
  if (wizard.amount === null || wizard.amount === undefined) {
    return { template: null, label: 'Mappatura manuale', target: null, records: [], errors: [{ row: 0, message: 'Seleziona la colonna Importo' }], warnings: [], totalRows: table.rows.length, preview: [] };
  }

  const destination = options.destination && options.destination !== 'auto'
    ? options.destination
    : inferWizardDestination(table, wizard.type);

  if (destination === 'finance') {
    if (wizard.date === null || wizard.date === undefined) {
      return { template: 'finance', label: 'Mappatura manuale — Finanze', target: 'finance_transactions', targetLabel: IMPORT_TEMPLATES.finance.targetLabel, records: [], errors: [{ row: 0, message: 'Per le Finanze seleziona anche la colonna Data' }], warnings: [], totalRows: table.rows.length, preview: [] };
    }
    const mapping = { date: wizard.date, description: wizard.description, amount: wizard.amount };
    if (wizard.type !== null && wizard.type !== undefined) mapping.type = wizard.type;
    const plan = buildImportPlan(table, 'finance', mapping, options);
    return { ...plan, label: 'Mappatura manuale — Finanze' };
  }

  // Compravendita: righe "Acquisto" e "Vendita" dello stesso oggetto vengono accoppiate per titolo
  const groups = new Map();
  table.rows.forEach((row, i) => {
    const rowNumber = table.rowNumbers[i];
    const title = cellText(row[wizard.description]);
    const amount = parseNumber(row[wizard.amount], { money: true });
    if (!title) return addError(errors, rowNumber, 'Oggetto mancante');
    if (amount === null) return addError(errors, rowNumber, `Importo non valido per "${title}"`);
    const kind = wizard.type !== null && wizard.type !== undefined ? wizardTypeKind(cellText(row[wizard.type])) : null;
    const date = wizard.date !== null && wizard.date !== undefined ? parseDateValue(row[wizard.date]) : null;
    const key = normalizeHeader(title);
    if (!groups.has(key)) groups.set(key, { title, purchases: [], sales: [] });
    const g = groups.get(key);
    (kind === 'sale' ? g.sales : g.purchases).push({ amount: Math.abs(amount), date });
  });

  const records = [];
  for (const g of groups.values()) {
    const pairs = Math.max(g.purchases.length, g.sales.length);
    for (let i = 0; i < pairs; i++) {
      const p = g.purchases[i];
      const s = g.sales[i];
      records.push(buildTradingRecord({
        title: g.title,
        purchase_price: p ? p.amount : 0,
        purchase_date: (p && p.date) || (s && s.date) || localTodayIso(),
        sale_price: s ? s.amount : null,
        sale_date: s ? s.date : null,
        notes: p ? '' : 'Acquisto non specificato nel file importato',
      }));
    }
  }
  return {
    template: 'trading',
    label: 'Mappatura manuale — Compravendita',
    target: 'trading_items',
    targetLabel: IMPORT_TEMPLATES.trading.targetLabel,
    mapping: wizard,
    totalRows: table.rows.length,
    records,
    errors,
    warnings: [],
    preview: records.slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// Commit batch idempotente
// ---------------------------------------------------------------------------

const norm = text => String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
const centsOf = v => Math.round((Number(v) || 0) * 100);

export function transactionSignature(t) {
  return `${String(t.date).slice(0, 10)}|${t.type}|${centsOf(t.amount)}|${norm(t.description)}`;
}

export function tradingSignature(t) {
  return `${norm(t.title)}|${String(t.purchase_date).slice(0, 10)}|${centsOf(t.purchase_price)}`;
}

/** Rimuove i record già presenti (multiset: due righe identiche nello stesso file restano entrambe al primo import). */
function dropKnown(records, existing, signatureFn) {
  const known = new Map();
  for (const e of existing) {
    const sig = signatureFn(e);
    known.set(sig, (known.get(sig) || 0) + 1);
  }
  const fresh = [];
  let duplicates = 0;
  for (const r of records) {
    const sig = signatureFn(r);
    const left = known.get(sig) || 0;
    if (left > 0) {
      known.set(sig, left - 1);
      duplicates++;
    } else {
      fresh.push(r);
    }
  }
  return { fresh, duplicates };
}

/** Quanti record del piano sono già presenti (e quindi verrebbero ignorati) senza scrivere nulla. */
export function estimateDuplicates(plan, store = defaultStore) {
  if (!plan || !plan.records) return 0;
  if (plan.target === 'finance_transactions') {
    return dropKnown(plan.records.map(r => normalizeTransaction(r)), store.getAll('finance_transactions'), transactionSignature).duplicates;
  }
  if (plan.target === 'trading_items') {
    return dropKnown(plan.records, store.getAll('trading_items'), tradingSignature).duplicates;
  }
  return 0;
}

/**
 * Scrive il piano nello store con un solo salvataggio.
 * Re-importare lo stesso file non duplica nulla: transazioni e articoli già presenti vengono saltati,
 * i log giornalieri Body sono upsert per data.
 * @returns {{target: string, imported: number, updated: number, duplicates: number, errors: number}}
 */
export function commitImportPlan(plan, store = defaultStore) {
  if (!plan || !plan.target) {
    return { target: null, imported: 0, updated: 0, duplicates: 0, errors: plan?.errors?.length || 0 };
  }

  let imported = 0;
  let updated = 0;
  let duplicates = 0;

  if (plan.target === 'body_daily_logs') {
    const existingDates = new Set(store.getAll('body_daily_logs').map(l => String(l.date).slice(0, 10)));
    store.runBatch(() => {
      for (const record of plan.records) {
        const isUpdate = existingDates.has(record.date);
        store.upsertBodyDailyLog(record);
        if (isUpdate) updated++;
        else imported++;
        existingDates.add(record.date);
      }
    });
  } else if (plan.target === 'finance_transactions') {
    const normalized = plan.records.map(r => normalizeTransaction(r));
    const { fresh, duplicates: dup } = dropKnown(normalized, store.getAll('finance_transactions'), transactionSignature);
    store.createBatch('finance_transactions', fresh);
    imported = fresh.length;
    duplicates = dup;
  } else if (plan.target === 'trading_items') {
    const { fresh, duplicates: dup } = dropKnown(plan.records, store.getAll('trading_items'), tradingSignature);
    store.createBatch('trading_items', fresh);
    imported = fresh.length;
    duplicates = dup;
  }

  return { target: plan.target, imported, updated, duplicates, errors: plan.errors.length };
}

/** Messaggio di esito pronto per il toast di successo. */
export function describeImportResult(result) {
  const targetNames = {
    body_daily_logs: 'giorni Body',
    finance_transactions: 'transazioni',
    trading_items: 'articoli di compravendita',
  };
  const name = targetNames[result.target] || 'record';
  const parts = [];
  const total = result.imported + (result.updated || 0);
  parts.push(`${total} ${name} importati`);
  if (result.updated) parts.push(`${result.updated} aggiornati`);
  if (result.duplicates) parts.push(`${result.duplicates} duplicati ignorati`);
  if (result.errors) parts.push(`${result.errors} righe scartate`);
  return parts.join(' · ');
}

/**
 * Scorciatoia end-to-end per matrice di celle: se il template è riconosciuto importa subito,
 * altrimenti restituisce needsMapping per far partire il wizard.
 */
export function autoImportRows(rawRows, store = defaultStore, options = {}) {
  const { table, detection } = analyzeRows(rawRows);
  if (!detection.template) {
    return { needsMapping: true, table, detection };
  }
  const plan = buildImportPlan(table, detection.template, detection.mapping, options);
  const result = commitImportPlan(plan, store);
  return { needsMapping: false, table, detection, plan, result, message: describeImportResult(result) };
}
