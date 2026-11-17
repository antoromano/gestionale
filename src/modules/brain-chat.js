// src/modules/brain-chat.js
// Scheda "Chiedi" del Second Brain: una conversazione con il proprio archivio.
// Ogni risposta mostra le fonti usate (cliccabili per leggere il testo d'origine) e permette di salvare
// una decisione come regola stabile ("Salva regola in memoria").

import { store } from '../services/store.js';
import { escapeHtml, formatDate } from '../utils/formatters.js';
import { showToast } from '../utils/toast.js';
import { openFormModal } from '../utils/form-modal.js';
import { RAG_DOMAINS, LIVE_SOURCES } from '../services/rag-core.js';
import { askPersonalRag, saveRuleFromChat } from '../services/personal-rag.js';
import { getAssistantProfile } from '../services/assistant-profile.js';
import { getMemoryById } from '../services/brain-docs.js';
import { openAssistantProfileModal } from './brain-profile.js';
import { openDocumentPreview } from './brain-sources.js';

// La conversazione vive finché resta aperta l'app (non viene salvata: sono domande, non dati)
const chat = { messages: [], domain: '', busy: false, draft: '' };

const EXAMPLES = [
  'Cosa posso cucinare stasera in 20 minuti?',
  'Cosa ho in agenda questa settimana?',
  'Che regole mi sono dato sull\'allenamento?',
];

const FACT_CATEGORIES = [
  { value: 'rule', label: 'Regola (vale sempre nelle risposte)' },
  { value: 'preference', label: 'Preferenza (vale sempre nelle risposte)' },
  { value: 'status', label: 'Stato' },
  { value: 'metric', label: 'Numero / misura' },
];

function permissionsLine() {
  const perms = getAssistantProfile().live_data_permissions;
  const on = Object.entries(LIVE_SOURCES).filter(([k]) => perms[k]).map(([, m]) => `${m.icon} ${m.label}`);
  const off = Object.entries(LIVE_SOURCES).filter(([k]) => !perms[k]).map(([, m]) => `${m.icon} ${m.label}`);
  return `
    <span>Dal gestionale posso leggere: <strong>${on.length ? on.map(escapeHtml).join(' · ') : 'niente'}</strong></span>
    ${off.length ? `<span>Non leggo: ${off.map(escapeHtml).join(' · ')}</span>` : ''}`;
}

function renderMessage(m, i) {
  if (m.role === 'user') {
    return `
      <div class="chat-row chat-user">
        <div class="chat-bubble chat-bubble-user">${escapeHtml(m.content)}</div>
        <div class="chat-actions"><button type="button" class="link-btn chat-save-rule" data-i="${i}">+ Salva regola in memoria</button></div>
      </div>`;
  }
  if (m.error) {
    return `
      <div class="chat-row chat-assistant">
        <div class="notice err" style="margin: 0;">Non sono riuscito a rispondere: ${escapeHtml(m.error)}<br><span style="font-size: 12.5px;">La domanda è ancora nella casella: puoi riprovare. Se continua, apri Impostazioni → Verifica IA.</span></div>
      </div>`;
  }
  const sources = m.sources || [];
  return `
    <div class="chat-row chat-assistant">
      <div class="chat-bubble chat-bubble-assistant">${escapeHtml(m.content)}</div>
      <div class="chat-sources">
        <span class="chat-sources-title">Fonti usate:</span>
        ${sources.length === 0
          ? '<span class="muted" style="font-size: 12.5px;">nessuna — questa risposta non viene dal tuo archivio</span>'
          : sources.map((s, k) => `<button type="button" class="chat-source" data-i="${i}" data-k="${k}" title="Clicca per leggere il testo d'origine">${escapeHtml(s.label)}</button>`).join('')}
      </div>
      <div class="chat-actions">
        <button type="button" class="link-btn chat-save-rule" data-i="${i}">+ Salva regola in memoria${m.suggestedRule ? ' (proposta pronta)' : ''}</button>
        <span class="muted" style="font-size: 12px;">ambito: ${escapeHtml(RAG_DOMAINS[m.domain]?.label || m.domain || '—')}</span>
      </div>
    </div>`;
}

