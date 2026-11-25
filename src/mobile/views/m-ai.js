// src/mobile/views/m-ai.js
// Scheda AI del telefono, tre parti:
//   Briefing — il riepilogo della giornata, calcolato dai tuoi dati (nessuna chiamata all'IA)
//   Chat     — "Chiedi a te stesso": risposte dal tuo archivio, con le fonti
//   Coach    — Avvocato del Diavolo, coda appunti, foto di uno scontrino, dettatura, assistente completo

import { store } from '../../services/store.js';
import { askPersonalRag, saveRuleFromChat } from '../../services/personal-rag.js';
import { getAssistantProfile } from '../../services/assistant-profile.js';
import { processAiPrompt, processNoteQueueBatch, applyAiResultToStore, undoAiResult } from '../../services/ai.js';
import { getMemoryById } from '../../services/brain-docs.js';
import { LIVE_SOURCES } from '../../services/rag-core.js';
import { openAssistantProfileModal } from '../../modules/brain-profile.js';
import { openAiModal } from '../../modules/ai-assistant.js';
import { showToast, showToastWithAction } from '../../utils/toast.js';
import { header, mi, esc, todayIso, dayOf, timeOf, greeting, longDate, relativeDay, eur, num, openSheet, formSheet, textSheet } from '../ui.js';
import { todayTodos, trainingStatus, upcomingAppointments } from './m-home.js';
import { describeApplied, runAiCapture } from '../forms.js';

const chat = { messages: [], busy: false, draft: '' };
let activeTab = 'briefing';

// ---------------------------------------------------------------------------
// Briefing
// ---------------------------------------------------------------------------

function briefingRows(today = todayIso()) {
  const log = store.getAll('body_daily_logs').find(l => l.date === today) || {};
  const sleep = Number(log.sleep_hours) || null;
  const ready = trainingStatus(today).filter(x => x.rec.status === 'optimal').map(x => x.col.name);
  const { open } = todayTodos(today);
  const overdue = open.filter(t => dayOf(t.due_date) < today).length;
  const appts = store.getAll('appointments').filter(a => a.start_time && dayOf(a.start_time) === today)
    .sort((a, b) => String(timeOf(a.start_time)).localeCompare(String(timeOf(b.start_time))));
  const [y, m] = today.split('-').map(Number);
  const fin = store.getFinancialSummary(m, y);
  const queued = store.getQueuedNotes().length;
  const next = upcomingAppointments(1, today)[0];

  return [
    { icon: '😴', label: 'Sonno', value: sleep ? `${num(sleep)} h` : 'non registrato', dot: sleep === null ? '' : sleep >= 7 ? 'green' : sleep >= 6 ? 'amber' : 'red' },
    { icon: '💪', label: 'Pronti da allenare', value: ready.length ? ready.slice(0, 3).join(', ') : 'nessuno nella finestra ideale', dot: ready.length ? 'green' : 'amber' },
    { icon: '✅', label: 'To-do di oggi', value: open.length ? `${open.length}${overdue ? ` (${overdue} scaduti)` : ''}` : 'nessuno', dot: overdue ? 'red' : open.length ? 'amber' : 'green' },
    { icon: '📅', label: 'Impegni di oggi', value: appts.length ? `${appts.length} · primo alle ${timeOf(appts[0].start_time)}` : (next ? `nessuno · prossimo ${relativeDay(dayOf(next.start_time)).toLowerCase()} alle ${timeOf(next.start_time)}` : 'nessuno'), dot: appts.length ? 'blue' : '' },
    { icon: '💶', label: 'Saldo del mese', value: eur(fin.netCashflow, { sign: true }), dot: fin.netCashflow < 0 ? 'red' : 'green' },
    { icon: '📝', label: 'Appunti in coda', value: queued ? `${queued} da elaborare` : 'nessuno', dot: queued ? 'amber' : '' },
  ];
}

function renderBriefing() {
  const today = todayIso();
  return `
    <div class="m-dark-card">
      <h3>${esc(greeting())}</h3>
      <p>${esc(longDate(today).replace(/^./, c => c.toUpperCase()))} · ecco la tua giornata</p>
    </div>
    <div class="m-list">
      ${briefingRows(today).map(r => `
        <div class="m-row">
          <span style="font-size:20px;width:28px;text-align:center;" aria-hidden="true">${r.icon}</span>
          <span class="m-row-main"><span class="m-row-title">${esc(r.label)}</span><span class="m-row-sub">${esc(r.value)}</span></span>
          <span class="m-dot ${r.dot}" aria-hidden="true"></span>
        </div>`).join('')}
    </div>
    <p class="m-small">Il riepilogo è calcolato dai tuoi dati sul telefono: non usa l'IA e non costa nulla.</p>
    <button type="button" class="m-btn m-btn-dark m-btn-block" id="brief-ask">${mi('ai', 18)} Chiedi all'IA un piano per oggi</button>`;
}

