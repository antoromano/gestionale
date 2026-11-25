// src/mobile/mobile-app.js
// Interfaccia per telefono: guscio (barra in basso con 5 schede + pulsante "+"), navigazione a pila con
// "Indietro" (anche il tasto indietro del telefono) e "Torna a Home" nelle sottoviste.
// Usa gli stessi dati e servizi dell'interfaccia per computer: cambia solo l'aspetto.

import './mobile.css';
import { store } from '../services/store.js';
import { cloud } from '../services/cloud.js';
import { mi, esc, isSheetOpen } from './ui.js';
import * as home from './views/m-home.js';
import * as add from './views/m-add.js';
import * as calendar from './views/m-calendar.js';
import * as tasks from './views/m-tasks.js';
import * as body from './views/m-body.js';
import * as ai from './views/m-ai.js';
import * as finances from './views/m-finances.js';
import * as notes from './views/m-notes.js';
import * as clients from './views/m-clients.js';
import * as search from './views/m-search.js';
import * as profile from './views/m-profile.js';

const TABS = [
  { route: 'home', label: 'Home', icon: 'home' },
  { route: 'calendar', label: 'Agenda', icon: 'calendar' },
  { route: 'tasks', label: 'To-do', icon: 'tasks' },
  { route: 'body', label: 'Corpo', icon: 'body' },
  { route: 'ai', label: 'AI', icon: 'ai' },
];

const VIEWS = {
  home, calendar, tasks, body, ai,
  add, finances, notes, clients, client: clients, search, profile,
};
const TAB_ROUTES = new Set(TABS.map(t => t.route));

class MobileApp {
  constructor(root, { session }) {
    this.root = root;
    this.session = session;
    this.stack = [{ route: 'home', params: {} }];
    this.cleanup = null;
    this.refreshTimer = null;

    root.innerHTML = `
      <div class="m-shell"><main id="m-view" tabindex="-1"></main></div>
      <nav class="m-bottom-nav" id="m-nav" aria-label="Menu principale">
        ${TABS.map(t => `
          <button type="button" class="m-tab" data-m-tab="${t.route}">
            ${mi(t.icon, 23)}<span>${esc(t.label)}</span>
          </button>`).join('')}
        <div class="m-fab-slot">
          <button type="button" class="m-fab" data-m-nav="add" aria-label="Aggiungi">${mi('plus', 26, 2.4)}</button>
        </div>
      </nav>
      <div class="m-return-home-bar" id="m-return" hidden>
        <button type="button" class="m-return-home" data-m-home>${mi('home', 20)}<span>Torna a Home</span></button>
      </div>`;
    this.view = root.querySelector('#m-view');
    this.nav = root.querySelector('#m-nav');
    this.returnBar = root.querySelector('#m-return');

    // Un solo ascoltatore per tutti i collegamenti delle schermate
    root.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-m-tab]');
      if (tab) { this.go(tab.dataset.mTab); return; }
      const nav = e.target.closest('[data-m-nav]');
      if (nav) {
        let params = {};
        try { params = nav.dataset.mParams ? JSON.parse(nav.dataset.mParams) : {}; } catch { params = {}; }
        this.navigate(nav.dataset.mNav, params);
        return;
      }
      if (e.target.closest('[data-m-back]')) { this.back(); return; }
      if (e.target.closest('[data-m-home]')) this.go('home');
    });

    // Tasto indietro del telefono / del browser
    window.addEventListener('popstate', (e) => {
      const stack = e.state?.mStack;
      this.stack = Array.isArray(stack) && stack.length ? stack : [{ route: 'home', params: {} }];
      this.render();
    });
    history.replaceState({ mStack: this.stack }, '');

    // Dati cambiati (altro dispositivo, Telegram, sincronizzazione): si ridisegna senza disturbare chi sta scrivendo
    store.subscribe(() => this.scheduleRefresh());
    cloud.subscribe(() => this.paintSync());

    this.render();
  }

  get current() {
    return this.stack[this.stack.length - 1];
  }

  /** Scheda principale: azzera la pila. */
  go(route, params = {}) {
    const r = VIEWS[route] ? route : 'home';
    if (this.stack.length === 1 && this.current.route === r && !Object.keys(params).length) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    this.stack = [{ route: r, params }];
    history.pushState({ mStack: this.stack }, '');
    this.render();
  }

  /** Sottovista (o scheda, che azzera la pila). */
  navigate(route, params = {}) {
    if (!VIEWS[route]) return;
    if (TAB_ROUTES.has(route)) { this.go(route, params); return; }
    this.stack = [...this.stack, { route, params }];
    history.pushState({ mStack: this.stack }, '');
    this.render();
  }

  back() {
    if (this.stack.length > 1) history.back();
    else this.go('home');
  }

  refresh() {
    const y = window.scrollY;
    this.render({ keepScroll: true });
    window.scrollTo(0, y);
  }

  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      const active = document.activeElement;
      const typing = active && this.view.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
      if (typing || isSheetOpen() || document.querySelector('.modal-overlay')) return;
      if (this.current.route === 'ai' || this.current.route === 'search') return; // conversazione e ricerca in corso
      this.refresh();
    }, 300);
  }

  render({ keepScroll = false } = {}) {
    const { route, params } = this.current;
    const isTab = TAB_ROUTES.has(route) && this.stack.length === 1;
    this.nav.hidden = !isTab;
    this.returnBar.hidden = isTab;
    this.nav.querySelectorAll('[data-m-tab]').forEach(b => {
      if (b.dataset.mTab === route) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });

    try { this.cleanup?.(); } catch { /* niente da pulire */ }
    this.cleanup = null;
    const ctx = {
      app: this,
      session: this.session,
      params,
      canGoBack: this.stack.length > 1,
      navigate: (r, p) => this.navigate(r, p),
      go: (r, p) => this.go(r, p),
      back: () => this.back(),
      refresh: () => this.refresh(),
      initial: (this.session?.user?.email || 'G').charAt(0).toUpperCase(),
    };
    const view = VIEWS[route] || home;
    const out = view.render(this.view, ctx, route);
    if (typeof out === 'function') this.cleanup = out;
    this.paintSync();
    if (!keepScroll) window.scrollTo(0, 0);
  }

  paintSync() {
    const s = cloud.getStatus();
    const state = s.state === 'stopped' ? 'offline' : s.state;
    this.root.querySelectorAll('[data-m-sync]').forEach(el => { el.dataset.state = state; });
  }
}

export function startMobileApp({ session } = {}) {
  let root = document.getElementById('mobile-app-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'mobile-app-root';
    document.body.insertBefore(root, document.body.firstChild);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#F8FAFC');
  const app = new MobileApp(root, { session });
  window.mobileApp = app;
  return app;
}