export function mountBrainChat(root, router) {
  if (!root) return;
  const rerender = () => mountBrainChat(root, router);
  const docs = store.getAll('brain_documents').length;
  const notes = store.getAll('brain_memories').filter(m => !m.document_id).length;
  const facts = store.getActiveFacts().length;

  root.innerHTML = `
    <div class="card chat-card">
      <div class="chat-head">
        <div style="min-width: 0;">
          <div class="card-title">Chiedi a te stesso</div>
          <div class="muted" style="font-size: 12.5px; margin-top: 2px;">
            Rispondo usando ${docs} ${docs === 1 ? 'fonte' : 'fonti'}, ${notes} ${notes === 1 ? 'nota' : 'note'} e ${facts} ${facts === 1 ? 'fatto' : 'fatti'}. Sotto ogni risposta trovi da dove l'ho presa.
          </div>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button type="button" class="btn btn-sm btn-secondary" id="chat-profile-btn">Istruzioni e privacy</button>
          <button type="button" class="btn btn-sm btn-secondary" id="chat-new-btn" ${chat.messages.length ? '' : 'disabled'}>Nuova conversazione</button>
        </div>
      </div>

      <div class="chat-perms">${permissionsLine()}</div>

      <div class="chat-thread" id="chat-thread" aria-live="polite">
        ${chat.messages.length === 0 ? `
          <div class="chat-empty">
            <div style="font-weight: 600; margin-bottom: 8px;">Prova con una domanda</div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;">
              ${EXAMPLES.map(q => `<button type="button" class="btn btn-sm btn-secondary chat-example">${escapeHtml(q)}</button>`).join('')}
            </div>
            ${docs + notes + facts === 0 ? '<div class="muted" style="margin-top: 12px;">L\'archivio è ancora vuoto: importa qualcosa dalla scheda <strong>Fonti</strong> per avere risposte su di te.</div>' : ''}
          </div>` : chat.messages.map(renderMessage).join('')}
        ${chat.busy ? `
          <div class="chat-row chat-assistant">
            <div class="chat-bubble chat-bubble-assistant" style="min-width: 240px;">
              <div class="muted" style="margin-bottom: 8px;">Cerco nel tuo archivio…</div>
              <div class="skeleton skeleton-line medium"></div>
              <div class="skeleton skeleton-line short" style="margin-bottom: 0;"></div>
            </div>
          </div>` : ''}
      </div>

      <form class="chat-form" id="chat-form">
        <textarea id="chat-input" class="form-textarea" rows="2" maxlength="4000" placeholder="Scrivi una domanda… (Invio per inviare, Maiusc+Invio per andare a capo)" ${chat.busy ? 'disabled' : ''}>${escapeHtml(chat.draft)}</textarea>
        <div class="chat-form-row">
          <label class="muted" style="font-size: 12.5px; display: flex; align-items: center; gap: 6px;">
            Argomento
            <select id="chat-domain" class="form-select" style="width: auto; font-size: 12.5px; padding: 4px 8px;">
              <option value="" ${chat.domain === '' ? 'selected' : ''}>Lo capisco da solo</option>
              ${Object.entries(RAG_DOMAINS).map(([k, m]) => `<option value="${k}" ${chat.domain === k ? 'selected' : ''}>${m.icon} ${escapeHtml(m.label)}</option>`).join('')}
            </select>
          </label>
          <button type="submit" class="btn btn-primary" ${chat.busy ? 'disabled' : ''}>${chat.busy ? 'Sto rispondendo…' : 'Chiedi'}</button>
        </div>
      </form>
    </div>`;

  const thread = root.querySelector('#chat-thread');
  thread.scrollTop = thread.scrollHeight;
  const input = root.querySelector('#chat-input');

  async function send(text) {
    const question = text.trim();
    if (!question || chat.busy) return;
    // la cronologia inviata è quella PRIMA di questa domanda, senza i messaggi di errore
    const history = chat.messages.filter(m => !m.error).map(m => ({ role: m.role, content: m.content }));
    chat.messages.push({ role: 'user', content: question });
    chat.busy = true;
    chat.draft = '';
    rerender();
    try {
      const res = await askPersonalRag({ question, history, domain: chat.domain || null });
      chat.messages.push({ role: 'assistant', content: res.answer, sources: res.sources, domain: res.domain, suggestedRule: res.suggestedRule, provider: res.provider, model: res.model });
    } catch (err) {
      chat.messages.push({ role: 'assistant', content: '', error: err.message || String(err) });
      chat.draft = question; // la domanda torna nella casella: non va riscritta
    } finally {
      chat.busy = false;
      if (document.body.contains(root)) {
        rerender();
        root.querySelector('#chat-input')?.focus();
      }
    }
  }

  root.querySelector('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    send(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send(input.value);
    }
  });
  input.addEventListener('input', () => { chat.draft = input.value; });
  root.querySelector('#chat-domain').addEventListener('change', (e) => { chat.domain = e.target.value; });
  root.querySelectorAll('.chat-example').forEach(b => b.addEventListener('click', () => send(b.textContent)));
  root.querySelector('#chat-profile-btn').addEventListener('click', () => openAssistantProfileModal(rerender));
  root.querySelector('#chat-new-btn').addEventListener('click', () => {
    chat.messages = [];
    chat.draft = '';
    rerender();
  });

  // Fonti: clic per leggere da dove viene la risposta
  root.querySelectorAll('.chat-source').forEach(btn => btn.addEventListener('click', () => {
    const src = chat.messages[Number(btn.dataset.i)]?.sources?.[Number(btn.dataset.k)];
    if (src) openSource(src);
  }));

  // Volano della conoscenza: una decisione presa in chat diventa una regola stabile
  root.querySelectorAll('.chat-save-rule').forEach(btn => btn.addEventListener('click', () => {
    const m = chat.messages[Number(btn.dataset.i)];
    if (!m) return;
    const proposal = m.suggestedRule || { subject: 'Io', fact_key: '', fact_value: m.role === 'user' ? m.content.slice(0, 300) : '', category: 'rule' };
    openFormModal({
      title: 'Salva regola in memoria',
      intro: 'Da ora in poi ne terrò conto in tutte le risposte, senza che tu debba ripeterla. Se esisteva già un valore per la stessa voce, quello vecchio passa nello storico.',
      fields: [
        { id: 'subject', label: 'Di chi o di cosa parla', value: proposal.subject || 'Io', required: true },
        { id: 'fact_key', label: 'Nome breve della regola', value: proposal.fact_key || '', required: true, placeholder: 'es. latticini_a_pranzo, tariffa_oraria', hint: 'Una o due parole: serve a ritrovarla e ad aggiornarla in futuro.' },
        { id: 'fact_value', label: 'Cosa devo ricordare', type: 'textarea', rows: 3, value: proposal.fact_value || '', required: true, placeholder: 'es. Niente latticini a pranzo' },
        { id: 'category', label: 'Tipo', type: 'select', value: FACT_CATEGORIES.some(c => c.value === proposal.category) ? proposal.category : 'rule', options: FACT_CATEGORIES },
      ],
      submitLabel: 'Salva regola',
      onSubmit: (v) => {
        const res = saveRuleFromChat(v);
        showToast(res.action === 'superseded' ? `Regola aggiornata (prima era: ${res.previousFact?.fact_value}).` : res.action === 'unchanged' ? 'Questa regola c\'era già.' : 'Regola salvata: la userò da ora in poi.', 'success', 5000);
        rerender();
      },
    });
  }));
}