// ---------------------------------------------------------------------------
// Chat "Chiedi a te stesso"
// ---------------------------------------------------------------------------

function renderChat() {
  const perms = getAssistantProfile().live_data_permissions;
  const on = Object.entries(LIVE_SOURCES).filter(([k]) => perms[k]).map(([, m]) => m.label);
  return `
    <div class="m-card" style="padding:10px 14px;">
      <div class="m-small">Rispondo con il tuo archivio${on.length ? ` e con: ${esc(on.join(', ').toLowerCase())}` : ''}. Entrate e uscite ${perms.finances ? '<strong>sono incluse</strong>' : 'restano escluse'}.</div>
      <button type="button" class="m-link" id="chat-privacy" style="padding-left:0;">Istruzioni e privacy ›</button>
    </div>
    <div class="m-chat" id="chat-thread" aria-live="polite">
      ${chat.messages.length === 0 ? `
        <div class="m-empty">
          <div style="font-weight:600;margin-bottom:8px;color:var(--m-text);">Chiedi a te stesso</div>
          ${['Cosa posso cucinare stasera in 20 minuti?', 'Cosa ho in agenda questa settimana?', 'Che regole mi sono dato sull\'allenamento?']
            .map(q => `<button type="button" class="m-pill" data-example style="margin:4px;">${esc(q)}</button>`).join('')}
        </div>` : chat.messages.map((m, i) => renderBubble(m, i)).join('')}
      ${chat.busy ? '<div class="m-bubble-row assistant"><div class="m-bubble assistant pending">Cerco nel tuo archivio…</div></div>' : ''}
    </div>
    <div class="m-chat-input">
      <textarea id="chat-input" class="m-textarea" rows="1" maxlength="4000" placeholder="Scrivi una domanda…" aria-label="Domanda" ${chat.busy ? 'disabled' : ''}>${esc(chat.draft)}</textarea>
      <button type="button" class="m-send" id="chat-send" aria-label="Invia" ${chat.busy ? 'disabled' : ''}>${mi('send', 20)}</button>
    </div>
    ${chat.messages.length ? '<button type="button" class="m-link" id="chat-new" style="align-self:center;">Nuova conversazione</button>' : ''}`;
}

function renderBubble(m, i) {
  if (m.role === 'user') {
    return `<div class="m-bubble-row user"><div class="m-bubble user">${esc(m.content)}</div>
      <button type="button" class="m-link" data-rule="${i}" style="padding:2px 0;font-size:12.5px;">+ Salva regola</button></div>`;
  }
  if (m.error) {
    return `<div class="m-bubble-row assistant"><div class="m-error" style="margin:0;max-width:88%;">Non sono riuscito a rispondere: ${esc(m.error)}</div></div>`;
  }
  const sources = m.sources || [];
  return `<div class="m-bubble-row assistant">
    <div class="m-bubble assistant">${esc(m.content)}</div>
    <div class="m-sources">${sources.length
      ? sources.map((s, k) => `<button type="button" class="m-source" data-src="${i}:${k}">${esc(s.label)}</button>`).join('')
      : '<span class="m-small">Nessuna fonte: risposta non presa dal tuo archivio.</span>'}</div>
    <button type="button" class="m-link" data-rule="${i}" style="padding:2px 0;font-size:12.5px;">+ Salva regola${m.suggestedRule ? ' (proposta pronta)' : ''}</button>
  </div>`;
}

async function openSource(src) {
  if (src.type === 'chunk') {
    let text = src.text || '';
    try {
      const mem = src.memory_id ? await getMemoryById(src.memory_id) : null;
      if (mem?.content) text = mem.content;
    } catch { /* si mostra il testo arrivato con la risposta */ }
    textSheet(src.label, text, src.date ? `Del ${String(src.date).slice(0, 10)}` : '');
    return;
  }
  if (src.type === 'fact') {
    const f = src.fact_id ? store.getById('brain_facts', src.fact_id) : null;
    const history = f ? store.getFactHistory(f.subject, f.fact_key) : [];
    textSheet(src.label, f ? `${f.subject} — ${f.fact_key}: ${f.fact_value}` : src.text,
      f ? `Vale dal ${String(f.valid_from || f.created_at).slice(0, 10)}${history.length > 1 ? ` · ${history.length - 1} valori precedenti nello storico` : ''}` : '');
    return;
  }
  textSheet(src.label, src.text, 'Dati letti dal gestionale al momento della domanda: è esattamente ciò che è stato inviato all\'IA.');
}

