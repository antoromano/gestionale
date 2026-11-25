# 📋 Storico delle Versioni (Changelog) — Gestionale AI

Questo documento traccia in ordine cronologico inverso l'evoluzione del progetto **Gestionale**, documentando cosa è stato aggiunto, riprogettato e corretto in ogni rilascio.

---

## [v2.3.0] — 2026-11-25 — Interfaccia dedicata per telefono ("Second Brain Mobile")

### ✨ Aggiunto
- **Interfaccia per telefono separata** (`src/mobile/`): si attiva da sola sotto i 768 px di larghezza; si può forzare da *Impostazioni → Interfaccia* (computer) o *Profilo → Passa a Vista Desktop* (telefono). Preferenza salvata sul dispositivo (`gestionale_ui_mode`: `auto` / `mobile` / `desktop`, `src/utils/device.js`).
- **Caricamento separato**: `src/main.js` carica `src/mobile/mobile-app.js` solo sul telefono (pezzo a parte nella build, ~107 kB JS + ~24 kB CSS). Il computer non scarica né il codice né gli stili mobile; ogni regola di `mobile.css` è sotto `body.is-mobile-ui`.
- **Barra in basso** con 5 schede (Home, Agenda, To-do, Corpo, AI) e pulsante **+** rialzato; le sottoviste (Aggiungi, Entrate e uscite, Second Brain, Clienti, Cerca, Profilo) mostrano **Torna a Home**. Il tasto indietro del telefono funziona.
- **Schermate**: Home (il punto di oggi calcolato dai tuoi dati, numeri principali, to-do di oggi, prossimi eventi); Aggiungi (6 azioni rapide + cattura rapida con IA o coda); Agenda (Giorno / Settimana con striscia di 7 giorni); To-do (ricerca, Oggi / In arrivo / Fatti, spunta con Annulla); Corpo (niente matrice: griglia 3×2 di oggi e esercizi ordinati per recupero, tocca per registrare); AI (Briefing, Chat *Chiedi a te stesso* con fonti, Coach: Avvocato del Diavolo, coda appunti, foto scontrino, dettatura, assistente completo); Entrate e uscite; Second Brain (note, fatti con storico, fonti); Clienti (scheda con concordato / incassato / da incassare e pagamenti dei preventivi); Cerca su tutto; Profilo (sincronizzazione, Verifica IA, istruzioni e privacy, uscita).
- **Pannelli dal basso** per creare e modificare to-do, movimenti, eventi, note, fatti, biometria e allenamenti, con gli stessi servizi dell'interfaccia per computer. Gli importi accettano la virgola ("45,50").

### 🛠️ Note
- Nessuna modifica a servizi, database, funzioni sul server o test. L'interfaccia per computer cambia solo per la nuova scheda *Interfaccia* nelle Impostazioni.
- Restano solo sul computer: PDF e modifica delle voci dei preventivi, importazione di chat/documenti/CSV, gestione colonne esercizi, listino, report, mappa 3D.

---

## [v2.2.0] — 2026-11-17 — Design System "Warm Daylight Studio" & UX Redesign

