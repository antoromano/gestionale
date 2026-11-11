// src/services/finances.js
// Logica finanziaria PURA (nessuna dipendenza da store/DOM): Cash Flow, Ricorrenze, Compravendita / Flipping.
// Usata da store.js (helper), dai moduli UI, dall'importatore CSV/Excel e dall'Avvocato del Diavolo.
// Tutte le date sono stringhe ISO "YYYY-MM-DD" e l'aritmetica è fatta in UTC/interi per evitare
// gli sfasamenti di fuso orario (es. Europe/Rome) tipici di new Date(...).toISOString().

export const TRANSACTION_TYPES = ['income', 'expense'];
export const RECURRENCE_FREQUENCIES = ['weekly', 'monthly', 'yearly'];
export const TRADING_PLATFORMS = ['Vinted', 'Subito', 'eBay', 'Altro'];
export const TRADING_STATUSES = ['in_stock', 'reserved', 'sold', 'returned'];
export const PAYMENT_METHODS = ['bonifico', 'carta', 'contanti', 'paypal', 'addebito', 'altro'];

export const EXPENSE_CATEGORIES = [
  'Software & Abbonamenti',
  'Server & Hosting',
  'Attrezzatura & Hardware',
  'Trasporti & Viaggi',
  'Marketing & Adv',
  'Commercialista & Fisco',
  'Ufficio & Utenze',
  'Collaboratori',
  'Compravendita',
  'Generale',
];

export const INCOME_CATEGORIES = [
  'Servizi & Progetti',
  'Canoni & Manutenzione',
  'Compravendita',
  'Consulenza',
  'Rimborsi',
  'Generale',
];

export const TRADING_STATUS_LABELS = {
  in_stock: 'In Vendita',
  reserved: 'Riservato',
  sold: 'Venduto',
  returned: 'Reso',
};

export const FREQUENCY_LABELS = {
  weekly: 'Settimanale',
  monthly: 'Mensile',
  yearly: 'Annuale',
};

// ---------------------------------------------------------------------------
// Numeri
// ---------------------------------------------------------------------------

export function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

export function toCents(value) {
  return Math.round(toNumber(value) * 100);
}

/** Arrotondamento "half away from zero" come NUMERIC/ROUND di PostgreSQL (la notazione esponenziale evita 1.005 → 1.00). */
export function roundHalfAway(value, decimals = 2) {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  return sign * Number(`${Math.round(Number(`${abs}e${decimals}`))}e-${decimals}`);
}

export function round2(value) {
  return roundHalfAway(toNumber(value), 2);
}

// ---------------------------------------------------------------------------
// Date ISO (UTC-safe)
// ---------------------------------------------------------------------------