function openRuleSheet(m, rerender) {
  const p = m.suggestedRule || { subject: 'Io', fact_key: '', fact_value: m.role === 'user' ? m.content.slice(0, 300) : '', category: 'rule' };
  formSheet({
    title: 'Salva regola in memoria',
    intro: 'Ne terrò conto in tutte le risposte future. Se esisteva già un valore per la stessa voce, quello vecchio va nello storico.',
    fields: [
      { id: 'subject', label: 'Di chi o di cosa parla', value: p.subject || 'Io', required: true },
      { id: 'fact_key', label: 'Nome breve', value: p.fact_key || '', required: true, placeholder: 'es. latticini_a_pranzo' },
      { id: 'fact_value', label: 'Cosa devo ricordare', type: 'textarea', rows: 3, value: p.fact_value || '', required: true },
      { id: 'category', label: 'Tipo', type: 'select', value: ['rule', 'preference', 'status', 'metric'].includes(p.category) ? p.category : 'rule', options: [
        { value: 'rule', label: 'Regola' }, { value: 'preference', label: 'Preferenza' }, { value: 'status', label: 'Stato' }, { value: 'metric', label: 'Numero / misura' },
      ] },
    ],
    submitLabel: 'Salva regola',
    onSubmit: (v) => {
      const res = saveRuleFromChat(v);
      showToast(res.action === 'superseded' ? `Regola aggiornata (prima: ${res.previousFact?.fact_value}).` : res.action === 'unchanged' ? 'Questa regola c\'era già.' : 'Regola salvata.', 'success', 4000);
      rerender();
    },
  });
}

async function sendQuestion(text, rerender) {
  const question = String(text || '').trim();
  if (!question || chat.busy) return;
  const history = chat.messages.filter(m => !m.error).map(m => ({ role: m.role, content: m.content }));
  chat.messages.push({ role: 'user', content: question });
  chat.busy = true;
  chat.draft = '';
  rerender();
  try {
    const res = await askPersonalRag({ question, history });
    chat.messages.push({ role: 'assistant', content: res.answer, sources: res.sources, domain: res.domain, suggestedRule: res.suggestedRule });
  } catch (err) {
    chat.messages.push({ role: 'assistant', content: '', error: err.message || String(err) });
    chat.draft = question; // la domanda torna nella casella
  } finally {
    chat.busy = false;
    rerender();
  }
}

// ---------------------------------------------------------------------------
// Coach
// ---------------------------------------------------------------------------

