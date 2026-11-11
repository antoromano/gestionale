// src/modules/finances.js
// Finanze & Cash Flow: centro finanziario completo (evoluzione del vecchio modulo Spese).
//   Tab 1 · Panoramica Cash Flow   — KPI mensili + tabella unificata Entrate/Uscite
//   Tab 2 · Compravendita          — Flipping online con Margine Netto e ROI % automatici
//   Tab 3 · Uscite & Ricorrenti    — Abbonamenti e costi fissi con generazione idempotente
//   Tab 4 · Importa File           — CSV / Excel deterministico (zero token IA)

import { store } from '../services/store.js';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
  TRADING_PLATFORMS,
  TRADING_STATUS_LABELS,
  FREQUENCY_LABELS,
  computeTradingMetrics,
  getRecurrenceDates,
  getRecurrenceStart,
  isRecurringParent,
  addDaysIso,
  localTodayIso,
  normalizeFrequency,
  toNumber,
} from '../services/finances.js';
import { formatCurrency, formatDate, formatMonthYear, escapeHtml } from '../utils/formatters.js';
import { icon } from '../utils/icons.js';
import { showToast } from '../utils/toast.js';
import { mountImportPanel } from './import-panel.js';
import { attachSpringTiltCards } from '../utils/three-scenes.js';
import { getDevHourlyRate } from '../services/devils-advocate.js';

const TABS = [
  { id: 'overview', label: 'Panoramica Cash Flow', icon: 'reports' },
  { id: 'trading', label: 'Compravendita', icon: 'catalog' },
  { id: 'recurring', label: 'Uscite & Abbonamenti', icon: 'clock' },
  { id: 'import', label: 'Importa File', icon: 'upload' },
];

const now = new Date();
const state = {
  tab: 'overview',
  month: now.getMonth() + 1,
  year: now.getFullYear(),
  allMonths: false,
  txType: 'all',
  txCategory: 'all',
  txSearch: '',
  tradeStatus: 'all',
  tradeSearch: '',
};

const STATUS_BADGES = {
  in_stock: 'badge-blue',
  sold: 'badge-green',
  reserved: 'badge-yellow',
  returned: 'badge-gray',
};

const kpiLabelStyle = 'font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); display: flex; align-items: center; gap: 5px;';
const kpiSubStyle = 'font-size: 11px; color: var(--text-muted); margin-top: 2px;';

function clientName(clientId) {
  const c = clientId ? store.getById('clients', clientId) : null;
  if (!c) return '';
  return c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim();
}

function signedAmount(type, amount) {
  return `${type === 'income' ? '+' : '-'}${formatCurrency(amount)}`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function renderFinances(container, router, params = {}) {
  if (params && TABS.some(t => t.id === params.tab)) state.tab = params.tab;

  // Generazione automatica (idempotente) delle transazioni ricorrenti maturate
  const generated = store.generateRecurringTransactions();
  if (generated > 0) {
    showToast(`${generated} ${generated === 1 ? 'transazione ricorrente generata' : 'transazioni ricorrenti generate'}`, 'info');
  }

  const rerender = () => renderFinances(container, router);

  container.innerHTML = `
    <div style="margin-bottom: 16px; overflow-x: auto;">
      <div class="segmented-tabs" role="tablist" aria-label="Sezioni Finanze">
        ${TABS.map(t => `
          <button type="button" role="tab" aria-selected="${state.tab === t.id}" class="segmented-tab-btn ${state.tab === t.id ? 'active' : ''}" data-fin-tab="${t.id}">
            ${icon(t.icon, 14)} <span>${t.label}</span>
          </button>`).join('')}
      </div>
    </div>
    <div id="fin-tab-content"></div>
    <div id="fin-modal-container"></div>
  `;

  container.querySelectorAll('[data-fin-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.tab = btn.dataset.finTab;
      rerender();
    });
  });

  const content = container.querySelector('#fin-tab-content');
  const modalHost = container.querySelector('#fin-modal-container');
  const ctx = { content, modalHost, rerender };

  if (state.tab === 'overview') renderOverviewTab(ctx);
  else if (state.tab === 'trading') renderTradingTab(ctx);
  else if (state.tab === 'recurring') renderRecurringTab(ctx);
  else mountImportPanel(content, { onImported: rerender });

  attachSpringTiltCards(container);
}

// Compatibilità con la vecchia rotta/modulo Spese
export function renderExpenses(container, router) {
  return renderFinances(container, router);
}

// ---------------------------------------------------------------------------
// TAB 1 · PANORAMICA CASH FLOW
// ---------------------------------------------------------------------------