/** Data odierna nel fuso orario locale dell'utente come "YYYY-MM-DD". */
export function localTodayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseIsoDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function daysInMonth(year, month1to12) {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function formatIso(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addDaysIso(iso, days) {
  const p = parseIsoDate(iso);
  if (!p) return null;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return formatIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Aggiunge N mesi mantenendo il giorno originale, ridotto all'ultimo giorno disponibile (31 gen + 1 mese = 28/29 feb). */
export function addMonthsClampedIso(iso, months) {
  const p = parseIsoDate(iso);
  if (!p) return null;
  const total = p.y * 12 + (p.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return formatIso(y, m, Math.min(p.d, daysInMonth(y, m)));
}

export function monthRange(month1to12, year) {
  const start = formatIso(year, month1to12, 1);
  const end = formatIso(year, month1to12, daysInMonth(year, month1to12));
  return { start, end };
}

// ---------------------------------------------------------------------------
// Frequenze & Ricorrenze
// ---------------------------------------------------------------------------

/** Normalizza le frequenze: l'alias legacy 'annual' (vecchio modulo Spese) diventa 'yearly' come nello schema SQL. */
export function normalizeFrequency(freq) {
  const f = String(freq || '').trim().toLowerCase();
  if (['annual', 'annually', 'yearly', 'annuale', 'anno', 'year'].includes(f)) return 'yearly';
  if (['monthly', 'mensile', 'mese', 'month'].includes(f)) return 'monthly';
  if (['weekly', 'settimanale', 'settimana', 'week'].includes(f)) return 'weekly';
  return null;
}

/**
 * Elenca le date in cui una ricorrenza cade nell'intervallo [fromIso, toIso] (estremi inclusi).
 * La data di inizio della ricorrenza è la prima occorrenza. Rispetta la data di fine opzionale.
 * @param {{start: string, frequency: string, end?: string|null}} rule
 */
export function getRecurrenceDates(rule, fromIso, toIso) {
  const frequency = normalizeFrequency(rule.frequency);
  const start = String(rule.start || '').slice(0, 10);
  if (!frequency || !parseIsoDate(start) || !parseIsoDate(fromIso) || !parseIsoDate(toIso)) return [];

  const hardEnd = rule.end && parseIsoDate(rule.end) ? String(rule.end).slice(0, 10) : null;
  const upper = hardEnd && hardEnd < toIso ? hardEnd : toIso;
  const dates = [];

  for (let k = 0; k < 5000; k++) {
    let current;
    if (frequency === 'weekly') current = addDaysIso(start, 7 * k);
    else if (frequency === 'monthly') current = addMonthsClampedIso(start, k);
    else current = addMonthsClampedIso(start, 12 * k);

    if (current > upper) break;
    if (current >= fromIso) dates.push(current);
  }
  return dates;
}

export function isRecurringParent(tx) {
  return Boolean(tx && !tx.is_deleted && tx.is_recurring && !tx.recurrence_parent_id && normalizeFrequency(tx.recurrence_frequency));
}

export function getRecurrenceStart(parent) {
  return String(parent.recurrence_start_date || parent.date || '').slice(0, 10);
}

// ---------------------------------------------------------------------------
// Transazioni (Entrate / Uscite)
// ---------------------------------------------------------------------------

/** Normalizza una transazione: tipo valido, importo sempre positivo (il segno lo dà il tipo), frequenza SQL-compatibile. */
export function normalizeTransaction(raw = {}) {
  const type = TRANSACTION_TYPES.includes(raw.type) ? raw.type : 'expense';
  const frequency = normalizeFrequency(raw.recurrence_frequency);
  const isRecurring = Boolean(raw.is_recurring) && Boolean(frequency);
  const out = {
    ...raw,
    type,
    date: String(raw.date || localTodayIso()).slice(0, 10),
    category: String(raw.category || '').trim() || 'generale',
    amount: Math.abs(round2(raw.amount)),
    description: String(raw.description || '').trim(),
    payment_method: raw.payment_method || 'bonifico',
    client_id: raw.client_id || null,
    quote_id: raw.quote_id || null,
    is_recurring: isRecurring,
    recurrence_frequency: isRecurring ? frequency : null,
  };
  return out;
}

/** Converte una vecchia spesa (collezione `expenses`) in transazione `expense` retrocompatibile. */
export function legacyExpenseToTransaction(expense = {}) {
  return normalizeTransaction({
    ...expense,
    type: 'expense',
    payment_method: expense.payment_method || 'altro',
  });
}

function inRange(date, start, end) {
  const d = String(date || '').slice(0, 10);
  return d >= start && d <= end;
}

/**
 * Riepilogo mensile del Cash Flow.
 * @param {Array} transactions tutte le transazioni (anche cestinate: vengono ignorate)
 * @param {number} month 1-12
 * @param {number} year
 */
export function summarizeFinancials(transactions = [], month, year) {
  const now = new Date();
  const m = Number.isInteger(month) && month >= 1 && month <= 12 ? month : now.getMonth() + 1;
  const y = Number.isInteger(year) ? year : now.getFullYear();
  const { start, end } = monthRange(m, y);

  const live = (transactions || []).filter(t => t && !t.is_deleted);
  const monthTx = live.filter(t => inRange(t.date, start, end));

  let incomeCents = 0;
  let expenseCents = 0;
  let incomeCount = 0;
  let expenseCount = 0;
  const categoryTotals = { income: new Map(), expense: new Map() };

  for (const t of monthTx) {
    const cents = Math.abs(toCents(t.amount));
    const type = t.type === 'income' ? 'income' : 'expense';
    const cat = t.category || 'generale';
    categoryTotals[type].set(cat, (categoryTotals[type].get(cat) || 0) + cents);
    if (type === 'income') {
      incomeCents += cents;
      incomeCount++;
    } else {
      expenseCents += cents;
      expenseCount++;
    }
  }

  // Previsione uscite ricorrenti del mese: ogni "padre" attivo moltiplicato per le sue occorrenze nel mese.
  const materialized = new Set();
  for (const t of transactions || []) {
    if (!t) continue;
    if (t.recurrence_parent_id) materialized.add(`${t.recurrence_parent_id}|${String(t.date).slice(0, 10)}`);
  }

  let forecastCents = 0;
  let pendingCents = 0;
  let recurringCount = 0;
  for (const parent of live) {
    if (parent.type === 'income' || !isRecurringParent(parent) || parent.is_suspended) continue;
    const dates = getRecurrenceDates(
      { start: getRecurrenceStart(parent), frequency: parent.recurrence_frequency, end: parent.recurrence_end_date },
      start,
      end,
    );
    if (dates.length === 0) continue;
    recurringCount++;
    const cents = Math.abs(toCents(parent.amount));
    const firstOccurrence = getRecurrenceStart(parent); // il generatore non crea mai la data di inizio: è il "padre" stesso
    for (const d of dates) {
      forecastCents += cents;
      if (d !== firstOccurrence && !materialized.has(`${parent.id}|${d}`)) pendingCents += cents;
    }
  }

  const toSortedList = (map) =>
    Array.from(map.entries())
      .map(([category, cents]) => ({ category, total: cents / 100 }))
      .sort((a, b) => b.total - a.total);

  const netCents = incomeCents - expenseCents;
  return {
    month: m,
    year: y,
    periodStart: start,
    periodEnd: end,
    totalIncome: incomeCents / 100,
    totalExpenses: expenseCents / 100,
    netCashflow: netCents / 100,
    forecastRecurringExpenses: forecastCents / 100,
    recurringPendingExpenses: pendingCents / 100,
    projectedNetCashflow: (netCents - pendingCents) / 100,
    recurringItemsCount: recurringCount,
    incomeCount,
    expenseCount,
    byCategory: {
      income: toSortedList(categoryTotals.income),
      expense: toSortedList(categoryTotals.expense),
    },
  };
}

// ---------------------------------------------------------------------------
// Compravendita / Flipping
// ---------------------------------------------------------------------------

/**
 * Margine Netto e ROI %: replica ESATTA delle colonne GENERATED di `trading_items` (migration 006).
 *   net_profit  = sale_price - purchase_price - extra_costs - platform_fees        (NULL se non venduto)
 *   roi_percent = ROUND(net_profit / (purchase_price + extra_costs) * 100, 2)     (NULL se base costi = 0)
 * Aggiunge margin_percent (netto / prezzo di vendita) come indicatore extra solo lato client.
 */
export function computeTradingMetrics(item = {}) {
  const purchase = toCents(item.purchase_price);
  const extra = toCents(item.extra_costs);
  const fees = toCents(item.platform_fees);
  const costBasis = purchase + extra;
  const hasSale =
    item.sale_price !== null &&
    item.sale_price !== undefined &&
    item.sale_price !== '' &&
    Number.isFinite(Number(String(item.sale_price).replace(',', '.')));

  if (!hasSale) {
    return { net_profit: null, roi_percent: null, margin_percent: null, total_cost: costBasis / 100 };
  }

  const sale = toCents(item.sale_price);
  const net = sale - costBasis - fees;
  return {
    net_profit: net / 100,
    roi_percent: costBasis > 0 ? roundHalfAway((net / costBasis) * 100, 2) : null,
    margin_percent: sale > 0 ? roundHalfAway((net / sale) * 100, 2) : null,
    total_cost: costBasis / 100,
  };
}

/** Normalizza un articolo di compravendita e ne calcola i campi derivati (net_profit, roi_percent). */
export function normalizeTradingItem(raw = {}) {
  const hasSale = raw.sale_price !== null && raw.sale_price !== undefined && raw.sale_price !== '';
  const platform = String(raw.platform || '').trim() || 'Vinted';
  const status = TRADING_STATUSES.includes(raw.status) ? raw.status : hasSale ? 'sold' : 'in_stock';

  const base = {
    ...raw,
    title: String(raw.title || '').trim(),
    platform,
    purchase_date: String(raw.purchase_date || localTodayIso()).slice(0, 10),
    purchase_price: round2(raw.purchase_price),
    extra_costs: round2(raw.extra_costs),
    platform_fees: round2(raw.platform_fees),
    sale_price: hasSale ? round2(raw.sale_price) : null,
    sale_date: hasSale ? String(raw.sale_date || localTodayIso()).slice(0, 10) : raw.sale_date ? String(raw.sale_date).slice(0, 10) : null,
    status,
    notes: raw.notes || '',
    hours_spent: raw.hours_spent === '' || raw.hours_spent == null ? null : toNumber(raw.hours_spent, null),
  };
  const metrics = computeTradingMetrics(base);
  return { ...base, net_profit: metrics.net_profit, roi_percent: metrics.roi_percent };
}

/**
 * Statistiche della sezione Compravendita.
 *  - stockCapital: capitale (acquisto + extra) fermo negli articoli `in_stock`
 *  - reservedCapital: idem per `reserved`; activeCapital = stock + reserved
 *  - realizedProfit: somma degli utili netti degli articoli `sold`
 *  - avgRoiPercent: ROI medio % sugli articoli `sold`
 */
export function summarizeTrading(items = []) {
  const live = (items || []).filter(i => i && !i.is_deleted && i.status !== 'returned');
  let stockCents = 0;
  let reservedCents = 0;
  let profitCents = 0;
  let roiSum = 0;
  let roiCount = 0;
  let soldRevenueCents = 0;
  let inStockCount = 0;
  let reservedCount = 0;
  let soldCount = 0;
  let totalHours = 0;

  for (const raw of live) {
    const metrics = computeTradingMetrics(raw);
    const cost = Math.round(metrics.total_cost * 100);
    if (raw.status === 'in_stock') {
      stockCents += cost;
      inStockCount++;
    } else if (raw.status === 'reserved') {
      reservedCents += cost;
      reservedCount++;
    } else if (raw.status === 'sold') {
      soldCount++;
      if (metrics.net_profit !== null) profitCents += Math.round(metrics.net_profit * 100);
      if (metrics.roi_percent !== null) {
        roiSum += metrics.roi_percent;
        roiCount++;
      }
      soldRevenueCents += toCents(raw.sale_price);
      totalHours += toNumber(raw.hours_spent);
    }
  }

  return {
    stockCapital: stockCents / 100,
    reservedCapital: reservedCents / 100,
    activeCapital: (stockCents + reservedCents) / 100,
    realizedProfit: profitCents / 100,
    soldRevenue: soldRevenueCents / 100,
    avgRoiPercent: roiCount > 0 ? roundHalfAway(roiSum / roiCount, 2) : 0,
    inStockCount,
    reservedCount,
    soldCount,
    totalItems: live.length,
    totalHoursSpent: totalHours,
  };
}

/**
 * Profitto orario reale di un articolo venduto: utile netto (già al netto di commissioni) / ore impiegate.
 * Se le ore non sono note usa `assumedHours` (stima prudente) e lo segnala in `isEstimated`.
 */
export function computeHourlyProfit(item, assumedHours = 2) {
  const metrics = computeTradingMetrics(item);
  if (metrics.net_profit === null) return null;
  const known = toNumber(item.hours_spent, 0);
  const hours = known > 0 ? known : assumedHours;
  return {
    netProfit: metrics.net_profit,
    hours,
    isEstimated: !(known > 0),
    hourlyProfit: hours > 0 ? roundHalfAway(metrics.net_profit / hours, 2) : null,
  };
}
