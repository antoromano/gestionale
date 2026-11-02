// src/modules/ai-assistant.js
// Modal Assistente IA: Input multimodale (Testo, Foto, Audio/Vocale), Riconoscimento intelligente, Disambiguazione e Conferma

import { store } from '../services/store.js';
import { processAiPrompt } from '../services/ai.js';
import { formatCurrency, formatDateTime } from '../utils/formatters.js';

export function openAiModal(options = {}) {
  const { preselectedClientId = null, onSaved = null } = options;
  const clients = store.getAll('clients');

  const preselectedClient = preselectedClientId ? store.getById('clients', preselectedClientId) : null;
  const preselectedName = preselectedClient ? (preselectedClient.company_name || `${preselectedClient.first_name} ${preselectedClient.last_name}`) : '';

  const modalHtml = `
    <div class="modal-overlay" id="ai-assistant-overlay">
      <div class="modal-dialog modal-lg" style="max-height: 92vh;">
        <div class="modal-header" style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color: #ffffff;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 20px;">✨</span>
            <div>
              <div class="modal-title" style="color: #ffffff;">Assistente Operativo IA</div>
              <div style="font-size: 11px; color: #94a3b8;">
                ${preselectedName ? `Contesto cliente attivo: <strong>${preselectedName}</strong>` : 'Analizza testo, foto o note vocali ed estrae To-do e Appuntamenti'}
              </div>
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-secondary" id="close-ai-modal-btn" style="background: rgba(255,255,255,0.1); color: #fff; border: none;">✕</button>
        </div>

        <div class="modal-body" style="padding: 20px; overflow-y: auto;">
          <!-- 1. AREA INPUT RICHIESTA -->
          <div id="ai-input-section">
            <div class="form-group">
              <label class="form-label">Descrivi cosa devi fare o allega note:</label>
              <textarea
                id="ai-text-input"
                class="form-textarea"
                rows="4"
                placeholder="Es: Devo attivare un abbonamento per lavorare, fare le foto prodotti per ${preselectedName || 'Cliente A'} e preparare i contenuti per Cliente B..."
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

            <div style="display: flex; justify-content: flex-end;">
              <button type="button" id="ai-process-btn" class="btn btn-ai" style="padding: 10px 20px;">
                ⚡ Elabora con l'IA
              </button>
            </div>
          </div>

          <!-- 2. STATO CARICAMENTO ED ELABORAZIONE -->
          <div id="ai-loading-section" style="display: none; text-align: center; padding: 40px;">
            <div style="font-size: 32px; margin-bottom: 12px; animation: pulse 1.5s infinite;">✨</div>
            <div style="font-size: 15px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">Analisi in corso...</div>
            <div style="font-size: 12px; color: var(--text-muted);">Estrazione to-do, appuntamenti e corrispondenze clienti</div>
          </div>

          <!-- 3. AREA ANTEPRIMA PROPOSTE & CONFERMA -->
          <div id="ai-results-section" style="display: none;">
            <div style="padding: 12px; background: #eff6ff; border-left: 4px solid var(--accent); border-radius: var(--radius); margin-bottom: 16px;">
              <div style="font-weight: 700; font-size: 13px; color: #1e40af;" id="ai-summary-text"></div>
              <div style="font-size: 11px; color: #3b82f6; margin-top: 2px;">
                Controlla o modifica le proposte prima di salvare. Nessun record verrà creato senza la tua conferma.
              </div>
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
                <span>📅 Appuntamenti & Shooting Proposti</span>
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

  const overlay = div.querySelector('#ai-assistant-overlay');
  const inputSection = div.querySelector('#ai-input-section');
  const loadingSection = div.querySelector('#ai-loading-section');
  const resultsSection = div.querySelector('#ai-results-section');
  const retryBtn = div.querySelector('#ai-retry-btn');
  const confirmBtn = div.querySelector('#ai-confirm-save-btn');
  const textInput = div.querySelector('#ai-text-input');

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

  // Elaborazione Richiesta
  div.querySelector('#ai-process-btn').addEventListener('click', async () => {
    const text = textInput.value.trim();
    if (!text && !attachedAudioBase64 && !attachedImageBase64) {
      alert('Inserisci un testo, carica una foto o registra una nota vocale.');
      return;
    }

    inputSection.style.display = 'none';
    loadingSection.style.display = 'block';

    try {
      const result = await processAiPrompt({
        prompt: text,
        imageBase64: attachedImageBase64,
        imageMimeType: attachedImageMime,
        audioBase64: attachedAudioBase64,
        audioMimeType: attachedAudioMime,
        preselectedClientId,
      });

      currentParsedResult = result;
      displayResults(result);
    } catch (err) {
      alert('Errore durante l\'elaborazione dell\'IA: ' + err.message);
      inputSection.style.display = 'block';
      loadingSection.style.display = 'none';
    }
  });

  function displayResults(data) {
    loadingSection.style.display = 'none';
    resultsSection.style.display = 'block';
    retryBtn.style.display = 'inline-block';
    confirmBtn.style.display = 'inline-block';

    div.querySelector('#ai-summary-text').textContent = data.summary || 'Proposte estratte con successo';
    div.querySelector('#ai-todos-count').textContent = (data.todos || []).length;
    div.querySelector('#ai-appts-count').textContent = (data.appointments || []).length;

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

  // Riprova
  retryBtn.addEventListener('click', () => {
    resultsSection.style.display = 'none';
    retryBtn.style.display = 'none';
    confirmBtn.style.display = 'none';
    inputSection.style.display = 'block';
  });

  // Conferma e Salva nel gestionale
  confirmBtn.addEventListener('click', () => {
    if (!currentParsedResult) return;

    let createdTodosCount = 0;
    let createdApptsCount = 0;

    // Salva to-do confermati
    div.querySelectorAll('.ai-include-todo:checked').forEach(cb => {
      const idx = cb.dataset.idx;
      const title = div.querySelector(`.ai-todo-title[data-idx="${idx}"]`).value.trim();
      const clientId = div.querySelector(`.ai-todo-client[data-idx="${idx}"]`).value || null;
      const due = div.querySelector(`.ai-todo-due[data-idx="${idx}"]`).value || null;
      const comp = parseFloat(div.querySelector(`.ai-todo-comp[data-idx="${idx}"]`).value) || 0;

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

    // Salva appuntamenti confermati
    div.querySelectorAll('.ai-include-appt:checked').forEach(cb => {
      const idx = cb.dataset.idx;
      const title = div.querySelector(`.ai-appt-title[data-idx="${idx}"]`).value.trim();
      const clientId = div.querySelector(`.ai-appt-client[data-idx="${idx}"]`).value || null;
      const start = div.querySelector(`.ai-appt-start[data-idx="${idx}"]`).value;
      const loc = div.querySelector(`.ai-appt-loc[data-idx="${idx}"]`).value.trim();
      const rawAppt = currentParsedResult.appointments[idx];

      if (title && start) {
        store.create('appointments', {
          title,
          client_id: clientId,
          start_time: start,
          end_time: rawAppt?.end_time || null,
          location: loc,
          is_all_day: Boolean(rawAppt?.is_all_day),
          is_shooting: Boolean(rawAppt?.is_shooting),
          shooting_type: rawAppt?.shooting_type || '',
          compensation_amount: rawAppt?.compensation_amount || 0,
        });
        createdApptsCount++;
      }
    });

    alert(`Salvataggio completato: creati ${createdTodosCount} To-do e ${createdApptsCount} Appuntamenti/Shooting.`);
    div.remove();
    if (onSaved) onSaved();
  });

  const closeModal = () => div.remove();
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
}
