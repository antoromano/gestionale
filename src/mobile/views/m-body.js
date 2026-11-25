// src/mobile/views/m-body.js
// Corpo sul telefono: niente matrice a 14 colonne. Recupero e sonno in evidenza, griglia 3×2 dei valori di oggi
// (tocca per aggiornare) ed esercizi ordinati per stato di recupero (tocca per registrare la sessione).

import { store } from '../../services/store.js';
import { calculateBodyTrends, calculateColumnRecoveryStatus } from '../../utils/body-parser.js';
import { header, mi, esc, todayIso, relativeDay, num } from '../ui.js';
import { BODY_METRICS, openMetricSheet, openDailyLogSheet, openWorkoutSheet } from '../forms.js';

const STATUS_ORDER = { optimal: 0, overdue: 1, recovery: 2 }; // prima quelli nella finestra ideale
const STATUS_TAG = {
  optimal: { cls: 'green', text: 'Pronto' },
  overdue: { cls: 'red', text: 'Da allenare' },
  recovery: { cls: 'blue', text: 'In recupero' },
};

function bodyInsight(trends, ranked, log) {
  const ready = ranked.filter(x => x.rec.status === 'optimal').map(x => x.col.name);
  const late = ranked.filter(x => x.rec.status === 'overdue' && x.rec.daysSinceLast !== null).map(x => x.col.name);
  const parts = [];
  if (log.sleep_hours && Number(log.sleep_hours) < 6.5) parts.push(`Stanotte ${num(log.sleep_hours)} h di sonno: meglio volume ridotto.`);
  if (ready.length) parts.push(`Nella finestra ideale: ${ready.slice(0, 3).join(', ')}.`);
  else if (late.length) parts.push(`Fermi da troppo: ${late.slice(0, 3).join(', ')}.`);
  if (trends.weightDelta7d !== null && trends.weightDelta7d !== undefined && Math.abs(trends.weightDelta7d) >= 0.3) {
    parts.push(`Peso medio ${trends.weightDelta7d > 0 ? 'in salita' : 'in discesa'} di ${num(Math.abs(trends.weightDelta7d))} kg rispetto alla settimana prima.`);
  }
  return parts.slice(0, 2).join(' ') || 'Registra sonno, peso e allenamenti: qui vedrai cosa è pronto da allenare oggi.';
}

