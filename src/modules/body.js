// src/modules/body.js
// Sezione "Body": Matrice Diario Intelligente (Ispirata al Quaderno a Colonne), Biometria, Kcal & Macronutrienti,
// Semaforo Frequenza 2-3 Giorni, Varianti a Parole Complete, Dettagli RPE/Buffer e Integrazione Nativa Second Brain

import { store } from '../services/store.js';
import {
  parseWorkoutNotation,
  calculateColumnRecoveryStatus,
  calculateBodyTrends,
} from '../utils/body-parser.js';
import { analyzeBodyWithSecondBrain, ingestKnowledge } from '../services/brain.js';
import { openAiModal } from './ai-assistant.js';

let activeSubView = 'matrix'; // 'matrix' | 'progressions'
let selectedProgressionColumnId = null;
let selectedProgressionVariant = 'all';
let daysWindowLimit = 14;
let brainInsightReport = null;

const FEELING_META = {
  ottimo: { label: 'Ottimo / Esplosivo', icon: '🔥', badge: 'badge-green' },
  buono: { label: 'Buono', icon: '✅', badge: 'badge-blue' },
  normale: { label: 'Normale', icon: '👍', badge: 'badge-gray' },
  faticoso: { label: 'Faticoso / Pesante', icon: '😓', badge: 'badge-yellow' },
  dolore_fastidio: { label: 'Fastidio / Tensione', icon: '⚠️', badge: 'badge-red' },
};