### ✨ Aggiunto
- **Specifica e Audit UX ([UX_AUDIT_AND_SPEC.md](file:///Users/antonio/Gestionale1/UX_AUDIT_AND_SPEC.md))**: documento architetturale completo con analisi di densità informativa, gerarchia visiva, ergonomia dell'Assistente AI e sistema di design token.
- **Design System Unificato ("Warm Daylight Studio")** in [src/styles/main.css](file:///Users/antonio/Gestionale1/src/styles/main.css) e [src/styles/ui.css](file:///Users/antonio/Gestionale1/src/styles/ui.css):
  - Palette neutra riposante per uso prolungato: canvas carta calda (`#F6F5F2`) anti-abbagliamento, sidebar (`#FAF9F6`), superfici operative bianche (`#FFFFFF`), inchiostro ad alto contrasto WCAG AAA (`#18181B`), accento primario Indigo Royal (`#364FC7`) e accento AI Violet (`#5F3DC4`).
  - Scala tipografica armonizzata (`Inter` + `JetBrains Mono` con `font-variant-numeric: tabular-nums` per importi, pesi, percentuali e serie di allenamento).
  - Componenti riutilizzabili: `.kpi-grid` / `.kpi-card`, `.filter-toolbar`, `.surface-box` / `.surface-box-interactive`, `.callout-box`, `.row-actions` / `.btn-icon`, `.skeleton` (shimmer loader).
- **Assistente AI Side-Drawer Non-Bloccante su Desktop** ([src/modules/ai-assistant.js](file:///Users/antonio/Gestionale1/src/modules/ai-assistant.js)):
  - Su schermi desktop (`>= 1024px`), `#ai-assistant-overlay` si apre come **Drawer laterale destro non bloccante** (`480px`, espandibile a `740px` tramite il pulsante `⇄` `#ai-toggle-width-btn`), senza oscurare né sfocare i dati sottostanti del gestionale (preventivi, clienti, finanze, matrice Body restano leggibili e scorrevoli a sinistra).
  - Pillola contestuale `.ai-context-pill` nell'intestazione del Drawer per indicare il modulo attivo.
  - Skeleton loader shimmer (`.skeleton`) durante l'analisi AI e nella chat *Chiedi a te stesso* ([src/modules/brain-chat.js](file:///Users/antonio/Gestionale1/src/modules/brain-chat.js)).

### 🛠️ Sistemato e Ottimizzato
- **Risolto il conflitto ("Split-Brain") tra `main.css` e `ui.css`**: rimossi gli override contrastanti su `:root` e le regole `!important` sull'header dell'Assistente AI, mantenendo il 100% degli alias CSS retrocompatibili.
- **Tabella Preventivi ([src/modules/quotes.js](file:///Users/antonio/Gestionale1/src/modules/quotes.js))**: compattata la colonna azioni da 5 bottoni testuali estesi a 1 azione primaria (`💼 Gestisci`) + 4 `.btn-icon` con tooltip (`✏️`, `📄`, `📋`, `🗑️`), eliminando l'andata a capo delle righe su laptop.
- **Uniformazione KPI Card e Barre Filtro**: standardizzate le metriche e le barre di ricerca in [finances.js](file:///Users/antonio/Gestionale1/src/modules/finances.js), [body.js](file:///Users/antonio/Gestionale1/src/modules/body.js), [clients.js](file:///Users/antonio/Gestionale1/src/modules/clients.js), [dashboard.js](file:///Users/antonio/Gestionale1/src/modules/dashboard.js), [brain.js](file:///Users/antonio/Gestionale1/src/modules/brain.js), [todos.js](file:///Users/antonio/Gestionale1/src/modules/todos.js), [calendar.js](file:///Users/antonio/Gestionale1/src/modules/calendar.js), [catalog.js](file:///Users/antonio/Gestionale1/src/modules/catalog.js) e [settings.js](file:///Users/antonio/Gestionale1/src/modules/settings.js).
- **Indicatore di sincronizzazione iniziale non bloccante**: `body.is-loading::before` trasformato in pillola flottante in alto a destra invece di coprire l'intero schermo.

---

## [v2.1.0] — 2026-11-17 — Personal RAG ("Chiedi a te stesso"), Importatore Storico & `/ask` Telegram

### ✨ Aggiunto
- **Migrazione Database `010_personal_rag.sql`** ([supabase/migrations/010_personal_rag.sql](file:///Users/antonio/Gestionale1/supabase/migrations/010_personal_rag.sql)):
  - Tabella `brain_documents` per archiviare fonti e conversazioni importate (con testo originale, metadati, data reale e conteggio pezzi/fatti).
  - Tabella `brain_assistant_profiles` per istruzioni globali, regole per dominio e permessi granulari di lettura dei dati vivi.
  - Funzione RPC PostgreSQL `match_brain_memories_hybrid` che combina ricerca vettoriale coseno (`pgvector` 768 dim) e Full-Text Search in lingua italiana (`plainto_tsquery('italian', ...)`).
- **Motore Personal RAG** ([src/services/rag-core.js](file:///Users/antonio/Gestionale1/src/services/rag-core.js), [src/services/rag-server.js](file:///Users/antonio/Gestionale1/src/services/rag-server.js), [src/services/personal-rag.js](file:///Users/antonio/Gestionale1/src/services/personal-rag.js)) ed **Edge Function `personal-rag-chat`** ([supabase/functions/personal-rag-chat/index.ts](file:///Users/antonio/Gestionale1/supabase/functions/personal-rag-chat/index.ts)):
  - Classificazione automatica del dominio della domanda (`cooking`, `work`, `body`, `tech`, `personal`).
  - Recupero ibrido di fatti attivi (`Mem0`), pezzi di documenti/chat (`chunks`) e istantanee in tempo reale dal gestionale secondo i permessi privacy (**Corpo** e **Agenda** attivi di default; **Clienti** e **Finanze** spenti di default).
  - Citazione puntuale delle fonti (`[C1]`, `[F1]`, `[L1]`) risolte in pillole cliccabili nell'interfaccia.
- **Scheda "Chiedi" e "Istruzioni e Privacy"** ([src/modules/brain-chat.js](file:///Users/antonio/Gestionale1/src/modules/brain-chat.js), [src/modules/brain-profile.js](file:///Users/antonio/Gestionale1/src/modules/brain-profile.js)):
  - Conversazione multi-turno con il proprio archivio personale, ispezione del testo originale delle fonti citate e azione rapida **"+ Salva regola in memoria"** (volano della conoscenza).
- **Scheda "Fonti" e Importatore Universale Chat/Documenti** ([src/modules/brain-sources.js](file:///Users/antonio/Gestionale1/src/modules/brain-sources.js), [src/utils/chat-importer.js](file:///Users/antonio/Gestionale1/src/utils/chat-importer.js), [src/services/brain-docs.js](file:///Users/antonio/Gestionale1/src/services/brain-docs.js)):
  - Supporto per esportazioni **ChatGPT** (`conversations.json`), **Claude**, **Google Gemini (Takeout)**, **PDF** (estrazione testo client-side), **Markdown** e file di testo.
  - Filtro anti-rumore (rimozione automatica dei convenevoli dell'assistente preservando ricette, codice e piani).
  - Regola di integrità sui fatti: i fatti personali vengono estratti **esclusivamente dai messaggi scritti dall'utente** (verificati tramite citazione letterale) e portano la **data originale** della chat (fatti più vecchi di un valore già attivo finiscono direttamente nello storico).
  - Selezione manuale delle chat da importare, stima preventiva di pezzi/token/costo in Euro, barra di avanzamento con **Pausa / Riprendi**, anteprima pezzi, re-indicizzazione e cancellazione a cascata.
- **Comando Telegram `/ask <domanda>`** ([supabase/functions/telegram-webhook/index.ts](file:///Users/antonio/Gestionale1/supabase/functions/telegram-webhook/index.ts)):
  - Interroga lo stesso motore Personal RAG direttamente da Telegram, restituendo risposta e fonti utilizzate.
- **Suite di Test `personal-rag.test.js` e `telegram-e2e.test.js`**: 132 test automatici complessivi su 6 suite.

---

## [v2.0.0] — 2026-11-16 — Architettura Cloud-First, Catena Multi-Provider AI & Dedup Telegram

### ✨ Aggiunto
- **Sincronizzazione Cloud-First Bidirezionale & Realtime** ([src/services/cloud.js](file:///Users/antonio/Gestionale1/src/services/cloud.js), migrazioni `007_cloud_first.sql` e `008_auth_and_realtime.sql`):
  - Supabase diventa l'unica fonte di verità condivisa tra Web App e Bot Telegram; `localStorage` funge da cache immediata con coda di invio offline e indicatore di stato in tempo reale nella Top Bar (`Sincronizzato`, `Sincronizzo…`, `Offline`, `Errore`).
  - Autenticazione email/password con blocco database a singolo proprietario (`enforce_single_owner`) e adozione automatica delle righe orfane.
- **Catena Multi-Provider AI con Failover Automatico** ([src/services/gemini-core.js](file:///Users/antonio/Gestionale1/src/services/gemini-core.js)):
  - Ordine di priorità: **OpenAI** (`gpt-4o-mini` / `text-embedding-3-small` a 768 dim + `whisper-1` per note vocali) ➔ **Google Gemini** (modello `lite` stabile con `thinkingBudget: 0`) ➔ **Anthropic Claude** (`claude-haiku`).
  - Timeout rigidi per singolo provider per evitare attese di 40+ secondi e pannello diagnostico in *Impostazioni → Verifica IA*.
- **Elaborazione Telegram in Background & Anti-Doppioni** (migrazione `009_telegram_dedup.sql`):
  - Risposta HTTP `200 OK` immediata a Telegram (`EdgeRuntime.waitUntil`) e tabella `telegram_processed_updates` per scartare i retry duplicati di Telegram.
  - Verifica rigorosa degli errori di scrittura sul database prima di inviare la conferma "✅" su Telegram, più pulsante inline **Annulla** su ogni salvataggio.

### 🛠️ Sistemato
- Risolto il disallineamento tra bot Telegram e Web App (in precedenza il bot scriveva su Supabase senza `user_id` mentre l'app leggeva solo da `localStorage`).
- Rimossi i parser locali silenziosi di ripiego per l'assistente AI: se nessun provider AI risponde, l'app dichiara il motivo esatto dell'errore senza inventare o perdere il testo scritto dall'utente.
- Aggiunto il pulsante **Indietro** (`← Indietro`) nella Top Bar, lo scorrimento completo delle finestre modali anche su mobile e le azioni CRUD mancanti su Clienti, Preventivi (Duplica), Catalogo, Oggi e Corpo.

---

## [v1.5.0] — 2026-11-12 — Finanze & Cash Flow, Compravendita, Importatore CSV/XLSX & Coda Appunti

### ✨ Aggiunto
- **Centro Finanze & Cash Flow** ([src/modules/finances.js](file:///Users/antonio/Gestionale1/src/modules/finances.js), [src/services/finances.js](file:///Users/antonio/Gestionale1/src/services/finances.js), migrazione `006_finances_and_queue.sql`):
  - Ledger unificato Entrate/Uscite, generazione idempotente delle spese/incassi ricorrenti e modulo **Compravendita (Flipping)** con calcolo automatico di Margine Netto, ROI % e profitto orario reale.
- **Importatore Deterministico CSV / Excel (Zero Token AI)** ([src/utils/csv-importer.js](file:///Users/antonio/Gestionale1/src/utils/csv-importer.js), [src/utils/xlsx-reader.js](file:///Users/antonio/Gestionale1/src/utils/xlsx-reader.js)):
  - Riconoscimento automatico di MyFitnessPal/Apple Health, fogli compravendita ed estratti conto bancari, con wizard di mappatura colonne e deduplicazione tramite impronta deterministica.
- **Coda Appunti & Ingestion Batching** ([src/modules/note-queue-ui.js](file:///Users/antonio/Gestionale1/src/modules/note-queue-ui.js)):
  - Accumulo rapido di note durante la giornata ("Da parte" / `/queue`) ed elaborazione cumulativa in un'unica chiamata AI (`/digest`).
- **Modalità "Avvocato del Diavolo"** ([src/services/devils-advocate.js](file:///Users/antonio/Gestionale1/src/services/devils-advocate.js)):
  - Stress-test numerico di preventivi, margini di compravendita e recupero fisico.

---

## [v1.0.0] — Rilascio Iniziale — Gestionale Operativo, Second Brain Tri-Layer & Matrice Body

### ✨ Aggiunto
- **Moduli Core**: Dashboard *Oggi*, *To-do*, *Clienti* (con ambienti Staging/Prod, widget GitHub live e canoni MRR), *Preventivi* (con foto per voce, autosave su IndexedDB, pannello economico *Gestisci* e doppia generazione PDF Stampa/Digitale), *Calendario & Agenda*, *Catalogo Servizi*, *Report Finanziari*, *Cestino* e *Backup JSON*.
- **Sezione Body**: Matrice Diario ispirata al quaderno cartaceo con parser per notazione compatta (`20(10,10,10,10)`), varianti a parole complete, semaforo di recupero a 2-3 giorni e visualizzazione 3D Three.js.
- **Second Brain Tri-Layer**: Archivio Semantico (`brain_memories`), Fatti Atomici con storico evolutivo (`brain_facts`) e Knowledge Graph relazionale 3D (`brain_nodes`, `brain_edges`).
