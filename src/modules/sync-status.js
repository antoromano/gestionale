// src/modules/sync-status.js
// Indicatore sempre visibile dello stato di sincronizzazione: niente più successi o fallimenti nascosti.

import { cloud } from '../services/cloud.js';
import { escapeHtml } from '../utils/formatters.js';

const LABELS = {
  idle: { dot: 'ok', text: 'Sincronizzato' },
  syncing: { dot: 'busy', text: 'Sincronizzo…' },
  offline: { dot: 'warn', text: 'Offline' },
  error: { dot: 'err', text: 'Errore di sincronizzazione' },
  stopped: { dot: 'warn', text: 'Non connesso' },
};

export function mountSyncStatus(host) {
  if (!host || host.querySelector('#sync-chip')) return;
  const wrap = document.createElement('div');
  wrap.className = 'sync-wrap';
  wrap.innerHTML = `
    <button type="button" class="sync-chip" id="sync-chip" aria-haspopup="true" aria-expanded="false">
      <span class="sync-dot" id="sync-dot"></span><span id="sync-text"></span>
    </button>
    <div class="sync-pop" id="sync-pop" hidden></div>`;
  host.prepend(wrap);

  const chip = wrap.querySelector('#sync-chip');
  const pop = wrap.querySelector('#sync-pop');

  const paint = (status = cloud.getStatus()) => {
    const l = LABELS[status.state] || LABELS.stopped;
    wrap.querySelector('#sync-dot').className = `sync-dot ${l.dot}`;
    const extra = status.pending > 0 && status.state !== 'idle' ? ` · ${status.pending} da inviare` : '';
    wrap.querySelector('#sync-text').textContent = l.text + extra;

    const when = status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '—';
    pop.innerHTML = `
      <div class="sync-pop-row"><strong>${l.text}</strong></div>
      <div class="sync-pop-row muted">Ultima sincronizzazione: ${when}</div>
      ${status.pending ? `<div class="sync-pop-row muted">Modifiche in attesa: ${status.pending}</div>` : ''}
      ${status.lastError ? `<div class="sync-pop-error">${escapeHtml(status.lastError)}</div>` : ''}
      <button type="button" class="btn btn-sm btn-secondary" id="sync-retry">Sincronizza ora</button>`;
    pop.querySelector('#sync-retry')?.addEventListener('click', async () => {
      await cloud.retryNow();
    });
  };

  chip.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    chip.setAttribute('aria-expanded', String(!pop.hidden));
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) pop.hidden = true;
  });

  cloud.subscribe(paint);
  paint();
}
