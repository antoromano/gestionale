// src/modules/backup.js
// Backup & Ripristino Completo: Esportazione JSON con immagini embedded e Importazione sicura

import { store } from '../services/store.js';
import { formatDate } from '../utils/formatters.js';

export function exportFullBackup() {
  const exportData = {
    version: '1.0',
    exported_at: new Date().toISOString(),
    store: store.data,
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  const appName = store.getSettings().app_name || 'Gestionale';
  a.download = `Backup-${appName}-${formatDate(new Date()).replace(/\//g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function openImportModal(parentContainer, router, onRestored) {
  const modalContainer = parentContainer.querySelector('#backup-modal-container') || document.body;

  const modalHtml = `
    <div class="modal-overlay" id="import-backup-overlay">
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title">Ripristina Backup Gestionale</div>
          <button type="button" class="btn btn-sm btn-secondary" id="close-import-modal-btn">✕</button>
        </div>

        <div class="modal-body">
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">
            Seleziona un file JSON di backup precedentemente esportato. Il sistema controllerà il formato prima del ripristino.
          </p>

          <div class="form-group">
            <input type="file" id="backup-file-input" accept="application/json,.json" class="form-input" />
          </div>

          <div id="import-preview-box" style="display: none; padding: 14px; background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius); margin-top: 14px;">
            <div style="font-weight: 700; font-size: 13px; margin-bottom: 6px;">Anteprima Dati Rilevati nel Backup:</div>
            <div id="import-preview-content" style="font-size: 12px; color: var(--text-main); line-height: 1.6;"></div>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="cancel-import-btn">Annulla</button>
          <button type="button" class="btn btn-primary" id="confirm-restore-btn" disabled>Conferma e Ripristina</button>
        </div>
      </div>
    </div>
  `;

  const div = document.createElement('div');
  div.innerHTML = modalHtml;
  modalContainer.appendChild(div);

  const overlay = div.querySelector('#import-backup-overlay');
  const fileInput = div.querySelector('#backup-file-input');
  const previewBox = div.querySelector('#import-preview-box');
  const previewContent = div.querySelector('#import-preview-content');
  const confirmBtn = div.querySelector('#confirm-restore-btn');

  let parsedBackupData = null;

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result);
        if (!json.store || !json.version) {
          throw new Error('Formato backup non riconosciuto.');
        }

        parsedBackupData = json.store;
        const s = json.store;

        previewContent.innerHTML = `
          <div>Data esportazione: <strong>${json.exported_at ? new Date(json.exported_at).toLocaleString() : 'N.D.'}</strong></div>
          <div>Nome attività: <strong>${s.settings?.business_name || s.settings?.app_name || 'Standard'}</strong></div>
          <div>Clienti: <strong>${(s.clients || []).length}</strong></div>
          <div>Preventivi: <strong>${(s.quotes || []).length}</strong></div>
          <div>To-do: <strong>${(s.todos || []).length}</strong></div>
          <div>Appuntamenti / Shooting: <strong>${(s.appointments || []).length}</strong></div>
          <div>Spese: <strong>${(s.expenses || []).length}</strong></div>
        `;
        previewBox.style.display = 'block';
        confirmBtn.disabled = false;
      } catch (err) {
        alert('File di backup non valido o danneggiato: ' + err.message);
        confirmBtn.disabled = true;
        previewBox.style.display = 'none';
      }
    };
    reader.readAsText(file);
  });

  const closeModal = () => div.remove();
  div.querySelector('#close-import-modal-btn').addEventListener('click', closeModal);
  div.querySelector('#cancel-import-btn').addEventListener('click', closeModal);

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

  confirmBtn.addEventListener('click', () => {
    if (!parsedBackupData) return;
    if (confirm('Il ripristino sostituirà o integrerà i dati correnti. Procedere?')) {
      store.data = {
        ...store.data,
        ...parsedBackupData,
        settings: { ...store.data.settings, ...(parsedBackupData.settings || {}) },
      };
      store.save();
      alert('Ripristino completato con successo!');
      closeModal();
      if (onRestored) onRestored();
      else location.reload();
    }
  });
}
