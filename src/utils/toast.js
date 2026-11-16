// src/utils/toast.js
// Notifiche toast leggere (usa il contenitore #toast-container di index.html e gli stili .toast)

export function showToast(message, type = 'success', durationMs = 3600) {
  if (typeof document === 'undefined') return null;
  const container = document.getElementById('toast-container');
  if (!container) return null;

  // al massimo 3 toast visibili: i più vecchi lasciano il posto ai nuovi
  while (container.children.length >= 3) container.firstElementChild.remove();

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  container.appendChild(el);

  setTimeout(() => {
    if (el.dataset.keep === '1') return;
    el.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 260);
  }, durationMs);
  return el;
}

/**
 * Toast con un pulsante (es. "Annulla"): si salva subito e si può tornare indietro per qualche secondo,
 * invece di chiedere una conferma prima di ogni salvataggio.
 */
export function showToastWithAction(message, actionLabel, onAction, { type = 'success', durationMs = 5000 } = {}) {
  if (typeof document === 'undefined') return null;
  const container = document.getElementById('toast-container');
  if (!container) return null;
  while (container.children.length >= 3) container.firstElementChild.remove();

  const el = document.createElement('div');
  el.className = `toast ${type} toast-action`;
  el.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.textContent = message;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'toast-undo';
  btn.textContent = actionLabel;

  const bar = document.createElement('span');
  bar.className = 'toast-bar';
  bar.style.animationDuration = `${durationMs}ms`;

  el.append(text, btn, bar);
  container.appendChild(el);

  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    el.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 260);
  };
  const timer = setTimeout(close, durationMs);

  btn.addEventListener('click', () => {
    clearTimeout(timer);
    close();
    try {
      onAction?.();
    } catch (err) {
      showToast(`Non sono riuscito ad annullare: ${err.message}`, 'error', 5000);
    }
  });

  return { el, close };
}
