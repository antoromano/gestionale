// src/modules/import-panel.js
// Pannello "Importa File (CSV / Excel)": drag & drop, auto-detection del template, anteprima,
// Wizard di Mapping Visivo di fallback. Tutto client-side e deterministico (ZERO token IA).

import { store } from '../services/store.js';
import {
  readSpreadsheetFile,
  analyzeRows,
  buildImportPlan,
  buildWizardPlan,
  suggestWizardMapping,
  commitImportPlan,
  describeImportResult,
  estimateDuplicates,
  IMPORT_TEMPLATES,
  WIZARD_FIELDS,
} from '../utils/csv-importer.js';
import { formatCurrency, formatDate, escapeHtml } from '../utils/formatters.js';
import { showToast } from '../utils/toast.js';
import { icon } from '../utils/icons.js';

const FIELD_LABELS = {
  date: 'Data', description: 'Descrizione', income: 'Entrata', expense: 'Uscita', amount: 'Importo', type: 'Tipo',
  category: 'Categoria', payment_method: 'Metodo pagamento',
  title: 'Oggetto', purchase_price: 'Prezzo acquisto', sale_price: 'Prezzo vendita', platform: 'Piattaforma',
  extra_costs: 'Spese extra', platform_fees: 'Commissioni', sale_date: 'Data vendita', purchase_date: 'Data acquisto',
  status: 'Stato', hours_spent: 'Ore', notes: 'Note',
  meal: 'Pasto', calories: 'Calorie', protein: 'Proteine', carbs: 'Carboidrati', fat: 'Grassi', weight: 'Peso', sleep: 'Sonno',
};

const cellToText = (v) => (v === null || v === undefined ? '' : String(v));

function previewRecordsTable(plan) {
  if (!plan.records.length) return '';
  const rows = plan.preview;

  if (plan.target === 'finance_transactions') {
    return `
      <table class="data-table"><thead><tr><th>Data</th><th>Tipo</th><th>Descrizione</th><th>Categoria</th><th style="text-align:right;">Importo</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td class="mono">${formatDate(r.date)}</td>
          <td><span class="badge ${r.type === 'income' ? 'badge-green' : 'badge-red'}">${r.type === 'income' ? 'Entrata' : 'Uscita'}</span></td>
          <td>${escapeHtml(r.description)}</td>
          <td>${escapeHtml(r.category)}</td>
          <td class="mono" style="text-align:right; font-weight:600; color: var(${r.type === 'income' ? '--success' : '--danger'});">${r.type === 'income' ? '+' : '-'}${formatCurrency(r.amount)}</td>
        </tr>`).join('')}</tbody></table>`;
  }
  if (plan.target === 'trading_items') {
    return `
      <table class="data-table"><thead><tr><th>Oggetto</th><th>Piattaforma</th><th style="text-align:right;">Acquisto</th><th style="text-align:right;">Vendita</th><th style="text-align:right;">Netto</th><th style="text-align:right;">ROI</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td>${escapeHtml(r.title)}</td>
          <td>${escapeHtml(r.platform)}</td>
          <td class="mono" style="text-align:right;">${formatCurrency(r.purchase_price)}</td>
          <td class="mono" style="text-align:right;">${r.sale_price != null ? formatCurrency(r.sale_price) : '—'}</td>
          <td class="mono" style="text-align:right;">${r.net_profit != null ? formatCurrency(r.net_profit) : '—'}</td>
          <td class="mono" style="text-align:right;">${r.roi_percent != null ? `${r.roi_percent}%` : '—'}</td>
        </tr>`).join('')}</tbody></table>`;
  }
  return `
    <table class="data-table"><thead><tr><th>Data</th><th style="text-align:right;">kcal</th><th style="text-align:right;">Prot</th><th style="text-align:right;">Carbo</th><th style="text-align:right;">Grassi</th><th style="text-align:right;">Peso</th><th style="text-align:right;">Sonno</th></tr></thead>
    <tbody>${rows.map(r => `
      <tr>
        <td class="mono">${formatDate(r.date)}</td>
        <td class="mono" style="text-align:right;">${r.calories_kcal ?? '—'}</td>
        <td class="mono" style="text-align:right;">${r.protein_g ?? '—'}</td>
        <td class="mono" style="text-align:right;">${r.carbs_g ?? '—'}</td>
        <td class="mono" style="text-align:right;">${r.fat_g ?? '—'}</td>
        <td class="mono" style="text-align:right;">${r.body_weight_kg ?? '—'}</td>
        <td class="mono" style="text-align:right;">${r.sleep_hours ?? '—'}</td>
      </tr>`).join('')}</tbody></table>`;
}