/** Mostra il testo d'origine di una fonte citata. */
async function openSource(src) {
  if (src.type === 'chunk' && src.document_id) {
    if (store.getById('brain_documents', src.document_id)) {
      openDocumentPreview(src.document_id, { highlightChunk: src.chunk_index });
      return;
    }
  }
  let title = src.label;
  let text = src.text || '';
  let meta = '';
  if (src.type === 'chunk') {
    try {
      const mem = await getMemoryById(src.memory_id);
      if (mem?.content) text = mem.content;
    } catch {
      /* si mostra il testo arrivato con la risposta */
    }
    meta = src.date ? `Del ${formatDate(src.date)}` : '';
  } else if (src.type === 'fact') {
    const fact = src.fact_id ? store.getById('brain_facts', src.fact_id) : null;
    if (fact) {
      const history = store.getFactHistory(fact.subject, fact.fact_key);
      text = `${fact.subject} — ${fact.fact_key}: ${fact.fact_value}`;
      meta = `Vale dal ${formatDate(fact.valid_from || fact.created_at)}${history.length > 1 ? ` · ${history.length - 1} ${history.length === 2 ? 'valore precedente' : 'valori precedenti'} nello storico (scheda Fatti)` : ''}`;
    }
  } else if (src.type === 'live') {
    title = src.label;
    meta = 'Dati letti dal gestionale nel momento della domanda. Questo è esattamente ciò che è stato inviato all\'IA.';
  }
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title">${escapeHtml(title)}</div>
          <button type="button" class="btn btn-sm btn-secondary" data-so="close" aria-label="Chiudi">✕</button>
        </div>
        <div class="modal-body">
          ${meta ? `<p class="muted" style="margin-bottom: 10px;">${escapeHtml(meta)}</p>` : ''}
          <div style="white-space: pre-wrap; font-size: 13.5px; line-height: 1.6;">${escapeHtml(text || '(testo non disponibile)')}</div>
        </div>
        <div class="modal-footer"><button type="button" class="btn btn-secondary" data-so="close">Chiudi</button></div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelectorAll('[data-so="close"]').forEach(b => b.addEventListener('click', () => wrap.remove()));
}

/** Solo per i test dell'interfaccia: azzera la conversazione. */
export function resetChatForTests() {
  chat.messages = [];
  chat.draft = '';
  chat.busy = false;
  chat.domain = '';
}