function renderCoach() {
  const queued = store.getQueuedNotes();
  return `
    <div class="m-list">
      <button type="button" class="m-row" data-coach="devil">
        <span class="m-icon-badge dark">${mi('devil', 20)}</span>
        <span class="m-row-main"><span class="m-row-title">Avvocato del Diavolo</span><span class="m-row-sub">Metti alla prova un preventivo, un acquisto o un piano con i tuoi numeri</span></span>
        <span class="m-row-end">${mi('chevron', 18)}</span>
      </button>
      <button type="button" class="m-row" data-coach="queue" ${queued.length ? '' : 'aria-disabled="true"'}>
        <span class="m-icon-badge amber">${mi('inbox', 20)}</span>
        <span class="m-row-main"><span class="m-row-title">Elabora la coda appunti</span><span class="m-row-sub">${queued.length ? `${queued.length} ${queued.length === 1 ? 'nota' : 'note'} con una sola richiesta all'IA` : 'La coda è vuota'}</span></span>
        <span class="m-row-end">${queued.length ? `<span class="m-tag amber">${queued.length}</span>` : ''}${mi('chevron', 18)}</span>
      </button>
      <label class="m-row" data-tap style="cursor:pointer;">
        <span class="m-icon-badge green">${mi('camera', 20)}</span>
        <span class="m-row-main"><span class="m-row-title">Foto di uno scontrino</span><span class="m-row-sub">L'IA legge importo e descrizione e li salva</span></span>
        <span class="m-row-end">${mi('chevron', 18)}</span>
        <input type="file" id="coach-photo" accept="image/*" capture="environment" class="m-sr" />
      </label>
      <button type="button" class="m-row" data-coach="voice">
        <span class="m-icon-badge purple">${mi('mic', 20)}</span>
        <span class="m-row-main"><span class="m-row-title">Dettatura vocale</span><span class="m-row-sub">Parla: trascrivo e smisto io</span></span>
        <span class="m-row-end">${mi('chevron', 18)}</span>
      </button>
      <button type="button" class="m-row" data-coach="full">
        <span class="m-icon-badge">${mi('ai', 20)}</span>
        <span class="m-row-main"><span class="m-row-title">Assistente completo</span><span class="m-row-sub">Vocali, foto, profili e cliente: la finestra completa</span></span>
        <span class="m-row-end">${mi('chevron', 18)}</span>
      </button>
    </div>
    ${queued.length ? `
      <section class="m-section">
        <div class="m-section-head"><h2>In coda</h2></div>
        <div class="m-list">${queued.slice(0, 20).map(n => `
          <div class="m-row"><span class="m-row-main"><span class="m-row-title" style="font-weight:500;">${esc(n.content)}</span><span class="m-row-sub">${esc(n.source === 'telegram' ? 'da Telegram' : 'dal web')} · ${esc(String(n.created_at || '').slice(0, 16).replace('T', ' '))}</span></span>
          <button type="button" class="m-icon-btn" data-unqueue="${esc(n.id)}" aria-label="Togli dalla coda">${mi('trash', 18)}</button></div>`).join('')}</div>
      </section>` : ''}`;
}

function openDevilSheet() {
  formSheet({
    title: 'Avvocato del Diavolo',
    intro: 'Descrivi la decisione: ti rispondo con rischi e numeri presi dai tuoi dati, senza salvare nulla.',
    fields: [{ id: 'prompt', label: 'Cosa vuoi mettere alla prova?', type: 'textarea', rows: 5, required: true, placeholder: 'es. Preventivo sito e-commerce per TechCorp a 2.500 €, consegna in 3 settimane' }],
    submitLabel: 'Analizza',
    onSubmit: async (v) => {
      const res = await processAiPrompt({ prompt: v.prompt, devilsAdvocate: true, activeModule: 'quotes' });
      const c = res.critique;
      setTimeout(() => openSheet({
        title: 'Il parere dell\'Avvocato',
        body: c ? `
          ${c.verdict ? `<p style="font-weight:600;margin-bottom:12px;">${esc(c.verdict)}</p>` : ''}
          ${c.risks?.length ? `<div class="m-label" style="margin-bottom:6px;">Rischi</div><div class="m-list" style="margin-bottom:12px;">${c.risks.map(r => `<div class="m-row"><span>⚠️</span><span class="m-row-main">${esc(r)}</span></div>`).join('')}</div>` : ''}
          ${c.recommendations?.length ? `<div class="m-label" style="margin-bottom:6px;">Cosa farei</div><div class="m-list" style="margin-bottom:12px;">${c.recommendations.map(r => `<div class="m-row"><span>👉</span><span class="m-row-main">${esc(r)}</span></div>`).join('')}</div>` : ''}
          ${c.buffer_percent && (c.buffer_percent.min || c.buffer_percent.max) ? `<p class="m-small">Margine di sicurezza consigliato: ${esc(c.buffer_percent.min)}–${esc(c.buffer_percent.max)}%.</p>` : ''}
          ${c.hourly_profit ? `<p class="m-small">Guadagno orario stimato: ${esc(eur(c.hourly_profit))}/h.</p>` : ''}`
          : `<p class="m-muted">${esc(res.summary || 'Nessuna critica restituita.')}</p>`,
        footer: '<button type="button" class="m-btn" data-sheet-close>Chiudi</button>',
      }), 0);
    },
  });
}

async function processQueue(rerender) {
  const notes = store.getQueuedNotes();
  if (!notes.length) { showToast('La coda è vuota.', 'info', 2500); return; }
  const pending = showToast(`Elaboro ${notes.length} ${notes.length === 1 ? 'nota' : 'note'}…`, 'info', 90000);
  let res;
  try {
    res = await processNoteQueueBatch(notes);
  } catch (err) {
    pending?.remove?.();
    showToast(`L'IA non ha risposto: ${err.message}. Le note restano in coda.`, 'error', 8000);
    return;
  } finally {
    pending?.remove?.();
  }
  const items = [
    ...(res.finance_transactions || []).map(t => `${t.type === 'income' ? 'Entrata' : 'Spesa'}: ${t.description} · ${eur(t.amount, { decimals: 2 })}`),
    ...(res.todos || []).map(t => `To-do: ${t.title}`),
    ...(res.appointments || []).map(a => `Evento: ${a.title} · ${String(a.start_time || '').slice(0, 16).replace('T', ' ')}`),
    ...(res.trading_items || []).map(t => `Articolo: ${t.title}`),
    ...(res.body_log ? [`Corpo del ${res.body_log.date}${(res.body_log.workout_entries || []).length ? ` · ${(res.body_log.workout_entries || []).length} esercizi` : ''}`] : []),
  ];
  openSheet({
    title: 'Cosa ho trovato',
    body: `${res.summary ? `<p class="m-muted" style="margin-bottom:12px;white-space:pre-wrap;">${esc(res.summary)}</p>` : ''}
      ${items.length ? `<div class="m-list">${items.map(x => `<div class="m-row"><span class="m-row-main">${esc(x)}</span></div>`).join('')}</div>` : '<p class="m-muted">Nessuna azione da salvare: le note verranno segnate come elaborate.</p>'}`,
    footer: '<button type="button" class="m-btn" data-sheet-close>Non ora</button><button type="button" class="m-btn m-btn-primary" data-apply>Salva tutto</button>',
    onMount(el, close) {
      el.querySelector('[data-apply]').addEventListener('click', () => {
        const applied = applyAiResultToStore(res);
        store.markNotesProcessed(res.noteIds);
        close();
        rerender();
        showToastWithAction(`Salvato: ${describeApplied(applied) || 'note elaborate'}`, 'Annulla', () => {
          undoAiResult(applied.undo);
          store.runBatch(() => { for (const id of res.noteIds) store.update('ai_note_queue', id, { status: 'queued', processed_at: null }); });
          rerender();
        }, { durationMs: 6000 });
      });
    },
  });
}

