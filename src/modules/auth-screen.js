// src/modules/auth-screen.js
// Schermata di accesso (utente unico). Si mostra prima di caricare qualunque dato.

import { signIn, signUp } from '../services/auth.js';
import { escapeHtml } from '../utils/formatters.js';

export function showAuthScreen({ onSuccess }) {
  let root = document.getElementById('auth-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'auth-root';
    document.body.appendChild(root);
  }
  let mode = 'login';

  const render = (error = '') => {
    const isLogin = mode === 'login';
    root.innerHTML = `
      <div class="auth-screen">
        <form class="auth-card" id="auth-form" novalidate>
          <div class="auth-logo">G</div>
          <h1 class="auth-title">${isLogin ? 'Bentornato' : 'Crea il tuo account'}</h1>
          <p class="auth-sub">${isLogin ? 'Accedi per vedere i tuoi dati su ogni dispositivo.' : 'Serve una sola volta. Dopo la prima registrazione l’app è chiusa ad altri utenti.'}</p>

          <label class="auth-label" for="auth-email">Email</label>
          <input id="auth-email" class="auth-input" type="email" autocomplete="email" required placeholder="nome@esempio.it" />

          <label class="auth-label" for="auth-password">Password</label>
          <input id="auth-password" class="auth-input" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required minlength="6" placeholder="Almeno 6 caratteri" />

          <div class="auth-error" role="alert" ${error ? '' : 'hidden'}>${escapeHtml(error)}</div>

          <button class="auth-submit" type="submit" id="auth-submit">${isLogin ? 'Accedi' : 'Crea account e accedi'}</button>
          <button class="auth-switch" type="button" id="auth-switch">${isLogin ? 'Prima volta? Crea il tuo account' : 'Hai già un account? Accedi'}</button>
        </form>
      </div>`;

    const form = root.querySelector('#auth-form');
    root.querySelector('#auth-switch').addEventListener('click', () => {
      mode = isLogin ? 'register' : 'login';
      render();
    });
    root.querySelector('#auth-email').focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = root.querySelector('#auth-email').value;
      const password = root.querySelector('#auth-password').value;
      if (!email || !password) return render('Inserisci email e password.');

      const btn = root.querySelector('#auth-submit');
      btn.disabled = true;
      btn.textContent = 'Un attimo…';
      try {
        const session = isLogin ? await signIn(email, password) : await signUp(email, password);
        onSuccess(session);
      } catch (err) {
        render(err.message);
        root.querySelector('#auth-email').value = email;
      }
    });
  };

  render();
}

export function hideAuthScreen() {
  document.getElementById('auth-root')?.remove();
}
