// src/modules/help.js
// Guida Interattiva & FAQ per Sviluppatori Freelance (Come usare il gestionale partendo da zero)

export function renderHelp(container, router) {
  container.innerHTML = `
    <div style="max-width: 900px; margin: 0 auto;">
      <!-- Hero Header -->
      <div class="card" style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color: #ffffff; padding: 28px; margin-bottom: 24px;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
          <span style="font-size: 28px;">📖</span>
          <h2 style="font-size: 22px; font-weight: 800; color: #ffffff; margin: 0;">Guida Pratica al Gestionale</h2>
        </div>
        <p style="font-size: 14px; color: #94a3b8; line-height: 1.6; margin: 0; max-width: 700px;">
          Progettato specificamente per <strong>Ingegneri Informatici e Sviluppatori Freelance</strong> (Web App, SaaS, E-Commerce, Mobile).
          Questa guida ti accompagna passo-passo, spiegando la logica di ogni sezione anche se non hai mai usato un gestionale prima d'ora.
        </p>
      </div>

      <!-- Scheda Architettura Cognitiva Second Brain Tri-Layer -->
      <div class="card" style="margin-bottom: 20px; border-left: 4px solid #7c3aed; background: linear-gradient(180deg, #faf5ff 0%, #ffffff 100%);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
          <h3 style="font-size: 16px; font-weight: 800; color: #5b21b6; margin: 0;">
            🧠 Come Funziona il Second Brain (Architettura Cognitiva Tri-Layer Ibrida)
          </h3>
          <span class="badge" style="background: #ede9fe; color: #5b21b6;">GraphRAG + Mem0 + pgvector</span>
        </div>
        <p style="font-size: 13px; color: var(--text-muted); line-height: 1.6; margin-bottom: 12px;">
          A differenza di un semplice blocco note, il tuo <strong>Second Brain</strong> organizza automaticamente ogni informazione (tecnica, clienti, salute/allenamento, regole) su <strong>3 livelli cognitivi sincronizzati</strong> dentro PostgreSQL:
        </p>
        <div class="grid-3" style="margin-bottom: 12px;">
          <div style="background: #ffffff; padding: 12px; border-radius: var(--radius); border: 1px solid #e9d5ff;">
            <div style="font-weight: 700; font-size: 13px; color: #1e40af; margin-bottom: 4px;">1️⃣ Livello Semantico (pgvector)</div>
            <div style="font-size: 12px; color: var(--text-muted); line-height: 1.5;">
              Archivia i tuoi appunti con <strong>embedding vettoriali a 768 dimensioni</strong> e tag GIN per ritrovare concetti per significato anche quando non ricordi le parole esatte.
            </div>
          </div>
          <div style="background: #ffffff; padding: 12px; border-radius: var(--radius); border: 1px solid #bbf7d0;">
            <div style="font-weight: 700; font-size: 13px; color: #166534; margin-bottom: 4px;">2️⃣ Livello Episodico & Fatti (Mem0)</div>
            <div style="font-size: 12px; color: var(--text-muted); line-height: 1.5;">
              Estrae coppie <code>(Soggetto, Chiave, Valore)</code>. Se un parametro cambia (es. canone MRR da 300€ a 450€, o massimale pull-up da 12 a 16), <strong>storicizza il vecchio stato</strong> (<code>is_active = false</code>) e attiva il nuovo senza contraddizioni.
            </div>
          </div>
          <div style="background: #ffffff; padding: 12px; border-radius: var(--radius); border: 1px solid #fde68a;">
            <div style="font-weight: 700; font-size: 13px; color: #b45309; margin-bottom: 4px;">3️⃣ Knowledge Graph (Nodi & Archi)</div>
            <div style="font-size: 12px; color: var(--text-muted); line-height: 1.5;">
              Collega Clienti, Tecnologie, Esercizi e Problemi (<code>[Nodo A] ──(RELAZIONE)──&gt; [Nodo B]</code>) e naviga fino a <strong>2 Hop di distanza</strong> per scoprire correlazioni indirette.
            </div>
          </div>
        </div>
        <div style="font-size: 12px; color: #5b21b6; background: #f3e8ff; padding: 10px 12px; border-radius: 6px;">
          <strong>💡 Come sfruttarlo ogni giorno:</strong> Quando crei o modifichi un Cliente (stack, repo, canone MRR) o completi un To-do importante, il Gestionale aggiorna da solo il Second Brain. Inoltre puoi scrivere appunti liberi nella sezione <strong>🧠 Second Brain</strong> o interrogare i 3 livelli insieme con <em>"Chiedi al Second Brain"</em>.
        </div>
      </div>

      <!-- Scheda Filosofia Chiave -->
      <div class="card" style="margin-bottom: 20px; border-left: 4px solid var(--accent);">
        <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 8px; color: var(--text-main);">
          💡 La Logica Base: Perché Tutto Ruota Attorno al Cliente
        </h3>
        <p style="font-size: 13px; color: var(--text-muted); line-height: 1.6;">
          Nei gestionali tradizionali per agenzie esistono spesso strutture complesse a "matrioska" (Azienda &gt; Progetto &gt; Sotto-progetto &gt; Milestone) che generano solo burocrazia per un freelance.
          In questo sistema, <strong>il Cliente è il tuo centro di comando unificato</strong>:
        </p>
        <ul style="font-size: 13px; color: var(--text-muted); line-height: 1.8; margin-left: 20px; margin-top: 6px;">
          <li><strong>Ambienti Dev a 1-click:</strong> Links rapidi a Staging (test) e Produzione.</li>
          <li><strong>GitHub Live Widget:</strong> Ultimi commits e Pull Request aperte direttamente nella scheda cliente.</li>
          <li><strong>Canoni Ricorrenti (MRR):</strong> Traccia contratti di manutenzione, SLA e hosting senza confonderli con i preventivi dei nuovi progetti.</li>
          <li><strong>Storico Lavori & To-do:</strong> Raggruppati mese per mese con distinzione tra "Da fare" e "Fatti".</li>
        </ul>
      </div>

      <!-- Guida ai Moduli -->
      <div class="card" style="margin-bottom: 20px;">
        <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 16px;">
          🚀 Come Svolgere le Operazioni Più Comuni
        </h3>

        <div style="display: flex; flex-direction: column; gap: 16px;">
          <!-- 1. Onboarding Clienti Storici con IA -->
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: var(--radius); padding: 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <div style="font-weight: 700; font-size: 14px; color: #166534;">
                1. Importare Clienti Storici in 1 Click con l'IA ✨
              </div>
              <span class="badge badge-green">Funzionalità Chiave</span>
            </div>
            <p style="font-size: 13px; color: #166534; line-height: 1.6; margin-bottom: 8px;">
              Se lavori già con clienti da mesi, non devi compilare decine di campi a mano. Clicca sul pulsante <strong>"✨ Assistente IA"</strong> in basso o nella Dashboard e scrivi (oppure usa il microfono vocale) un testo libero:
            </p>
            <div style="background: #ffffff; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 12px; color: #1e293b; border: 1px solid #bbf7d0; margin-bottom: 8px;">
              "Lavoro da 6 mesi con TechCorp (referente Marco), sito www.techcorp.it, staging stage.techcorp.it, repo antoromano/techcorp-web, stack Next.js e Supabase, canone manutenzione 300€/mese. Devo fare deploy mercoledì alle 15."
            </div>
            <p style="font-size: 12px; color: #166534; margin: 0;">
              L'IA riconosce automaticamente il cliente, crea la scheda tecnica con ambienti e GitHub, configura il canone MRR ed estrae il rilascio in agenda, mostrandoti l'anteprima per la tua conferma.
            </p>
          </div>

          <!-- 2. Ciclo Preventivo & Pagamenti -->
          <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius); padding: 16px;">
            <div style="font-weight: 700; font-size: 14px; color: var(--text-main); margin-bottom: 8px;">
              2. Creare un Preventivo, Acconto e Saldo
            </div>
            <p style="font-size: 13px; color: var(--text-muted); line-height: 1.6;">
              Vai in <strong>Preventivi &gt; + Nuovo Preventivo</strong>:
            </p>
            <ul style="font-size: 13px; color: var(--text-muted); line-height: 1.7; margin-left: 20px;">
              <li><strong>Voci & Allegati Tecnici:</strong> Inserisci le voci (es. Sviluppo MVP, Integrazione API Stripe). Puoi allegare diagrammi di architettura o mockup a ciascuna voce.</li>
              <li><strong>Gestisci & Pagamenti:</strong> Dalla lista preventivi clicca <em>💼 Gestisci</em>. Qui puoi registrare l'Acconto (es. 30%) e il Saldo quando consegni il software.</li>
              <li><strong>Stampa PDF:</strong> Crea un PDF pulito, conforme e professionale da inviare al cliente con un click.</li>
            </ul>
          </div>

          <!-- 3. Calendario per Rilasci e Scadenze -->
          <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius); padding: 16px;">
            <div style="font-weight: 700; font-size: 14px; color: var(--text-main); margin-bottom: 8px;">
              3. Calendario Sviluppatore: Deploy, Demo e Scadenze Server/SSL
            </div>
            <p style="font-size: 13px; color: var(--text-muted); line-height: 1.6;">
              Nel <strong>Calendario</strong> puoi pianificare i tuoi impegni tecnici con etichette chiare:
            </p>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px;">
              <span class="badge badge-blue">🚀 Deploy / Rilascio</span>
              <span class="badge badge-green">💻 Demo / Sprint Review</span>
              <span class="badge badge-yellow">📞 Call Tecnica</span>
              <span class="badge badge-red">⏳ Scadenza Server/SSL</span>
            </div>
          </div>

          <!-- 4. Report Economico & Margini -->
          <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: var(--radius); padding: 16px;">
            <div style="font-weight: 700; font-size: 14px; color: var(--text-main); margin-bottom: 8px;">
              4. Report Finanziari: Cassa Reale, Crediti Residui e MRR
            </div>
            <p style="font-size: 13px; color: var(--text-muted); line-height: 1.6;">
              Nei <strong>Report</strong> hai il quadro completo senza fuffa:
            </p>
            <ul style="font-size: 13px; color: var(--text-muted); line-height: 1.7; margin-left: 20px;">
              <li><strong>Incassi Effettivi:</strong> Solo il denaro realmente entrato in cassa.</li>
              <li><strong>Crediti Residui:</strong> Lavori concordati o consegnati ma non ancora pagati.</li>
              <li><strong>MRR (Monthly Recurring Revenue):</strong> Il canone mensile prevedibile generato dai tuoi contratti di manutenzione attivi.</li>
              <li><strong>Spese:</strong> I costi di licenze (Vercel, Supabase, Domini, Hetzner, OpenAI API) sottratti per darti il margine reale netto.</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- FAQ per Ingegneri Informatici & Freelance -->
      <div class="card" style="margin-bottom: 24px;">
        <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 16px;">
          ❓ Domande Frequenti (FAQ)
        </h3>

        <div style="display: flex; flex-direction: column; gap: 12px;">
          <details style="background: #f8fafc; padding: 12px 16px; border-radius: var(--radius); border: 1px solid var(--border); cursor: pointer;">
            <summary style="font-weight: 700; font-size: 13px; color: var(--text-main);">
              Dove trovo il token GitHub se ho repo privati?
            </summary>
            <div style="font-size: 13px; color: var(--text-muted); margin-top: 8px; line-height: 1.6;">
              Per i repository pubblici non serve alcun token (funziona direttamente). Se vuoi vedere commits e PR da repository privati, vai su GitHub in <em>Settings &gt; Developer settings &gt; Personal access tokens &gt; Tokens (classic)</em>, genera un token con permesso <code>repo</code> e inseriscilo in <strong>Impostazioni &gt; Token GitHub</strong>.
            </div>
          </details>

          <details style="background: #f8fafc; padding: 12px 16px; border-radius: var(--radius); border: 1px solid var(--border); cursor: pointer;">
            <summary style="font-weight: 700; font-size: 13px; color: var(--text-main);">
              Come faccio se ho sbagliato a salvare un preventivo o un cliente?
            </summary>
            <div style="font-size: 13px; color: var(--text-muted); margin-top: 8px; line-height: 1.6;">
              Tutti gli elementi possono essere modificati in ogni momento con il pulsante ✏️ Modifica. Inoltre, se cancelli qualcosa per errore, va nella sezione <strong>Cestino</strong> da dove puoi ripristinarlo con 1 click senza perdere nessun dato.
            </div>
          </details>

          <details style="background: #f8fafc; padding: 12px 16px; border-radius: var(--radius); border: 1px solid var(--border); cursor: pointer;">
            <summary style="font-weight: 700; font-size: 13px; color: var(--text-main);">
              I miei dati rimangono privati? Posso usarlo offline?
            </summary>
            <div style="font-size: 13px; color: var(--text-muted); margin-top: 8px; line-height: 1.6;">
              Sì! L'applicazione è una Progressive Web App (PWA) autonoma. Tutti i dati sono memorizzati in locale nel tuo browser e sincronizzati con il tuo database PostgreSQL privato su Supabase con Row Level Security. Funziona sia online che offline.
            </div>
          </details>

          <details style="background: #f8fafc; padding: 12px 16px; border-radius: var(--radius); border: 1px solid var(--border); cursor: pointer;">
            <summary style="font-weight: 700; font-size: 13px; color: var(--text-main);">
              Come configuro la mia Cassa Previdenziale (INPS / Inarcassa / Gestione Separata)?
            </summary>
            <div style="font-size: 13px; color: var(--text-muted); margin-top: 8px; line-height: 1.6;">
              Vai in <strong>Impostazioni</strong>: trovi i campi "Oneri Fiscali / Rivalsa Previdenziale". Puoi abilitare la cassa (es. Rivalsa INPS 4% o Inarcassa 4%) e l'aliquota IVA se applichi il regime ordinario, oppure disattivarli se sei in regime forfettario.
            </div>
          </details>
        </div>
      </div>
    </div>
  `;
}
