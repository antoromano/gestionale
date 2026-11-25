// src/mobile/views/m-add.js
// Pulsante "+": crea qualcosa al volo, oppure scrivi in libertà e lo smista l'IA (o lo metti in coda).

import { store } from '../../services/store.js';
import { header, mi, esc } from '../ui.js';
import { showToast } from '../../utils/toast.js';
import {
  openTodoSheet, openTransactionSheet, openDailyLogSheet, openNoteSheet, openAppointmentSheet, runAiCapture,
} from '../forms.js';

let draft = '';

const ACTIONS = [
  { id: 'todo', label: 'Nuovo to-do', sub: 'Una cosa da fare, con scadenza e priorità', icon: 'tasks', tone: '' },
  { id: 'money', label: 'Nuova spesa o entrata', sub: 'Un movimento di soldi', icon: 'wallet', tone: 'green' },
  { id: 'body', label: 'Corpo di oggi', sub: 'Peso, sonno, calorie e macro', icon: 'body', tone: 'red' },
  { id: 'workout', label: 'Registra un allenamento', sub: 'Serie e ripetizioni di un esercizio', icon: 'flame', tone: 'amber' },
  { id: 'note', label: 'Nuova nota nel Second Brain', sub: 'Qualcosa da ricordare', icon: 'note', tone: 'purple' },
  { id: 'event', label: 'Nuovo evento in agenda', sub: 'Appuntamento, chiamata, scadenza', icon: 'calendar', tone: '' },
];

export function render(container, ctx) {
  const queued = store.getQueuedNotes().length;
  container.innerHTML = `
    ${header({ title: 'Aggiungi', subtitle: 'Cosa vuoi registrare?', back: true, initial: ctx.initial })}
    <div class="m-page">
      <div class="m-list">
        ${ACTIONS.map(a => `
          <button type="button" class="m-row" data-action="${a.id}">
            <span class="m-icon-badge ${a.tone}">${mi(a.icon, 20)}</span>
            <span class="m-row-main"><span class="m-row-title" style="display:block;">${esc(a.label)}</span><span class="m-row-sub" style="display:block;">${esc(a.sub)}</span></span>
            <span class="m-row-end">${mi('chevron', 18)}</span>
          </button>`).join('')}
      </div>

      <section class="m-card" aria-labelledby="qc-title">
        <div class="m-insight-label" id="qc-title">Cattura rapida</div>
        <p class="m-small" style="margin-bottom:10px;">Scrivi come parli: «ho speso 45 € di benzina e domani devo richiamare Marco». L'IA salva tutto al posto giusto; per 5 secondi puoi annullare.</p>
        <textarea id="qc-text" class="m-textarea" rows="3" placeholder="Cosa hai in mente?">${esc(draft)}</textarea>
        <div class="m-btn-row" style="margin-top:10px;">
          <button type="button" class="m-btn" id="qc-queue">${mi('inbox', 18)} Metti in coda</button>
          <button type="button" class="m-btn m-btn-primary" id="qc-send">${mi('ai', 18)} Elabora con IA</button>
        </div>
        ${queued ? `<button type="button" class="m-link" data-m-nav="ai" data-m-params='{"tab":"coach"}' style="padding-left:0;margin-top:6px;">${queued} ${queued === 1 ? 'nota in coda' : 'note in coda'}: elaborale ›</button>` : ''}
      </section>
    </div>`;

  const done = () => ctx.refresh();
  container.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.action;
    if (a === 'todo') openTodoSheet(null, { onChange: done });
    if (a === 'money') openTransactionSheet(null, { onChange: done });
    if (a === 'body') openDailyLogSheet({ onChange: done });
    if (a === 'workout') ctx.go('body');
    if (a === 'note') openNoteSheet({ onChange: done });
    if (a === 'event') openAppointmentSheet(null, { onChange: done });
  }));

  const text = container.querySelector('#qc-text');
  text.addEventListener('input', () => { draft = text.value; });
  container.querySelector('#qc-queue').addEventListener('click', () => {
    const v = text.value.trim();
    if (!v) { text.focus(); return; }
    store.addQueuedNote(v, 'web');
    draft = '';
    showToast('Messa in coda: la elaboro quando vuoi, insieme alle altre.', 'success', 3000);
    ctx.refresh();
  });
  container.querySelector('#qc-send').addEventListener('click', async (e) => {
    const v = text.value.trim();
    if (!v) { text.focus(); return; }
    const btn = e.currentTarget;
    btn.disabled = true;
    const ok = await runAiCapture(v, { onChange: () => {} });
    btn.disabled = false;
    if (ok) {
      draft = '';
      text.value = '';
    } // se l'IA non risponde il testo resta nella casella
  });
}
