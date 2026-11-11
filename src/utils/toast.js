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
    el.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 260);
  }, durationMs);
  return el;
}