function downscaleImage(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Immagine non leggibile.')); };
    img.src = url;
  });
}

async function processPhoto(file, rerender) {
  const pending = showToast('Leggo la foto…', 'info', 60000);
  try {
    const imageBase64 = await downscaleImage(file);
    const result = await processAiPrompt({ prompt: 'Leggi questa foto (scontrino, ricevuta o appunto) e registra quello che contiene.', imageBase64, imageMimeType: 'image/jpeg', activeModule: 'finances' });
    pending?.remove?.();
    const applied = applyAiResultToStore(result);
    rerender();
    const summary = describeApplied(applied);
    if (!summary) { showToast('Nella foto non ho trovato niente da salvare.', 'info', 5000); return; }
    showToastWithAction(`Salvato: ${summary}`, 'Annulla', () => { undoAiResult(applied.undo); rerender(); }, { durationMs: 6000 });
  } catch (err) {
    pending?.remove?.();
    showToast(`Non sono riuscito a leggere la foto: ${err.message}`, 'error', 8000);
  }
}

function openVoiceSheet(rerender) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  openSheet({
    title: 'Dettatura vocale',
    body: `
      ${Rec ? '' : '<div class="m-error">Questo browser non permette la dettatura. Usa il microfono della tastiera del telefono per scrivere qui sotto.</div>'}
      <textarea id="voice-text" class="m-textarea" rows="5" placeholder="Premi «Parla» oppure detta con la tastiera…"></textarea>
      <p class="m-small" id="voice-state" style="margin-top:8px;"></p>`,
    footer: `${Rec ? `<button type="button" class="m-btn" data-voice>${mi('mic', 18)} Parla</button>` : ''}<button type="button" class="m-btn m-btn-primary" data-send>Elabora con IA</button>`,
    onClose: () => { try { rec?.stop(); } catch { /* già fermo */ } },
    onMount(el, close) {
      const text = el.querySelector('#voice-text');
      const stateEl = el.querySelector('#voice-state');
      el.querySelector('[data-voice]')?.addEventListener('click', () => {
        rec = new Rec();
        rec.lang = 'it-IT';
        rec.interimResults = false;
        rec.onresult = (e) => { text.value = `${text.value ? `${text.value} ` : ''}${e.results[0][0].transcript}`; };
        rec.onerror = (e) => { stateEl.textContent = `Microfono non disponibile (${e.error}).`; };
        rec.onend = () => { stateEl.textContent = text.value ? 'Fatto. Controlla e premi «Elabora con IA».' : ''; };
        stateEl.textContent = '🔴 Ti ascolto…';
        rec.start();
      });
      el.querySelector('[data-send]').addEventListener('click', async (e) => {
        const v = text.value.trim();
        if (!v) { text.focus(); return; }
        e.currentTarget.disabled = true;
        const ok = await runAiCapture(v, { onChange: rerender });
        if (ok) close();
        else e.currentTarget.disabled = false;
      });
    },
  });
}