export function render(container, ctx) {
  const today = todayIso();
  const logs = store.getAll('body_daily_logs');
  const entries = store.getAll('body_workout_entries');
  const columns = store.getBodyColumns();
  const log = logs.find(l => l.date === today) || {};
  const trends = calculateBodyTrends(logs, entries, columns);
  const ranked = columns
    .map(col => ({ col, rec: calculateColumnRecoveryStatus(col, entries, today), todayEntry: entries.find(e => e.column_id === col.id && e.date === today && e.raw_notation) }))
    .sort((a, b) => (a.todayEntry ? -1 : 0) - (b.todayEntry ? -1 : 0) || STATUS_ORDER[a.rec.status] - STATUS_ORDER[b.rec.status] || (b.rec.daysSinceLast ?? 99) - (a.rec.daysSinceLast ?? 99));
  const readyCount = ranked.filter(x => x.rec.status !== 'recovery').length;
  const delta = trends.weightDelta7d;

  container.innerHTML = `
    ${header({ title: 'Corpo', subtitle: 'Recupero, biometria e allenamenti', initial: ctx.initial,
      right: `<button type="button" class="m-icon-btn" id="body-log" aria-label="Diario di oggi">${mi('edit', 20)}</button>` })}
    <div class="m-page">
      <div class="m-insight">
        <span class="m-icon-badge" style="background:#fff;">${mi('body', 20)}</span>
        <div><div class="m-insight-label">Recupero</div><p>${esc(bodyInsight(trends, ranked, log))}</p></div>
      </div>

      <div class="m-hero-grid">
        <div class="m-hero" role="group" aria-label="Sonno e recupero">
          <span class="m-hero-label">Sonno medio 7 gg</span>
          <span class="m-hero-value">${trends.avgSleep7d ? `${num(trends.avgSleep7d)} h` : '—'}</span>
          <span class="m-hero-foot">${readyCount}/${columns.length} allenabili oggi</span>
        </div>
        <div class="m-hero m-light" role="group" aria-label="Peso">
          <span class="m-hero-label">Peso medio 7 gg</span>
          <span class="m-hero-value">${trends.avgWeight7d ? `${num(trends.avgWeight7d)} kg` : '—'}</span>
          <span class="m-hero-foot" style="color:${delta > 0 ? 'var(--m-amber-text)' : delta < 0 ? 'var(--m-green-text)' : 'var(--m-text-sec)'};">${delta !== null && delta !== undefined ? `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${num(Math.abs(delta))} kg vs sett. prima` : 'Servono più pesate'}</span>
        </div>
      </div>

      <section class="m-section">
        <div class="m-section-head"><h2>Oggi</h2><span class="m-small">tocca per aggiornare</span></div>
        <div class="m-stat-grid">
          ${Object.entries(BODY_METRICS).map(([key, m]) => {
            const v = log[key];
            const has = v !== null && v !== undefined && v !== '';
            return `<button type="button" class="m-stat" data-metric="${key}" aria-label="${esc(m.label)} di oggi: ${has ? esc(num(v, m.decimals)) : 'non registrato'}">
              <span class="m-stat-label">${esc(m.label)}</span>
              <span class="m-stat-value">${has ? `${esc(num(v, m.decimals))}<small>${esc(m.unit)}</small>` : '<span class="m-stat-empty">+</span>'}</span>
            </button>`;
          }).join('')}
        </div>
        ${log.is_rest_day ? '<div class="m-small">Segnato come giorno di riposo.</div>' : ''}
      </section>

      <section class="m-section">
        <div class="m-section-head"><h2>Allenamento di oggi</h2><span class="m-small">${ranked.filter(x => x.todayEntry).length} registrati</span></div>
        <div class="m-list">
          ${ranked.map(({ col, rec, todayEntry }) => {
            const tag = todayEntry ? { cls: 'green', text: 'Fatto oggi' } : STATUS_TAG[rec.status] || STATUS_TAG.overdue;
            const sub = todayEntry
              ? todayEntry.raw_notation
              : rec.lastTrainedDate ? `Ultima volta: ${relativeDay(rec.lastTrainedDate).toLowerCase()}${rec.daysSinceLast > 1 ? ` (${rec.daysSinceLast} gg fa)` : ''}` : 'Mai registrato';
            return `<button type="button" class="m-row" data-col="${esc(col.id)}">
              <span class="m-icon-badge ${todayEntry ? 'green' : rec.status === 'optimal' ? 'green' : rec.status === 'recovery' ? '' : 'red'}">${mi('flame', 20)}</span>
              <span class="m-row-main"><span class="m-row-title">${esc(col.name)}</span><span class="m-row-sub">${esc(sub)}</span></span>
              <span class="m-row-end"><span class="m-tag ${tag.cls}">${tag.text}</span></span>
            </button>`;
          }).join('')}
        </div>
        <p class="m-small">Colonne, varianti e storico completo restano nella vista per computer.</p>
      </section>
    </div>`;

  const onChange = () => ctx.refresh();
  container.querySelector('#body-log').addEventListener('click', () => openDailyLogSheet({ onChange }));
  container.querySelectorAll('[data-metric]').forEach(b => b.addEventListener('click', () => openMetricSheet(b.dataset.metric, { onChange })));
  container.querySelectorAll('[data-col]').forEach(b => b.addEventListener('click', () => {
    const col = columns.find(c => c.id === b.dataset.col);
    if (col) openWorkoutSheet(col, { onChange });
  }));
}