function sourcePreviewTable(table) {
  const rows = table.rows.slice(0, 3);
  return `
    <div class="data-table-wrapper" style="max-height: 210px; overflow: auto;">
      <table class="data-table">
        <thead><tr>${table.headers.map(h => `<th>${escapeHtml(h) || '<span style="opacity:.5;">(vuota)</span>'}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${table.headers.map((_, i) => `<td>${escapeHtml(cellToText(r[i]))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>`;
}

function errorsBlock(plan) {
  if (!plan.errors.length && !plan.warnings.length) return '';
  const shown = plan.errors.slice(0, 8);
  return `
    <details style="margin-top: 10px; font-size: 12px;">
      <summary style="cursor: pointer; color: ${plan.errors.length ? 'var(--danger)' : 'var(--text-muted)'}; font-weight: 600;">
        ${plan.errors.length ? (plan.errors.every(e => !e.row) ? 'Mappatura incompleta' : `${plan.errors.length} righe scartate`) : ''}${plan.errors.length && plan.warnings.length ? ' · ' : ''}${plan.warnings.length ? `${plan.warnings.length} avvisi` : ''}
      </summary>
      <ul style="margin: 6px 0 0 18px; color: var(--text-muted);">
        ${shown.map(e => `<li>${e.row ? `Riga ${e.row}: ` : ''}${escapeHtml(e.message)}</li>`).join('')}
        ${plan.errors.length > shown.length ? `<li>… e altre ${plan.errors.length - shown.length}</li>` : ''}
        ${plan.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
      </ul>
    </details>`;
}

export function mountImportPanel(host, { onImported = null } = {}) {
  if (!host) return;

  let state = { stage: 'idle', file: null, source: null, table: null, detection: null, plan: null, wizard: null, wizardOptions: { destination: 'auto', positiveAs: 'income' }, positiveAs: 'income', lastResult: null };

  function render() {
    if (state.stage === 'idle') host.innerHTML = idleHtml();
    else if (state.stage === 'detected') host.innerHTML = detectedHtml();
    else host.innerHTML = wizardHtml();
    bind();
  }

  function idleHtml() {
    return `
      <div class="card" style="margin-bottom: 14px;">
        <div class="card-header">
          <div class="card-title">${icon('upload', 15)} Importa File (CSV / Excel)</div>
          <span class="badge badge-green">100% locale • zero token IA</span>
        </div>
        ${state.lastResult ? `
          <div style="padding: 10px 12px; background: #ecfdf5; border: 1px solid rgba(5,150,105,0.25); border-radius: var(--radius); margin-bottom: 12px; font-size: 12.5px; color: #047857; font-weight: 600;">
            ✅ ${escapeHtml(state.lastResult)}
          </div>` : ''}
        <label class="dropzone" id="import-dropzone" for="import-file-input" tabindex="0">
          <div style="font-size: 26px; line-height: 1;">${icon('upload', 28)}</div>
          <div style="font-weight: 600; margin-top: 8px;">Trascina qui un file .csv o .xlsx</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">oppure clicca per scegliere dal computer</div>
          <input type="file" id="import-file-input" accept=".csv,.tsv,.txt,.xlsx,.xlsm,text/csv" style="display:none;" />
        </label>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-top: 14px;">
          ${Object.values(IMPORT_TEMPLATES).map(t => `
            <div style="padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: #fafafa;">
              <div style="font-weight: 600; font-size: 12.5px;">${escapeHtml(t.label)}</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                Riconosciuto da: ${Object.entries(t.fields).filter(([k]) => t.required.includes(k) || (t.anyOf || []).includes(k)).slice(0, 4).map(([k]) => FIELD_LABELS[k] || k).join(', ')}
              </div>
              <div style="font-size: 11px; color: var(--text-muted);">→ ${escapeHtml(t.targetLabel)}</div>
            </div>`).join('')}
        </div>
        <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 10px;">
          Se gli header non corrispondono a nessun template si apre il <strong>wizard di mapping</strong> con anteprima delle prime righe.
          Reimportare lo stesso file non crea duplicati.
        </div>
      </div>`;
  }

  function detectedHtml() {
    const { detection, plan, table } = state;
    const dup = estimateDuplicates(plan, store);
    const mappingChips = Object.entries(detection.mapping)
      .map(([field, idx]) => `<span class="badge badge-gray" title="Colonna ${idx + 1}">${escapeHtml(FIELD_LABELS[field] || field)} ← ${escapeHtml(table.headers[idx])}</span>`)
      .join(' ');
    const needsSign = plan.template === 'finance' && 'amount' in detection.mapping && !('type' in detection.mapping);
    const toImport = Math.max(0, plan.records.length - dup);

    return `
      <div class="card" style="margin-bottom: 14px;">
        <div class="card-header">
          <div class="card-title">${icon('check', 15)} Template riconosciuto: ${escapeHtml(detection.label)}</div>
          <span class="badge badge-green">${Object.keys(detection.mapping).length} colonne riconosciute</span>
        </div>
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">
          <strong>${escapeHtml(state.file.name)}</strong> · ${table.rows.length} righe${state.source === 'xlsx' ? ' · Excel' : ''} → scrive in <strong>${escapeHtml(plan.targetLabel)}</strong>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px;">${mappingChips}</div>

        ${needsSign ? `
          <div class="form-row" style="margin-bottom: 10px; align-items: center;">
            <label class="form-label" style="margin: 0;">Gli importi positivi sono</label>
            <select id="import-positive-as" class="form-select" style="max-width: 200px;">
              <option value="income" ${state.positiveAs === 'income' ? 'selected' : ''}>Entrate (i negativi sono uscite)</option>
              <option value="expense" ${state.positiveAs === 'expense' ? 'selected' : ''}>Uscite (es. elenco spese)</option>
            </select>
          </div>` : ''}

        <div style="font-size: 12px; font-weight: 600; margin: 8px 0 4px;">Anteprima record convertiti (${plan.records.length} validi${dup ? `, ${dup} già presenti → ignorati` : ''})</div>
        <div class="data-table-wrapper">${previewRecordsTable(plan) || '<div style="padding: 12px; color: var(--text-muted);">Nessun record valido.</div>'}</div>
        ${errorsBlock(plan)}

        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; flex-wrap: wrap;">
          <button class="btn btn-secondary" id="import-cancel-btn">Annulla</button>
          <button class="btn btn-secondary" id="import-manual-btn">Mappa manualmente</button>
          <button class="btn btn-primary" id="import-confirm-btn" ${toImport === 0 && plan.target !== 'body_daily_logs' ? 'disabled' : ''}>
            Importa ${plan.target === 'body_daily_logs' ? plan.records.length : toImport} record
          </button>
        </div>
      </div>`;
  }

  function wizardHtml() {
    const { table, wizard, plan } = state;
    const opt = (selected) => `
      <option value="">— nessuna —</option>
      ${table.headers.map((h, i) => `<option value="${i}" ${selected === i ? 'selected' : ''}>${i + 1}. ${escapeHtml(h) || '(vuota)'}</option>`).join('')}`;

    const hasPlan = plan && plan.target;
    const dup = hasPlan ? estimateDuplicates(plan, store) : 0;
    const toImport = hasPlan ? Math.max(0, plan.records.length - dup) : 0;

    return `
      <div class="card" style="margin-bottom: 14px;">
        <div class="card-header">
          <div class="card-title">${icon('sliders', 15)} Wizard di mapping colonne</div>
          <span class="badge badge-yellow">Template non riconosciuto</span>
        </div>
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">
          <strong>${escapeHtml(state.file.name)}</strong> · ${table.rows.length} righe. Anteprima delle prime 3 righe:
        </div>
        ${sourcePreviewTable(table)}

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 14px;">
          ${WIZARD_FIELDS.map(f => `
            <div class="form-group" style="margin: 0;">
              <label class="form-label">${escapeHtml(f.label)}</label>
              <select class="form-select wizard-select" data-field="${f.key}">${opt(wizard[f.key])}</select>
            </div>`).join('')}
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-top: 10px;">
          <div class="form-group" style="margin: 0;">
            <label class="form-label">Destinazione</label>
            <select id="wizard-destination" class="form-select">
              <option value="auto" ${state.wizardOptions.destination === 'auto' ? 'selected' : ''}>Automatica (dal campo Tipo)</option>
              <option value="finance" ${state.wizardOptions.destination === 'finance' ? 'selected' : ''}>Finanze (Entrate / Uscite)</option>
              <option value="trading" ${state.wizardOptions.destination === 'trading' ? 'selected' : ''}>Compravendita (Acquisto / Vendita)</option>
            </select>
          </div>
          <div class="form-group" style="margin: 0;">
            <label class="form-label">Importi positivi senza tipo sono</label>
            <select id="wizard-positive-as" class="form-select">
              <option value="income" ${state.wizardOptions.positiveAs === 'income' ? 'selected' : ''}>Entrate (negativi = uscite)</option>
              <option value="expense" ${state.wizardOptions.positiveAs === 'expense' ? 'selected' : ''}>Uscite</option>
            </select>
          </div>
        </div>

        <div style="margin-top: 14px;">
          ${hasPlan && plan.records.length ? `
            <div style="font-size: 12px; font-weight: 600; margin-bottom: 4px;">Anteprima → ${escapeHtml(plan.targetLabel)} (${plan.records.length} validi${dup ? `, ${dup} già presenti` : ''})</div>
            <div class="data-table-wrapper">${previewRecordsTable(plan)}</div>` : ''}
          ${plan ? errorsBlock(plan) : ''}
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; flex-wrap: wrap;">
          <button class="btn btn-secondary" id="import-cancel-btn">Annulla</button>
          <button class="btn btn-primary" id="import-confirm-btn" ${hasPlan && toImport > 0 ? '' : 'disabled'}>Importa ${toImport} record</button>
        </div>
      </div>`;
  }

  function recomputeWizardPlan() {
    state.plan = buildWizardPlan(state.table, state.wizard, state.wizardOptions);
  }

  async function handleFile(file) {
    if (!file) return;
    try {
      const { rows, source } = await readSpreadsheetFile(file);
      if (!rows.length) throw new Error('Il file è vuoto.');
      const { table, detection } = analyzeRows(rows);
      state = { ...state, file, source, table, detection, lastResult: null };
      if (detection.template) {
        state.positiveAs = 'income';
        state.plan = buildImportPlan(table, detection.template, detection.mapping, { positiveAs: state.positiveAs });
        state.stage = 'detected';
      } else {
        state.wizard = suggestWizardMapping(table);
        recomputeWizardPlan();
        state.stage = 'wizard';
      }
      render();
    } catch (err) {
      showToast(err.message || 'Impossibile leggere il file.', 'error', 6000);
    }
  }

  function finishImport() {
    const result = commitImportPlan(state.plan, store);
    const message = describeImportResult(result);
    showToast(message, 'success');
    state = { ...state, stage: 'idle', file: null, table: null, detection: null, plan: null, lastResult: message };
    if (onImported) onImported(result);
    else render();
  }

  function bind() {
    const dropzone = host.querySelector('#import-dropzone');
    const input = host.querySelector('#import-file-input');
    if (dropzone && input) {
      input.addEventListener('change', () => handleFile(input.files[0]));
      ['dragenter', 'dragover'].forEach(evt => dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      }));
      ['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      }));
      dropzone.addEventListener('drop', (e) => handleFile(e.dataTransfer?.files?.[0]));
      dropzone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          input.click();
        }
      });
    }

    host.querySelector('#import-cancel-btn')?.addEventListener('click', () => {
      state = { ...state, stage: 'idle', file: null, table: null, plan: null };
      render();
    });

    host.querySelector('#import-confirm-btn')?.addEventListener('click', finishImport);

    host.querySelector('#import-manual-btn')?.addEventListener('click', () => {
      state.wizard = suggestWizardMapping(state.table);
      recomputeWizardPlan();
      state.stage = 'wizard';
      render();
    });

    host.querySelector('#import-positive-as')?.addEventListener('change', (e) => {
      state.positiveAs = e.target.value;
      state.plan = buildImportPlan(state.table, state.detection.template, state.detection.mapping, { positiveAs: state.positiveAs });
      render();
    });

    host.querySelectorAll('.wizard-select').forEach(sel => {
      sel.addEventListener('change', () => {
        state.wizard = { ...state.wizard, [sel.dataset.field]: sel.value === '' ? null : Number(sel.value) };
        recomputeWizardPlan();
        render();
      });
    });
    host.querySelector('#wizard-destination')?.addEventListener('change', (e) => {
      state.wizardOptions = { ...state.wizardOptions, destination: e.target.value };
      recomputeWizardPlan();
      render();
    });
    host.querySelector('#wizard-positive-as')?.addEventListener('change', (e) => {
      state.wizardOptions = { ...state.wizardOptions, positiveAs: e.target.value };
      recomputeWizardPlan();
      render();
    });
  }

  render();
}
