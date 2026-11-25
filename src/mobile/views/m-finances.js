// src/mobile/views/m-finances.js
// Entrate e uscite sul telefono: numeri del mese, ultimi movimenti (tocca per modificare), compravendita.

import { store } from '../../services/store.js';
import { header, mi, esc, todayIso, relativeDay, eur } from '../ui.js';
import { openTransactionSheet } from '../forms.js';

const state = { filter: 'all', offset: 0 };
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

function monthOf(offset) {
  const [y, m] = todayIso().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
}

export function render(container, ctx) {
  const { month, year } = monthOf(state.offset);
  const s = store.getFinancialSummary(month, year);
  const trading = store.getTradingStats();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const tx = store.getAll('finance_transactions')
    .filter(t => String(t.date || '').startsWith(prefix))
    .filter(t => state.filter === 'all' || t.type === state.filter)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at || '').localeCompare(String(a.created_at || '')));

  container.innerHTML = `
    ${header({ title: 'Entrate e uscite', subtitle: `${MONTHS[month - 1]} ${year}`.replace(/^./, c => c.toUpperCase()), back: true, initial: ctx.initial,
      right: `<button type="button" class="m-icon-btn" id="fin-add" aria-label="Nuovo movimento">${mi('plus', 20)}</button>` })}
    <div class="m-page">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <button type="button" class="m-icon-btn" data-month="-1" aria-label="Mese prima">${mi('back', 20)}</button>
        <div style="font-weight:650;text-transform:capitalize;">${MONTHS[month - 1]} ${year}</div>
        <button type="button" class="m-icon-btn" data-month="1" aria-label="Mese dopo" ${state.offset >= 0 ? 'disabled' : ''}>${mi('chevron', 20)}</button>
      </div>

      <div class="m-hero-grid">
        <div class="m-hero" style="${s.netCashflow < 0 ? 'background:var(--m-dark);border-color:var(--m-dark);' : ''}">
          <div class="m-hero-label">Saldo del mese</div>
          <div class="m-hero-value">${eur(s.netCashflow, { sign: true })}</div>
          <div class="m-hero-foot">${s.recurringPendingExpenses > 0 ? `previsto a fine mese ${eur(s.projectedNetCashflow, { sign: true })}` : `${s.incomeCount + s.expenseCount} movimenti`}</div>
        </div>
        <div class="m-hero m-light">
          <div class="m-hero-label" style="color:var(--m-green-text);">Entrate ${eur(s.totalIncome)}</div>
          <div class="m-hero-label" style="margin-top:8px;color:var(--m-text);">Uscite ${eur(s.totalExpenses)}</div>
          <div class="m-hero-foot" style="color:var(--m-text-sec);margin-top:8px;">${s.byCategory.expense[0] ? `Più spesa: ${esc(s.byCategory.expense[0].category)}` : 'Nessuna spesa'}</div>
        </div>
      </div>

      <div class="m-btn-row">
        <button type="button" class="m-btn" data-new="expense">${mi('wallet', 18)} Spesa</button>
        <button type="button" class="m-btn" data-new="income">${mi('plus', 18)} Entrata</button>
      </div>

      <section class="m-section">
        <div class="m-section-head"><h2>Movimenti</h2></div>
        <div class="m-pills" role="group" aria-label="Filtro">
          ${[['all', 'Tutti'], ['expense', 'Uscite'], ['income', 'Entrate']].map(([k, l]) => `<button type="button" class="m-pill" data-filter="${k}" aria-pressed="${state.filter === k}">${l}</button>`).join('')}
        </div>
        <div class="m-list">
          ${tx.length ? tx.slice(0, 100).map(t => `
            <button type="button" class="m-row" data-tx="${esc(t.id)}">
              <span class="m-icon-badge ${t.type === 'income' ? 'green' : ''}">${mi(t.type === 'income' ? 'plus' : 'wallet', 18)}</span>
              <span class="m-row-main"><span class="m-row-title">${esc(t.description || t.category || 'Movimento')}</span><span class="m-row-sub">${esc(relativeDay(String(t.date).slice(0, 10)))} · ${esc(t.category || 'Generale')}${t.recurrence_frequency && !t.recurrence_parent_id ? ' · ricorrente' : ''}</span></span>
              <span class="m-row-end"><span class="m-amount ${t.type === 'income' ? 'm-in' : 'm-out'}">${t.type === 'income' ? '+' : '−'}${eur(t.amount, { decimals: 2 })}</span></span>
            </button>`).join('') : '<div class="m-empty">Nessun movimento in questo mese.</div>'}
        </div>
      </section>

      <section class="m-section">
        <div class="m-section-head"><h2>Compravendita</h2></div>
        <div class="m-card">
          <div class="m-row2">
            <div><div class="m-small">In magazzino</div><div style="font-weight:700;font-size:18px;">${trading.inStockCount} · ${eur(trading.stockCapital)}</div></div>
            <div><div class="m-small">Utile realizzato</div><div style="font-weight:700;font-size:18px;color:${trading.realizedProfit < 0 ? 'var(--m-red-text)' : 'var(--m-green-text)'};">${eur(trading.realizedProfit, { sign: true })}</div></div>
          </div>
          <p class="m-small" style="margin-top:8px;">${trading.soldCount} venduti · ROI medio ${trading.avgRoiPercent}%. Per gestire gli articoli usa la vista per computer.</p>
        </div>
      </section>
    </div>`;

  const onChange = () => ctx.refresh();
  container.querySelectorAll('[data-month]').forEach(b => b.addEventListener('click', () => { state.offset = Math.min(0, state.offset + Number(b.dataset.month)); ctx.refresh(); }));
  container.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { state.filter = b.dataset.filter; ctx.refresh(); }));
  container.querySelector('#fin-add').addEventListener('click', () => openTransactionSheet(null, { onChange }));
  container.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => openTransactionSheet(null, { onChange, type: b.dataset.new })));
  container.querySelectorAll('[data-tx]').forEach(b => b.addEventListener('click', () => openTransactionSheet(store.getById('finance_transactions', b.dataset.tx), { onChange })));
}
