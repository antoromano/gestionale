// src/main.js
// Application Bootstrap & Central Router

import { store } from './services/store.js';
import { renderDashboard } from './modules/dashboard.js';
import { renderBrain } from './modules/brain.js';
import { renderBody } from './modules/body.js';
import { renderTodos } from './modules/todos.js';
import { renderClients } from './modules/clients.js';
import { renderCalendar } from './modules/calendar.js';
import { renderQuotes, openQuoteEditorModal } from './modules/quotes.js';
import { renderFinances } from './modules/finances.js';
import { renderReports } from './modules/reports.js';
import { renderCatalog } from './modules/catalog.js';
import { renderSettings } from './modules/settings.js';
import { renderHelp } from './modules/help.js';
import { renderTrash } from './modules/trash.js';
import { openAiModal } from './modules/ai-assistant.js';
import { mountNoteQueueWidget } from './modules/note-queue-ui.js';
import { exportFullBackup, openImportModal } from './modules/backup.js';

// Espone i moduli globalmente per interazioni rapide
window._appModules = {
  quotes: { openQuoteEditorModal },
};

// Alias di rotte legacy: il vecchio modulo Spese vive ora in Finanze & Spese
const ROUTE_ALIASES = {
  expenses: 'finances',
};

class Router {
  constructor() {
    this.currentRoute = 'dashboard';
    this.routeParams = {};
    this.container = document.getElementById('app-main-content');
    this.pageTitle = document.getElementById('page-title-text');
    this.sidebar = document.getElementById('app-sidebar');

    this.routes = {
      dashboard: { title: 'Dashboard Operativa', render: renderDashboard },
      brain: { title: 'Second Brain • Architettura Cognitiva Tri-Layer', render: renderBrain },
      body: { title: 'Body • Diario Allenamenti, Biometria & Macro', render: renderBody },
      todos: { title: 'To-do', render: renderTodos },
      clients: { title: 'Clienti', render: renderClients },
      calendar: { title: 'Calendario & Agenda', render: renderCalendar },
      quotes: { title: 'Preventivi', render: renderQuotes },
      finances: { title: 'Finanze & Cash Flow', render: renderFinances },
      reports: { title: 'Report Finanziari', render: renderReports },
      catalog: { title: 'Catalogo Servizi', render: renderCatalog },
      settings: { title: 'Impostazioni', render: renderSettings },
      help: { title: 'Guida & FAQ', render: renderHelp },
      trash: { title: 'Cestino', render: renderTrash },
    };

    this.init();
  }

  init() {
    // Navigazione da click
    document.querySelectorAll('[data-route]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const route = el.getAttribute('data-route');
        this.navigate(route);
        // Chiude la sidebar su mobile se aperta
        if (this.sidebar) this.sidebar.classList.remove('open');
      });
    });

    // Mobile menu toggle
    const menuToggle = document.getElementById('mobile-menu-toggle');
    if (menuToggle) {
      menuToggle.addEventListener('click', () => {
        this.sidebar.classList.toggle('open');
      });
    }

    // AI Global buttons
    document.getElementById('sidebar-ai-btn')?.addEventListener('click', () => openAiModal({ onSaved: () => this.refresh() }));
    document.getElementById('top-ai-btn')?.addEventListener('click', () => openAiModal({ onSaved: () => this.refresh() }));
    document.getElementById('bottom-nav-ai-btn')?.addEventListener('click', () => openAiModal({ onSaved: () => this.refresh() }));

    // Coda Appunti del Giorno: box flottante sempre disponibile; "Elabora Coda" apre l'assistente e avvia 1 sola chiamata
    mountNoteQueueWidget({ onProcess: () => openAiModal({ autoProcessQueue: true, onSaved: () => this.refresh() }) });

    // Backup quick actions
    document.getElementById('quick-backup-export')?.addEventListener('click', () => exportFullBackup());
    document.getElementById('quick-backup-import')?.addEventListener('click', () => openImportModal(document.body, this, () => this.refresh()));

    // Gestione tema iniziale
    this.applyTheme();

    // Sottoscrizione allo store per badge e tema
    store.subscribe(() => {
      this.updateBadges();
      this.applyTheme();
    });

    this.updateBadges();
    this.navigate('dashboard');
  }

  navigate(route, params = {}) {
    route = ROUTE_ALIASES[route] || route;
    if (!this.routes[route]) route = 'dashboard';
    this.currentRoute = route;
    this.routeParams = params;

    // Aggiorna titolo pagina
    if (this.pageTitle) {
      this.pageTitle.textContent = this.routes[route].title;
    }

    // Aggiorna stato attivo nella navigazione
    document.querySelectorAll('[data-route]').forEach(el => {
      if (el.getAttribute('data-route') === route) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    // Mostra/Nasconde menu toggle su mobile per sezioni oltre le 5 principali
    const menuToggle = document.getElementById('mobile-menu-toggle');
    if (menuToggle) {
      menuToggle.style.display = (window.innerWidth < 1024) ? 'inline-flex' : 'none';
    }

    // Renderizza la vista attiva
    this.routes[route].render(this.container, this, params);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  refresh() {
    this.navigate(this.currentRoute, this.routeParams);
  }

  applyTheme() {
    const settings = store.getSettings();
    document.documentElement.style.setProperty('--primary', settings.primary_color || '#1e293b');
    document.documentElement.style.setProperty('--accent', settings.accent_color || '#2563eb');

    const appNameEl = document.getElementById('sidebar-app-name');
    if (appNameEl) appNameEl.textContent = settings.app_name || 'Gestionale';
    document.title = settings.app_name || 'Gestionale';

    const logoContainer = document.getElementById('sidebar-logo-container');
    if (logoContainer) {
      if (settings.logo_url) {
        logoContainer.innerHTML = `<img src="${settings.logo_url}" class="sidebar-logo" alt="Logo" />`;
      } else {
        const initial = (settings.app_name || 'G').charAt(0).toUpperCase();
        logoContainer.innerHTML = `<div class="sidebar-logo-placeholder">${initial}</div>`;
      }
    }
  }

  updateBadges() {
    // Badge To-do aperti
    const openTodosCount = store.getAll('todos').filter(t => !t.is_completed).length;
    const todosBadge = document.getElementById('nav-todos-badge');
    if (todosBadge) {
      if (openTodosCount > 0) {
        todosBadge.textContent = openTodosCount;
        todosBadge.style.display = 'inline-block';
      } else {
        todosBadge.style.display = 'none';
      }
    }

    // Badge Cestino
    const trashCount = store.getAllTrash().length;
    const trashBadge = document.getElementById('nav-trash-badge');
    if (trashBadge) {
      if (trashCount > 0) {
        trashBadge.textContent = trashCount;
        trashBadge.style.display = 'inline-block';
      } else {
        trashBadge.style.display = 'none';
      }
    }

    // Badge Second Brain (Fatti attivi)
    const activeFactsCount = store.getActiveFacts().length;
    const brainBadge = document.getElementById('nav-brain-badge');
    if (brainBadge) {
      if (activeFactsCount > 0) {
        brainBadge.textContent = activeFactsCount;
        brainBadge.style.display = 'inline-block';
      } else {
        brainBadge.style.display = 'none';
      }
    }
  }
}

// Inizializza l'applicazione al DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  window.appRouter = new Router();

  // Registrazione Service Worker per PWA
  if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        console.log('PWA Service Worker registrato con successo, scope:', reg.scope);
      }).catch((err) => {
        console.warn('Registrazione Service Worker fallita:', err);
      });
    });
  }
});
