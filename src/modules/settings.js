// src/modules/settings.js
// Gestione Impostazioni: Personalizzazione Brand, Dati Fiscali, Condizioni, Integrazioni e Dati Demo

import { store, defaultSettings } from '../services/store.js';
import { aiDiagnose } from '../services/ai-client.js';
import {
  getTelegramIntegrationStatus,
  sendTelegramTestMessage,
  registerTelegramWebhook,
} from '../services/telegram.js';

export function renderSettings(container, router) {
  const settings = store.getSettings();
  const tgStatus = getTelegramIntegrationStatus();

  container.innerHTML = `
    <div style="max-width: 900px; margin: 0 auto;">
      <!-- Messaggio di Salvataggio -->
      <div id="settings-alert" style="display: none; padding: 12px 16px; border-radius: var(--radius); margin-bottom: 20px;" class="toast success">
        Impostazioni salvate con successo!
      </div>

      <form id="settings-form">
        <!-- 1. IDENTITÀ APP & BRANDING -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Identità & Personalizzazione Grafica</div>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 2;">
              <label class="form-label">Nome dell'Applicazione *</label>
              <input type="text" id="set-app-name" class="form-input" value="${settings.app_name || 'Gestionale'}" required />
            </div>

            <div class="form-group" style="flex: 1;">
              <label class="form-label">Colore Primario</label>
              <div style="display: flex; gap: 8px; align-items: center;">
                <input type="color" id="set-primary-color" style="width: 44px; height: 38px; border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; padding: 2px;" value="${settings.primary_color || '#1e293b'}" />
                <input type="text" id="set-primary-color-text" class="form-input" value="${settings.primary_color || '#1e293b'}" style="font-family: monospace;" />
              </div>
            </div>

            <div class="form-group" style="flex: 1;">
              <label class="form-label">Colore Accento</label>
              <div style="display: flex; gap: 8px; align-items: center;">
                <input type="color" id="set-accent-color" style="width: 44px; height: 38px; border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; padding: 2px;" value="${settings.accent_color || '#2563eb'}" />
                <input type="text" id="set-accent-color-text" class="form-input" value="${settings.accent_color || '#2563eb'}" style="font-family: monospace;" />
              </div>
            </div>
          </div>

          <!-- Caricamento Logo -->
          <div class="form-row" style="align-items: center; margin-top: 10px;">
            <div style="width: 80px; height: 80px; border: 2px dashed var(--border); border-radius: var(--radius); display: flex; align-items: center; justify-content: center; background: #f8fafc; overflow: hidden;" id="logo-preview-box">
              ${settings.logo_url ? `<img src="${settings.logo_url}" style="width: 100%; height: 100%; object-fit: contain;" />` : `<span style="font-size: 24px; color: var(--text-muted);">🏢</span>`}
            </div>
            <div style="flex: 1;">
              <label class="form-label">Logo Attività (usato su desktop, mobile e PDF)</label>
              <input type="file" id="set-logo-file" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="form-input" />
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Formati consigliati: PNG trasparente o SVG. Max 5 MB.</div>
            </div>
            ${settings.logo_url ? `
              <button type="button" id="remove-logo-btn" class="btn btn-sm btn-danger">Rimuovi Logo</button>
            ` : ''}
          </div>
        </div>

        <!-- 2. DATI ATTIVITÀ & FISCALI PER I PREVENTIVI -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Intestazione & Dati Fiscali Emittente</div>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 2;">
              <label class="form-label">Nome Attività / Studio Professionale</label>
              <input type="text" id="set-business-name" class="form-input" value="${settings.business_name || ''}" placeholder="es. Studio Creativo Rossi" />
            </div>
            <div class="form-group" style="flex: 2;">
              <label class="form-label">Titolare / Professionista</label>
              <input type="text" id="set-owner-name" class="form-input" value="${settings.owner_name || ''}" placeholder="es. Mario Rossi" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 2;">
              <label class="form-label">Indirizzo</label>
              <input type="text" id="set-address" class="form-input" value="${settings.address || ''}" placeholder="Via Dante 15" />
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">CAP</label>
              <input type="text" id="set-postal-code" class="form-input" value="${settings.postal_code || ''}" placeholder="20121" />
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Città</label>
              <input type="text" id="set-city" class="form-input" value="${settings.city || ''}" placeholder="Milano" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Partita IVA</label>
              <input type="text" id="set-vat-number" class="form-input" value="${settings.vat_number || ''}" placeholder="IT12345678901" />
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Codice Fiscale</label>
              <input type="text" id="set-fiscal-code" class="form-input" value="${settings.fiscal_code || ''}" placeholder="RSSMRA80A01H501U" />
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">PEC</label>
              <input type="email" id="set-pec" class="form-input" value="${settings.pec || ''}" placeholder="studio@pec.it" />
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Codice SDI</label>
              <input type="text" id="set-sdi" class="form-input" value="${settings.sdi_code || ''}" placeholder="0000000" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Email di Contatto</label>
              <input type="email" id="set-email" class="form-input" value="${settings.email || ''}" placeholder="contatto@studio.it" />
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Telefono</label>
              <input type="tel" id="set-phone" class="form-input" value="${settings.phone || ''}" placeholder="+39 02 1234567" />
            </div>
          </div>
        </div>

        <!-- 3. LOCALIZZAZIONE & PARAMETRI ECONOMICI -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Parametri Economici & Fiscali Predefiniti</div>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Valuta</label>
              <select id="set-currency" class="form-select">
                <option value="EUR" ${settings.currency === 'EUR' ? 'selected' : ''}>Euro (€)</option>
                <option value="USD" ${settings.currency === 'USD' ? 'selected' : ''}>Dollaro ($)</option>
                <option value="CHF" ${settings.currency === 'CHF' ? 'selected' : ''}>Franco Svizzero (CHF)</option>
                <option value="GBP" ${settings.currency === 'GBP' ? 'selected' : ''}>Sterlina (£)</option>
              </select>
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Fuso Orario</label>
              <input type="text" id="set-timezone" class="form-input" value="${settings.timezone || 'Europe/Rome'}" />
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Validità Predefinita Preventivi (Giorni)</label>
              <input type="number" id="set-validity-days" class="form-input" value="${settings.quote_default_validity_days || 30}" />
            </div>
          </div>

          <div class="form-row" style="align-items: center; margin-top: 10px;">
            <div style="flex: 1.5;">
              <label style="display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer;">
                <input type="checkbox" id="set-levy-enabled" ${settings.fiscal_levy_enabled ? 'checked' : ''} />
                Abilita Oneri / Cassa Previdenziale di default
              </label>
            </div>
            <div class="form-group" style="flex: 2; margin-bottom: 0;">
              <label class="form-label">Dicitura Oneri</label>
              <input type="text" id="set-levy-name" class="form-input" value="${settings.fiscal_levy_name || 'Cassa Previdenziale'}" />
            </div>
            <div class="form-group" style="flex: 1; margin-bottom: 0;">
              <label class="form-label">Aliquota Oneri (%)</label>
              <input type="number" id="set-levy-percent" class="form-input" step="0.1" value="${settings.fiscal_levy_percent || 4.0}" />
            </div>
          </div>

          <div class="form-row" style="align-items: center; margin-top: 12px;">
            <div style="flex: 1.5;">
              <label style="display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer;">
                <input type="checkbox" id="set-vat-enabled" ${settings.vat_enabled ? 'checked' : ''} />
                Abilita IVA di default
              </label>
            </div>
            <div class="form-group" style="flex: 1; margin-bottom: 0;">
              <label class="form-label">Aliquota IVA Standard (%)</label>
              <input type="number" id="set-vat-percent" class="form-input" step="0.1" value="${settings.vat_percent || 22.0}" />
            </div>
          </div>

          <div class="form-group" style="margin-top: 14px;">
            <label class="form-label">Condizioni Contrattuali Predefinite (PDF)</label>
            <textarea id="set-default-conditions" class="form-textarea" rows="2">${settings.quote_default_conditions || ''}</textarea>
          </div>
        </div>

        <!-- 4. INTEGRAZIONI ESTERNE (SUPABASE, GEMINI, GOOGLE, NOTION) -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Integrazioni Servizi Cloud & IA</div>
          </div>

          <div class="form-group">
            <label class="form-label">Intelligenza artificiale (Gemini)</label>
            <div class="muted" style="margin-bottom: 8px;">
              La chiave vera sta al sicuro sul server (Supabase), non qui. Premi il pulsante per controllare se l'IA risponde davvero.
            </div>
            <button type="button" id="ai-diagnose-btn" class="btn btn-secondary">Verifica IA</button>
            <div id="ai-diagnose-result" style="margin-top: 10px;"></div>
            <details class="ai-options" style="margin-top: 12px;">
              <summary>Uso una mia chiave personale (solo su questo dispositivo)</summary>
              <div class="ai-options-body" style="display: block;">
                <input type="password" id="set-gemini-key" class="form-input" value="${settings.gemini_api_key || ''}" placeholder="AIzaSy..." autocomplete="off" />
                <div class="muted" style="margin-top: 4px;">Serve solo se la chiave sul server non c'è. Non viene mai sincronizzata né salvata nel cloud.</div>
              </div>
            </details>
          </div>

          <div class="form-group" style="max-width: 280px;">
            <label class="form-label">Tariffa oraria sviluppo (€/h) — usata dall'Avvocato del Diavolo</label>
            <input type="number" id="set-dev-hourly-rate" class="form-input" min="1" step="1" value="${settings.dev_hourly_rate || 50}" />
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
              Serve a confrontare il profitto orario reale delle rivendite e le ore implicite dei preventivi con la tua tariffa.
            </div>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 2;">
              <label class="form-label">Supabase URL Progetto (Opzionale)</label>
              <input type="text" id="set-supabase-url" class="form-input" value="${settings.supabase_url || ''}" placeholder="https://xyzcompany.supabase.co" />
            </div>
            <div class="form-group" style="flex: 2;">
              <label class="form-label">Supabase Anon Key (Opzionale)</label>
              <input type="password" id="set-supabase-key" class="form-input" value="${settings.supabase_anon_key || ''}" placeholder="eyJhbG..." />
            </div>
          </div>

          <!-- Stato Connettori Google Calendar e Notion -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 10px;">
            <div style="padding: 12px; background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-weight: 700;">Google Calendar (2-Way)</span>
                <span class="badge ${settings.google_calendar_connected ? 'badge-green' : 'badge-gray'}">
                  ${settings.google_calendar_connected ? 'Collegato' : 'Da collegare'}
                </span>
              </div>
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">
                Gestito tramite Edge Function sicura e OAuth. Risolve conflitti con timestamp prioritario.
              </div>
              <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
                <input type="checkbox" id="set-gcal-connected" ${settings.google_calendar_connected ? 'checked' : ''} />
                Abilita sincronizzazione Google Calendar
              </label>
            </div>

            <div style="padding: 12px; background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-weight: 700;">Notion To-do Connector</span>
                <span class="badge ${settings.notion_connected ? 'badge-green' : 'badge-gray'}">
                  ${settings.notion_connected ? 'Collegato' : 'Da collegare'}
                </span>
              </div>
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">
                Sincronizza to-do con database Notion (creazione, scadenze e completamento).
              </div>
              <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
                <input type="checkbox" id="set-notion-connected" ${settings.notion_connected ? 'checked' : ''} />
                Abilita sincronizzazione Notion
              </label>
            </div>

            <!-- GitHub Integration -->
            <div style="padding: 12px; background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius); margin-top: 10px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-weight: 700;">GitHub Integration (Commits & PRs)</span>
                <span class="badge ${settings.github_token ? 'badge-green' : 'badge-blue'}">
                  ${settings.github_token ? 'Token Configurato' : 'Accesso Pubblico Diretto'}
                </span>
              </div>
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">
                I repository pubblici funzionano automaticamente senza credenziali. Inserisci un Personal Access Token GitHub (classic) con permesso <code>repo</code> solo se devi leggere repository privati.
              </div>
              <input type="password" id="set-github-token" class="form-input" value="${settings.github_token || ''}" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx (facoltativo)" />
            </div>
          </div>
        </div>

        <!-- 4B. INTEGRAZIONE TELEGRAM BOT (MULTIMODAL + 4° LIVELLO DI PROTEZIONE) -->
        <div class="card" id="telegram-integration-card">
          <div class="card-header">
            <div>
              <div class="card-title">🤖 Integrazione Telegram Bot (Second Brain & Body Proattivo)</div>
              <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 2px;">
                Note vocali (.ogg), foto, log rapido Body (<code>20(10,10,10,10)</code>) e 4° Livello di Protezione con Inline Keyboard per nuovi macro-domini
              </div>
            </div>
            <span id="telegram-status-badge" class="badge ${tgStatus.isConfigured ? 'badge-green' : 'badge-gray'}">
              ${tgStatus.isConfigured ? '● Attivo e Connesso' : 'Da configurare'}
            </span>
          </div>

          <div class="form-group">
            <label class="form-label">Webhook URL Supabase Edge Function (da impostare su Telegram)</label>
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <input
                type="text"
                id="telegram-webhook-url-display"
                class="form-input mono"
                readonly
                value="${tgStatus.webhookUrl}"
                style="background: #fafafa; color: var(--text-main); flex: 1;"
              />
              <button type="button" id="copy-tg-webhook-btn" class="btn btn-sm btn-secondary">
                Copia URL
              </button>
              <button type="button" id="register-tg-webhook-btn" class="btn btn-sm btn-secondary" title="Chiama setWebhook sulle API di Telegram">
                🔗 Collega Webhook
              </button>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 1.5;">
              <label class="form-label">TELEGRAM_BOT_TOKEN (da @BotFather o Supabase Secrets)</label>
              <input
                type="password"
                id="set-telegram-bot-token"
                class="form-input mono"
                value="${settings.telegram_bot_token || ''}"
                placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
              />
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">TELEGRAM_ALLOWED_USER_ID (Tuo ID Telegram)</label>
              <input
                type="text"
                id="set-telegram-user-id"
                class="form-input mono"
                value="${settings.telegram_allowed_user_id || ''}"
                placeholder="es. 123456789"
              />
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; padding-top: 10px; border-top: 1px solid var(--border);">
            <div style="font-size: 11px; color: var(--text-muted);">
              Cron Proattività: <code class="mono">?action=morning_brief</code> (08:30) • <code class="mono">?action=evening_check</code> (21:30)
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span id="telegram-test-feedback" style="font-size: 12px; font-weight: 600;"></span>
              <button type="button" id="telegram-test-msg-btn" class="btn btn-sm btn-primary">
                ✈️ Invia messaggio di test
              </button>
            </div>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-bottom: 30px;">
          <button type="submit" class="btn btn-primary" style="padding: 10px 24px; font-size: 14px;">
            💾 Salva Impostazioni
          </button>
        </div>
      </form>

      <!-- 5. GESTIONE DATI: DEMO E RESET -->
      <div class="card" style="border-color: rgba(220, 38, 38, 0.2);">
        <div class="card-header">
          <div class="card-title">Gestione Dati & Manutenzione Installazione</div>
        </div>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">
          I dati sono nel tuo cloud (Supabase) e si sincronizzano su tutti i dispositivi. Puoi azzerare tutto per ricominciare da zero: l'operazione cancella i dati anche dal cloud.
        </p>
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button type="button" id="reset-all-data-btn" class="btn btn-danger">
            ⚠️ Azzera Completamente Tutti i Dati
          </button>
        </div>
      </div>
    </div>
  `;

  // Color picker sync
  const pColor = container.querySelector('#set-primary-color');
  const pColorText = container.querySelector('#set-primary-color-text');
  pColor.addEventListener('input', () => { pColorText.value = pColor.value; });
  pColorText.addEventListener('input', () => { pColor.value = pColorText.value; });

  const aColor = container.querySelector('#set-accent-color');
  const aColorText = container.querySelector('#set-accent-color-text');
  aColor.addEventListener('input', () => { aColorText.value = aColor.value; });
  aColorText.addEventListener('input', () => { aColor.value = aColorText.value; });

  // Upload Logo
  let newLogoDataUrl = settings.logo_url || '';
  const logoInput = container.querySelector('#set-logo-file');
  const logoBox = container.querySelector('#logo-preview-box');

  logoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('Il file del logo supera i 5 MB consentiti.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      newLogoDataUrl = reader.result;
      logoBox.innerHTML = `<img src="${newLogoDataUrl}" style="width: 100%; height: 100%; object-fit: contain;" />`;
    };
    reader.readAsDataURL(file);
  });

  // Rimuovi logo
  container.querySelector('#remove-logo-btn')?.addEventListener('click', () => {
    newLogoDataUrl = '';
    logoBox.innerHTML = `<span style="font-size: 24px; color: var(--text-muted);">🏢</span>`;
  });

  // Salva Form Impostazioni
  container.querySelector('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();

    const updated = {
      app_name: container.querySelector('#set-app-name').value.trim() || 'Gestionale',
      primary_color: pColor.value,
      accent_color: aColor.value,
      logo_url: newLogoDataUrl,
      business_name: container.querySelector('#set-business-name').value.trim(),
      owner_name: container.querySelector('#set-owner-name').value.trim(),
      address: container.querySelector('#set-address').value.trim(),
      postal_code: container.querySelector('#set-postal-code').value.trim(),
      city: container.querySelector('#set-city').value.trim(),
      vat_number: container.querySelector('#set-vat-number').value.trim(),
      fiscal_code: container.querySelector('#set-fiscal-code').value.trim(),
      pec: container.querySelector('#set-pec').value.trim(),
      sdi_code: container.querySelector('#set-sdi').value.trim(),
      email: container.querySelector('#set-email').value.trim(),
      phone: container.querySelector('#set-phone').value.trim(),
      currency: container.querySelector('#set-currency').value,
      timezone: container.querySelector('#set-timezone').value.trim(),
      quote_default_validity_days: parseInt(container.querySelector('#set-validity-days').value, 10) || 30,
      fiscal_levy_enabled: container.querySelector('#set-levy-enabled').checked,
      fiscal_levy_name: container.querySelector('#set-levy-name').value.trim() || 'Cassa Previdenziale',
      fiscal_levy_percent: parseFloat(container.querySelector('#set-levy-percent').value) || 0,
      vat_enabled: container.querySelector('#set-vat-enabled').checked,
      vat_percent: parseFloat(container.querySelector('#set-vat-percent').value) || 0,
      quote_default_conditions: container.querySelector('#set-default-conditions').value.trim(),
      gemini_api_key: container.querySelector('#set-gemini-key').value.trim(),
      dev_hourly_rate: parseFloat(container.querySelector('#set-dev-hourly-rate').value) || 50,
      supabase_url: container.querySelector('#set-supabase-url').value.trim(),
      supabase_anon_key: container.querySelector('#set-supabase-key').value.trim(),
      google_calendar_connected: container.querySelector('#set-gcal-connected').checked,
      notion_connected: container.querySelector('#set-notion-connected').checked,
      github_token: container.querySelector('#set-github-token').value.trim(),
      telegram_bot_token: container.querySelector('#set-telegram-bot-token')?.value.trim() || '',
      telegram_allowed_user_id: container.querySelector('#set-telegram-user-id')?.value.trim() || '',
      telegram_connected: Boolean(
        container.querySelector('#set-telegram-bot-token')?.value.trim() &&
        container.querySelector('#set-telegram-user-id')?.value.trim()
      ),
    };

    store.updateSettings(updated);
    renderSettings(container, router);

    // Aggiorna variabili CSS dinamiche
    document.documentElement.style.setProperty('--primary', updated.primary_color);
    document.documentElement.style.setProperty('--accent', updated.accent_color);
    document.title = updated.app_name;

    const alertEl = container.querySelector('#settings-alert');
    if (alertEl) {
      alertEl.style.display = 'block';
      setTimeout(() => { alertEl.style.display = 'none'; }, 3000);
    }
  });

  // Reset Totale Dati
  container.querySelector('#reset-all-data-btn').addEventListener('click', () => {
    if (confirm('ATTENZIONE: Questa azione cancellerà permanentemente TUTTI i dati inseriti (clienti, preventivi, to-do, spese, impostazioni). Procedere?')) {
      store.clearAll();
      // lascia al sincronizzatore il tempo di inviare le eliminazioni al cloud prima di ricaricare
      setTimeout(() => location.reload(), 2500);
      alert('Installazione azzerata. La pagina si ricaricherà tra pochi secondi.');
    }
  });

  // --- Eventi Card Integrazione Telegram Bot ---
  container.querySelector('#copy-tg-webhook-btn')?.addEventListener('click', () => {
    const urlInput = container.querySelector('#telegram-webhook-url-display');
    if (urlInput && navigator.clipboard) {
      navigator.clipboard.writeText(urlInput.value);
      const fb = container.querySelector('#telegram-test-feedback');
      if (fb) {
        fb.style.color = 'var(--success)';
        fb.textContent = '✓ Webhook URL copiato!';
      }
    }
  });

  container.querySelector('#register-tg-webhook-btn')?.addEventListener('click', async () => {
    const tokenVal = container.querySelector('#set-telegram-bot-token')?.value.trim() || '';
    const fb = container.querySelector('#telegram-test-feedback');
    try {
      if (fb) {
        fb.style.color = 'var(--text-muted)';
        fb.textContent = 'Registrazione webhook in corso...';
      }
      await registerTelegramWebhook(tokenVal);
      if (fb) {
        fb.style.color = 'var(--success)';
        fb.textContent = '✓ Webhook collegato a Telegram!';
      }
      const badge = container.querySelector('#telegram-status-badge');
      if (badge) {
        badge.className = 'badge badge-green';
        badge.textContent = '● Attivo e Connesso';
      }
    } catch (err) {
      if (fb) {
        fb.style.color = 'var(--danger)';
        fb.textContent = err.message;
      }
    }
  });

  container.querySelector('#ai-diagnose-btn')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const out = container.querySelector('#ai-diagnose-result');
    btn.disabled = true;
    out.innerHTML = '<div class="muted">Controllo in corso…</div>';
    try {
      // Se l'utente ha appena scritto una chiave personale, la usa subito per il test
      const typed = container.querySelector('#set-gemini-key')?.value.trim();
      if (typed && typed !== store.getSettings().gemini_api_key) store.updateSettings({ gemini_api_key: typed });
      const r = await aiDiagnose();
      const esc = (t) => String(t ?? '').replace(/</g, '&lt;');
      if (!r.ok && !r.gemini) {
        out.innerHTML = `<div class="notice err">❌ L'IA non funziona: ${esc(r.message || 'risposta non valida')}</div>`;
      } else if (r.via === 'direct') {
        out.innerHTML = `<div class="notice ok">✅ L'IA funziona con la tua chiave personale. Modello: <strong>${esc(r.generateModel || '?')}</strong>.</div>`;
      } else {
        const line = (nome, d, ruolo) => {
          if (!d) return '';
          if (d.ok && d.probeOk !== false) {
            return `<div class="notice ok">✅ <strong>${nome}</strong> (${ruolo}) funziona. Modello: <strong>${esc(d.generateModel || d.model || '?')}</strong>${d.ms ? ` — ${(d.ms / 1000).toFixed(1)}s` : ''}.</div>`;
          }
          const livello = ruolo === 'riserva' ? 'warn' : 'err';
          return `<div class="notice ${livello}">${ruolo === 'riserva' ? '⚠️' : '❌'} <strong>${nome}</strong> (${ruolo}) non disponibile: ${esc(d.message || 'errore sconosciuto')}</div>`;
        };
        const geminiOk = r.gemini?.ok && r.gemini?.probeOk !== false;
        const claudeOk = r.anthropic?.ok && r.anthropic?.probeOk !== false;
        const verdetto = geminiOk || claudeOk
          ? `<div class="notice ok"><strong>In sintesi:</strong> l'assistente funziona${geminiOk && claudeOk ? ', e se il primo si blocca entra in gioco la riserva.' : geminiOk ? ', ma senza riserva: se Gemini si blocca ti fermi.' : ' usando la riserva (Claude), perché Gemini non risponde.'}</div>`
          : `<div class="notice err"><strong>In sintesi:</strong> nessun fornitore risponde, l'assistente non può funzionare.</div>`;
        out.innerHTML = line('Gemini', r.gemini, 'principale') + line('Claude', r.anthropic, 'riserva') + verdetto;
      }
    } catch (err) {
      out.innerHTML = `<div class="notice err">❌ ${String(err.message || err).replace(/</g, '&lt;')}</div>`;
    } finally {
      btn.disabled = false;
    }
  });

  container.querySelector('#telegram-test-msg-btn')?.addEventListener('click', async () => {
    const tokenVal = container.querySelector('#set-telegram-bot-token')?.value.trim() || '';
    const chatIdVal = container.querySelector('#set-telegram-user-id')?.value.trim() || '';
    const fb = container.querySelector('#telegram-test-feedback');
    try {
      if (fb) {
        fb.style.color = 'var(--text-muted)';
        fb.textContent = 'Invio messaggio di test...';
      }
      await sendTelegramTestMessage({ botToken: tokenVal, chatId: chatIdVal });
      if (fb) {
        fb.style.color = 'var(--success)';
        fb.textContent = '✓ Messaggio di test inviato su Telegram!';
      }
      const badge = container.querySelector('#telegram-status-badge');
      if (badge) {
        badge.className = 'badge badge-green';
        badge.textContent = '● Attivo e Connesso';
      }
    } catch (err) {
      if (fb) {
        fb.style.color = 'var(--danger)';
        fb.textContent = err.message;
      }
    }
  });
}
