// src/utils/form-modal.js
// Finestra con modulo generata da una descrizione dei campi: evita di riscrivere lo stesso HTML per ogni
// piccola modifica (fatto, memoria, nodo, regola…). Testata fissa, corpo scorrevole, piede fisso.

import { escapeHtml } from './formatters.js';

/**
 * @param {object} cfg
 * @param {string} cfg.title
 * @param {string} [cfg.intro] testo di spiegazione sopra i campi
 * @param {Array<{id:string,label:string,type?:'text'|'textarea'|'select'|'number'|'checkbox'|'date',value?:any,options?:Array<{value:string,label:string}>,required?:boolean,placeholder?:string,rows?:number,hint?:string}>} cfg.fields
 * @param {string} [cfg.submitLabel]
 * @param {(values:object, close:()=>void) => (void|Promise<void>)} cfg.onSubmit lanciare un errore mostra il messaggio nella finestra
 * @param {{label:string, className?:string, onClick:(close:()=>void)=>void}} [cfg.extraAction] pulsante in più a sinistra (es. Elimina)
 * @param {boolean} [cfg.large]
 */
export function openFormModal({ title, intro = '', fields, submitLabel = 'Salva', onSubmit, extraAction = null, large = false }) {
  const wrap = document.createElement('div');
  const fieldHtml = fields.map(f => {
    const id = `fm-${f.id}`;
    const req = f.required ? 'required' : '';
    const ph = f.placeholder ? `placeholder="${escapeHtml(f.placeholder)}"` : '';
    const hint = f.hint ? `<div class="muted" style="font-size: 12px; margin-top: 4px;">${escapeHtml(f.hint)}</div>` : '';
    if (f.type === 'checkbox') {
      return `<div class="form-group"><label style="display: flex; gap: 8px; align-items: flex-start; cursor: pointer;">
        <input type="checkbox" id="${id}" ${f.value ? 'checked' : ''} style="margin-top: 3px; width: 16px; height: 16px;" />
        <span><span style="font-weight: 600;">${escapeHtml(f.label)}</span>${hint}</span></label></div>`;
    }
    let control;
    if (f.type === 'textarea') {
      control = `<textarea id="${id}" class="form-textarea" rows="${f.rows || 4}" ${req} ${ph}>${escapeHtml(f.value ?? '')}</textarea>`;
    } else if (f.type === 'select') {
      control = `<select id="${id}" class="form-select">${(f.options || []).map(o => `<option value="${escapeHtml(o.value)}" ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
    } else {
      control = `<input type="${f.type || 'text'}" id="${id}" class="form-input" value="${escapeHtml(f.value ?? '')}" ${req} ${ph} ${f.type === 'number' ? 'step="any"' : ''} />`;
    }
    return `<div class="form-group"><label class="form-label" for="${id}">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>${control}${hint}</div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-dialog ${large ? 'modal-lg' : ''}" style="${large ? '' : 'max-width: 560px;'}">
        <div class="modal-header">
          <div class="modal-title">${escapeHtml(title)}</div>
          <button type="button" class="btn btn-sm btn-secondary" data-fm="close" aria-label="Chiudi">✕</button>
        </div>
        <form>
          <div class="modal-body">
            ${intro ? `<p class="muted" style="margin-bottom: 12px;">${escapeHtml(intro)}</p>` : ''}
            ${fieldHtml}
            <div class="notice err" data-fm="error" style="display: none; margin: 8px 0 0;"></div>
          </div>
          <div class="modal-footer" style="justify-content: space-between;">
            <div>${extraAction ? `<button type="button" class="btn ${extraAction.className || 'btn-danger'}" data-fm="extra">${escapeHtml(extraAction.label)}</button>` : ''}</div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="btn btn-secondary" data-fm="close">Annulla</button>
              <button type="submit" class="btn btn-primary" data-fm="submit">${escapeHtml(submitLabel)}</button>
            </div>
          </div>
        </form>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const close = () => wrap.remove();
  wrap.querySelectorAll('[data-fm="close"]').forEach(b => b.addEventListener('click', close));
  wrap.querySelector('[data-fm="extra"]')?.addEventListener('click', () => extraAction.onClick(close));

  const errorBox = wrap.querySelector('[data-fm="error"]');
  const submitBtn = wrap.querySelector('[data-fm="submit"]');
  wrap.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = {};
    for (const f of fields) {
      const el = wrap.querySelector(`#fm-${f.id}`);
      values[f.id] = f.type === 'checkbox' ? el.checked : el.value;
    }
    errorBox.style.display = 'none';
    submitBtn.disabled = true;
    try {
      await onSubmit(values, close);
      close();
    } catch (err) {
      errorBox.textContent = err?.message || String(err);
      errorBox.style.display = 'block';
      submitBtn.disabled = false;
    }
  });

  wrap.querySelector('input:not([type=checkbox]), textarea, select')?.focus();
  return { close, root: wrap };
}