export function renderBody(container, router) {
  const columns = store.getBodyColumns();
  const dailyLogs = store.getAll('body_daily_logs');
  const workoutEntries = store.getAll('body_workout_entries');

  if (!selectedProgressionColumnId && columns.length > 0) {
    selectedProgressionColumnId = columns[0].id;
  }

  const trends = calculateBodyTrends(dailyLogs, workoutEntries, columns);
  const recoveryByCol = {};
  const recommendedTodayCols = [];

  for (const col of columns) {
    const rec = calculateColumnRecoveryStatus(col.id, workoutEntries, col.target_frequency_days || 3);
    recoveryByCol[col.id] = rec;
    if (rec.isRecommendedToday) {
      recommendedTodayCols.push({ col, rec });
    }
  }

  // Costruisce l'elenco di date da mostrare nella Matrice (ordinate dalla più recente in alto, oppure cronologiche)
  const matrixDates = buildMatrixDateRows(dailyLogs, workoutEntries, daysWindowLimit);

  container.innerHTML = `
    <!-- 1. DASHBOARD BIOMETRICA SINTETICA & CONSIGLI DI OGGI (2-3 GIORNI) -->
    <div class="grid-4" style="margin-bottom: 18px;">
      <!-- Peso Medio 7gg -->
      <div class="card" style="margin-bottom: 0; padding: 16px; border-left: 4px solid #2563eb;">
        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">⚖️ Peso Medio 7gg (Media Mobile)</div>
        <div style="display: flex; align-items: baseline; gap: 8px; margin-top: 4px;">
          <div style="font-size: 24px; font-weight: 800; color: var(--text-main);">
            ${trends.avgWeight7d !== null ? `${trends.avgWeight7d} kg` : '—'}
          </div>
          ${trends.weightDelta7d !== 0 ? `
            <span class="badge ${trends.weightDelta7d > 0 ? 'badge-blue' : 'badge-green'}" style="font-size: 10px;">
              ${trends.weightDelta7d > 0 ? `+${trends.weightDelta7d}` : trends.weightDelta7d} kg vs sett. prec.
            </span>
          ` : ''}
        </div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
          Smussa le oscillazioni idriche giornaliere
        </div>
      </div>

      <!-- Media Sonno -->
      <div class="card" style="margin-bottom: 0; padding: 16px; border-left: 4px solid #7c3aed;">
        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">😴 Media Sonno (7gg)</div>
        <div style="font-size: 24px; font-weight: 800; color: #7c3aed; margin-top: 4px;">
          ${trends.avgSleep7d !== null ? `${trends.avgSleep7d} h` : '—'}
        </div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
          ${trends.avgSleep7d && trends.avgSleep7d >= 7.5 ? 'Recupero neurale ottimale' : 'Target consigliato: 7.5 - 8.0 ore'}
        </div>
      </div>

      <!-- Media Kcal & Macronutrienti -->
      <div class="card" style="margin-bottom: 0; padding: 16px; border-left: 4px solid #16a34a;">
        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">🍽️ Media Kcal & Macro (7gg)</div>
        <div style="font-size: 22px; font-weight: 800; color: #16a34a; margin-top: 4px;">
          ${trends.avgCalories7d !== null ? `${trends.avgCalories7d} kcal` : '—'}
        </div>
        <div style="font-size: 11px; color: var(--text-main); font-weight: 600; margin-top: 3px; display: flex; gap: 6px; flex-wrap: wrap;">
          <span class="badge badge-blue" style="font-size: 10px;">P: ${trends.avgProtein7d ?? '—'}g</span>
          <span class="badge badge-yellow" style="font-size: 10px;">C: ${trends.avgCarbs7d ?? '—'}g</span>
          <span class="badge badge-gray" style="font-size: 10px;">G: ${trends.avgFat7d ?? '—'}g</span>
        </div>
      </div>

      <!-- Esercizi Consigliati Oggi (Finestra 2-3gg) -->
      <div class="card" style="margin-bottom: 0; padding: 16px; border-left: 4px solid #d97706;">
        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">🎯 Consigliati Oggi (Target 2-3gg)</div>
        <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px;">
          ${recommendedTodayCols.length === 0 ? `
            <span style="font-size: 12px; color: var(--success); font-weight: 600;">Tutti i gruppi muscolari sono in recupero attivo!</span>
          ` : recommendedTodayCols.slice(0, 5).map(({ col, rec }) => `
            <button
              type="button"
              class="badge ${rec.badgeClass} quick-train-recommended-btn"
              data-col="${col.id}"
              style="border: none; cursor: pointer; font-size: 10px; padding: 3px 7px;"
              title="${rec.label} — Clicca per registrare sessione oggi"
            >
              ${col.name} (${rec.daysSinceLast !== null ? `${rec.daysSinceLast}gg` : 'Nuovo'})
            </button>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- 2. BARRA COMANDI & SELETTORE VISTA (MATRICE DIARIO vs PROGRESSIONI ESERCIZIO) -->
    <div class="card" style="padding: 14px 18px; margin-bottom: 18px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button
            type="button"
            class="btn ${activeSubView === 'matrix' ? 'btn-primary' : 'btn-secondary'} body-view-switch-btn"
            data-view="matrix"
          >
            📓 Matrice Diario Intelligente
          </button>
          <button
            type="button"
            class="btn ${activeSubView === 'progressions' ? 'btn-primary' : 'btn-secondary'} body-view-switch-btn"
            data-view="progressions"
          >
            📈 Progressioni & Record per Esercizio
          </button>
        </div>

        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button type="button" id="body-log-today-btn" class="btn btn-primary">
            + Registra Oggi (Biometria & Workout)
          </button>
          <button type="button" id="body-brain-analyze-btn" class="btn btn-ai">
            🧠 Analizza Andamento con il Second Brain
          </button>
          <button type="button" id="body-manage-cols-btn" class="btn btn-secondary">
            ⚙️ Colonne & Varianti
          </button>
          ${dailyLogs.length === 0 && workoutEntries.length === 0 ? `
            <button type="button" id="body-seed-demo-btn" class="btn btn-secondary" title="Carica 6 giorni di esempio fedeli al tuo quaderno cartaceo">
              📓 Carica Esempio Diario
            </button>
          ` : ''}
        </div>
      </div>

      ${brainInsightReport ? renderBrainInsightBox(brainInsightReport) : ''}
    </div>

    <!-- 3. CONTENUTO PRINCIPALE: MATRICE DIARIO OPPURE PROGRESSIONI -->
    <div id="body-main-view-container">
      ${activeSubView === 'matrix'
        ? renderMatrixDiaryView(matrixDates, columns, dailyLogs, workoutEntries, recoveryByCol, trends)
        : renderProgressionsView(columns, workoutEntries, trends)}
    </div>

    <!-- Contenitore Modali Body -->
    <div id="body-modal-container"></div>
  `;

  bindBodyEvents(container, router, columns);
}

/**
 * Renderizza il box di analisi generato dal Second Brain
 */
function renderBrainInsightBox(report) {
  return `
    <div style="margin-top: 14px; padding: 14px 16px; background: linear-gradient(135deg, #faf5ff 0%, #eff6ff 100%); border: 1px solid #d8b4fe; border-radius: var(--radius);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <div style="font-weight: 800; font-size: 13px; color: #5b21b6; display: flex; align-items: center; gap: 6px;">
          <span>🧠</span>
          <span>Report Cognitivo Second Brain (Correlazione Sonno • Nutrizione • Progressioni)</span>
        </div>
        <div style="display: flex; gap: 6px;">
          <button type="button" id="save-body-insight-to-brain-btn" class="btn btn-sm btn-primary" style="font-size: 11px; padding: 3px 10px;">
            💾 Salva Report nel Second Brain
          </button>
          <button type="button" id="close-body-insight-btn" class="btn btn-sm btn-secondary" style="padding: 2px 8px;">✕</button>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-main); line-height: 1.55;">
        ${report.insights.map(line => `
          <div style="background: rgba(255,255,255,0.85); padding: 6px 10px; border-radius: 6px; border: 1px solid #e9d5ff;">
            ${line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code style="background:#f1f5f9;padding:1px 5px;border-radius:4px;">$1</code>')}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/**
 * VISTA 1: MATRICE DIARIO INTELLIGENTE (Colonne = Esercizi Base; Righe = Giorni)
 */
function renderMatrixDiaryView(matrixDates, columns, dailyLogs, workoutEntries, recoveryByCol, trends) {
  const logsByDate = new Map(dailyLogs.map(l => [String(l.date).split('T')[0], l]));
  const entriesByDateCol = new Map();
  workoutEntries.forEach(e => {
    const d = String(e.date).split('T')[0];
    entriesByDateCol.set(`${d}::${e.column_id}`, e);
  });

  const movingAvgByDate = new Map(
    (trends.weightMovingAverageSeries || []).map(item => [item.date, item.movingAvg7d])
  );

  return `
    <div class="card" style="padding: 0; overflow: hidden;">
      <div style="padding: 14px 18px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; background: #f8fafc;">
        <div>
          <span style="font-weight: 800; font-size: 14px; color: var(--text-main);">📓 Matrice Diario Quotidiano</span>
          <span style="font-size: 12px; color: var(--text-muted); margin-left: 8px;">
            Clicca su qualsiasi cella per inserire o modificare serie, varianti a parole complete (es. <em>Presa Larga</em>, <em>Singolo Arto</em>) e note RPE.
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <label style="font-size: 12px; color: var(--text-muted);">Giorni mostrati:</label>
          <select id="body-days-window-select" class="form-select" style="width: auto; padding: 4px 10px; font-size: 12px;">
            <option value="7" ${daysWindowLimit === 7 ? 'selected' : ''}>Ultimi 7 giorni</option>
            <option value="14" ${daysWindowLimit === 14 ? 'selected' : ''}>Ultimi 14 giorni</option>
            <option value="30" ${daysWindowLimit === 30 ? 'selected' : ''}>Ultimi 30 giorni</option>
          </select>
        </div>
      </div>

      <div style="overflow-x: auto;">
        <table class="data-table" style="min-width: 1180px; border-collapse: separate; border-spacing: 0;">
          <thead>
            <tr>
              <th style="position: sticky; left: 0; z-index: 10; background: #f1f5f9; min-width: 115px; border-right: 1px solid var(--border);">
                DATA
              </th>
              <th style="background: #f8fafc; min-width: 78px; text-align: center; border-right: 1px solid var(--border);">
                😴 SONNO
              </th>
              <th style="background: #f8fafc; min-width: 155px; border-right: 1px solid var(--border);">
                🍽️ KCAL & MACRO
              </th>
              <th style="background: #f8fafc; min-width: 95px; text-align: center; border-right: 2px solid #cbd5e1;">
                ⚖️ PESO
              </th>
              ${columns.map(col => {
                const rec = recoveryByCol[col.id];
                return `
                  <th style="min-width: 145px; vertical-align: top; border-right: 1px solid var(--border); background: #ffffff;">
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                      <div
                        class="matrix-col-header-link"
                        data-col="${col.id}"
                        style="font-weight: 800; font-size: 12px; color: var(--text-main); cursor: pointer; display: flex; align-items: center; justify-content: space-between;"
                        title="Clicca per aprire lo storico e le progressioni di ${col.name}"
                      >
                        <span>${col.name}</span>
                        <span style="font-size: 10px; color: var(--accent);">📈</span>
                      </div>
                      <div>
                        <span class="badge ${rec.badgeClass}" style="font-size: 10px; font-weight: 700; text-transform: none;">
                          ${rec.shortBadge}
                        </span>
                      </div>
                    </div>
                  </th>
                `;
              }).join('')}
            </tr>
          </thead>
          <tbody>
            ${matrixDates.map(dateStr => {
              const log = logsByDate.get(dateStr);
              const isToday = dateStr === new Date().toISOString().split('T')[0];
              const isRest = Boolean(log?.is_rest_day);
              const movAvg = movingAvgByDate.get(dateStr);

              return `
                <tr style="background: ${isToday ? '#eff6ff' : (isRest ? '#f8fafc' : '#ffffff')};">
                  <!-- Colonna DATA -->
                  <td
                    class="matrix-bio-cell"
                    data-date="${dateStr}"
                    style="position: sticky; left: 0; z-index: 5; background: ${isToday ? '#dbeafe' : '#f8fafc'}; font-weight: 700; font-size: 12px; cursor: pointer; border-right: 1px solid var(--border); white-space: nowrap;"
                    title="Clicca per modificare Biometria, Sonno e Kcal del ${dateStr}"
                  >
                    <div>${formatShortItalianDate(dateStr)}</div>
                    ${isToday ? `<span class="badge badge-blue" style="font-size: 9px;">OGGI</span>` : ''}
                    ${isRest ? `<span class="badge badge-gray" style="font-size: 9px;">Riposo</span>` : ''}
                  </td>

                  <!-- Colonna SONNO -->
                  <td
                    class="matrix-bio-cell"
                    data-date="${dateStr}"
                    style="text-align: center; cursor: pointer; border-right: 1px solid var(--border); font-size: 12px;"
                  >
                    ${log?.sleep_hours ? `
                      <span style="font-weight: 700; color: ${Number(log.sleep_hours) >= 7.5 ? '#166534' : 'var(--text-main)'};">
                        ${log.sleep_hours} h
                      </span>
                    ` : `<span style="color: #cbd5e1;">—</span>`}
                  </td>

                  <!-- Colonna NUTRIZIONE (KCAL & MACRO) -->
                  <td
                    class="matrix-bio-cell"
                    data-date="${dateStr}"
                    style="cursor: pointer; border-right: 1px solid var(--border); font-size: 12px;"
                  >
                    ${log?.calories_kcal || log?.protein_g ? `
                      <div style="font-weight: 700; color: var(--text-main);">${log.calories_kcal ? `${log.calories_kcal} kcal` : ''}</div>
                      ${(log.protein_g || log.carbs_g || log.fat_g) ? `
                        <div style="font-size: 10px; color: var(--text-muted); margin-top: 1px;">
                          P:${log.protein_g || 0}g • C:${log.carbs_g || 0}g • G:${log.fat_g || 0}g
                        </div>
                      ` : ''}
                    ` : `<span style="color: #cbd5e1; font-size: 11px;">+ Kcal/Macro</span>`}
                  </td>

                  <!-- Colonna PESO -->
                  <td
                    class="matrix-bio-cell"
                    data-date="${dateStr}"
                    style="text-align: center; cursor: pointer; border-right: 2px solid #cbd5e1; font-size: 12px;"
                  >
                    ${log?.body_weight_kg ? `
                      <div style="font-weight: 800; color: var(--accent);">${Number(log.body_weight_kg).toFixed(1)} kg</div>
                      ${movAvg ? `<div style="font-size: 9px; color: var(--text-muted);">avg7: ${movAvg}</div>` : ''}
                    ` : `<span style="color: #cbd5e1;">—</span>`}
                  </td>

                  <!-- Celle Esercizi della Matrice -->
                  ${columns.map(col => {
                    const entry = entriesByDateCol.get(`${dateStr}::${col.id}`);
                    return renderMatrixWorkoutCell(dateStr, col, entry);
                  }).join('')}
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Renderizza una singola cella di allenamento nella Matrice
 * Mostra i numeri compatti + i badge con PAROLE COMPLETE per variante e Singolo Arto
 */
function renderMatrixWorkoutCell(dateStr, col, entry) {
  if (!entry || !entry.raw_notation) {
    return `
      <td
        class="matrix-workout-cell"
        data-date="${dateStr}"
        data-col="${col.id}"
        style="cursor: pointer; border-right: 1px solid var(--border); text-align: center; vertical-align: middle; color: #cbd5e1; transition: background 0.12s;"
        title="Clicca per inserire ${col.name} (${dateStr})"
      >
        <span style="font-size: 14px; opacity: 0.45;">+</span>
      </td>
    `;
  }

  const blocks = Array.isArray(entry.parsed_blocks) && entry.parsed_blocks.length > 0
    ? entry.parsed_blocks
    : parseWorkoutNotation(entry.raw_notation, col.category).blocks;

  const feelingMeta = FEELING_META[entry.feeling] || null;

  return `
    <td
      class="matrix-workout-cell"
      data-date="${dateStr}"
      data-col="${col.id}"
      style="cursor: pointer; border-right: 1px solid var(--border); vertical-align: top; padding: 8px 10px; background: #f0fdf4;"
      title="Clicca per modificare o vedere i dettagli completi"
    >
      <div style="display: flex; flex-direction: column; gap: 5px;">
        ${blocks.map(b => {
          if (b.type === 'cardio') {
            return `
              <div style="font-size: 12px; font-weight: 700; color: #0369a1;">
                🏃 ${b.display_label}
              </div>
            `;
          }
          return `
            <div style="line-height: 1.35;">
              <!-- Badge Parole Complete per Variante e Singolo Arto -->
              <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 2px;">
                ${b.variant_name && b.variant_name !== 'Standard' ? `
                  <span class="badge" style="background: #ede9fe; color: #5b21b6; font-size: 9px; padding: 1px 6px;">
                    ${b.variant_name}
                  </span>
                ` : ''}
                ${b.unilateral ? `
                  <span class="badge" style="background: #fef3c7; color: #b45309; font-size: 9px; padding: 1px 6px;">
                    🦿 Singolo Arto
                  </span>
                ` : ''}
              </div>

              <!-- Carico e Serie -->
              <div style="font-size: 12px; font-family: monospace; color: var(--text-main);">
                ${b.load_kg > 0 ? `<strong style="color: #166534; font-size: 13px;">${b.load_kg}kg</strong>` : ''}
                <span>(${(b.sets || []).join(',')})</span>
              </div>
            </div>
          `;
        }).join('<div style="border-top: 1px dashed #bbf7d0; margin: 2px 0;"></div>')}

        <!-- Metadati extra (RPE, Recupero, Note) -->
        ${(entry.rpe || entry.rest_seconds || entry.detailed_notes || entry.feeling === 'dolore_fastidio') ? `
          <div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 2px; font-size: 10px; color: var(--text-muted);">
            ${entry.rpe ? `<span class="badge badge-gray" style="font-size: 9px; padding: 1px 4px;">RPE ${entry.rpe}</span>` : ''}
            ${entry.rest_seconds ? `<span>⏱️${entry.rest_seconds}s</span>` : ''}
            ${feelingMeta && entry.feeling !== 'buono' ? `<span title="${feelingMeta.label}">${feelingMeta.icon}</span>` : ''}
            ${entry.detailed_notes ? `<span title="${entry.detailed_notes}">📝</span>` : ''}
          </div>
        ` : ''}
      </div>
    </td>
  `;
}

/**
 * VISTA 2: PROGRESSIONI & ANALISI STORICA PER ESERCIZIO
 */
function renderProgressionsView(columns, workoutEntries, trends) {
  const activeCol = columns.find(c => c.id === selectedProgressionColumnId) || columns[0];
  if (!activeCol) {
    return `<div class="card">Nessuna colonna esercizio configurata.</div>`;
  }

  const colProg = trends.exerciseProgressions[activeCol.id] || {
    sessions_count: 0,
    max_load_kg: 0,
    max_total_reps: 0,
    max_single_set_reps: 0,
    max_tonnage_kg: 0,
    history: [],
  };

  // Filtra per variante se selezionata
  const filteredHistory = colProg.history.filter(item => {
    if (selectedProgressionVariant === 'all') return true;
    if (selectedProgressionVariant === 'Singolo Arto') {
      return item.blocks.some(b => b.unilateral);
    }
    return item.blocks.some(b => (b.variant_name || 'Standard') === selectedProgressionVariant);
  });

  const allVariantsUsed = Array.from(
    new Set([
      ...(activeCol.available_variants || ['Standard']),
      ...colProg.history.flatMap(h => h.blocks.map(b => b.variant_name || 'Standard')),
    ])
  );

  return `
    <!-- Selettore Esercizio e Filtro Variante -->
    <div class="card" style="margin-bottom: 18px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
          ${columns.map(c => `
            <button
              type="button"
              class="btn btn-sm ${c.id === activeCol.id ? 'btn-primary' : 'btn-secondary'} prog-col-select-btn"
              data-col="${c.id}"
            >
              ${c.name}
            </button>
          `).join('')}
        </div>

        <div style="display: flex; align-items: center; gap: 8px;">
          <label style="font-size: 12px; font-weight: 600;">Filtra Variante:</label>
          <select id="prog-variant-filter" class="form-select" style="width: auto; font-size: 12px; padding: 5px 10px;">
            <option value="all" ${selectedProgressionVariant === 'all' ? 'selected' : ''}>Tutte le varianti</option>
            <option value="Singolo Arto" ${selectedProgressionVariant === 'Singolo Arto' ? 'selected' : ''}>🦿 Solo Singolo Arto</option>
            ${allVariantsUsed.map(v => `
              <option value="${v}" ${selectedProgressionVariant === v ? 'selected' : ''}>${v}</option>
            `).join('')}
          </select>
        </div>
      </div>
    </div>

    <!-- Personal Records dell'Esercizio Selezionato -->
    <div class="grid-4" style="margin-bottom: 18px;">
      <div class="card" style="margin-bottom: 0; padding: 14px;">
        <div style="font-size: 11px; color: var(--text-muted); font-weight: 700;">🏆 MASSIMO SOVRACCARICO</div>
        <div style="font-size: 22px; font-weight: 800; color: #16a34a; margin-top: 4px;">${colProg.max_load_kg} kg</div>
      </div>
      <div class="card" style="margin-bottom: 0; padding: 14px;">
        <div style="font-size: 11px; color: var(--text-muted); font-weight: 700;">🔥 MIGLIOR SERIE SINGOLA</div>
        <div style="font-size: 22px; font-weight: 800; color: var(--accent); margin-top: 4px;">${colProg.max_single_set_reps} rep</div>
      </div>
      <div class="card" style="margin-bottom: 0; padding: 14px;">
        <div style="font-size: 11px; color: var(--text-muted); font-weight: 700;">📊 VOLUME MAX SESSIONE</div>
        <div style="font-size: 22px; font-weight: 800; color: #7c3aed; margin-top: 4px;">${colProg.max_total_reps} rep totali</div>
      </div>
      <div class="card" style="margin-bottom: 0; padding: 14px;">
        <div style="font-size: 11px; color: var(--text-muted); font-weight: 700;">🗓️ SESSIONI REGISTRATE</div>
        <div style="font-size: 22px; font-weight: 800; color: var(--text-main); margin-top: 4px;">${colProg.sessions_count}</div>
      </div>
    </div>

    <!-- Timeline Storica delle Sessioni -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">📈 Evoluzione Storica • ${activeCol.name} (${filteredHistory.length} sessioni)</div>
      </div>

      ${filteredHistory.length === 0 ? `
        <div style="text-align: center; padding: 36px; color: var(--text-muted);">
          Nessuna sessione registrata per <strong>${activeCol.name}</strong> con il filtro selezionato.
        </div>
      ` : `
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${[...filteredHistory].reverse().map(sess => {
            const fMeta = FEELING_META[sess.feeling] || FEELING_META.buono;
            return `
              <div style="padding: 12px 14px; background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                <div>
                  <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span style="font-weight: 800; font-size: 13px; color: var(--text-main);">📅 ${formatShortItalianDate(sess.date)} (${sess.date})</span>
                    ${sess.blocks.map(b => `
                      <span class="badge badge-blue" style="font-size: 11px;">
                        ${b.display_label}
                      </span>
                    `).join('')}
                  </div>
                  ${sess.detailed_notes ? `
                    <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
                      📝 <em>${sess.detailed_notes}</em>
                    </div>
                  ` : ''}
                </div>

                <div style="display: flex; align-items: center; gap: 8px; font-size: 12px;">
                  <span class="badge badge-gray">${sess.total_sets} serie • ${sess.total_reps} rep tot</span>
                  ${sess.rpe ? `<span class="badge badge-yellow">RPE ${sess.rpe}</span>` : ''}
                  ${sess.rest_seconds ? `<span class="badge badge-gray">Recupero ${sess.rest_seconds}s</span>` : ''}
                  <span class="badge ${fMeta.badge}">${fMeta.icon} ${fMeta.label}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

/**
 * MODAL 1: Inserimento / Modifica Cella d'Allenamento nella Matrice (con Varianti a Parole Complete + Singolo Arto + Dettagli RPE/Recupero)
 */
export function openWorkoutCellModal(dateStr, col, existingEntry, parentContainer, router) {
  const modalContainer = parentContainer.querySelector('#body-modal-container') || document.body;
  const variants = Array.isArray(col.available_variants) && col.available_variants.length > 0
    ? col.available_variants
    : ['Standard'];

  // Trova l'ultima sessione eseguita su questa colonna per mostrarla come riferimento
  const allColEntries = store.getAll('body_workout_entries')
    .filter(e => e.column_id === col.id && e.date !== dateStr && e.raw_notation)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const previousSession = allColEntries[0] || null;

  const modalHtml = `
    <div class="modal-overlay" id="body-cell-modal-overlay">
      <div class="modal-dialog">
        <div class="modal-header" style="background: #0f172a; color: #ffffff;">
          <div>
            <div class="modal-title" style="color: #ffffff;">🏋️ ${col.name} — ${formatShortItalianDate(dateStr)}</div>
            <div style="font-size: 11px; color: #94a3b8;">
              ${previousSession ? `Ultima sessione (${previousSession.date}): <strong>${previousSession.raw_notation}</strong>` : 'Prima sessione registrata per questa colonna'}
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-secondary" id="close-cell-modal-btn" style="background: rgba(255,255,255,0.1); color: #fff; border: none;">✕</button>
        </div>

        <form id="body-cell-form">
          <div class="modal-body">
            <!-- Selettore Rapido Variante con Parole Complete + Toggle Singolo Arto -->
            <div style="margin-bottom: 14px;">
              <label class="form-label">1. Scegli Variante a Parole Complete (aggiunge alla notazione):</label>
              <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;">
                ${variants.map(v => `
                  <button
                    type="button"
                    class="btn btn-sm btn-secondary variant-chip-btn"
                    data-variant="${v}"
                    style="font-size: 11px; padding: 4px 10px;"
                  >
                    ${v}
                  </button>
                `).join('')}
              </div>

              <label style="display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: #b45309; background: #fef3c7; padding: 6px 12px; border-radius: var(--radius); cursor: pointer;">
                <input type="checkbox" id="cell-unilateral-toggle" />
                🦿 Modalità Singolo Arto / Monopodalico
              </label>
            </div>

            <!-- Input Notazione Veloce -->
            <div class="form-group">
              <label class="form-label">
                2. Notazione Serie & Carico *
                <span style="font-weight: 400; color: var(--text-muted);">
                  (es. <code>20(10,10,10,10)</code> oppure <code>Presa Larga (15,15)</code> o <code>Singolo Arto 10(12,12,12)</code>)
                </span>
              </label>
              <input
                type="text"
                id="cell-raw-notation"
                class="form-input"
                style="font-size: 15px; font-family: monospace; font-weight: 700;"
                placeholder="${col.category === 'cardio' ? 'es. 1h Basket oppure 30 min Plio Jump' : 'es. 20(10,10,10,10) + Presa Larga (15,15)'}"
                value="${existingEntry?.raw_notation || ''}"
              />
            </div>

            <!-- Anteprima Live del Parser -->
            <div id="cell-live-preview" style="padding: 10px 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: var(--radius); margin-bottom: 16px; font-size: 12px; color: #166534;">
              Digita la notazione per vedere l'interpretazione in tempo reale...
            </div>

            <!-- Dettagli Arricchiti (quelli che non entravano nel quaderno cartaceo) -->
            <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius); padding: 12px;">
              <div style="font-weight: 700; font-size: 12px; color: var(--text-main); margin-bottom: 10px;">
                ✨ Dettagli Tecnici & Sensazioni (Extra Digitali)
              </div>

              <div class="form-row">
                <div class="form-group" style="flex: 1;">
                  <label class="form-label">RPE / Intensità (1-10)</label>
                  <input type="number" id="cell-rpe" class="form-input" step="0.5" min="1" max="10" placeholder="es. 8.5 (Buffer 1-2)" value="${existingEntry?.rpe || ''}" />
                </div>

                <div class="form-group" style="flex: 1;">
                  <label class="form-label">Recupero tra le serie (sec)</label>
                  <input type="number" id="cell-rest" class="form-input" step="15" placeholder="es. 120" value="${existingEntry?.rest_seconds || ''}" />
                </div>

                <div class="form-group" style="flex: 1.2;">
                  <label class="form-label">Sensazione Muscolare</label>
                  <select id="cell-feeling" class="form-select">
                    ${Object.entries(FEELING_META).map(([k, v]) => `
                      <option value="${k}" ${(existingEntry?.feeling || 'buono') === k ? 'selected' : ''}>${v.icon} ${v.label}</option>
                    `).join('')}
                  </select>
                </div>
              </div>

              <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label">Note Tecniche / Controllo / Articolazioni</label>
                <input
                  type="text"
                  id="cell-notes"
                  class="form-input"
                  placeholder="es. Ottima esplosività, fermo 1s in basso, nessun fastidio..."
                  value="${existingEntry?.detailed_notes || ''}"
                />
              </div>
            </div>
          </div>

          <div class="modal-footer" style="justify-content: space-between;">
            <div>
              ${existingEntry ? `
                <button type="button" id="delete-cell-entry-btn" class="btn btn-danger">🗑️ Svuota Cella</button>
              ` : ''}
            </div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="btn btn-secondary" id="cancel-cell-modal-btn">Annulla</button>
              <button type="submit" class="btn btn-primary">✓ Salva nella Matrice & Second Brain</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;

  const div = document.createElement('div');
  div.innerHTML = modalHtml;
  modalContainer.appendChild(div);

  const rawInput = div.querySelector('#cell-raw-notation');
  const previewBox = div.querySelector('#cell-live-preview');
  const uniToggle = div.querySelector('#cell-unilateral-toggle');

  const updatePreview = () => {
    const val = rawInput.value.trim();
    if (!val) {
      previewBox.innerHTML = 'Nessuna serie inserita.';
      return;
    }
    const parsed = parseWorkoutNotation(val, col.category);
    uniToggle.checked = parsed.has_unilateral;
    previewBox.innerHTML = `
      <div><strong>Interpretazione Parser:</strong> ${parsed.summary_label || val}</div>
      <div style="font-size: 11px; margin-top: 3px;">
        Serie totali: <strong>${parsed.total_sets}</strong> •
        Ripetizioni totali: <strong>${parsed.total_reps}</strong> •
        Carico max: <strong>${parsed.max_load_kg} kg</strong>
        ${parsed.tonnage_kg > 0 ? ` • Tonnellaggio: <strong>${parsed.tonnage_kg} kg</strong>` : ''}
        ${parsed.has_unilateral ? ` • <span class="badge badge-yellow" style="font-size:10px;">🦿 Singolo Arto</span>` : ''}
      </div>
    `;
  };

  updatePreview();
  rawInput.addEventListener('input', updatePreview);

  // Click su chip variante -> inserisce la variante a parole complete
  div.querySelectorAll('.variant-chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const vName = btn.getAttribute('data-variant');
      const cur = rawInput.value.trim();
      if (!cur) {
        rawInput.value = vName === 'Standard' ? '(10,10,10)' : `${vName} (10,10,10)`;
      } else if (!cur.toLowerCase().includes(vName.toLowerCase())) {
        rawInput.value = `${cur} + ${vName === 'Standard' ? '(10,10,10)' : `${vName} (10,10,10)`}`;
      }
      rawInput.focus();
      updatePreview();
    });
  });

  // Toggle Singolo Arto
  uniToggle.addEventListener('change', () => {
    const cur = rawInput.value.trim();
    if (uniToggle.checked) {
      if (!/singolo arto|monopodalic|\d+s\(|^s\(/i.test(cur)) {
        rawInput.value = cur ? `Singolo Arto ${cur}` : 'Singolo Arto 10(10,10,10)';
      }
    } else {
      rawInput.value = cur
        .replace(/\bSingolo Arto\s*/gi, '')
        .replace(/(\d+)S\(/gi, '$1(')
        .replace(/^S\(/i, '(')
        .trim();
    }
    updatePreview();
  });

  const closeModal = () => div.remove();
  div.querySelector('#close-cell-modal-btn').addEventListener('click', closeModal);
  div.querySelector('#cancel-cell-modal-btn').addEventListener('click', closeModal);

  div.querySelector('#delete-cell-entry-btn')?.addEventListener('click', () => {
    store.upsertBodyWorkoutEntry({ date: dateStr, column_id: col.id, raw_notation: '' });
    closeModal();
    renderBody(parentContainer, router);
  });

  div.querySelector('#body-cell-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw_notation = rawInput.value.trim();
    const rpe = parseFloat(div.querySelector('#cell-rpe').value) || null;
    const rest_seconds = parseInt(div.querySelector('#cell-rest').value, 10) || null;
    const feeling = div.querySelector('#cell-feeling').value || 'buono';
    const detailed_notes = div.querySelector('#cell-notes').value.trim();

    store.upsertBodyWorkoutEntry({
      date: dateStr,
      column_id: col.id,
      raw_notation,
      rpe,
      rest_seconds,
      feeling,
      detailed_notes,
    });

    closeModal();
    renderBody(parentContainer, router);
  });
}

/**
 * MODAL 2: Registrazione Biometria, Sonno, Kcal & Macronutrienti della Giornata
 */
export function openDailyBioModal(dateStr, parentContainer, router) {
  const modalContainer = parentContainer.querySelector('#body-modal-container') || document.body;
  const existing = store.getAll('body_daily_logs').find(l => l.date === dateStr) || null;

  const modalHtml = `
    <div class="modal-overlay" id="body-bio-modal-overlay">
      <div class="modal-dialog">
        <div class="modal-header" style="background: #1e293b; color: #ffffff;">
          <div>
            <div class="modal-title" style="color: #ffffff;">📊 Biometria, Sonno & Nutrizione — ${formatShortItalianDate(dateStr)}</div>
            <div style="font-size: 11px; color: #94a3b8;">Sincronizzato automaticamente con i Fatti Atomici (Mem0) del Second Brain</div>
          </div>
          <button type="button" class="btn btn-sm btn-secondary" id="close-bio-modal-btn" style="background: rgba(255,255,255,0.1); color: #fff; border: none;">✕</button>
        </div>

        <form id="body-bio-form">
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label class="form-label">Data</label>
                <input type="date" id="bio-date" class="form-input" value="${dateStr}" required />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">⚖️ Peso Corporeo (kg)</label>
                <input type="number" id="bio-weight" class="form-input" step="0.1" placeholder="es. 75.2" value="${existing?.body_weight_kg || ''}" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label">😴 Ore di Sonno (h)</label>
                <input type="number" id="bio-sleep" class="form-input" step="0.25" placeholder="es. 7.5" value="${existing?.sleep_hours || ''}" />
              </div>
            </div>

            <!-- Sezione Kcal e Macronutrienti -->
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: var(--radius); padding: 12px; margin-bottom: 14px;">
              <div style="font-weight: 700; font-size: 12px; color: #166534; margin-bottom: 8px;">
                🍽️ Bilancio Calorico & Macronutrienti Giornalieri
              </div>
              <div class="form-row">
                <div class="form-group" style="flex: 1.2; margin-bottom: 0;">
                  <label class="form-label">Calorie (kcal)</label>
                  <input type="number" id="bio-kcal" class="form-input" step="10" placeholder="es. 2500" value="${existing?.calories_kcal || ''}" />
                </div>
                <div class="form-group" style="flex: 1; margin-bottom: 0;">
                  <label class="form-label">Proteine (g)</label>
                  <input type="number" id="bio-prot" class="form-input" placeholder="es. 165" value="${existing?.protein_g || ''}" />
                </div>
                <div class="form-group" style="flex: 1; margin-bottom: 0;">
                  <label class="form-label">Carboidrati (g)</label>
                  <input type="number" id="bio-carbs" class="form-input" placeholder="es. 285" value="${existing?.carbs_g || ''}" />
                </div>
                <div class="form-group" style="flex: 1; margin-bottom: 0;">
                  <label class="form-label">Grassi (g)</label>
                  <input type="number" id="bio-fat" class="form-input" placeholder="es. 75" value="${existing?.fat_g || ''}" />
                </div>
              </div>
            </div>

            <div class="form-row" style="align-items: center;">
              <div class="form-group" style="flex: 1;">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600; font-size: 13px;">
                  <input type="checkbox" id="bio-rest-day" ${existing?.is_rest_day ? 'checked' : ''} />
                  🛌 Segna come Giorno di Riposo (Rest Day)
                </label>
              </div>
            </div>

            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Note Generali Giornata / Energia</label>
              <input type="text" id="bio-notes" class="form-input" placeholder="es. Ottima energia durante il giorno, idratazione 3L..." value="${existing?.general_notes || ''}" />
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" id="cancel-bio-modal-btn">Annulla</button>
            <button type="submit" class="btn btn-primary">✓ Salva Biometria & Macro</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const div = document.createElement('div');
  div.innerHTML = modalHtml;
  modalContainer.appendChild(div);

  const closeModal = () => div.remove();
  div.querySelector('#close-bio-modal-btn').addEventListener('click', closeModal);
  div.querySelector('#cancel-bio-modal-btn').addEventListener('click', closeModal);

  div.querySelector('#body-bio-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const targetDate = div.querySelector('#bio-date').value;
    store.upsertBodyDailyLog({
      date: targetDate,
      body_weight_kg: parseFloat(div.querySelector('#bio-weight').value) || null,
      sleep_hours: parseFloat(div.querySelector('#bio-sleep').value) || null,
      calories_kcal: parseInt(div.querySelector('#bio-kcal').value, 10) || null,
      protein_g: parseInt(div.querySelector('#bio-prot').value, 10) || null,
      carbs_g: parseInt(div.querySelector('#bio-carbs').value, 10) || null,
      fat_g: parseInt(div.querySelector('#bio-fat').value, 10) || null,
      is_rest_day: div.querySelector('#bio-rest-day').checked,
      general_notes: div.querySelector('#bio-notes').value.trim(),
    });
    closeModal();
    renderBody(parentContainer, router);
  });
}

/**
 * MODAL 3: Gestione Colonne Esercizi & Varianti a Parole Complete
 */
function openManageColumnsModal(parentContainer, router) {
  const modalContainer = parentContainer.querySelector('#body-modal-container') || document.body;
  const columns = store.getBodyColumns();

  const modalHtml = `
    <div class="modal-overlay" id="body-cols-modal-overlay">
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title">⚙️ Gestisci Colonne Esercizi & Varianti</div>
          <button type="button" class="btn btn-sm btn-secondary" id="close-cols-modal-btn">✕</button>
        </div>

        <div class="modal-body">
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
            Aggiungi una nuova colonna alla tua Matrice oppure arricchisci le varianti a parole complete dei tuoi esercizi base.
          </div>

          <form id="add-body-col-form" style="background: #f8fafc; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 16px;">
            <div style="font-weight: 700; font-size: 12px; margin-bottom: 8px;">+ Nuova Colonna Esercizio</div>
            <div class="form-row">
              <div style="flex: 1.5;">
                <input type="text" id="new-col-name" class="form-input" required placeholder="Nome (es. Core / Addome o Military Press)" />
              </div>
              <div style="flex: 1;">
                <select id="new-col-cat" class="form-select">
                  <option value="pull">Tirata (Pull)</option>
                  <option value="push">Spinta (Push)</option>
                  <option value="legs_ant">Gambe Ant.</option>
                  <option value="legs_post">Catena Post.</option>
                  <option value="core">Core</option>
                  <option value="cardio">Cardio & Sport</option>
                </select>
              </div>
              <div>
                <button type="submit" class="btn btn-primary">Aggiungi</button>
              </div>
            </div>
            <div style="margin-top: 8px;">
              <input type="text" id="new-col-variants" class="form-input" placeholder="Varianti separate da virgola (es. Standard, L-Sit, Dragon Flag, Plank)" />
            </div>
          </form>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${columns.map(col => `
              <div style="padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius); display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-weight: 700; font-size: 13px;">${col.name} <span class="badge badge-gray" style="font-size:10px;">ogni ${col.target_frequency_days || 3}gg</span></div>
                  <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                    Varianti: ${(col.available_variants || []).join(', ')}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="done-cols-modal-btn">Chiudi</button>
        </div>
      </div>
    </div>
  `;

  const div = document.createElement('div');
  div.innerHTML = modalHtml;
  modalContainer.appendChild(div);

  const closeModal = () => div.remove();
  div.querySelector('#close-cols-modal-btn').addEventListener('click', closeModal);
  div.querySelector('#done-cols-modal-btn').addEventListener('click', closeModal);

  div.querySelector('#add-body-col-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = div.querySelector('#new-col-name').value.trim();
    const category = div.querySelector('#new-col-cat').value;
    const variantsRaw = div.querySelector('#new-col-variants').value;
    const variants = variantsRaw
      ? variantsRaw.split(',').map(s => s.trim()).filter(Boolean)
      : ['Standard'];

    if (!variants.includes('Standard')) variants.unshift('Standard');

    store.create('body_exercise_columns', {
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      category,
      target_frequency_days: 3,
      available_variants: variants,
      position: columns.length,
      is_active: true,
    });

    closeModal();
    renderBody(parentContainer, router);
  });
}

function bindBodyEvents(container, router, columns) {
  // Switch vista Matrice / Progressioni
  container.querySelectorAll('.body-view-switch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSubView = btn.getAttribute('data-view');
      renderBody(container, router);
    });
  });

  // Finestra giorni nella matrice
  container.querySelector('#body-days-window-select')?.addEventListener('change', (e) => {
    daysWindowLimit = parseInt(e.target.value, 10) || 14;
    renderBody(container, router);
  });

  // Clic su cella Biometria (Data, Sonno, Kcal, Peso)
  container.querySelectorAll('.matrix-bio-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const dateStr = cell.getAttribute('data-date');
      openDailyBioModal(dateStr, container, router);
    });
  });

  // Clic su cella Esercizio nella Matrice
  container.querySelectorAll('.matrix-workout-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const dateStr = cell.getAttribute('data-date');
      const colId = cell.getAttribute('data-col');
      const col = columns.find(c => c.id === colId);
      if (!col) return;
      const existing = store.getAll('body_workout_entries').find(
        e => e.date === dateStr && e.column_id === colId
      );
      openWorkoutCellModal(dateStr, col, existing, container, router);
    });
  });

  // Clic sull'header di una colonna -> apre la vista Progressioni per quell'esercizio
  container.querySelectorAll('.matrix-col-header-link').forEach(el => {
    el.addEventListener('click', () => {
      selectedProgressionColumnId = el.getAttribute('data-col');
      activeSubView = 'progressions';
      renderBody(container, router);
    });
  });

  // Clic su un esercizio consigliato oggi -> apre direttamente la cella di oggi per quell'esercizio
  container.querySelectorAll('.quick-train-recommended-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const colId = btn.getAttribute('data-col');
      const col = columns.find(c => c.id === colId);
      if (!col) return;
      const todayIso = new Date().toISOString().split('T')[0];
      const existing = store.getAll('body_workout_entries').find(
        e => e.date === todayIso && e.column_id === colId
      );
      openWorkoutCellModal(todayIso, col, existing, container, router);
    });
  });

  // Pulsante "+ Registra Oggi"
  container.querySelector('#body-log-today-btn')?.addEventListener('click', () => {
    const todayIso = new Date().toISOString().split('T')[0];
    openDailyBioModal(todayIso, container, router);
  });

  // Pulsante "Analizza Andamento con il Second Brain"
  container.querySelector('#body-brain-analyze-btn')?.addEventListener('click', () => {
    brainInsightReport = analyzeBodyWithSecondBrain();
    renderBody(container, router);
  });

  container.querySelector('#close-body-insight-btn')?.addEventListener('click', () => {
    brainInsightReport = null;
    renderBody(container, router);
  });

  container.querySelector('#save-body-insight-to-brain-btn')?.addEventListener('click', async () => {
    if (!brainInsightReport) return;
    await ingestKnowledge({
      title: `Report Body & Performance (${new Date().toISOString().split('T')[0]})`,
      text: brainInsightReport.summaryText.replace(/\*\*/g, ''),
      domain: 'body',
      sourceType: 'body_log',
      tags: ['body', 'performance', 'biometria'],
    });
    alert('Report biometrico e di progressione salvato nel Second Brain!');
  });

  // Gestisci Colonne
  container.querySelector('#body-manage-cols-btn')?.addEventListener('click', () => {
    openManageColumnsModal(container, router);
  });

  // Carica dati dimostrativi ispirati al quaderno cartaceo
  container.querySelector('#body-seed-demo-btn')?.addEventListener('click', () => {
    seedNotebookSampleData();
    renderBody(container, router);
  });

  // Eventi Vista Progressioni
  container.querySelectorAll('.prog-col-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedProgressionColumnId = btn.getAttribute('data-col');
      selectedProgressionVariant = 'all';
      renderBody(container, router);
    });
  });

  container.querySelector('#prog-variant-filter')?.addEventListener('change', (e) => {
    selectedProgressionVariant = e.target.value;
    renderBody(container, router);
  });
}

function buildMatrixDateRows(dailyLogs, workoutEntries, limitDays = 14) {
  const dateSet = new Set();
  const today = new Date();

  // Aggiunge gli ultimi N giorni fino a oggi
  for (let i = 0; i < limitDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dateSet.add(d.toISOString().split('T')[0]);
  }

  // Aggiunge eventuali date con log o allenamenti registrati
  dailyLogs.forEach(l => {
    if (l.date) dateSet.add(String(l.date).split('T')[0]);
  });
  workoutEntries.forEach(e => {
    if (e.date) dateSet.add(String(e.date).split('T')[0]);
  });

  return Array.from(dateSet).sort((a, b) => b.localeCompare(a)).slice(0, Math.max(limitDays, 14));
}

function formatShortItalianDate(dateIso = '') {
  if (!dateIso) return '';
  const d = new Date(`${dateIso}T12:00:00`);
  if (isNaN(d.getTime())) return dateIso;
  const days = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  const dayName = days[d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dayName} ${dd}/${mm}`;
}

/**
 * Popola 5 giorni di esempio fedeli al quaderno dell'utente (Pull Up, Dips, Push Up, Affondi, Squat/Sissy, Femo, Stacchi, Basket)
 */
function seedNotebookSampleData() {
  const today = new Date();
  const getOffsetDate = (daysAgo) => {
    const d = new Date(today);
    d.setDate(today.getDate() - daysAgo);
    return d.toISOString().split('T')[0];
  };

  const d4 = getOffsetDate(4);
  const d3 = getOffsetDate(3);
  const d2 = getOffsetDate(2);
  const d1 = getOffsetDate(1);
  const d0 = getOffsetDate(0);

  store.upsertBodyDailyLog({ date: d4, sleep_hours: 7.5, body_weight_kg: 75.6, calories_kcal: 2450, protein_g: 165, carbs_g: 280, fat_g: 75 });
  store.upsertBodyWorkoutEntry({ date: d4, column_id: 'col-pull-up', raw_notation: '20(10,10,10,10)', rpe: 8, rest_seconds: 120, feeling: 'buono' });
  store.upsertBodyWorkoutEntry({ date: d4, column_id: 'col-dips', raw_notation: '20(10,10,12,12)', rpe: 8, rest_seconds: 120, feeling: 'ottimo' });
  store.upsertBodyWorkoutEntry({ date: d4, column_id: 'col-affondi', raw_notation: '20(12,12,12,15)', rpe: 7.5, rest_seconds: 90 });

  store.upsertBodyDailyLog({ date: d3, sleep_hours: 7.0, body_weight_kg: 75.4, calories_kcal: 2600, protein_g: 170, carbs_g: 310, fat_g: 72 });
  store.upsertBodyWorkoutEntry({ date: d3, column_id: 'col-push-up', raw_notation: 'Pseudo Planche (10,10,10)', rpe: 8, rest_seconds: 90 });
  store.upsertBodyWorkoutEntry({ date: d3, column_id: 'col-femo', raw_notation: 'Singolo Arto (15,20,20)', rpe: 8 });
  store.upsertBodyWorkoutEntry({ date: d3, column_id: 'col-stacchi', raw_notation: 'Singolo Arto 10(10,10,10)', rpe: 7.5 });
  store.upsertBodyWorkoutEntry({ date: d3, column_id: 'col-cardio-sport', raw_notation: '1.5h Basket', feeling: 'ottimo' });

  store.upsertBodyDailyLog({ date: d2, sleep_hours: 8.0, body_weight_kg: 75.3, calories_kcal: 2400, protein_g: 160, carbs_g: 265, fat_g: 75, is_rest_day: true });

  store.upsertBodyDailyLog({ date: d1, sleep_hours: 7.5, body_weight_kg: 75.2, calories_kcal: 2520, protein_g: 168, carbs_g: 290, fat_g: 74 });
  store.upsertBodyWorkoutEntry({ date: d1, column_id: 'col-pull-up', raw_notation: '20(11,11,11,11) + Presa Larga (15,15)', rpe: 8.5, rest_seconds: 120, feeling: 'ottimo', detailed_notes: 'Progressione +1 rep su tutte le 4 serie con 20kg!' });
  store.upsertBodyWorkoutEntry({ date: d1, column_id: 'col-dips', raw_notation: '20(12,12,12,12)', rpe: 8, rest_seconds: 120, feeling: 'ottimo' });
  store.upsertBodyWorkoutEntry({ date: d1, column_id: 'col-squat-sissy', raw_notation: 'Sissy Squat (10,10,10)', rpe: 8 });

  store.upsertBodyDailyLog({ date: d0, sleep_hours: 7.5, body_weight_kg: 75.1, calories_kcal: 2500, protein_g: 165, carbs_g: 285, fat_g: 75 });
}

