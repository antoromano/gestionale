// src/modules/help.js
// Guida Interattiva & FAQ per Sviluppatori Freelance (Progressive Disclosure con Accordion espandibili)

import { icon } from '../utils/icons.js';

export function renderHelp(container, router) {
  container.innerHTML = `
    <div style="max-width: 900px; margin: 0 auto;">
      <!-- Hero Header Sobrio -->
      <div class="card" style="background: #09090b; color: #ffffff; padding: 24px 28px; margin-bottom: 20px; border: 1px solid #27272a;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
          <span style="color: #818cf8; display: inline-flex;">${icon('help', 22)}</span>
          <h2 style="font-size: 20px; font-weight: 700; color: #ffffff; margin: 0; letter-spacing: -0.02em;">Guida Rapida & Architettura del Sistema</h2>
        </div>
        <p style="font-size: 13px; color: #a1a1aa; line-height: 1.6; margin: 0; max-width: 720px;">
          Workspace progettato per <strong>Ingegneri Informatici e Sviluppatori Freelance</strong>.
          Clicca su ciascun modulo qui sotto per consultare le istruzioni operative senza muri di testo.
        </p>
      </div>

      <!-- 1. Second Brain Tri-Layer & 3D Graph -->
      <details class="ux-guide-callout" open style="margin-bottom: 12px;">
        <summary style="padding: 13px 16px; font-size: 13.5px;">
          <span>${icon('brain', 15)} 1. Second Brain: Architettura Cognitiva Tri-Layer Ibrida & Grafo 3D</span>
          <span class="badge badge-blue mono">pgvector • Mem0 • 3D GraphRAG</span>
        </summary>
        <div class="callout-body" style="padding: 14px 16px;">
          <p style="margin-bottom: 10px;">
            Il tuo <strong>Second Brain</strong> organizza automaticamente ogni informazione (tecnica, clienti, salute/allenamento, regole) su <strong>3 livelli cognitivi sincronizzati</strong> dentro PostgreSQL:
          </p>
          <div class="grid-3" style="margin-bottom: 10px;">
            <div style="background: #fafafa; padding: 12px; border-radius: 8px; border: 1px solid var(--border);">
              <div style="font-weight: 600; font-size: 12.5px; color: var(--text-main); margin-bottom: 4px;">1. Livello Semantico (pgvector)</div>
              <div style="font-size: 12px; color: var(--text-muted); line-height: 1.5;">
                Archivia appunti con <strong>embedding vettoriali a 768 dimensioni</strong> e tag GIN per ritrovare concetti per significato.
              </div>
            </div>
            <div style="background: #fafafa; padding: 12px; border-radius: 8px; border: 1px solid var(--border);">
              <div style="font-weight: 600; font-size: 12.5px; color: var(--text-main); margin-bottom: 4px;">2. Livello Fatti Atomici (Mem0)</div>
              <div style="font-size: 12px; color: var(--text-muted); line-height: 1.5;">
                Estrae coppie <code class="mono">(Soggetto, Chiave, Valore)</code>. Quando un valore cambia (es. MRR o massimale pull-up), <strong>storicizza il vecchio stato</strong> e attiva il nuovo.
              </div>
            </div>
            <div style="background: #fafafa; padding: 12px; border-radius: 8px; border: 1px solid var(--border);">
              <div style="font-weight: 600; font-size: 12.5px; color: var(--text-main); margin-bottom: 4px;">3. Knowledge Graph 3D (Three.js)</div>
              <div style="font-size: 12px; color: var(--text-muted); line-height: 1.5;">
                Mappa spaziale 3D force-directed che collega Clienti, Tecnologie, Esercizi e Metriche fino a <strong>2 Hop di distanza</strong>.
              </div>
            </div>
          </div>
        </div>
      </details>

      <!-- 2. Modulo Body & Matrice Diario -->
      <details class="ux-guide-callout" style="margin-bottom: 12px;">
        <summary style="padding: 13px 16px; font-size: 13.5px;">
          <span>${icon('body', 15)} 2. Modulo Body: Matrice Diario a Colonne, Notazione Compatta & Poliedro 3D</span>
          <span class="badge badge-green mono">Frequenza 2-3gg</span>
        </summary>
        <div class="callout-body" style="padding: 14px 16px;">
          <ul style="margin-left: 18px; line-height: 1.75;">
            <li><strong>Notazione rapida numerica:</strong> digita <code class="mono">20(10,10,10,10)</code> per 4 serie da 10 con 20 kg, oppure <code class="mono">14,14,14,14</code> a corpo libero.</li>
            <li><strong>Varianti a parole complete:</strong> usa i chip per inserire <em>Presa Larga</em>, <em>Anelli</em>, <em>Pseudo Planche</em> e il toggle <em>Singolo Arto</em> (mantenendo retrocompatibilità con sigle veloci).</li>
            <li><strong>Semaforo 2-3 Giorni & Poliedro 3D:</strong> visualizza a colpo d'occhio quali gruppi muscolari sono freschi e nella finestra ideale per essere allenati oggi.</li>
          </ul>
        </div>
      </details>

      <!-- 3. Scheda Cliente & Onboarding IA -->
      <details class="ux-guide-callout" style="margin-bottom: 12px;">
        <summary style="padding: 13px 16px; font-size: 13.5px;">
          <span>${icon('clients', 15)} 3. Scheda Cliente Unificata, Ambienti Git & Onboarding Rapido con IA</span>
          <span class="badge badge-gray mono">CRM + Dev</span>
        </summary>
        <div class="callout-body" style="padding: 14px 16px;">
          <p style="margin-bottom: 8px;">
            Usa le <strong>Tab a Pillola (Segmented Control)</strong> nella scheda cliente per navigare tra <em>Attività & To-do</em>, <em>Ambienti & GitHub</em>, <em>Preventivi & Canoni MRR</em> e <em>Agenda & Rilasci</em>.
          </p>
          <div class="mono" style="background: #fafafa; padding: 10px 12px; border-radius: 6px; font-size: 11.5px; color: var(--text-main); border: 1px solid var(--border);">
            Prompt IA di esempio: "Lavoro con TechCorp (ref. Marco), sito www.techcorp.it, repo antoromano/techcorp-web, stack Next.js e Supabase, canone 300€/mese. Deploy mercoledì alle 15."
          </div>
        </div>
      </details>

      <!-- 4. Preventivi, Pagamenti & Report Finanziari -->
      <details class="ux-guide-callout" style="margin-bottom: 12px;">
        <summary style="padding: 13px 16px; font-size: 13.5px;">
          <span>${icon('reports', 15)} 4. Preventivi, Pagamenti (Acconto/Saldo) & Report Finanziari Anti-Duplicazione</span>
          <span class="badge badge-gray mono">MRR • ARR • Margine</span>
        </summary>
        <div class="callout-body" style="padding: 14px 16px;">
          <ul style="margin-left: 18px; line-height: 1.75;">
            <li><strong>Preventivi & PDF:</strong> crea preventivi con allegati tecnici, calcola automaticamente Rivalsa Previdenziale/IVA e genera PDF pronti per il cliente.</li>
            <li><strong>Zero doppio conteggio:</strong> i to-do inclusi in un preventivo non gonfiano il valore concordato; solo i lavori autonomi/extra vengono sommati separatamente.</li>
            <li><strong>MRR & ARR:</strong> monitora i canoni di manutenzione ricorrenti separatamente dai progetti una tantum.</li>
          </ul>
        </div>
      </details>

      <!-- 5. FAQ Tecniche -->
      <details class="ux-guide-callout" style="margin-bottom: 24px;">
        <summary style="padding: 13px 16px; font-size: 13.5px;">
          <span>${icon('settings', 15)} 5. Domande Frequenti (Token GitHub, Offline-First PWA, Cestino & Fisco)</span>
          <span class="badge badge-gray mono">FAQ</span>
        </summary>
        <div class="callout-body" style="padding: 14px 16px; display: flex; flex-direction: column; gap: 10px;">
          <div>
            <strong>Token GitHub per repository privati:</strong> per i repo pubblici non serve alcun token. Per i repo privati genera un Personal Access Token (<code class="mono">repo</code>) e incollalo in <em>Impostazioni &gt; Token GitHub</em>.
          </div>
          <div>
            <strong>Ripristino dal Cestino:</strong> qualsiasi elemento eliminato finisce nel <em>Cestino</em> e può essere ripristinato con 1 click.
          </div>
          <div>
            <strong>Architettura Local-First + Supabase Cloud:</strong> l'app funziona istantaneamente in locale (anche offline) e sincronizza in background tutte le tabelle con Supabase PostgreSQL protetto da Row Level Security.
          </div>
        </div>
      </details>
    </div>
  `;
}
