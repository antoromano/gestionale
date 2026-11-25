// src/utils/device.js
// Quale interfaccia mostrare: quella per telefono o quella per computer.
// Di norma si decide dalla larghezza dello schermo; la scelta si può forzare a mano (Impostazioni / Profilo)
// e resta salvata su questo dispositivo.

export const UI_MODE_KEY = 'gestionale_ui_mode';
export const UI_MODES = ['auto', 'mobile', 'desktop'];
export const MOBILE_MAX_WIDTH = 767;

/** 'auto' | 'mobile' | 'desktop' (se il browser non permette di leggere la preferenza vale 'auto'). */
export function getUiMode() {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(UI_MODE_KEY) : null;
    return UI_MODES.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** true = interfaccia per telefono. */
export function shouldUseMobileUi() {
  const mode = getUiMode();
  if (mode === 'mobile') return true;
  if (mode === 'desktop') return false;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
}

/** Salva la preferenza e ricarica la pagina per applicarla. */
export function setUiMode(mode, { reload = true } = {}) {
  const value = UI_MODES.includes(mode) ? mode : 'auto';
  try {
    if (value === 'auto') localStorage.removeItem(UI_MODE_KEY);
    else localStorage.setItem(UI_MODE_KEY, value);
  } catch {
    /* archiviazione non disponibile: la scelta vale solo per questa visita */
  }
  if (reload && typeof location !== 'undefined') location.reload();
  return value;
}
