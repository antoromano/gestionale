// src/mobile/views/m-profile.js
// Profilo e impostazioni sul telefono: sincronizzazione, verifica IA, istruzioni dell'assistente,
// passaggio alla vista per computer, uscita.

import { store } from '../../services/store.js';
import { cloud } from '../../services/cloud.js';
import { signOut } from '../../services/auth.js';
import { aiDiagnose } from '../../services/ai-client.js';
import { openAssistantProfileModal } from '../../modules/brain-profile.js';
import { setUiMode, getUiMode } from '../../utils/device.js';
import { showToast } from '../../utils/toast.js';
import { header, mi, esc } from '../ui.js';

const STATE_TEXT = {
  idle: { text: 'Sincronizzato', tone: 'green' },
  syncing: { text: 'Sincronizzazione in corso…', tone: 'amber' },
  offline: { text: 'Senza connessione: invio appena torna la rete', tone: '' },
  error: { text: 'Errore di sincronizzazione', tone: 'red' },
  stopped: { text: 'Cloud non collegato', tone: '' },
};

function syncCard() {
  const s = cloud.getStatus();
  const st = STATE_TEXT[s.state] || STATE_TEXT.stopped;
  const when = s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString('it-IT', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : null;
  return `
    <div class="m-row"><span class="m-dot ${st.tone}" aria-hidden="true"></span>
      <span class="m-row-main"><span class="m-row-title">${esc(st.text)}</span>
      <span class="m-row-sub">${esc([when ? `ultimo invio ${when}` : '', s.pending ? `${s.pending} modifiche in attesa` : '', s.failedRows ? `${s.failedRows} righe rifiutate` : ''].filter(Boolean).join(' · ') || 'Telefono e computer vedono gli stessi dati.')}</span>
      ${s.lastError && s.state === 'error' ? `<span class="m-row-sub m-late">${esc(s.lastError)}</span>` : ''}</span>
      <button type="button" class="m-icon-btn" id="pf-retry" aria-label="Riprova adesso">${mi('refresh', 18)}</button>
    </div>`;
}

export function render(container, ctx) {
  const email = ctx.session?.user?.email || '';
  const settings = store.getSettings();
  container.innerHTML = `
    ${header({ title: 'Profilo', subtitle: email, back: true, profile: false })}
    <div class="m-page">
      <section class="m-section">
        <div class="m-section-head"><h2>Cloud</h2></div>
        <div class="m-list" id="pf-sync">${syncCard()}</div>
      </section>

      <section class="m-section">
        <div class="m-section-head"><h2>Intelligenza artificiale</h2></div>
        <div class="m-list">
          <button type="button" class="m-row" id="pf-diagnose"><span class="m-icon-badge">${mi('ai', 20)}</span><span class="m-row-main"><span class="m-row-title">Verifica IA</span><span class="m-row-sub">Controlla che l'assistente risponda davvero</span></span><span class="m-row-end">${mi('chevron', 18)}</span></button>
          <button type="button" class="m-row" id="pf-profile"><span class="m-icon-badge purple">${mi('shield', 20)}</span><span class="m-row-main"><span class="m-row-title">Istruzioni e privacy</span><span class="m-row-sub">Come rispondere e quali dati può leggere la chat</span></span><span class="m-row-end">${mi('chevron', 18)}</span></button>
        </div>
        <div id="pf-diag-out"></div>
      </section>

      <section class="m-section">
        <div class="m-section-head"><h2>Interfaccia</h2></div>
        <div class="m-list">
          <button type="button" class="m-row" id="pf-desktop"><span class="m-icon-badge dark">${mi('monitor', 20)}</span><span class="m-row-main"><span class="m-row-title">Passa a Vista Desktop</span><span class="m-row-sub">Tutte le funzioni (PDF, importazioni, colonne esercizi), anche dal telefono</span></span><span class="m-row-end">${mi('chevron', 18)}</span></button>
          ${getUiMode() !== 'auto' ? `<button type="button" class="m-row" id="pf-auto"><span class="m-icon-badge">${mi('refresh', 20)}</span><span class="m-row-main"><span class="m-row-title">Scelta automatica</span><span class="m-row-sub">Adesso è forzata la vista per telefono: torna a decidere dalla larghezza dello schermo</span></span></button>` : ''}
        </div>
      </section>

      <section class="m-section">
        <div class="m-section-head"><h2>Account</h2></div>
        <div class="m-list">
          <div class="m-row"><span class="m-icon-badge">${mi('user', 20)}</span><span class="m-row-main"><span class="m-row-title">${esc(settings.owner_name || settings.business_name || 'Utente')}</span><span class="m-row-sub">${esc(email)}</span></span></div>
          <button type="button" class="m-row" id="pf-logout"><span class="m-icon-badge red">${mi('logout', 20)}</span><span class="m-row-main"><span class="m-row-title">Esci</span></span></button>
        </div>
      </section>
    </div>`;

  const unsub = cloud.subscribe(() => {
    const host = container.querySelector('#pf-sync');
    if (host) { host.innerHTML = syncCard(); bindRetry(); }
  });
  const bindRetry = () => container.querySelector('#pf-retry')?.addEventListener('click', async () => {
    try { await cloud.retryNow(); } catch { /* lo stato mostra già l'errore */ }
  });
  bindRetry();

  container.querySelector('#pf-diagnose').addEventListener('click', async (e) => {
    const out = container.querySelector('#pf-diag-out');
    e.currentTarget.disabled = true;
    out.innerHTML = '<p class="m-muted" style="margin-top:8px;">Controllo in corso…</p>';
    try {
      const r = await aiDiagnose();
      if (!r.ok) {
        out.innerHTML = `<div class="m-error" style="margin-top:8px;">L'IA non funziona: ${esc(r.message || 'risposta non valida')}</div>`;
      } else {
        const line = (name, x, role) => x
          ? `<div>${x.ok ? '✅' : '❌'} <strong>${name}</strong> (${role}): ${x.ok ? esc(x.model || x.generateModel || 'ok') : esc(x.message || x.code)}</div>`
          : '';
        const anyOk = [r.openai, r.gemini, r.anthropic].some(x => x?.ok);
        out.innerHTML = `<div class="${anyOk ? 'm-ok' : 'm-error'}" style="margin-top:8px;line-height:1.6;">
          ${line('OpenAI', r.openai, 'principale')}${line('Gemini', r.gemini, 'riserva')}${line('Claude', r.anthropic, 'riserva')}
          <div style="margin-top:4px;">${anyOk ? 'L\'assistente può rispondere.' : 'Nessun fornitore risponde: controlla le chiavi sul server.'}</div></div>`;
      }
    } catch (err) {
      out.innerHTML = `<div class="m-error" style="margin-top:8px;">${esc(err.message)}</div>`;
    } finally {
      e.currentTarget.disabled = false;
    }
  });
  container.querySelector('#pf-profile').addEventListener('click', () => openAssistantProfileModal(() => showToast('Istruzioni salvate.', 'success', 2500)));
  container.querySelector('#pf-desktop').addEventListener('click', () => setUiMode('desktop'));
  container.querySelector('#pf-auto')?.addEventListener('click', () => setUiMode('auto'));
  container.querySelector('#pf-logout').addEventListener('click', async () => {
    if (!confirm('Uscire dall\'account su questo dispositivo?')) return;
    cloud.stop();
    await signOut();
    location.reload();
  });

  return () => unsub();
}