function renderOverviewTab({ content, modalHost, rerender }) {
  const summary = store.getFinancialSummary(state.month, state.year);
  const monthLabel = formatMonthYear(new Date(state.year, state.month - 1, 1));
  const net = summary.netCashflow;
  const netColor = net > 0 ? 'var(--success)' : net < 0 ? 'var(--danger)' : 'var(--text-main)';

  const allTx = store.getAll('finance_transactions');
  const categories = Array.from(new Set(allTx.map(t => t.category).filter(Boolean))).sort();
  const q = state.txSearch.trim().toLowerCase();

  const rows = allTx
    .filter(t => {
      if (!state.allMonths && (t.date < summary.periodStart || t.date > summary.periodEnd)) return false;
      if (state.txType !== 'all' && t.type !== state.txType) return false;
      if (state.txCategory !== 'all' && t.category !== state.txCategory) return false;
      if (q) {
        const hay = `${t.description} ${t.category} ${clientName(t.client_id)} ${t.notes || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at)));

  const filteredIncome = rows.filter(r => r.type === 'income').reduce((s, r) => s + Number(r.amount), 0);
  const filteredExpense = rows.filter(r => r.type === 'expense').reduce((s, r) => s + Number(r.amount), 0);

  const topExpenseCats = summary.byCategory.expense.slice(0, 5);
  const maxCat = topExpenseCats.length > 0 ? topExpenseCats[0].total : 0;

  content.innerHTML = `
    <!-- Navigazione mese -->
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 14px;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <button class="btn btn-sm btn-secondary" id="fin-prev-month" aria-label="Mese precedente">‹</button>
        <div style="min-width: 150px; text-align: center; font-weight: 700; font-size: 15px;">${monthLabel}</div>
        <button class="btn btn-sm btn-secondary" id="fin-next-month" aria-label="Mese successivo">›</button>
        <button class="btn btn-sm btn-secondary" id="fin-this-month">Oggi</button>
      </div>
      <div style="font-size: 12px; color: var(--text-muted);">Il Cash Flow considera solo il ledger Entrate/Uscite del mese selezionato.</div>
    </div>

    <!-- KPI -->
    <div class="grid-4 fin-kpis" style="margin-bottom: 16px;">
      <div class="card kpi-card-3d" style="margin-bottom: 0; padding: 15px 16px;">
        <div style="${kpiLabelStyle}">${icon('download', 13)} <span>Entrate Mese</span></div>
        <div class="kpi-value" style="font-size: 24px; font-weight: 700; margin-top: 4px; color: var(--success);" id="kpi-income">+${formatCurrency(summary.totalIncome)}</div>
        <div style="${kpiSubStyle}">${summary.incomeCount} ${summary.incomeCount === 1 ? 'movimento' : 'movimenti'}</div>
      </div>

      <div class="card kpi-card-3d" style="margin-bottom: 0; padding: 15px 16px;">
        <div style="${kpiLabelStyle}">${icon('upload', 13)} <span>Uscite Mese</span></div>
        <div class="kpi-value" style="font-size: 24px; font-weight: 700; margin-top: 4px; color: var(--danger);" id="kpi-expense">-${formatCurrency(summary.totalExpenses)}</div>
        <div style="${kpiSubStyle}">${summary.expenseCount} ${summary.expenseCount === 1 ? 'movimento' : 'movimenti'}</div>
      </div>

      <div class="card kpi-card-3d" style="margin-bottom: 0; padding: 15px 16px; border-color: ${net >= 0 ? 'rgba(5,150,105,0.35)' : 'rgba(220,38,38,0.35)'}; box-shadow: 0 0 0 3px ${net >= 0 ? 'rgba(5,150,105,0.07)' : 'rgba(220,38,38,0.07)'};">
        <div style="${kpiLabelStyle}">${icon('activity', 13)} <span>Cash Flow Netto</span></div>
        <div class="kpi-value" style="font-size: 26px; font-weight: 700; margin-top: 4px; color: ${netColor};" id="kpi-net">${net > 0 ? '+' : net < 0 ? '-' : ''}${formatCurrency(Math.abs(net))}</div>
        <div style="${kpiSubStyle}">
          ${net > 0 ? 'Utile del mese' : net < 0 ? 'Perdita del mese' : 'In pareggio'}
          ${summary.recurringPendingExpenses > 0 ? ` · previsto a fine mese ${formatCurrency(summary.projectedNetCashflow)}` : ''}
        </div>
      </div>

      <div class="card kpi-card-3d" style="margin-bottom: 0; padding: 15px 16px;">
        <div style="${kpiLabelStyle}">${icon('clock', 13)} <span>Costi Fissi Ricorrenti</span></div>
        <div class="kpi-value" style="font-size: 24px; font-weight: 700; margin-top: 4px;" id="kpi-recurring">${formatCurrency(summary.forecastRecurringExpenses)}</div>
        <div style="${kpiSubStyle}">
          ${summary.recurringItemsCount} ${summary.recurringItemsCount === 1 ? 'abbonamento/server' : 'abbonamenti/server'}
          ${summary.recurringPendingExpenses > 0 ? ` · ${formatCurrency(summary.recurringPendingExpenses)} ancora da addebitare` : ''}
        </div>
      </div>
    </div>

    ${topExpenseCats.length > 0 ? `
      <div class="card" style="margin-bottom: 16px; padding: 14px 16px;">
        <div style="font-weight: 600; font-size: 12.5px; margin-bottom: 10px;">Uscite per categoria — ${monthLabel}</div>
        <div style="display: flex; flex-direction: column; gap: 7px;">
          ${topExpenseCats.map(c => `
            <div style="display: grid; grid-template-columns: minmax(110px, 190px) 1fr auto; gap: 10px; align-items: center; font-size: 12px;">
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(c.category)}</span>
              <div class="cat-bar"><div class="cat-bar-fill" style="width: ${maxCat > 0 ? Math.max(3, Math.round((c.total / maxCat) * 100)) : 0}%;"></div></div>
              <span class="mono" style="font-weight: 600;">${formatCurrency(c.total)}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}

    <!-- Filtri e azioni -->
    <div class="card" style="margin-bottom: 14px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; gap: 10px; flex-wrap: wrap; flex: 1; align-items: center;">
          <input type="text" id="fin-search" class="form-input" placeholder="Cerca transazione..." value="${escapeHtml(state.txSearch)}" style="max-width: 230px;" />
          <select id="fin-type-filter" class="form-select" style="max-width: 150px;">
            <option value="all" ${state.txType === 'all' ? 'selected' : ''}>Entrate e Uscite</option>
            <option value="income" ${state.txType === 'income' ? 'selected' : ''}>Solo Entrate</option>
            <option value="expense" ${state.txType === 'expense' ? 'selected' : ''}>Solo Uscite</option>
          </select>
          <select id="fin-cat-filter" class="form-select" style="max-width: 190px;">
            <option value="all">Tutte le categorie</option>
            ${categories.map(c => `<option value="${escapeHtml(c)}" ${state.txCategory === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
          <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
            <input type="checkbox" id="fin-all-months" ${state.allMonths ? 'checked' : ''} /> Tutti i mesi
          </label>
        </div>
        <button id="fin-new-tx-btn" class="btn btn-primary">${icon('plus', 14)} Nuova Transazione</button>
      </div>
    </div>

    <!-- Tabella unificata -->
    <div class="card" style="padding: 0; overflow: hidden;">
      ${rows.length === 0 ? `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          Nessuna transazione ${state.allMonths ? '' : `in ${monthLabel}`}. Registra la prima con “Nuova Transazione” o importa un estratto conto.
        </div>` : `
        <div class="data-table-wrapper">
          <table class="data-table mobile-cards-table">
            <thead>
              <tr>
                <th>Data</th><th>Descrizione</th><th>Categoria</th><th>Cliente</th>
                <th style="text-align: right;">Importo</th><th style="text-align: right;">Azioni</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(t => `
                <tr>
                  <td data-label="Data" class="mono">${formatDate(t.date)}</td>
                  <td data-label="Descrizione" style="font-weight: 600;">
                    ${escapeHtml(t.description)}
                    ${t.is_recurring ? `<span class="badge badge-blue" style="margin-left: 6px;">${icon('clock', 11)} ${FREQUENCY_LABELS[normalizeFrequency(t.recurrence_frequency)] || 'Ricorrente'}</span>` : ''}
                  </td>
                  <td data-label="Categoria"><span class="badge badge-gray">${escapeHtml(t.category)}</span></td>
                  <td data-label="Cliente">${escapeHtml(clientName(t.client_id)) || '-'}</td>
                  <td data-label="Importo" class="mono" style="text-align: right; font-weight: 700; color: var(${t.type === 'income' ? '--success' : '--danger'});">${signedAmount(t.type, t.amount)}</td>
                  <td data-label="Azioni" style="text-align: right; white-space: nowrap;">
                    <button class="btn btn-sm btn-secondary tx-edit-btn" data-id="${t.id}" aria-label="Modifica">${icon('edit', 13)}</button>
                    <button class="btn btn-sm btn-danger tx-trash-btn" data-id="${t.id}" aria-label="Sposta nel cestino">${icon('trash', 13)}</button>
                  </td>
                </tr>`).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="4" style="font-weight: 600; padding: 10px 14px;">Totale filtrato</td>
                <td class="mono" style="text-align: right; font-weight: 700; padding: 10px 14px;">
                  <span style="color: var(--success);">+${formatCurrency(filteredIncome)}</span> /
                  <span style="color: var(--danger);">-${formatCurrency(filteredExpense)}</span>
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>`}
    </div>
  `;

  const shiftMonth = (delta) => {
    let m = state.month + delta;
    let y = state.year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    state.month = m;
    state.year = y;
    rerender();
  };
  content.querySelector('#fin-prev-month').addEventListener('click', () => shiftMonth(-1));
  content.querySelector('#fin-next-month').addEventListener('click', () => shiftMonth(1));
  content.querySelector('#fin-this-month').addEventListener('click', () => {
    const d = new Date();
    state.month = d.getMonth() + 1;
    state.year = d.getFullYear();
    rerender();
  });

  const searchInput = content.querySelector('#fin-search');
  searchInput.addEventListener('input', (e) => {
    state.txSearch = e.target.value;
    rerender();
    const el = document.querySelector('#fin-search');
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  });
  content.querySelector('#fin-type-filter').addEventListener('change', (e) => { state.txType = e.target.value; rerender(); });
  content.querySelector('#fin-cat-filter').addEventListener('change', (e) => { state.txCategory = e.target.value; rerender(); });
  content.querySelector('#fin-all-months').addEventListener('change', (e) => { state.allMonths = e.target.checked; rerender(); });

  content.querySelector('#fin-new-tx-btn').addEventListener('click', () => openTransactionModal({ modalHost, rerender }));
  content.querySelectorAll('.tx-edit-btn').forEach(btn => btn.addEventListener('click', () => {
    openTransactionModal({ tx: store.getById('finance_transactions', btn.dataset.id), modalHost, rerender });
  }));
  content.querySelectorAll('.tx-trash-btn').forEach(btn => btn.addEventListener('click', () => {
    if (confirm('Spostare questa transazione nel cestino?')) {
      store.moveToTrash('finance_transactions', btn.dataset.id);
      rerender();
    }
  }));
}

// ---------------------------------------------------------------------------
// TAB 2 · COMPRAVENDITA / FLIPPING ONLINE
// ---------------------------------------------------------------------------

function renderTradingTab({ content, modalHost, rerender }) {
  const stats = store.getTradingStats();
  const items = store.getAll('trading_items');
  const q = state.tradeSearch.trim().toLowerCase();

  const rows = items
    .filter(i => (state.tradeStatus === 'all' || i.status === state.tradeStatus)
      && (!q || `${i.title} ${i.platform} ${i.notes || ''}`.toLowerCase().includes(q)))
    .sort((a, b) => String(b.purchase_date).localeCompare(String(a.purchase_date)));

  content.innerHTML = `
    <div class="grid-3 fin-kpis" style="margin-bottom: 16px;">
      <div class="card kpi-card-3d" style="margin-bottom: 0; padding: 15px 16px;">
        <div style="${kpiLabelStyle}">${icon('catalog', 13)} <span>Capitale Attivo in Giacenza</span></div>
        <div class="kpi-value" style="font-size: 24px; font-weight: 700; margin-top: 4px;" id="kpi-stock">${formatCurrency(stats.activeCapital)}</div>
        <div style="${kpiSubStyle}">${stats.inStockCount} in vendita${stats.reservedCount ? ` · ${stats.reservedCount} riservati (${formatCurrency(stats.reservedCapital)})` : ''}</div>
      </div>
      <div class="card kpi-card-3d" style="margin-bottom: 0; padding: 15px 16px;">
        <div style="${kpiLabelStyle}">${icon('check', 13)} <span>Utile Netto Realizzato</span></div>
        <div class="kpi-value" style="font-size: 24px; font-weight: 700; margin-top: 4px; color: ${stats.realizedProfit >= 0 ? 'var(--success)' : 'var(--danger)'};" id="kpi-profit">${stats.realizedProfit > 0 ? '+' : ''}${formatCurrency(stats.realizedProfit)}</div>
        <div style="${kpiSubStyle}">${stats.soldCount} ${stats.soldCount === 1 ? 'articolo venduto' : 'articoli venduti'} · incasso ${formatCurrency(stats.soldRevenue)}</div>
      </div>
      <div class="card kpi-card-3d" style="margin-bottom: 0; padding: 15px 16px;">
        <div style="${kpiLabelStyle}">${icon('target', 13)} <span>ROI Medio</span></div>
        <div class="kpi-value" style="font-size: 24px; font-weight: 700; margin-top: 4px;" id="kpi-roi">${stats.avgRoiPercent}%</div>
        <div style="${kpiSubStyle}">Utile netto / (acquisto + extra), media sui venduti</div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 14px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; gap: 10px; flex-wrap: wrap; flex: 1;">
          <input type="text" id="trade-search" class="form-input" placeholder="Cerca articolo..." value="${escapeHtml(state.tradeSearch)}" style="max-width: 230px;" />
          <select id="trade-status-filter" class="form-select" style="max-width: 180px;">
            <option value="all">Tutti gli stati</option>
            ${Object.entries(TRADING_STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${state.tradeStatus === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </div>
        <button id="trade-new-btn" class="btn btn-primary">${icon('plus', 14)} Nuovo Articolo</button>
      </div>
    </div>

    <div class="card" style="padding: 0; overflow: hidden;">
      ${rows.length === 0 ? `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          Nessun articolo. Aggiungi il primo acquisto con “Nuovo Articolo” o importa il tuo foglio di compravendita.
        </div>` : `
        <div class="data-table-wrapper">
          <table class="data-table mobile-cards-table">
            <thead>
              <tr>
                <th>Oggetto</th><th>Piattaforma</th>
                <th style="text-align: right;">Costo</th><th style="text-align: right;">Vendita</th>
                <th style="text-align: right;">Margine Netto</th><th style="text-align: right;">ROI</th>
                <th>Stato</th><th style="text-align: right;">Azioni</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(i => {
                const m = computeTradingMetrics(i);
                const sold = m.net_profit !== null;
                return `
                  <tr>
                    <td data-label="Oggetto" style="font-weight: 600;">${escapeHtml(i.title)}<div style="font-size: 11px; color: var(--text-muted); font-weight: 400;">Acquistato ${formatDate(i.purchase_date)}</div></td>
                    <td data-label="Piattaforma">${escapeHtml(i.platform)}</td>
                    <td data-label="Costo" class="mono" style="text-align: right;">${formatCurrency(m.total_cost)}${toNumber(i.extra_costs) > 0 ? `<div style="font-size: 10.5px; color: var(--text-muted);">incl. ${formatCurrency(i.extra_costs)} extra</div>` : ''}</td>
                    <td data-label="Vendita" class="mono" style="text-align: right;">${sold ? formatCurrency(i.sale_price) : '—'}${sold && toNumber(i.platform_fees) > 0 ? `<div style="font-size: 10.5px; color: var(--text-muted);">- ${formatCurrency(i.platform_fees)} comm.</div>` : ''}</td>
                    <td data-label="Margine Netto" class="mono" style="text-align: right; font-weight: 700; color: ${sold ? (m.net_profit >= 0 ? 'var(--success)' : 'var(--danger)') : 'var(--text-muted)'};">${sold ? `${m.net_profit > 0 ? '+' : ''}${formatCurrency(m.net_profit)}` : '—'}</td>
                    <td data-label="ROI" class="mono" style="text-align: right; font-weight: 600;">${m.roi_percent !== null ? `${m.roi_percent}%` : '—'}</td>
                    <td data-label="Stato"><span class="badge ${STATUS_BADGES[i.status] || 'badge-gray'}">${TRADING_STATUS_LABELS[i.status] || i.status}</span></td>
                    <td data-label="Azioni" style="text-align: right; white-space: nowrap;">
                      ${i.status === 'in_stock' || i.status === 'reserved' ? `<button class="btn btn-sm btn-success trade-sold-btn" data-id="${i.id}" title="Registra la vendita">Venduto</button>` : ''}
                      <button class="btn btn-sm btn-secondary trade-edit-btn" data-id="${i.id}" aria-label="Modifica">${icon('edit', 13)}</button>
                      <button class="btn btn-sm btn-danger trade-trash-btn" data-id="${i.id}" aria-label="Sposta nel cestino">${icon('trash', 13)}</button>
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
    </div>
  `;

  const search = content.querySelector('#trade-search');
  search.addEventListener('input', (e) => {
    state.tradeSearch = e.target.value;
    rerender();
    const el = document.querySelector('#trade-search');
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  });
  content.querySelector('#trade-status-filter').addEventListener('change', (e) => { state.tradeStatus = e.target.value; rerender(); });
  content.querySelector('#trade-new-btn').addEventListener('click', () => openTradingModal({ modalHost, rerender }));
  content.querySelectorAll('.trade-edit-btn').forEach(b => b.addEventListener('click', () => {
    openTradingModal({ item: store.getById('trading_items', b.dataset.id), modalHost, rerender });
  }));
  content.querySelectorAll('.trade-sold-btn').forEach(b => b.addEventListener('click', () => {
    openTradingModal({ item: store.getById('trading_items', b.dataset.id), markSold: true, modalHost, rerender });
  }));
  content.querySelectorAll('.trade-trash-btn').forEach(b => b.addEventListener('click', () => {
    if (confirm('Spostare questo articolo nel cestino?')) {
      store.moveToTrash('trading_items', b.dataset.id);
      rerender();
    }
  }));
}

// ---------------------------------------------------------------------------
// TAB 3 · USCITE & ABBONAMENTI RICORRENTI
// ---------------------------------------------------------------------------

function monthlyEquivalent(parent) {
  const amount = Math.abs(toNumber(parent.amount));
  const f = normalizeFrequency(parent.recurrence_frequency);
  if (f === 'weekly') return (amount * 52) / 12;
  if (f === 'yearly') return amount / 12;
  return amount;
}

function renderRecurringTab({ content, modalHost, rerender }) {
  const all = store.getAll('finance_transactions');
  const parents = all.filter(isRecurringParent).sort((a, b) => String(a.description).localeCompare(String(b.description)));
  const today = localTodayIso();

  const activeExpenses = parents.filter(p => p.type === 'expense' && !p.is_suspended);
  const monthlyFixed = activeExpenses.reduce((s, p) => s + monthlyEquivalent(p), 0);

  content.innerHTML = `
    <div class="grid-3 fin-kpis" style="margin-bottom: 16px;">
      <div class="card kpi-card-3d" style="margin-bottom: 0; padding: 15px 16px;">
        <div style="${kpiLabelStyle}">${icon('clock', 13)} <span>Costo Fisso Mensile</span></div>
        <div class="kpi-value" style="font-size: 24px; font-weight: 700; margin-top: 4px; color: var(--danger);">${formatCurrency(monthlyFixed)}</div>
        <div style="${kpiSubStyle}">Equivalente mensile di ${activeExpenses.length} ${activeExpenses.length === 1 ? 'uscita attiva' : 'uscite attive'}</div>
      </div>
      <div class="card kpi-card-3d" style="margin-bottom: 0; padding: 15px 16px;">
        <div style="${kpiLabelStyle}">${icon('calendar', 13)} <span>Proiezione Annua</span></div>
        <div class="kpi-value" style="font-size: 24px; font-weight: 700; margin-top: 4px;">${formatCurrency(monthlyFixed * 12)}</div>
        <div style="${kpiSubStyle}">Quanto ti costano in un anno server, licenze e abbonamenti</div>
      </div>
      <div class="card kpi-card-3d" style="margin-bottom: 0; padding: 15px 16px;">
        <div style="${kpiLabelStyle}">${icon('info', 13)} <span>Generazione automatica</span></div>
        <div style="font-size: 13px; font-weight: 600; margin-top: 6px;">Idempotente</div>
        <div style="${kpiSubStyle}">Le scadenze maturate vengono create una sola volta, anche riaprendo la pagina.</div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 14px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div style="font-size: 12.5px; color: var(--text-muted);">Abbonamenti, server, licenze e incassi periodici (mensili, settimanali, annuali).</div>
        <button id="rec-new-btn" class="btn btn-primary">${icon('plus', 14)} Nuova Ricorrenza</button>
      </div>
    </div>

    <div class="card" style="padding: 0; overflow: hidden;">
      ${parents.length === 0 ? `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          Nessuna ricorrenza. Aggiungi ad esempio “Hosting Vercel — 20 € / mese” o “Dominio — 15 € / anno”.
        </div>` : `
        <div class="data-table-wrapper">
          <table class="data-table mobile-cards-table">
            <thead>
              <tr>
                <th>Descrizione</th><th>Tipo</th><th>Categoria</th><th style="text-align: right;">Importo</th>
                <th>Frequenza</th><th>Prossima scadenza</th><th style="text-align: right;">Eq. mensile</th><th>Stato</th>
                <th style="text-align: right;">Azioni</th>
              </tr>
            </thead>
            <tbody>
              ${parents.map(p => {
                const f = normalizeFrequency(p.recurrence_frequency);
                const next = getRecurrenceDates(
                  { start: getRecurrenceStart(p), frequency: f, end: p.recurrence_end_date },
                  addDaysIso(today, 1),
                  addDaysIso(today, 800),
                )[0];
                const generatedCount = all.filter(t => t.recurrence_parent_id === p.id).length;
                return `
                  <tr style="${p.is_suspended ? 'opacity: 0.6;' : ''}">
                    <td data-label="Descrizione" style="font-weight: 600;">${escapeHtml(p.description)}<div style="font-size: 11px; color: var(--text-muted); font-weight: 400;">dal ${formatDate(getRecurrenceStart(p))} · ${generatedCount} generate</div></td>
                    <td data-label="Tipo"><span class="badge ${p.type === 'income' ? 'badge-green' : 'badge-red'}">${p.type === 'income' ? 'Entrata' : 'Uscita'}</span></td>
                    <td data-label="Categoria"><span class="badge badge-gray">${escapeHtml(p.category)}</span></td>
                    <td data-label="Importo" class="mono" style="text-align: right; font-weight: 700;">${formatCurrency(p.amount)}</td>
                    <td data-label="Frequenza"><span class="badge badge-blue">${FREQUENCY_LABELS[f]}</span></td>
                    <td data-label="Prossima scadenza" class="mono">${p.is_suspended ? '—' : next ? formatDate(next) : 'Terminata'}</td>
                    <td data-label="Eq. mensile" class="mono" style="text-align: right;">${formatCurrency(monthlyEquivalent(p))}</td>
                    <td data-label="Stato"><span class="badge ${p.is_suspended ? 'badge-yellow' : 'badge-green'}">${p.is_suspended ? 'Sospesa' : 'Attiva'}</span></td>
                    <td data-label="Azioni" style="text-align: right; white-space: nowrap;">
                      <button class="btn btn-sm btn-secondary rec-toggle-btn" data-id="${p.id}">${p.is_suspended ? 'Riattiva' : 'Sospendi'}</button>
                      <button class="btn btn-sm btn-secondary rec-edit-btn" data-id="${p.id}" aria-label="Modifica">${icon('edit', 13)}</button>
                      <button class="btn btn-sm btn-danger rec-trash-btn" data-id="${p.id}" aria-label="Sposta nel cestino">${icon('trash', 13)}</button>
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
    </div>
  `;

  content.querySelector('#rec-new-btn').addEventListener('click', () => {
    openTransactionModal({ modalHost, rerender, defaults: { type: 'expense', is_recurring: true, recurrence_frequency: 'monthly', category: 'Software & Abbonamenti' } });
  });
  content.querySelectorAll('.rec-edit-btn').forEach(b => b.addEventListener('click', () => {
    openTransactionModal({ tx: store.getById('finance_transactions', b.dataset.id), modalHost, rerender });
  }));
  content.querySelectorAll('.rec-toggle-btn').forEach(b => b.addEventListener('click', () => {
    const p = store.getById('finance_transactions', b.dataset.id);
    store.update('finance_transactions', b.dataset.id, { is_suspended: !p.is_suspended });
    rerender();
  }));
  content.querySelectorAll('.rec-trash-btn').forEach(b => b.addEventListener('click', () => {
    if (confirm('Spostare questa ricorrenza nel cestino? Le occorrenze già generate restano nel ledger.')) {
      store.moveToTrash('finance_transactions', b.dataset.id);
      rerender();
    }
  }));
}

// ---------------------------------------------------------------------------
// MODALI
// ---------------------------------------------------------------------------

function mountModal(host, html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  host.appendChild(wrapper);
  const overlay = wrapper.querySelector('.modal-overlay');

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    wrapper.remove();
  };
  document.addEventListener('keydown', onKey);

  let downOnBackdrop = false;
  overlay.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === overlay; });
  overlay.addEventListener('mouseup', (e) => {
    if (downOnBackdrop && e.target === overlay) close();
    downOnBackdrop = false;
  });
  wrapper.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', close));
  return { el: wrapper, close };
}

function openTransactionModal({ tx = null, defaults = {}, modalHost, rerender }) {
  const isEdit = Boolean(tx);
  const base = tx || { type: 'expense', date: localTodayIso(), category: 'Generale', payment_method: 'bonifico', ...defaults };
  const clients = store.getAll('clients');
  const recurring = Boolean(base.is_recurring);
  const freq = normalizeFrequency(base.recurrence_frequency) || 'monthly';

  const { el, close } = mountModal(modalHost, `
    <div class="modal-overlay">
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-label="${isEdit ? 'Modifica transazione' : 'Nuova transazione'}">
        <div class="modal-header">
          <div class="modal-title">${isEdit ? 'Modifica Transazione' : 'Nuova Transazione'}</div>
          <button type="button" class="btn btn-sm btn-secondary" data-close-modal aria-label="Chiudi">✕</button>
        </div>
        <form id="tx-form">
          <div class="modal-body">
            <div class="segmented-tabs" id="tx-type-toggle" style="margin-bottom: 14px;">
              <button type="button" class="segmented-tab-btn ${base.type === 'income' ? 'active' : ''}" data-type="income" style="${base.type === 'income' ? 'color: var(--success);' : ''}">+ Entrata</button>
              <button type="button" class="segmented-tab-btn ${base.type !== 'income' ? 'active' : ''}" data-type="expense" style="${base.type !== 'income' ? 'color: var(--danger);' : ''}">− Uscita</button>
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 2;">
                <label class="form-label">Descrizione *</label>
                <input type="text" id="tx-desc" class="form-input" required value="${escapeHtml(base.description || '')}" placeholder="es. Hosting Vercel, Saldo progetto sito" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Importo (€) *</label>
                <input type="number" id="tx-amount" class="form-input" step="0.01" min="0.01" required value="${base.amount ?? ''}" placeholder="0.00" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Categoria</label>
                <input type="text" id="tx-cat" class="form-input" list="tx-cat-list" value="${escapeHtml(base.category || 'Generale')}" />
                <datalist id="tx-cat-list"></datalist>
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Data *</label>
                <input type="date" id="tx-date" class="form-input" required value="${String(base.date).slice(0, 10)}" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Metodo</label>
                <select id="tx-method" class="form-select">
                  ${PAYMENT_METHODS.map(m => `<option value="${m}" ${base.payment_method === m ? 'selected' : ''}>${m.charAt(0).toUpperCase() + m.slice(1)}</option>`).join('')}
                </select>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Cliente collegato (opzionale)</label>
              <select id="tx-client" class="form-select">
                <option value="">Nessuno</option>
                ${clients.map(c => `<option value="${c.id}" ${base.client_id === c.id ? 'selected' : ''}>${escapeHtml(c.company_name || `${c.first_name} ${c.last_name}`)}</option>`).join('')}
              </select>
            </div>

            <div style="margin-top: 6px; padding: 12px; background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius);">
              <label style="display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer;">
                <input type="checkbox" id="tx-recurring" ${recurring ? 'checked' : ''} /> ${icon('clock', 14)} Rendi ricorrente (generazione automatica)
              </label>
              <div id="tx-recurring-pane" style="display: ${recurring ? 'block' : 'none'}; margin-top: 10px;">
                <div class="form-row">
                  <div class="form-group" style="flex: 1;">
                    <label class="form-label">Frequenza</label>
                    <select id="tx-freq" class="form-select">
                      <option value="monthly" ${freq === 'monthly' ? 'selected' : ''}>Mensile</option>
                      <option value="weekly" ${freq === 'weekly' ? 'selected' : ''}>Settimanale</option>
                      <option value="yearly" ${freq === 'yearly' ? 'selected' : ''}>Annuale</option>
                    </select>
                  </div>
                  <div class="form-group" style="flex: 1;">
                    <label class="form-label">Data fine (opzionale)</label>
                    <input type="date" id="tx-end" class="form-input" value="${base.recurrence_end_date || ''}" />
                  </div>
                  <div class="form-group" style="flex: 1; display: flex; align-items: flex-end; padding-bottom: 8px;">
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
                      <input type="checkbox" id="tx-suspended" ${base.is_suspended ? 'checked' : ''} /> Sospendi generazione
                    </label>
                  </div>
                </div>
                <div style="font-size: 11px; color: var(--text-muted);">La data della transazione è la prima scadenza; le successive vengono create una sola volta.</div>
              </div>
            </div>

            <div class="form-group" style="margin-top: 12px;">
              <label class="form-label">Note</label>
              <textarea id="tx-notes" class="form-textarea" rows="2" placeholder="Riferimento fattura, ricevuta...">${escapeHtml(base.notes || '')}</textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close-modal>Annulla</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Salva Modifiche' : 'Salva Transazione'}</button>
          </div>
        </form>
      </div>
    </div>`);

  let type = base.type === 'income' ? 'income' : 'expense';
  const catList = el.querySelector('#tx-cat-list');
  const refreshCategories = () => {
    catList.innerHTML = (type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
  };
  refreshCategories();

  el.querySelectorAll('#tx-type-toggle [data-type]').forEach(btn => btn.addEventListener('click', () => {
    type = btn.dataset.type;
    el.querySelectorAll('#tx-type-toggle [data-type]').forEach(b => {
      const active = b.dataset.type === type;
      b.classList.toggle('active', active);
      b.style.color = active ? (type === 'income' ? 'var(--success)' : 'var(--danger)') : '';
    });
    refreshCategories();
  }));

  const recurCb = el.querySelector('#tx-recurring');
  recurCb.addEventListener('change', () => {
    el.querySelector('#tx-recurring-pane').style.display = recurCb.checked ? 'block' : 'none';
  });

  el.querySelector('#tx-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const description = el.querySelector('#tx-desc').value.trim();
    const amount = parseFloat(el.querySelector('#tx-amount').value);
    if (!description || !Number.isFinite(amount) || amount <= 0) {
      alert('Inserisci una descrizione e un importo maggiore di zero.');
      return;
    }
    const date = el.querySelector('#tx-date').value;
    const isRecurring = recurCb.checked;

    const payload = {
      type,
      description,
      amount,
      category: el.querySelector('#tx-cat').value.trim() || 'Generale',
      date,
      payment_method: el.querySelector('#tx-method').value,
      client_id: el.querySelector('#tx-client').value || null,
      notes: el.querySelector('#tx-notes').value.trim(),
      is_recurring: isRecurring,
      recurrence_frequency: isRecurring ? el.querySelector('#tx-freq').value : null,
      recurrence_start_date: isRecurring ? date : null,
      recurrence_end_date: isRecurring ? (el.querySelector('#tx-end').value || null) : null,
      is_suspended: isRecurring ? el.querySelector('#tx-suspended').checked : false,
    };

    if (isEdit) store.update('finance_transactions', tx.id, payload);
    else store.create('finance_transactions', payload);

    close();
    showToast(isEdit ? 'Transazione aggiornata' : 'Transazione registrata', 'success');
    rerender();
  });
}

function openTradingModal({ item = null, markSold = false, modalHost, rerender }) {
  const isEdit = Boolean(item);
  const base = item || { platform: 'Vinted', purchase_date: localTodayIso(), status: 'in_stock' };
  const startSold = markSold || base.status === 'sold';
  const rate = getDevHourlyRate();

  const { el, close } = mountModal(modalHost, `
    <div class="modal-overlay">
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-label="${isEdit ? 'Modifica articolo' : 'Nuovo articolo'}">
        <div class="modal-header">
          <div class="modal-title">${markSold ? 'Registra Vendita' : isEdit ? 'Modifica Articolo' : 'Nuovo Articolo'}</div>
          <button type="button" class="btn btn-sm btn-secondary" data-close-modal aria-label="Chiudi">✕</button>
        </div>
        <form id="trade-form">
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group" style="flex: 2;">
                <label class="form-label">Oggetto *</label>
                <input type="text" id="tr-title" class="form-input" required value="${escapeHtml(base.title || '')}" placeholder="es. GoPro Hero 9 da riparare" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Piattaforma</label>
                <select id="tr-platform" class="form-select">
                  ${TRADING_PLATFORMS.map(p => `<option value="${p}" ${base.platform === p ? 'selected' : ''}>${p}</option>`).join('')}
                </select>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Prezzo Acquisto (€) *</label>
                <input type="number" id="tr-purchase" class="form-input" step="0.01" min="0" required value="${base.purchase_price ?? ''}" />
              </div>
              <div class="form-group">
                <label class="form-label">Spese Extra / Riparazione (€)</label>
                <input type="number" id="tr-extra" class="form-input" step="0.01" min="0" value="${base.extra_costs ?? 0}" />
              </div>
              <div class="form-group">
                <label class="form-label">Data Acquisto</label>
                <input type="date" id="tr-purchase-date" class="form-input" value="${String(base.purchase_date).slice(0, 10)}" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Prezzo Vendita (€)</label>
                <input type="number" id="tr-sale" class="form-input" step="0.01" min="0" value="${base.sale_price ?? ''}" placeholder="vuoto = non venduto" />
              </div>
              <div class="form-group">
                <label class="form-label">Commissioni piattaforma (€)</label>
                <input type="number" id="tr-fees" class="form-input" step="0.01" min="0" value="${base.platform_fees ?? 0}" />
              </div>
              <div class="form-group">
                <label class="form-label">Data Vendita</label>
                <input type="date" id="tr-sale-date" class="form-input" value="${base.sale_date ? String(base.sale_date).slice(0, 10) : (markSold ? localTodayIso() : '')}" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Stato</label>
                <select id="tr-status" class="form-select">
                  ${Object.entries(TRADING_STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${(markSold ? 'sold' : base.status) === k ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Ore impiegate (opz.)</label>
                <input type="number" id="tr-hours" class="form-input" step="0.25" min="0" value="${base.hours_spent ?? ''}" placeholder="ricerca, foto, spedizione" />
              </div>
            </div>

            <!-- Calcolo automatico Margine Netto & ROI % -->
            <div id="tr-preview" class="trade-preview" aria-live="polite"></div>

            <div class="form-group" style="margin-top: 12px;">
              <label class="form-label">Note</label>
              <textarea id="tr-notes" class="form-textarea" rows="2">${escapeHtml(base.notes || '')}</textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close-modal>Annulla</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Salva Modifiche' : 'Salva Articolo'}</button>
          </div>
        </form>
      </div>
    </div>`);

  const $ = (sel) => el.querySelector(sel);
  const statusSel = $('#tr-status');

  const readValues = () => ({
    purchase_price: $('#tr-purchase').value,
    extra_costs: $('#tr-extra').value,
    platform_fees: $('#tr-fees').value,
    sale_price: $('#tr-sale').value,
  });

  const refreshPreview = () => {
    const v = readValues();
    const m = computeTradingMetrics(v);
    const hours = toNumber($('#tr-hours').value, 0);
    const box = $('#tr-preview');
    if (m.net_profit === null) {
      box.innerHTML = `<div class="trade-preview-row"><span>Costo totale</span><strong class="mono">${formatCurrency(m.total_cost)}</strong></div>
        <div style="font-size: 11px; color: var(--text-muted);">Inserisci il prezzo di vendita per calcolare Margine Netto e ROI %.</div>`;
      return;
    }
    const color = m.net_profit >= 0 ? 'var(--success)' : 'var(--danger)';
    const hourly = hours > 0 ? m.net_profit / hours : null;
    box.innerHTML = `
      <div class="trade-preview-row"><span>Costo totale (acquisto + extra)</span><strong class="mono">${formatCurrency(m.total_cost)}</strong></div>
      <div class="trade-preview-row"><span>Margine Netto</span><strong class="mono" style="color:${color};">${m.net_profit > 0 ? '+' : ''}${formatCurrency(m.net_profit)}</strong></div>
      <div class="trade-preview-row"><span>ROI</span><strong class="mono" style="color:${color};">${m.roi_percent !== null ? `${m.roi_percent}%` : '—'}</strong></div>
      ${hourly !== null ? `<div class="trade-preview-row"><span>Profitto orario reale</span><strong class="mono" style="color:${hourly >= rate ? 'var(--success)' : 'var(--danger)'};">${formatCurrency(hourly)}/h</strong></div>
        <div style="font-size: 11px; color: var(--text-muted);">${hourly >= rate ? 'Sopra' : 'Sotto'} la tua tariffa dev di ${formatCurrency(rate)}/h.</div>` : ''}`;
  };

  ['#tr-purchase', '#tr-extra', '#tr-fees', '#tr-sale', '#tr-hours'].forEach(sel => $(sel).addEventListener('input', () => {
    if (sel === '#tr-sale') {
      if ($('#tr-sale').value !== '' && statusSel.value === 'in_stock') statusSel.value = 'sold';
      if ($('#tr-sale').value !== '' && !$('#tr-sale-date').value) $('#tr-sale-date').value = localTodayIso();
    }
    refreshPreview();
  }));
  refreshPreview();
  if (startSold) setTimeout(() => $('#tr-sale')?.focus(), 30);

  $('#trade-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#tr-title').value.trim();
    const purchase = parseFloat($('#tr-purchase').value);
    if (!title || !Number.isFinite(purchase) || purchase < 0) {
      alert('Inserisci l’oggetto e un prezzo di acquisto valido.');
      return;
    }
    const salePriceRaw = $('#tr-sale').value;
    const payload = {
      title,
      platform: $('#tr-platform').value,
      purchase_date: $('#tr-purchase-date').value || localTodayIso(),
      purchase_price: purchase,
      extra_costs: parseFloat($('#tr-extra').value) || 0,
      platform_fees: parseFloat($('#tr-fees').value) || 0,
      sale_price: salePriceRaw === '' ? null : parseFloat(salePriceRaw),
      sale_date: $('#tr-sale-date').value || null,
      status: statusSel.value,
      hours_spent: $('#tr-hours').value === '' ? null : parseFloat($('#tr-hours').value),
      notes: $('#tr-notes').value.trim(),
    };
    if (payload.status === 'sold' && payload.sale_price === null) {
      alert('Per segnare l’articolo come venduto inserisci il prezzo di vendita.');
      return;
    }

    if (isEdit) store.update('trading_items', item.id, payload);
    else store.create('trading_items', payload);

    close();
    showToast(isEdit ? 'Articolo aggiornato' : 'Articolo aggiunto', 'success');
    rerender();
  });
}
