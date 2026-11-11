// src/modules/ai-assistant.js
// Modal Assistente IA: Input multimodale (Testo, Foto, Audio/Vocale), Riconoscimento intelligente, Disambiguazione e Conferma

import { store } from '../services/store.js';
import { processAiPrompt, processNoteQueueBatch, selectAiProfile, AI_PROFILES } from '../services/ai.js';
import { ingestKnowledge, BRAIN_DOMAINS } from '../services/brain.js';
import { formatCurrency, formatDateTime, escapeHtml } from '../utils/formatters.js';
import { parseWorkoutNotation } from '../utils/body-parser.js';
import { mountNeuralOrb3D } from '../utils/three-scenes.js';
import { renderNoteQueueBox } from './note-queue-ui.js';
import { showToast } from '../utils/toast.js';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, TRADING_PLATFORMS } from '../services/finances.js';

const DEVIL_PREF_KEY = 'gestionale_ai_devils_advocate_v1';

function readDevilsPref() {
  try {
    return localStorage.getItem(DEVIL_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDevilsPref(on) {
  try {
    localStorage.setItem(DEVIL_PREF_KEY, on ? '1' : '0');
  } catch {
    /* preferenza non persistita */
  }
}

const SOURCE_LABELS = {
  edge_function: 'Edge Function Supabase',
  gemini_direct: 'Gemini',
  local_heuristic: 'motore locale (0 token)',
};

export function openAiModal(options = {}) {
  const { preselectedClientId = null, onSaved = null, autoProcessQueue = false } = options;
  const activeModule = options.activeModule || (typeof window !== 'undefined' ? window.appRouter?.currentRoute : null) || null;
  const clients = store.getAll('clients');
  let devilsMode = readDevilsPref();
  let batchContext = null; // { noteIds, rawText, count, source } quando si elabora la Coda Appunti

  const preselectedClient = preselectedClientId ? store.getById('clients', preselectedClientId) : null;
  const preselectedName = preselectedClient ? (preselectedClient.company_name || `${preselectedClient.first_name} ${preselectedClient.last_name}`) : '';

  const modalHtml = `
    <div class="modal-overlay" id="ai-assistant-overlay">
      <div class="modal-dialog modal-lg" style="max-height: 92vh;">
        <div class="modal-header ai-modal-header" style="background: #09090b; color: #ffffff; border-bottom: 1px solid #27272a;">
          <div class="ai-header-title">
            <div id="ai-modal-orb-canvas" title="Nucleo Cognitivo 3D Interattivo (Three.js)" style="width: 44px; height: 44px; border-radius: 10px; background: #18181b; display: flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden; border: 1px solid rgba(99,102,241,0.35);"></div>
            <div>
              <div class="modal-title" style="color: #ffffff; letter-spacing: -0.02em;">Assistente Operativo IA & Second Brain</div>
              <div id="ai-modal-subtitle" style="font-size: 11px; color: #a1a1aa;">
                ${preselectedName ? `Contesto cliente attivo: <strong>${preselectedName}</strong>` : 'Analizza testo, foto o note vocali ed estrae To-do, Eventi, Body Log e Fatti Mem0'}
              </div>
            </div>
          </div>
          <div class="persona-toggle" role="group" aria-label="Persona dell'assistente">
            <button type="button" class="persona-btn" data-persona="constructive" aria-pressed="${!devilsMode}">🤝 Assistente Costruttivo</button>
            <button type="button" class="persona-btn devil" data-persona="devil" aria-pressed="${devilsMode}">😈 Avvocato del Diavolo</button>
          </div>
          <button type="button" class="btn btn-sm btn-secondary" id="close-ai-modal-btn" aria-label="Chiudi" style="background: rgba(255,255,255,0.1); color: #fff; border: none;">✕</button>
        </div>

        <div class="modal-body" style="padding: 20px; overflow-y: auto;">
          <!-- 1. AREA INPUT RICHIESTA -->
          <div id="ai-input-section">
            <div id="ai-persona-banner"></div>
            <div id="ai-queue-host"></div>
            <div class="form-group">
              <label class="form-label">Descrivi cosa devi fare o fornisci note su clienti/lavori:</label>
              <textarea
                id="ai-text-input"
                class="form-textarea"
                rows="4"
                placeholder="Es: Lavoro da mesi con Marco di TechCorp, sito www.techcorp.it, staging stage.techcorp.it, repo antoromano/techcorp-web, stack Next.js e Supabase, canone 300€/mese. Devo fare deploy mercoledì alle 15..."
              ></textarea>
            </div>

            <!-- Controlli Multimodali (Audio Vocale & Foto) -->
            <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; padding: 12px; background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius);">
              <!-- Registratore Vocale -->
              <div style="display: flex; align-items: center; gap: 8px;">
                <button type="button" id="ai-mic-record-btn" class="btn btn-sm btn-secondary" style="display: flex; align-items: center; gap: 6px;">
                  🎙️ <span id="mic-btn-label">Registra Vocale</span>
                </button>
                <span id="mic-timer" style="display: none; font-size: 12px; font-weight: 700; color: var(--danger);">00:00 🔴</span>
                <audio id="audio-preview-player" controls style="display: none; height: 32px;"></audio>
              </div>

              <!-- Caricamento Foto / Documento -->
              <div style="display: flex; align-items: center; gap: 8px;">
                <label class="btn btn-sm btn-secondary" style="cursor: pointer; margin-bottom: 0;">
                  📷 Allega Foto / Appunto
                  <input type="file" id="ai-photo-input" accept="image/*" style="display: none;" />
                </label>
                <div id="photo-preview-name" style="font-size: 11px; color: var(--text-muted); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></div>
              </div>
            </div>

            <!-- Opzione Second Brain Tri-Layer -->
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; padding: 10px 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: var(--radius);">
              <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: #166534; cursor: pointer;">
                <input type="checkbox" id="ai-save-to-brain" checked />
                🧠 Memorizza anche nel Second Brain (estrae Fatti Atomici Mem0 & Knowledge Graph)
              </label>
              <select id="ai-brain-domain" class="form-select" style="max-width: 190px; padding: 4px 8px; font-size: 12px;">
                ${Object.entries(BRAIN_DOMAINS).map(([k, v]) => `
                  <option value="${k}" ${(preselectedClientId && k === 'client') ? 'selected' : ''}>${v.icon} ${v.label}</option>
                `).join('')}
              </select>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 8px;">
              <button type="button" id="ai-save-brain-only-btn" class="btn btn-secondary">
                🧠 Salva Solo nel Second Brain
              </button>
              <button type="button" id="ai-process-btn" class="btn btn-ai" style="padding: 10px 20px;">
                ⚡ Elabora con l'IA
              </button>
            </div>
          </div>

          <!-- 2. STATO CARICAMENTO ED ELABORAZIONE -->
          <div id="ai-loading-section" style="display: none; text-align: center; padding: 40px;">
            <div style="font-size: 32px; margin-bottom: 12px; animation: pulse 1.5s infinite;">✨</div>
            <div id="ai-loading-title" style="font-size: 15px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">Analisi in corso...</div>
            <div id="ai-loading-detail" style="font-size: 12px; color: var(--text-muted);">Estrazione to-do, appuntamenti e corrispondenze clienti</div>
          </div>

          <!-- 3. AREA ANTEPRIMA PROPOSTE & CONFERMA -->
          <div id="ai-results-section" style="display: none;">
            <div style="padding: 12px; background: #eff6ff; border-left: 4px solid var(--accent); border-radius: var(--radius); margin-bottom: 16px;">
              <div style="font-weight: 700; font-size: 13px; color: #1e40af;" id="ai-summary-text"></div>
              <div style="font-size: 11px; color: #3b82f6; margin-top: 2px;">
                Controlla o modifica le proposte prima di salvare. Nessun record verrà creato senza la tua conferma.
              </div>
            </div>

 <!-- Elaborazione batch della Coda Appunti -->
            <div id="ai-batch-banner" style="display: none;"></div>

            <!-- Critica Avvocato del Diavolo -->
            <div id="ai-critique-section" style="display: none;"></div>

            <!-- Contesto Second Brain Iniettato -->
            <div id="ai-brain-context-box" style="display: none; padding: 10px 12px; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: var(--radius); margin-bottom: 16px; font-size: 11px; color: #5b21b6;"></div>

            <!-- Proposte Nuovi Clienti (On-boarding) -->
            <div id="ai-clients-section" style="margin-bottom: 20px; display: none;">
              <div style="font-weight: 700; font-size: 14px; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                <span>👤 Nuovi Clienti Rilevati da Acquisire</span>
                <span id="ai-clients-count" class="badge badge-green">0</span>
              </div>
              <div id="ai-clients-container" style="display: flex; flex-direction: column; gap: 10px;"></div>
            </div>

            <!-- Proposta Diario Body (Biometria, Nutrizione & Allenamento Matrice) -->
            <div id="ai-body-section" style="margin-bottom: 20px; display: none;">
              <div style="font-weight: 700; font-size: 14px; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                <span>🏋️ Diario Body Rilevato (Biometria, Macro & Matrice Allenamento)</span>
                <span class="badge badge-green">Body + Second Brain</span>
              </div>
              <div id="ai-body-container"></div>
            </div>

            <!-- Proposte Finanze (Entrate / Uscite) -->
            <div id="ai-finance-section" style="margin-bottom: 20px; display: none;">
              <div style="font-weight: 700; font-size: 14px; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                <span>💶 Movimenti Finanziari Rilevati</span>
                <span id="ai-finance-count" class="badge badge-green">0</span>
              </div>
              <div id="ai-finance-container" style="display: flex; flex-direction: column; gap: 10px;"></div>
            </div>

            <!-- Proposte Compravendita -->
            <div id="ai-trading-section" style="margin-bottom: 20px; display: none;">
              <div style="font-weight: 700; font-size: 14px; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                <span>🏷️ Articoli Compravendita Rilevati</span>
                <span id="ai-trading-count" class="badge badge-blue">0</span>
              </div>
              <div id="ai-trading-container" style="display: flex; flex-direction: column; gap: 10px;"></div>
            </div>

            <!-- Proposte To-do -->
            <div style="margin-bottom: 20px;">
              <div style="font-weight: 700; font-size: 14px; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                <span>📋 To-do Proposti</span>
                <span id="ai-todos-count" class="badge badge-gray">0</span>
              </div>
              <div id="ai-todos-container" style="display: flex; flex-direction: column; gap: 10px;"></div>
            </div>

            <!-- Proposte Appuntamenti -->
            <div>
              <div style="font-weight: 700; font-size: 14px; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                <span>📅 Eventi, Rilasci & Scadenze Proposti</span>
                <span id="ai-appts-count" class="badge badge-gray">0</span>
              </div>
              <div id="ai-appts-container" style="display: flex; flex-direction: column; gap: 10px;"></div>
            </div>
          </div>
        </div>

        <div class="modal-footer" id="ai-footer-section">
          <button type="button" class="btn btn-secondary" id="ai-cancel-btn">Annulla</button>
          <button type="button" class="btn btn-secondary" id="ai-retry-btn" style="display: none;">Riprova</button>
          <button type="button" class="btn btn-primary" id="ai-confirm-save-btn" style="display: none;">
            ✓ Conferma e Salva nel Gestionale
          </button>
        </div>
      </div>
    </div>
  `;

  const div = document.createElement('div');
  div.innerHTML = modalHtml;
  document.body.appendChild(div);

  // Monta il Nucleo Cognitivo 3D nell'header della modale IA
  const modalOrbEl = div.querySelector('#ai-modal-orb-canvas');
  const modalOrbInstance = modalOrbEl ? mountNeuralOrb3D(modalOrbEl, { size: 44, initialState: 'idle' }) : null;

  const overlay = div.querySelector('#ai-assistant-overlay');
  const inputSection = div.querySelector('#ai-input-section');
  const loadingSection = div.querySelector('#ai-loading-section');
  const resultsSection = div.querySelector('#ai-results-section');
  const retryBtn = div.querySelector('#ai-retry-btn');
  const confirmBtn = div.querySelector('#ai-confirm-save-btn');
  const textInput = div.querySelector('#ai-text-input');

  const defaultPlaceholder = textInput?.placeholder || '';
  const defaultSubtitle = div.querySelector('#ai-modal-subtitle')?.innerHTML || '';
  const processBtn = div.querySelector('#ai-process-btn');
  const brainOnlyBtn = div.querySelector('#ai-save-brain-only-btn');

  // --- Persona: Assistente Costruttivo | Avvocato del Diavolo ---
  function applyPersonaUi() {
    const profileId = selectAiProfile({ devilsAdvocate: devilsMode, activeModule });
    const profile = AI_PROFILES[profileId];
    div.querySelectorAll('.persona-btn').forEach(btn => {
      const active = (btn.dataset.persona === 'devil') === devilsMode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    const banner = div.querySelector('#ai-persona-banner');
    if (banner) {
      banner.innerHTML = devilsMode
        ? `<div class="persona-banner devil"><span style="font-size: 18px;">😈</span><div><strong>Modalità Avvocato del Diavolo attiva.</strong> Sottopongo a stress-test preventivi (scadenze, revisioni, buffer +25-35%), margini di compravendita (profitto orario reale vs tariffa dev) e carichi di allenamento (sonno + recupero). Non creo to-do né eventi.</div></div>`
        : `<div class="persona-banner"><span style="font-size: 18px;">${profile.icon}</span><div><strong>Profilo attivo: ${profile.label}</strong> — selezionato in automatico${activeModule ? ` dal modulo “${escapeHtml(activeModule)}”` : ''}. ${profile.description}</div></div>`;
    }

    if (textInput) {
      textInput.placeholder = devilsMode
        ? 'Es: Preventivo e-commerce a 3000€ da consegnare in 10 giorni, revisioni a volontà. Conviene? / Ho venduto 3 articoli su Vinted questa settimana, ne vale la pena?'
        : defaultPlaceholder;
    }
    if (processBtn) processBtn.innerHTML = devilsMode ? '😈 Metti alla prova' : '⚡ Elabora con l\'IA';
    if (brainOnlyBtn) brainOnlyBtn.style.display = devilsMode ? 'none' : '';
    const subtitleEl = div.querySelector('#ai-modal-subtitle');
    if (subtitleEl) {
      subtitleEl.innerHTML = devilsMode ? 'Socio critico: contesta le tue assunzioni con numeri reali' : defaultSubtitle;
    }
  }

  div.querySelectorAll('.persona-btn').forEach(btn => btn.addEventListener('click', () => {
    devilsMode = btn.dataset.persona === 'devil';
    writeDevilsPref(devilsMode);
    applyPersonaUi();
  }));
  applyPersonaUi();

  // --- Coda Appunti del Giorno (cassetto collassabile) ---
  renderNoteQueueBox(div.querySelector('#ai-queue-host'), { onProcess: () => runQueueBatch() });

  let orbTypingTimer = null;
  textInput?.addEventListener('input', () => {
    modalOrbInstance?.setEnergy('active');
    if (orbTypingTimer) clearTimeout(orbTypingTimer);
    orbTypingTimer = setTimeout(() => modalOrbInstance?.setEnergy('idle'), 1200);
  });

  let currentParsedResult = null;
  let attachedImageBase64 = null;
  let attachedImageMime = null;
  let attachedAudioBase64 = null;
  let attachedAudioMime = null;

  // Gestione Registrazione Audio Vocale
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;
  let timerInterval = null;
  let secondsRecorded = 0;

  const micBtn = div.querySelector('#ai-mic-record-btn');
  const micLabel = div.querySelector('#mic-btn-label');
  const micTimer = div.querySelector('#mic-timer');
  const audioPreview = div.querySelector('#audio-preview-player');

  micBtn.addEventListener('click', async () => {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          audioPreview.src = URL.createObjectURL(audioBlob);
          audioPreview.style.display = 'block';

          const reader = new FileReader();
          reader.onload = () => {
            attachedAudioBase64 = reader.result.split(',')[1];
            attachedAudioMime = 'audio/webm';
          };
          reader.readAsDataURL(audioBlob);

          // Ferma tracce microfono
          stream.getTracks().forEach(t => t.stop());
        };

        mediaRecorder.start();
        isRecording = true;
        micLabel.textContent = 'Interrompi';
        micBtn.classList.remove('btn-secondary');
        micBtn.classList.add('btn-danger');
        micTimer.style.display = 'inline';

        secondsRecorded = 0;
        timerInterval = setInterval(() => {
          secondsRecorded++;
          const m = String(Math.floor(secondsRecorded / 60)).padStart(2, '0');
          const s = String(secondsRecorded % 60).padStart(2, '0');
          micTimer.textContent = `${m}:${s} 🔴`;
        }, 1000);
      } catch (err) {
        alert('Impossibile accedere al microfono: ' + err.message);
      }
    } else {
      // Ferma registrazione
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
      isRecording = false;
      clearInterval(timerInterval);
      micLabel.textContent = 'Registra di nuovo';
      micBtn.classList.remove('btn-danger');
      micBtn.classList.add('btn-secondary');
      micTimer.style.display = 'none';
    }
  });

  // Gestione Upload Foto
  const photoInput = div.querySelector('#ai-photo-input');
  const photoPreviewName = div.querySelector('#photo-preview-name');
  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    photoPreviewName.textContent = `📎 ${file.name}`;

    const reader = new FileReader();
    reader.onload = () => {
      attachedImageBase64 = reader.result.split(',')[1];
      attachedImageMime = file.type;
    };
    reader.readAsDataURL(file);
  });

  // Salva direttamente solo nel Second Brain
  div.querySelector('#ai-save-brain-only-btn')?.addEventListener('click', async () => {
    const text = textInput.value.trim();
    if (!text) {
      alert('Inserisci una nota o un appunto da salvare nel Second Brain.');
      return;
    }
    const domain = div.querySelector('#ai-brain-domain')?.value || 'work';
    try {
      const res = await ingestKnowledge({
        text,
        domain,
        sourceType: 'ai_chat',
      });
      alert(`Nota memorizzata nel Second Brain!\nFatti estratti/aggiornati: ${res.facts.length}\nRelazioni grafo: ${res.edges.length}`);
      div.remove();
      if (onSaved) onSaved();
    } catch (err) {
      alert('Errore salvataggio Second Brain: ' + err.message);
    }
  });

  // Elaborazione Richiesta
  div.querySelector('#ai-process-btn').addEventListener('click', async () => {
    const text = textInput.value.trim();
    if (!text && !attachedAudioBase64 && !attachedImageBase64) {
      alert('Inserisci un testo, carica una foto o registra una nota vocale.');
      return;
    }

    batchContext = null;
    inputSection.style.display = 'none';
    loadingSection.style.display = 'block';
    div.querySelector('#ai-loading-title').textContent = devilsMode ? 'L’Avvocato del Diavolo sta cercando i punti deboli...' : 'Analisi in corso...';
    div.querySelector('#ai-loading-detail').textContent = devilsMode ? 'Incrocio preventivi, margini di compravendita e dati di recupero' : 'Estrazione to-do, appuntamenti e corrispondenze clienti';

    try {
      const result = await processAiPrompt({
        prompt: text,
        imageBase64: attachedImageBase64,
        imageMimeType: attachedImageMime,
        audioBase64: attachedAudioBase64,
        audioMimeType: attachedAudioMime,
        preselectedClientId,
        devilsAdvocate: devilsMode,
        activeModule,
      });

      currentParsedResult = result;
      displayResults(result);
    } catch (err) {
      alert('Errore durante l\'elaborazione dell\'IA: ' + err.message);
      inputSection.style.display = 'block';
      loadingSection.style.display = 'none';
    }
  });

  // Elabora TUTTE le note in coda con UNA sola chiamata (profilo ingestion_batch)
  async function runQueueBatch() {
    const notes = store.getQueuedNotes();
    if (notes.length === 0) {
      showToast('La coda è vuota.', 'info');
      return;
    }
    inputSection.style.display = 'none';
    loadingSection.style.display = 'block';
    div.querySelector('#ai-loading-title').textContent = `Elaboro ${notes.length} ${notes.length === 1 ? 'nota' : 'note'} in un’unica chiamata...`;
    div.querySelector('#ai-loading-detail').textContent = 'Profilo Ingestion Batch: estrazione multi-intent compatta';

    try {
      const result = await processNoteQueueBatch(notes, { preselectedClientId, activeModule });
      batchContext = {
        noteIds: result.noteIds,
        // Al Second Brain va il testo pulito delle note (senza l'intestazione del prompt batch)
        rawText: notes.map(n => n.content).join('\n'),
        count: notes.length,
        source: result.source,
      };
      currentParsedResult = result;
      displayResults(result);
    } catch (err) {
      alert('Errore durante l\'elaborazione della coda: ' + err.message);
      inputSection.style.display = 'block';
      loadingSection.style.display = 'none';
    }
  }

  function displayResults(data) {
    loadingSection.style.display = 'none';
    resultsSection.style.display = 'block';
    retryBtn.style.display = 'inline-block';
    confirmBtn.style.display = 'inline-block';

    div.querySelector('#ai-summary-text').textContent = data.summary || 'Proposte estratte con successo';
    div.querySelector('#ai-todos-count').textContent = (data.todos || []).length;
    div.querySelector('#ai-appts-count').textContent = (data.appointments || []).length;

    renderBatchBanner(data);
    renderCritique(data.critique);
    renderFinanceProposals(data.finance_transactions || []);
    renderTradingProposals(data.trading_items || []);

    // Nessuna proposta da salvare (es. sola critica dell'Avvocato del Diavolo): il pulsante di salvataggio non serve
    const proposalCount = (data.todos || []).length + (data.appointments || []).length + (data.clients_to_create || []).length
      + (data.finance_transactions || []).length + (data.trading_items || []).length + (data.body_log ? 1 : 0);
    const critiqueOnly = proposalCount === 0 && Boolean(data.critique);
    confirmBtn.style.display = critiqueOnly ? 'none' : 'inline-block';
    const hintEl = div.querySelector('#ai-summary-text')?.nextElementSibling;
    if (hintEl) {
      hintEl.textContent = critiqueOnly
        ? 'Analisi basata sui tuoi dati reali (preventivi, compravendita, Body). Nessun record viene creato.'
        : 'Controlla o modifica le proposte prima di salvare. Nessun record verrà creato senza la tua conferma.';
    }

    const brainBox = div.querySelector('#ai-brain-context-box');
    if (brainBox && data.brainContext) {
      const bc = data.brainContext;
      if ((bc.activeFacts && bc.activeFacts.length > 0) || (bc.graphConnections && bc.graphConnections.length > 0)) {
        brainBox.style.display = 'block';
        brainBox.innerHTML = `
          <strong>🧠 Contesto Second Brain attivo iniettato:</strong>
          ${bc.activeFacts.slice(0, 4).map(f => `<span class="badge badge-green" style="margin-left: 4px;">[${f.subject}] ${f.fact_key}: ${f.fact_value}</span>`).join('')}
          ${bc.graphConnections.slice(0, 3).map(c => `<span class="badge badge-blue" style="margin-left: 4px;">${c.source_label} → ${c.target_label}</span>`).join('')}
        `;
      } else {
        brainBox.style.display = 'none';
      }
    }

    const clientsSection = div.querySelector('#ai-clients-section');
    const clientsContainer = div.querySelector('#ai-clients-container');
    const clientsToCreate = data.clients_to_create || [];
    div.querySelector('#ai-clients-count').textContent = clientsToCreate.length;

    if (clientsToCreate.length > 0) {
      clientsSection.style.display = 'block';
      clientsContainer.innerHTML = clientsToCreate.map((c, idx) => `
        <div class="card ai-client-card" data-idx="${idx}" style="padding: 14px; margin-bottom: 0; border: 1px solid #bbf7d0; background: #f0fdf4;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <label style="display: flex; align-items: center; gap: 8px; font-weight: 700; color: #166534;">
              <input type="checkbox" class="ai-include-client" data-idx="${idx}" checked />
              Acquisisci Nuovo Cliente: ${c.company_name}
            </label>
            <span class="badge badge-green">Onboarding Rilevato</span>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 2;">
              <label class="form-label">Azienda / Nome *</label>
              <input type="text" class="form-input ai-client-name" data-idx="${idx}" value="${c.company_name}" />
            </div>
            <div class="form-group" style="flex: 1.5;">
              <label class="form-label">Referente</label>
              <input type="text" class="form-input ai-client-contact" data-idx="${idx}" value="${c.first_name ? `${c.first_name} ${c.last_name || ''}`.trim() : ''}" />
            </div>
            <div class="form-group" style="flex: 1.5;">
              <label class="form-label">Email</label>
              <input type="email" class="form-input ai-client-email" data-idx="${idx}" value="${c.email || ''}" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Staging URL</label>
              <input type="url" class="form-input ai-client-staging" data-idx="${idx}" value="${c.staging_url || ''}" placeholder="https://staging..." />
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Produzione URL</label>
              <input type="url" class="form-input ai-client-prod" data-idx="${idx}" value="${c.production_url || ''}" placeholder="https://www..." />
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Repo GitHub (owner/repo)</label>
              <input type="text" class="form-input ai-client-repo" data-idx="${idx}" value="${c.github_repo || ''}" placeholder="owner/repo" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 2;">
              <label class="form-label">Stack Tecnologico</label>
              <input type="text" class="form-input ai-client-stack" data-idx="${idx}" value="${c.stack || ''}" placeholder="es. React, Next.js, Supabase" />
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Canone Manutenzione (€)</label>
              <input type="number" class="form-input ai-client-maintenance" data-idx="${idx}" step="0.01" value="${c.maintenance_amount || 0}" />
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Frequenza</label>
              <select class="form-select ai-client-freq" data-idx="${idx}">
                <option value="monthly" ${c.maintenance_frequency === 'monthly' ? 'selected' : ''}>Mensile</option>
                <option value="annual" ${c.maintenance_frequency === 'annual' ? 'selected' : ''}>Annuale</option>
              </select>
            </div>
          </div>
        </div>
      `).join('');
    } else {
      clientsSection.style.display = 'none';
    }

    // Rendering Diario Body (Biometria, Nutrizione & Allenamento Matrice)
    const bodySection = div.querySelector('#ai-body-section');
    const bodyContainer = div.querySelector('#ai-body-container');
    if (data.body_log && bodySection && bodyContainer) {
      const bl = data.body_log;
      bodySection.style.display = 'block';
      // Se è un body log, pre-imposta il dominio Second Brain su 'body'
      const domainSelect = div.querySelector('#ai-brain-domain');
      if (domainSelect) domainSelect.value = 'body';

      bodyContainer.innerHTML = `
        <div class="card" style="padding: 14px; margin-bottom: 0; border: 1px solid #bbf7d0; background: #f0fdf4;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <label style="display: flex; align-items: center; gap: 8px; font-weight: 700; color: #166534;">
              <input type="checkbox" id="ai-include-body" checked />
              Salva nella Matrice Body (${bl.date})
            </label>
            <input type="date" id="ai-body-date" class="form-input" style="max-width: 150px; padding: 4px 8px; font-size: 12px;" value="${bl.date}" />
          </div>

          <div class="form-row" style="margin-bottom: 10px;">
            <div class="form-group">
              <label class="form-label">Peso (kg)</label>
              <input type="number" step="0.1" id="ai-body-weight" class="form-input" value="${bl.body_weight_kg ?? ''}" placeholder="-" />
            </div>
            <div class="form-group">
              <label class="form-label">Sonno (ore)</label>
              <input type="number" step="0.5" id="ai-body-sleep" class="form-input" value="${bl.sleep_hours ?? ''}" placeholder="-" />
            </div>
            <div class="form-group">
              <label class="form-label">Calorie (kcal)</label>
              <input type="number" step="10" id="ai-body-kcal" class="form-input" value="${bl.calories_kcal ?? ''}" placeholder="-" />
            </div>
            <div class="form-group">
              <label class="form-label">Proteine (g)</label>
              <input type="number" step="1" id="ai-body-protein" class="form-input" value="${bl.protein_g ?? ''}" placeholder="-" />
            </div>
            <div class="form-group">
              <label class="form-label">Carbo (g)</label>
              <input type="number" step="1" id="ai-body-carbs" class="form-input" value="${bl.carbs_g ?? ''}" placeholder="-" />
            </div>
            <div class="form-group">
              <label class="form-label">Grassi (g)</label>
              <input type="number" step="1" id="ai-body-fat" class="form-input" value="${bl.fat_g ?? ''}" placeholder="-" />
            </div>
          </div>

          ${(bl.workout_entries || []).length > 0 ? `
            <div style="font-size: 12px; font-weight: 700; color: #166534; margin-bottom: 6px;">Celle Esercizi Rilevate:</div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
              ${bl.workout_entries.map((we, idx) => `
                <div style="display: flex; gap: 8px; align-items: center; background: #ffffff; padding: 6px 10px; border-radius: 6px; border: 1px solid #bbf7d0;">
                  <span class="badge badge-blue" style="min-width: 110px; text-align: center;">${we.column_name}</span>
                  <input type="text" class="form-input ai-body-workout-notation" data-idx="${idx}" data-col-id="${we.column_id}" data-cat="${we.category || 'pull'}" value="${we.raw_notation}" style="font-family: monospace; font-size: 12px;" />
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    } else if (bodySection) {
      bodySection.style.display = 'none';
    }

    const todosContainer = div.querySelector('#ai-todos-container');
    const apptsContainer = div.querySelector('#ai-appts-container');

    // Rendering To-do proposti
    if (!data.todos || data.todos.length === 0) {
      todosContainer.innerHTML = `<div style="font-size: 12px; color: var(--text-muted); font-style: italic;">Nessun to-do identificato</div>`;
    } else {
      todosContainer.innerHTML = data.todos.map((t, idx) => `
        <div class="card ai-todo-card" data-idx="${idx}" style="padding: 12px; margin-bottom: 0; border: 1px solid var(--border);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <label style="display: flex; align-items: center; gap: 8px; font-weight: 700;">
              <input type="checkbox" class="ai-include-todo" data-idx="${idx}" checked />
              Includi To-do #${idx + 1}
            </label>
            <span class="badge ${t.priority === 'urgente' ? 'badge-red' : 'badge-gray'}">${t.priority}</span>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 3;">
              <label class="form-label">Titolo</label>
              <input type="text" class="form-input ai-todo-title" data-idx="${idx}" value="${t.title}" />
            </div>

            <div class="form-group" style="flex: 2;">
              <label class="form-label">Cliente Associato</label>
              <select class="form-select ai-todo-client" data-idx="${idx}">
                <option value="">Nessun cliente</option>
                ${clients.map(c => `
                  <option value="${c.id}" ${t.client_id === c.id ? 'selected' : ''}>
                    ${c.company_name || `${c.first_name} ${c.last_name}`}
                  </option>
                `).join('')}
              </select>
              ${t.client_name_proposed && !t.client_id ? `
                <div style="font-size: 10px; color: var(--warning); margin-top: 2px;">
                  ⚠️ Rilevato nel testo: "${t.client_name_proposed}". Scegli il cliente corretto se applicabile.
                </div>
              ` : ''}
            </div>

            <div class="form-group" style="flex: 1.5;">
              <label class="form-label">Scadenza</label>
              <input type="datetime-local" class="form-input ai-todo-due" data-idx="${idx}" value="${t.due_date ? t.due_date.slice(0, 16) : ''}" />
            </div>

            <div class="form-group" style="flex: 1;">
              <label class="form-label">Compenso (€)</label>
              <input type="number" class="form-input ai-todo-comp" data-idx="${idx}" step="0.01" value="${t.compensation_amount || 0}" />
            </div>
          </div>
        </div>
      `).join('');
    }

    // Rendering Appuntamenti proposti
    if (!data.appointments || data.appointments.length === 0) {
      apptsContainer.innerHTML = `<div style="font-size: 12px; color: var(--text-muted); font-style: italic;">Nessun appuntamento o shooting identificato</div>`;
    } else {
      apptsContainer.innerHTML = data.appointments.map((a, idx) => `
        <div class="card ai-appt-card" data-idx="${idx}" style="padding: 12px; margin-bottom: 0; border: 1px solid var(--border);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <label style="display: flex; align-items: center; gap: 8px; font-weight: 700;">
              <input type="checkbox" class="ai-include-appt" data-idx="${idx}" checked />
              Includi Evento #${idx + 1}
            </label>
            <span class="badge ${a.is_shooting ? 'badge-blue' : 'badge-gray'}">${a.is_shooting ? (a.shooting_type || 'Shooting') : 'Incontro'}</span>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 3;">
              <label class="form-label">Titolo</label>
              <input type="text" class="form-input ai-appt-title" data-idx="${idx}" value="${a.title}" />
            </div>

            <div class="form-group" style="flex: 2;">
              <label class="form-label">Cliente Associato</label>
              <select class="form-select ai-appt-client" data-idx="${idx}">
                <option value="">Nessun cliente</option>
                ${clients.map(c => `
                  <option value="${c.id}" ${a.client_id === c.id ? 'selected' : ''}>
                    ${c.company_name || `${c.first_name} ${c.last_name}`}
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="form-group" style="flex: 1.5;">
              <label class="form-label">Inizio</label>
              <input type="datetime-local" class="form-input ai-appt-start" data-idx="${idx}" value="${a.start_time ? a.start_time.slice(0, 16) : ''}" />
            </div>

            <div class="form-group" style="flex: 1.5;">
              <label class="form-label">Luogo</label>
              <input type="text" class="form-input ai-appt-loc" data-idx="${idx}" value="${a.location || ''}" placeholder="Luogo o Studio" />
            </div>
          </div>
        </div>
      `).join('');
    }
  }

  function renderBatchBanner(data) {
    const el = div.querySelector('#ai-batch-banner');
    if (!el) return;
    if (!batchContext) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.innerHTML = `<div class="persona-banner" style="margin-bottom: 14px;"><span style="font-size: 18px;">⚡</span><div><strong>${batchContext.count} ${batchContext.count === 1 ? 'nota elaborata' : 'note elaborate'} in 1 chiamata</strong> · profilo Ingestion Batch · ${escapeHtml(SOURCE_LABELS[batchContext.source] || batchContext.source || '')}. Le note restano in coda finché non confermi il salvataggio.</div></div>`;
  }

  function renderCritique(critique) {
    const el = div.querySelector('#ai-critique-section');
    if (!el) return;
    if (!critique) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    const buffer = critique.buffer_percent && critique.buffer_percent.min != null
      ? `<span class="badge badge-yellow">Buffer rischio +${critique.buffer_percent.min}-${critique.buffer_percent.max}%</span>` : '';
    const hourly = critique.hourly_profit != null
      ? `<span class="badge badge-red">Profitto orario reale ${formatCurrency(critique.hourly_profit)}/h</span>` : '';
    el.style.display = 'block';
    el.innerHTML = `
      <div class="critique-card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: wrap;">
          <div style="font-weight: 700; font-size: 14px;">😈 ${escapeHtml(critique.verdict || 'Analisi critica')}</div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">${buffer}${hourly}</div>
        </div>
        ${(critique.risks || []).length > 0 ? `<h4>Rischi individuati</h4><ul>${critique.risks.map(r => `<li>⚠️ ${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
        ${(critique.recommendations || []).length > 0 ? `<h4>Cosa fare invece</h4><ul>${critique.recommendations.map(r => `<li>✅ ${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
      </div>`;
  }

  function renderFinanceProposals(items) {
    const section = div.querySelector('#ai-finance-section');
    const container = div.querySelector('#ai-finance-container');
    div.querySelector('#ai-finance-count').textContent = items.length;
    if (!section || !container) return;
    if (items.length === 0) {
      section.style.display = 'none';
      container.innerHTML = '';
      return;
    }
    section.style.display = 'block';
    container.innerHTML = `
      <datalist id="ai-fin-cat-list">${[...new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])].map(c => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
      ${items.map((t, idx) => `
        <div class="card ai-fin-card" style="padding: 12px; margin-bottom: 0; border: 1px solid ${t.type === 'income' ? '#bbf7d0' : '#fecaca'};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label style="display: flex; align-items: center; gap: 8px; font-weight: 700;">
              <input type="checkbox" class="ai-include-fin" data-idx="${idx}" checked />
              Registra movimento #${idx + 1}
            </label>
            <span class="badge ${t.type === 'income' ? 'badge-green' : 'badge-red'}">${t.type === 'income' ? 'Entrata' : 'Uscita'}</span>
          </div>
          <div class="form-row">
            <div class="form-group" style="flex: 3;">
              <label class="form-label">Descrizione</label>
              <input type="text" class="form-input ai-fin-desc" data-idx="${idx}" value="${escapeHtml(t.description)}" />
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Tipo</label>
              <select class="form-select ai-fin-type" data-idx="${idx}">
                <option value="expense" ${t.type === 'expense' ? 'selected' : ''}>Uscita</option>
                <option value="income" ${t.type === 'income' ? 'selected' : ''}>Entrata</option>
              </select>
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Importo (€)</label>
              <input type="number" step="0.01" min="0" class="form-input ai-fin-amt" data-idx="${idx}" value="${t.amount}" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group" style="flex: 2;">
              <label class="form-label">Categoria</label>
              <input type="text" list="ai-fin-cat-list" class="form-input ai-fin-cat" data-idx="${idx}" value="${escapeHtml(t.category)}" />
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Data</label>
              <input type="date" class="form-input ai-fin-date" data-idx="${idx}" value="${escapeHtml(t.date)}" />
            </div>
          </div>
        </div>`).join('')}`;
  }

  function renderTradingProposals(items) {
    const section = div.querySelector('#ai-trading-section');
    const container = div.querySelector('#ai-trading-container');
    div.querySelector('#ai-trading-count').textContent = items.length;
    if (!section || !container) return;
    if (items.length === 0) {
      section.style.display = 'none';
      container.innerHTML = '';
      return;
    }
    section.style.display = 'block';
    container.innerHTML = items.map((t, idx) => `
      <div class="card ai-trade-card" style="padding: 12px; margin-bottom: 0; border: 1px solid #bfdbfe;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <label style="display: flex; align-items: center; gap: 8px; font-weight: 700;">
            <input type="checkbox" class="ai-include-trade" data-idx="${idx}" checked />
            Aggiungi articolo #${idx + 1}
          </label>
          <span class="badge badge-blue">${t.status === 'sold' ? 'Venduto' : 'In vendita'}</span>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex: 3;">
            <label class="form-label">Oggetto</label>
            <input type="text" class="form-input ai-trade-title" data-idx="${idx}" value="${escapeHtml(t.title)}" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label class="form-label">Piattaforma</label>
            <select class="form-select ai-trade-platform" data-idx="${idx}">
              ${TRADING_PLATFORMS.map(p => `<option value="${p}" ${t.platform === p ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Acquisto (€)</label><input type="number" step="0.01" min="0" class="form-input ai-trade-purchase" data-idx="${idx}" value="${t.purchase_price}" /></div>
          <div class="form-group"><label class="form-label">Extra (€)</label><input type="number" step="0.01" min="0" class="form-input ai-trade-extra" data-idx="${idx}" value="${t.extra_costs || 0}" /></div>
          <div class="form-group"><label class="form-label">Commissioni (€)</label><input type="number" step="0.01" min="0" class="form-input ai-trade-fees" data-idx="${idx}" value="${t.platform_fees || 0}" /></div>
          <div class="form-group"><label class="form-label">Vendita (€)</label><input type="number" step="0.01" min="0" class="form-input ai-trade-sale" data-idx="${idx}" value="${t.sale_price ?? ''}" placeholder="non venduto" /></div>
        </div>
      </div>`).join('');
  }

  // Riprova
  retryBtn.addEventListener('click', () => {
    batchContext = null;
    resultsSection.style.display = 'none';
    retryBtn.style.display = 'none';
    confirmBtn.style.display = 'none';
    inputSection.style.display = 'block';
  });

  // Conferma e Salva nel gestionale
  confirmBtn.addEventListener('click', async () => {
    if (!currentParsedResult) return;

    let createdClientsCount = 0;
    let createdTodosCount = 0;
    let createdApptsCount = 0;
    let createdFinanceCount = 0;
    let createdTradingCount = 0;
    let savedBodyLog = false;
    let savedToBrain = false;
    const clientNameToIdMap = {};

    // 0. Salva eventuale Diario Body (Biometria + Macro + Celle Allenamento)
    if (currentParsedResult.body_log && div.querySelector('#ai-include-body')?.checked) {
      const logDate = div.querySelector('#ai-body-date')?.value || currentParsedResult.body_log.date;
      const weightVal = div.querySelector('#ai-body-weight')?.value;
      const sleepVal = div.querySelector('#ai-body-sleep')?.value;
      const kcalVal = div.querySelector('#ai-body-kcal')?.value;
      const protVal = div.querySelector('#ai-body-protein')?.value;
      const carbsVal = div.querySelector('#ai-body-carbs')?.value;
      const fatVal = div.querySelector('#ai-body-fat')?.value;

      const dailyPayload = { date: logDate };
      if (weightVal !== '' && weightVal != null) dailyPayload.body_weight_kg = Number(weightVal);
      if (sleepVal !== '' && sleepVal != null) dailyPayload.sleep_hours = Number(sleepVal);
      if (kcalVal !== '' && kcalVal != null) dailyPayload.calories_kcal = Number(kcalVal);
      if (protVal !== '' && protVal != null) dailyPayload.protein_g = Number(protVal);
      if (carbsVal !== '' && carbsVal != null) dailyPayload.carbs_g = Number(carbsVal);
      if (fatVal !== '' && fatVal != null) dailyPayload.fat_g = Number(fatVal);

      store.upsertBodyDailyLog(dailyPayload);

      div.querySelectorAll('.ai-body-workout-notation').forEach(inp => {
        const raw_notation = inp.value.trim();
        const column_id = inp.dataset.colId;
        const category = inp.dataset.cat || 'pull';
        if (raw_notation && column_id) {
          const parsed = parseWorkoutNotation(raw_notation, category);
          store.upsertBodyWorkoutEntry({
            date: logDate,
            column_id,
            raw_notation,
            parsed_blocks: parsed.blocks,
          });
        }
      });

      savedBodyLog = true;
    }

    const shouldSaveToBrain = div.querySelector('#ai-save-to-brain')?.checked;
    const brainDomain = div.querySelector('#ai-brain-domain')?.value || 'work';
    const rawPromptText = batchContext ? batchContext.rawText : textInput.value.trim();

    if (shouldSaveToBrain && rawPromptText) {
      try {
        await ingestKnowledge({
          text: rawPromptText,
          domain: brainDomain,
          sourceType: 'ai_chat',
        });
        savedToBrain = true;
      } catch (err) {
        console.warn('Errore salvataggio automatico Second Brain:', err);
      }
    }

    // 0b. Salva movimenti finanziari e articoli di compravendita confermati (scrittura batch)
    const financeToCreate = [];
    div.querySelectorAll('.ai-include-fin:checked').forEach(cb => {
      const idx = cb.dataset.idx;
      const description = div.querySelector(`.ai-fin-desc[data-idx="${idx}"]`).value.trim();
      const amount = parseFloat(div.querySelector(`.ai-fin-amt[data-idx="${idx}"]`).value);
      if (!description || !(amount > 0)) return;
      const raw = (currentParsedResult.finance_transactions || [])[idx] || {};
      financeToCreate.push({
        type: div.querySelector(`.ai-fin-type[data-idx="${idx}"]`).value,
        description,
        amount,
        category: div.querySelector(`.ai-fin-cat[data-idx="${idx}"]`).value.trim() || 'generale',
        date: div.querySelector(`.ai-fin-date[data-idx="${idx}"]`).value,
        payment_method: raw.payment_method || 'bonifico',
        client_id: raw.client_id || null,
      });
    });
    if (financeToCreate.length > 0) {
      createdFinanceCount = store.createBatch('finance_transactions', financeToCreate).length;
    }

    const tradingToCreate = [];
    div.querySelectorAll('.ai-include-trade:checked').forEach(cb => {
      const idx = cb.dataset.idx;
      const title = div.querySelector(`.ai-trade-title[data-idx="${idx}"]`).value.trim();
      const purchase = parseFloat(div.querySelector(`.ai-trade-purchase[data-idx="${idx}"]`).value);
      if (!title || !(purchase >= 0)) return;
      const saleRaw = div.querySelector(`.ai-trade-sale[data-idx="${idx}"]`).value;
      const raw = (currentParsedResult.trading_items || [])[idx] || {};
      tradingToCreate.push({
        title,
        platform: div.querySelector(`.ai-trade-platform[data-idx="${idx}"]`).value,
        purchase_price: purchase,
        extra_costs: parseFloat(div.querySelector(`.ai-trade-extra[data-idx="${idx}"]`).value) || 0,
        platform_fees: parseFloat(div.querySelector(`.ai-trade-fees[data-idx="${idx}"]`).value) || 0,
        sale_price: saleRaw === '' ? null : parseFloat(saleRaw),
        purchase_date: raw.purchase_date,
        notes: raw.notes || '',
      });
    });
    if (tradingToCreate.length > 0) {
      createdTradingCount = store.createBatch('trading_items', tradingToCreate).length;
    }

    // 1. Salva nuovi clienti confermati (Onboarding)
    div.querySelectorAll('.ai-include-client:checked').forEach(cb => {
      const idx = cb.dataset.idx;
      const rawC = currentParsedResult.clients_to_create[idx];
      const company_name = div.querySelector(`.ai-client-name[data-idx="${idx}"]`).value.trim();
      const contact_person = div.querySelector(`.ai-client-contact[data-idx="${idx}"]`).value.trim();
      const email = div.querySelector(`.ai-client-email[data-idx="${idx}"]`).value.trim();
      const staging_url = div.querySelector(`.ai-client-staging[data-idx="${idx}"]`).value.trim();
      const production_url = div.querySelector(`.ai-client-prod[data-idx="${idx}"]`).value.trim();
      const github_repo = div.querySelector(`.ai-client-repo[data-idx="${idx}"]`).value.trim();
      const stack = div.querySelector(`.ai-client-stack[data-idx="${idx}"]`).value.trim();
      const maintenance_amount = parseFloat(div.querySelector(`.ai-client-maintenance[data-idx="${idx}"]`).value) || 0;
      const maintenance_frequency = div.querySelector(`.ai-client-freq[data-idx="${idx}"]`).value || 'monthly';

      const contracts = [];
      if (maintenance_amount > 0) {
        contracts.push({
          title: 'Canone Manutenzione & Assistenza (SLA)',
          amount: maintenance_amount,
          frequency: maintenance_frequency,
          status: 'active',
          created_at: new Date().toISOString(),
        });
      }

      const newClient = store.create('clients', {
        type: 'company',
        company_name: company_name || 'Nuovo Cliente',
        contact_person,
        email,
        phone: rawC?.phone || '',
        staging_url,
        production_url,
        github_repo,
        stack,
        notes: rawC?.notes || '',
        maintenance_contracts: contracts,
      });

      createdClientsCount++;
      if (company_name) clientNameToIdMap[company_name.toLowerCase()] = newClient.id;
      if (contact_person) clientNameToIdMap[contact_person.toLowerCase()] = newClient.id;
    });

    // 2. Salva to-do confermati
    div.querySelectorAll('.ai-include-todo:checked').forEach(cb => {
      const idx = cb.dataset.idx;
      const title = div.querySelector(`.ai-todo-title[data-idx="${idx}"]`).value.trim();
      let clientId = div.querySelector(`.ai-todo-client[data-idx="${idx}"]`).value || null;
      const due = div.querySelector(`.ai-todo-due[data-idx="${idx}"]`).value || null;
      const comp = parseFloat(div.querySelector(`.ai-todo-comp[data-idx="${idx}"]`).value) || 0;

      // Se non selezionato esplicitamente, controlla se corrisponde a un cliente appena creato
      if (!clientId && currentParsedResult.todos[idx]?.client_name_proposed) {
        const propName = currentParsedResult.todos[idx].client_name_proposed.toLowerCase();
        for (const [nameKey, newId] of Object.entries(clientNameToIdMap)) {
          if (nameKey.includes(propName) || propName.includes(nameKey)) {
            clientId = newId;
            break;
          }
        }
      }

      if (title) {
        store.create('todos', {
          title,
          client_id: clientId,
          due_date: due,
          priority: currentParsedResult.todos[idx]?.priority || 'media',
          compensation_mode: comp > 0 ? 'autonomous' : 'none',
          compensation_amount: comp,
          is_completed: false,
          source: 'ai',
        });
        createdTodosCount++;
      }
    });

    // 3. Salva appuntamenti ed eventi confermati
    div.querySelectorAll('.ai-include-appt:checked').forEach(cb => {
      const idx = cb.dataset.idx;
      const title = div.querySelector(`.ai-appt-title[data-idx="${idx}"]`).value.trim();
      let clientId = div.querySelector(`.ai-appt-client[data-idx="${idx}"]`).value || null;
      const start = div.querySelector(`.ai-appt-start[data-idx="${idx}"]`).value;
      const loc = div.querySelector(`.ai-appt-loc[data-idx="${idx}"]`).value.trim();
      const rawAppt = currentParsedResult.appointments[idx];

      if (!clientId && rawAppt?.client_name_proposed) {
        const propName = rawAppt.client_name_proposed.toLowerCase();
        for (const [nameKey, newId] of Object.entries(clientNameToIdMap)) {
          if (nameKey.includes(propName) || propName.includes(nameKey)) {
            clientId = newId;
            break;
          }
        }
      }

      if (title && start) {
        store.create('appointments', {
          title,
          client_id: clientId,
          start_time: start,
          end_time: rawAppt?.end_time || null,
          location: loc,
          is_all_day: Boolean(rawAppt?.is_all_day),
          activity_type: rawAppt?.activity_type || (rawAppt?.is_shooting ? 'deploy' : 'general'),
          compensation_amount: rawAppt?.compensation_amount || 0,
        });
        createdApptsCount++;
      }
    });

    const parts = [];
    if (savedBodyLog) parts.push('Diario Body registrato');
    if (createdFinanceCount > 0) parts.push(`${createdFinanceCount} Movimenti finanziari`);
    if (createdTradingCount > 0) parts.push(`${createdTradingCount} Articoli compravendita`);
    if (createdClientsCount > 0) parts.push(`${createdClientsCount} Clienti acquisiti`);
    if (createdTodosCount > 0) parts.push(`${createdTodosCount} To-do creati`);
    if (createdApptsCount > 0) parts.push(`${createdApptsCount} Eventi in agenda`);
    if (savedToBrain) parts.push('Conoscenza salvata nel Second Brain');

    // La coda viene svuotata solo dopo la conferma: chiudendo senza salvare le note restano disponibili
    if (batchContext) {
      store.markNotesProcessed(batchContext.noteIds);
      parts.push(`${batchContext.count} note della coda elaborate`);
      batchContext = null;
    }

    showToast(`Operazione completata: ${parts.join(', ') || 'Nessun elemento selezionato'}.`, 'success', 5200);
    modalOrbInstance?.destroy?.();
    div.remove();
    if (onSaved) onSaved();
  });

  const closeModal = () => {
    modalOrbInstance?.destroy?.();
    div.remove();
  };
  div.querySelector('#close-ai-modal-btn').addEventListener('click', closeModal);
  div.querySelector('#ai-cancel-btn').addEventListener('click', closeModal);

  // Safe backdrop click
  let mouseDownOnBackdrop = false;
  overlay.addEventListener('mousedown', (e) => {
    mouseDownOnBackdrop = (e.target === overlay);
  });
  overlay.addEventListener('mouseup', (e) => {
    if (mouseDownOnBackdrop && e.target === overlay) {
      closeModal();
    }
    mouseDownOnBackdrop = false;
  });

  if (autoProcessQueue) {
    setTimeout(() => runQueueBatch(), 0);
  }
}
