// src/modules/reports.js
// Report Economico e Finanziario: Valore concordato, Incassi reali, Residuo, Spese e Margine stimato
// Con filtri per periodo/cliente e rigoroso controllo contro il doppio conteggio

import { store } from '../services/store.js';
import { formatCurrency, formatDate } from '../utils/formatters.js';
import { calculateFinancialReport } from '../utils/calculations.js';

let reportClientId = '';
let reportStartDate = '';
let reportEndDate = '';

export function renderReports(container, router) {
  const clients = store.getAll('clients');
  const quotes = store.getAll('quotes');
  const payments = store.getAll('payments');
  const todos = store.getAll('todos');
  const expenses = store.getAll('expenses');

  // Esegue il calcolo finanziario unificato con protezione anti-duplicati
  const report = calculateFinancialReport({
    quotes,
    payments,
    todos,
    expenses,
    filterClientId: reportClientId || null,
    startDate: reportStartDate || null,
    endDate: reportEndDate || null,
  });

  container.innerHTML = `
    <!-- Filtri di Analisi -->
    <div class="card" style="margin-bottom: 24px;">
      <div style="font-weight: 700; font-size: 15px; margin-bottom: 12px;">Filtri Periodo e Cliente</div>
      <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end;">
        <div class="form-group" style="flex: 1; min-width: 180px; margin-bottom: 0;">
          <label class="form-label">Cliente</label>
          <select id="report-client-filter" class="form-select">
            <option value="">Tutti i clienti</option>
            ${clients.map(c => `
              <option value="${c.id}" ${reportClientId === c.id ? 'selected' : ''}>
                ${c.company_name || `${c.first_name} ${c.last_name}`}
              </option>
            `).join('')}
          </select>
        </div>

        <div class="form-group" style="flex: 1; min-width: 160px; margin-bottom: 0;">
          <label class="form-label">Data Inizio</label>
          <input type="date" id="report-start-date" class="form-input" value="${reportStartDate}" />
        </div>

        <div class="form-group" style="flex: 1; min-width: 160px; margin-bottom: 0;">
          <label class="form-label">Data Fine</label>
          <input type="date" id="report-end-date" class="form-input" value="${reportEndDate}" />
        </div>

        <div style="display: flex; gap: 8px;">
          <button id="report-preset-ytd" class="btn btn-sm btn-secondary">Anno in Corso</button>
          <button id="report-reset-filters" class="btn btn-sm btn-secondary">Azzera Filtri</button>
        </div>
      </div>
    </div>

    <!-- Schede KPI Principali -->
    <div class="grid-4" style="margin-bottom: 24px;">
      <!-- Valore Concordato -->
      <div class="card" style="background: #ffffff; border-top: 4px solid var(--accent); margin-bottom: 0;">
        <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px;">
          Valore Concordato
        </div>
        <div style="font-size: 22px; font-weight: 800; color: var(--text-main); margin-top: 6px;">
          ${formatCurrency(report.agreedRevenue)}
        </div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
          Preventivi attivi + to-do autonomi
        </div>
      </div>

      <!-- Incassato Effettivo -->
      <div class="card" style="background: #ffffff; border-top: 4px solid var(--success); margin-bottom: 0;">
        <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px;">
          Incassi Effettivi
        </div>
        <div style="font-size: 22px; font-weight: 800; color: var(--success); margin-top: 6px;">
          ${formatCurrency(report.collectedCash)}
        </div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
          Denaro incassato (al netto di rimborsi)
        </div>
      </div>

      <!-- Residuo da Incassare -->
      <div class="card" style="background: #ffffff; border-top: 4px solid ${report.residualReceivables > 0 ? 'var(--danger)' : 'var(--border)'}; margin-bottom: 0;">
        <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px;">
          Crediti Residui
        </div>
        <div style="font-size: 22px; font-weight: 800; color: ${report.residualReceivables > 0 ? 'var(--danger)' : 'var(--text-main)'}; margin-top: 6px;">
          ${formatCurrency(report.residualReceivables)}
        </div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
          Importi ancora da incassare
        </div>
      </div>

      <!-- Spese Totali -->
      <div class="card" style="background: #ffffff; border-top: 4px solid #ea580c; margin-bottom: 0;">
        <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px;">
          Spese Totali
        </div>
        <div style="font-size: 22px; font-weight: 800; color: #ea580c; margin-top: 6px;">
          ${formatCurrency(report.totalExpenses)}
        </div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
          ${report.expensesCount} spese registrate
        </div>
      </div>
    </div>

    <!-- Analisi dei Margini Operativi -->
    <div class="grid-2">
      <!-- Margine su Cassa Effettiva -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">Margine Reale di Cassa</div>
          <span class="badge ${report.estimatedCashMargin >= 0 ? 'badge-green' : 'badge-red'}">
            ${report.estimatedCashMargin >= 0 ? 'In Utile' : 'Disavanzo'}
          </span>
        </div>
        <div style="font-size: 28px; font-weight: 800; color: ${report.estimatedCashMargin >= 0 ? 'var(--success)' : 'var(--danger)'}; margin-bottom: 8px;">
          ${formatCurrency(report.estimatedCashMargin)}
        </div>
        <div style="font-size: 13px; color: var(--text-muted); line-height: 1.6;">
          Calcolato come: <strong>Incassi Effettivi (${formatCurrency(report.collectedCash)})</strong> meno <strong>Spese Totali (${formatCurrency(report.totalExpenses)})</strong>.
          Rappresenta la liquidità netta generata dalla gestione.
        </div>
      </div>

      <!-- Margine su Valore Concordato -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">Margine Stimato sul Pattuito</div>
          <span class="badge badge-blue">Previsionale</span>
        </div>
        <div style="font-size: 28px; font-weight: 800; color: var(--accent); margin-bottom: 8px;">
          ${formatCurrency(report.estimatedAgreedMargin)}
        </div>
        <div style="font-size: 13px; color: var(--text-muted); line-height: 1.6;">
          Calcolato come: <strong>Valore Concordato (${formatCurrency(report.agreedRevenue)})</strong> meno <strong>Spese Totali (${formatCurrency(report.totalExpenses)})</strong>.
          Rappresenta il margine atteso al saldo completo di tutti i lavori.
        </div>
      </div>
    </div>
  `;

  // Listeners Filtri
  container.querySelector('#report-client-filter')?.addEventListener('change', (e) => {
    reportClientId = e.target.value;
    renderReports(container, router);
  });

  container.querySelector('#report-start-date')?.addEventListener('change', (e) => {
    reportStartDate = e.target.value;
    renderReports(container, router);
  });

  container.querySelector('#report-end-date')?.addEventListener('change', (e) => {
    reportEndDate = e.target.value;
    renderReports(container, router);
  });

  container.querySelector('#report-preset-ytd')?.addEventListener('click', () => {
    const curYear = new Date().getFullYear();
    reportStartDate = `${curYear}-01-01`;
    reportEndDate = `${curYear}-12-31`;
    renderReports(container, router);
  });

  container.querySelector('#report-reset-filters')?.addEventListener('click', () => {
    reportClientId = '';
    reportStartDate = '';
    reportEndDate = '';
    renderReports(container, router);
  });
}
