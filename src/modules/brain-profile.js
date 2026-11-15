// src/modules/brain-profile.js
// Finestra "Istruzioni e privacy": come deve risponderti l'assistente e quali dati del gestionale può leggere.

import { escapeHtml } from '../utils/formatters.js';
import { RAG_DOMAINS, LIVE_SOURCES } from '../services/rag-core.js';
import { getAssistantProfile, saveAssistantProfile } from '../services/assistant-profile.js';
import { showToast } from '../utils/toast.js';

const LIVE_HINTS = {
  body: 'Calorie, peso, sonno di oggi e allenamenti dell\'ultima settimana.',
  todos_calendar: 'Cose da fare aperte e impegni dei prossimi 14 giorni.',
  clients: 'Nomi dei clienti, canoni, preventivi e note sui clienti.',
  finances: 'Entrate, uscite e compravendita. Sono dati sensibili: accendilo solo se vuoi risposte sui tuoi soldi.',
};

export function openAssistantProfileModal(onSaved = null) {
  const profile = getAssistantProfile();
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-dialog modal-lg">
        <div class="modal-header">
          <div class="modal-title">Istruzioni e privacy dell'assistente</div>
          <button type="button" class="btn btn-sm btn-secondary" data-ap="close" aria-label="Chiudi">✕</button>
        </div>
        <form>
          <div class="modal-body">
            <h4 class="section-h" style="margin-top: 0;">1. Come vuoi le risposte (vale sempre)</h4>
            <textarea id="ap-global" class="form-textarea" rows="4" placeholder="Es. Sono Antonio, sviluppatore freelance. Risposte dirette, senza introduzioni, con numeri concreti.">${escapeHtml(profile.global_instructions)}</textarea>
            <div class="muted" style="font-size: 12px; margin-top: 4px;">Scrivi chi sei e che tono vuoi. Lo puoi cambiare quando vuoi: vale dalla domanda successiva.</div>

            <h4 class="section-h">2. Regole per argomento</h4>
            <div class="muted" style="font-size: 12px; margin-bottom: 8px;">Si attivano da sole quando la domanda riguarda quell'argomento.</div>
            ${Object.entries(RAG_DOMAINS).map(([key, meta]) => `
              <div class="form-group">
                <label class="form-label" for="ap-rule-${key}">${meta.icon} ${escapeHtml(meta.label)}</label>
                <textarea id="ap-rule-${key}" class="form-textarea" rows="2">${escapeHtml(profile.domain_rules[key] || '')}</textarea>
              </div>`).join('')}

            <h4 class="section-h">3. Quali dati del gestionale posso leggere</h4>
            <div class="muted" style="font-size: 12px; margin-bottom: 8px;">I dati accesi vengono inviati all'IA (OpenAI) insieme alla domanda, solo quando chiedi qualcosa. Quelli spenti non escono mai.</div>
            ${Object.entries(LIVE_SOURCES).map(([key, meta]) => `
              <label style="display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 8px; cursor: pointer;">
                <input type="checkbox" id="ap-live-${key}" ${profile.live_data_permissions[key] ? 'checked' : ''} style="width: 17px; height: 17px; margin-top: 2px;" />
                <span>
                  <span style="font-weight: 600;">${meta.icon} ${escapeHtml(meta.label)}</span>
                  <span class="muted" style="display: block; font-size: 12px;">${escapeHtml(LIVE_HINTS[key])}</span>
                </span>
              </label>`).join('')}
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-ap="close">Annulla</button>
            <button type="submit" class="btn btn-primary">Salva</button>
          </div>
        </form>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const close = () => wrap.remove();
  wrap.querySelectorAll('[data-ap="close"]').forEach(b => b.addEventListener('click', close));
  wrap.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveAssistantProfile({
      global_instructions: wrap.querySelector('#ap-global').value,
      domain_rules: Object.fromEntries(Object.keys(RAG_DOMAINS).map(k => [k, wrap.querySelector(`#ap-rule-${k}`).value.trim()])),
      live_data_permissions: Object.fromEntries(Object.keys(LIVE_SOURCES).map(k => [k, wrap.querySelector(`#ap-live-${k}`).checked])),
    });
    close();
    showToast('Istruzioni salvate. Valgono dalla prossima domanda.', 'success');
    onSaved?.();
  });
}