// ---------------------------------------------------------------------------

export function render(container, ctx) {
  if (ctx.params?.tab && ['briefing', 'chat', 'coach'].includes(ctx.params.tab)) {
    activeTab = ctx.params.tab;
    ctx.params.tab = null; // si applica una volta sola
  }
  const rerender = () => ctx.refresh();

  container.innerHTML = `
    ${header({ title: 'AI', subtitle: activeTab === 'chat' ? 'Chiedi a te stesso' : activeTab === 'coach' ? 'Strumenti dell\'assistente' : 'Il punto della giornata', initial: ctx.initial })}
    <div class="m-page">
      <div class="m-seg" role="group" aria-label="Sezione">
        <button type="button" data-tab="briefing" aria-pressed="${activeTab === 'briefing'}">Briefing</button>
        <button type="button" data-tab="chat" aria-pressed="${activeTab === 'chat'}">Chat</button>
        <button type="button" data-tab="coach" aria-pressed="${activeTab === 'coach'}">Coach</button>
      </div>
      ${activeTab === 'briefing' ? renderBriefing() : activeTab === 'chat' ? renderChat() : renderCoach()}
    </div>`;

  container.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { activeTab = b.dataset.tab; rerender(); }));

  if (activeTab === 'briefing') {
    container.querySelector('#brief-ask').addEventListener('click', () => {
      activeTab = 'chat';
      sendQuestion('Fammi un piano concreto per oggi: priorità, allenamento ed eventuali cose da non dimenticare.', rerender);
    });
  }

  if (activeTab === 'chat') {
    const input = container.querySelector('#chat-input');
    const autosize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(140, input.scrollHeight + 2)}px`; };
    autosize();
    input.addEventListener('input', () => { chat.draft = input.value; autosize(); });
    container.querySelector('#chat-send').addEventListener('click', () => sendQuestion(input.value, rerender));
    container.querySelectorAll('[data-example]').forEach(b => b.addEventListener('click', () => sendQuestion(b.textContent, rerender)));
    container.querySelector('#chat-new')?.addEventListener('click', () => { chat.messages = []; chat.draft = ''; rerender(); });
    container.querySelector('#chat-privacy').addEventListener('click', () => openAssistantProfileModal(rerender));
    container.querySelectorAll('[data-src]').forEach(b => b.addEventListener('click', () => {
      const [i, k] = b.dataset.src.split(':').map(Number);
      const src = chat.messages[i]?.sources?.[k];
      if (src) openSource(src);
    }));
    container.querySelectorAll('[data-rule]').forEach(b => b.addEventListener('click', () => {
      const m = chat.messages[Number(b.dataset.rule)];
      if (m) openRuleSheet(m, rerender);
    }));
    if (chat.messages.length) {
      const thread = container.querySelector('#chat-thread');
      thread.lastElementChild?.scrollIntoView({ block: 'end' });
    }
  }

  if (activeTab === 'coach') {
    container.querySelector('[data-coach="devil"]').addEventListener('click', openDevilSheet);
    container.querySelector('[data-coach="queue"]').addEventListener('click', () => processQueue(rerender));
    container.querySelector('[data-coach="voice"]').addEventListener('click', () => openVoiceSheet(rerender));
    container.querySelector('[data-coach="full"]').addEventListener('click', () => openAiModal({ onSaved: rerender, activeModule: 'dashboard' }));
    container.querySelector('#coach-photo').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) processPhoto(file, rerender);
    });
    container.querySelectorAll('[data-unqueue]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.unqueue;
      const note = store.getById('ai_note_queue', id);
      store.permanentDelete('ai_note_queue', id);
      rerender();
      showToastWithAction('Tolta dalla coda.', 'Annulla', () => { if (note) store.create('ai_note_queue', { ...note }); rerender(); }, { durationMs: 5000 });
    }));
  }
}
