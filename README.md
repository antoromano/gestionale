# Gestionale — Web App Completa per Professionisti, Freelance e Piccole Attività

Software gestionale web moderno, reattivo, installabile come **PWA (Progressive Web App)** su desktop, tablet e smartphone, e **completamente riutilizzabile e personalizzabile** per qualsiasi nuova attività o professionista attraverso la sezione **Impostazioni**, senza dover modificare il codice sorgente.

---

## 🌟 Caratteristiche Chiave

- **Architettura Modulare & Nessun Brand Predefinito**: Ogni nuova installazione diventa il gestionale autonomo di un'attività diversa semplicemente configurando nome, logo, colori, intestazione, dati fiscali e oneri.
- **Frontend Moderno & Standalone**: Costruito con JavaScript ES Modules moderno, CSS reattivo (da schermi compatti da 320px fino a 1440px+ senza overflow orizzontale) e bundling rapido tramite Vite.
- **Database & Storage Supabase con Row Level Security (RLS)**: Schema PostgreSQL con isolamento completo tra utenti/workspace (`auth.uid() = user_id`) e bucket Storage protetti con policy cartella per utente.
- **Autonomia Locale & Offline-First (IndexedDB)**: Il software funziona immediatamente anche in locale e offline, salvando automaticamente le bozze dei preventivi con relative immagini su IndexedDB con ripristino sicuro.
- **Centro Operativo Focalizzato sul Cliente**: Scheda cliente omnicomprensiva con to-do raggruppati per mese (suddivisi tra "Da fare" e "Fatti"), appuntamenti/shooting, preventivi, servizi extra concordati e situazione pagamenti/residui.
- **Preventivi con Galleria Immagini Affiancata per Singola Voce**: Supporto per JPG, PNG e WebP fino a 5 MB per immagine e fino a 20 immagini per preventivo, duplicazione voci, sconti per voce e globali, totale concordato modificabile e opzione "Mostra totale nel PDF" (attiva di default).
- **Duplice Generazione PDF Integrata**: Versione **Stampa** (sfondo bianco, inchiostro risparmiato) e Versione **Digitale** (fondo colore aziendale, alto contrasto), con layout multipagina protetto da sovrapposizioni e denominazione file standardizzata: `Preventivo - Numero - Nome Cognome - Azienda.pdf`.
- **Pannello "Gestisci" Economico Preventivo**: Tracciamento di acconti, saldi, extra e rimborsi (che diminuiscono l'incassato), pagamenti previsti (che non aumentano l'incassato fittiziamente) e servizi extra (proposti vs approvati).
- **Nessun Doppio Conteggio nei Report**: Separazione rigorosa tra ricavi pattuiti, to-do inclusi nei preventivi, to-do autonomi, incassi reali e uscite.
- **Finanze & Cash Flow**: Ledger unico di Entrate e Uscite con KPI mensili (Entrate, Uscite, Cash Flow Netto, Costi Fissi Ricorrenti), ricorrenze settimanali/mensili/annuali idempotenti (con corretta gestione dei fine mese 28/30/31) e sezione **Compravendita / Flipping** con Margine Netto e ROI % calcolati automaticamente. La vecchia rotta/collezione `expenses` resta compatibile.
- **Importatore Universale CSV / Excel (zero token)**: riconosce automaticamente i file MyFitnessPal/Apple Health, i fogli di compravendita e gli estratti conto; se gli header sono sconosciuti apre un wizard di mapping colonne. Tutto client-side e deterministico, reimportare lo stesso file non crea duplicati.
- **Coda Appunti & Ingestion Batching**: accumuli note durante il giorno (box flottante 📝, `/queue` su Telegram) e le elabori con **una sola chiamata IA** (`/digest` su Telegram).
- **Avvocato del Diavolo & Profili Specializzati**: toggle nell'assistente che stress-testa preventivi, margini di compravendita e carichi di allenamento con evidenze numeriche dai tuoi dati; il profilo di prompt (Ingestion Batch, Nutrizione/Fitness, Finance Coach, Second Brain) è scelto in automatico dal modulo attivo.
- **Assistente IA Multimodale (Google Gemini)**: Accetta testo, foto o note vocali registrate direttamente dal microfono del dispositivo. Estrae to-do e appuntamenti multipli senza confondere nomi di servizi con clienti, con anteprima modificabile e disambiguazione prima del salvataggio.
- **Sincronizzazione Bidirezionale Calendario (Google Calendar) & Notion**: Predisposta via Edge Functions con gestione token server-side protetta e risoluzione conflitti documentata.
- **Backup & Ripristino Completo**: Esportazione ed importazione di tutti i dati, impostazioni e immagini in formato JSON autonomo, ripristinabile in qualsiasi nuova installazione.
- **Cestino con Soft-Delete**: Protezione contro le eliminazioni accidentali con ripristino o eliminazione definitiva.

---

## 🚀 Avvio Rapido Locale

### Prerequisiti
- **Node.js** v18+ (testato su v24.22.1)
- **npm** v9+

### 1. Installazione Dipendenze
```bash
npm install
```

### 2. Avvio Server di Sviluppo
```bash
npm run dev
```
L'applicazione si aprirà su `http://localhost:5173`.

### 3. Esecuzione Test Automatizzati
```bash
npm test
```
Tutti i test unitari e di calcolo economico vengono eseguiti tramite **Vitest**.

### 4. Build per Produzione
```bash
npm run build
```
I file compilati e ottimizzati vengono generati nella cartella `dist/`.

---

## 📁 Struttura del Progetto

```
Gestionale1/
├── index.html                   # Entry point con layout reattivo desktop e mobile
├── package.json                 # Dipendenze e script
├── vite.config.js               # Configurazione Vite e test runner
├── .env.example                 # Modello variabili d'ambiente
├── public/                      # Asset pubblici e PWA
│   ├── manifest.webmanifest     # Manifest Progressive Web App
│   ├── sw.js                    # Service Worker (sicuro: non memorizza dati privati)
│   ├── sample-data.json         # Dataset dimostrativo facoltativo
│   └── icons/                   # Icone neutre per PWA (192px e 512px)
├── src/
│   ├── main.js                  # Bootstrap applicazione, router e theme loader
│   ├── styles/
│   │   └── main.css             # Design neutro, accessibile, breakpoints 320px-1440px
│   ├── utils/
│   │   ├── calculations.js      # Logica economica, sconti, oneri, IVA e anti-duplicati
│   │   ├── csv-importer.js      # Parser CSV, auto-detection template, wizard, commit idempotente
│   │   ├── xlsx-reader.js       # Lettore .xlsx senza dipendenze (ZIP + XML)
│   │   ├── formatters.js        # Formattazione valuta (€), date (it-IT) e file
│   │   ├── id.js                # Generatore UUID
│   │   └── indexed-db.js        # Gestione bozze preventivi e allegati locali
│   ├── services/
│   │   ├── store.js             # Store dati centralizzato, CRUD, Soft-delete e backup
│   │   ├── supabase.js          # Wrapper client Supabase con Storage upload
│   │   ├── ai.js                # Gemini + AI_PROFILES, payload di sistema, batch coda (solo IA, nessun parser locale)
│   │   ├── devils-advocate.js   # Evidenze deterministiche dai tuoi dati per l'Avvocato del Diavolo
│   │   ├── finances.js          # Logica pura: cash flow, ricorrenze, margine netto e ROI %
│   │   ├── note-queue-sync.js   # Sync best-effort della coda con Supabase (ai_note_queue)
│   │   └── pdf.js               # Motore PDF duplice (Digitale e Stampa)
│   └── modules/
│       ├── dashboard.js         # Dashboard operativa (solo urgenze, scadenze, quick to-do)
│       ├── todos.js             # Sezione To-do (scadenze rapide, raggruppamento mensile)
│       ├── clients.js           # Anagrafica e Scheda Cliente operativa
│       ├── calendar.js          # Calendario mensile, agenda mobile e shooting
│       ├── quotes.js            # Elenco e Editor Preventivi con foto voce
│       ├── quote-manager.js     # Pannello Gestisci (acconti, saldi, extra, consegna)
│       ├── finances.js          # Finanze & Cash Flow: panoramica, compravendita, ricorrenze, import (ex expenses.js)
│       ├── import-panel.js      # Drag & drop, auto-detection template e wizard di mapping
│       ├── note-queue-ui.js     # Coda Appunti del Giorno (cassetto + box flottante)
│       ├── catalog.js           # Catalogo prodotti e servizi
│       ├── reports.js           # Analisi finanziaria, incassi e margini
│       ├── settings.js          # Personalizzazione grafica, fisco e integrazioni
│       ├── trash.js             # Cestino di ripristino
│       ├── backup.js            # Esportazione e importazione JSON
│       └── ai-assistant.js      # Modal IA multimodale (audio, foto, testo)
├── supabase/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql    # Schema PostgreSQL con RLS su tutte le tabelle
│   │   ├── 002_storage_buckets.sql   # Bucket e policy sicurezza storage
│   │   └── 006_finances_and_queue.sql # finance_transactions, trading_items, ai_note_queue (+ copia idempotente di expenses)
│   └── functions/
│       ├── gemini-assistant/index.ts      # Edge Function Gemini Multimodal
│       ├── google-calendar-sync/index.ts  # Edge Function 2-Way Google Calendar
│       └── notion-sync/index.ts           # Edge Function Notion To-do
└── tests/
    └── gestionale.test.js       # Suite di test automatizzati per calcoli e regole
```

---

## 💶 Finanze, Compravendita, Importatore e Coda Appunti

### Finanze & Cash Flow (`Finanze & Spese`)
- **Panoramica**: KPI del mese (Entrate, Uscite, Cash Flow Netto, Costi Fissi Ricorrenti), ripartizione per categoria e tabella unificata con filtri per tipo, categoria e testo.
- **Compravendita**: `Margine Netto = vendita − acquisto − spese extra − commissioni`, `ROI % = netto / (acquisto + extra)`. Il client replica esattamente le colonne `GENERATED` di `trading_items`. Il campo opzionale *Ore impiegate* alimenta il profitto orario reale.
- **Ricorrenze**: mensili, settimanali e annuali. La generazione è idempotente e non rigenera le occorrenze cestinate. In `finance_transactions` la frequenza annuale è `yearly` (alias legacy `annual` accettato).
- **Retrocompatibilità**: `store.getAll('expenses')` / `create` / `update` operano su `finance_transactions` con `type = 'expense'`; vecchi dati locali e vecchi backup vengono migrati automaticamente. Tabella SQL `expenses` non modificata: la migration 006 ne copia le righe in modo idempotente.

### Importatore CSV / Excel (zero token)
| Header riconosciuti | Template | Destinazione |
|---|---|---|
| `date`, `calories`, `protein`… / `data`, `calorie`… | MyFitnessPal / Apple Health | `body_daily_logs` (aggregato per giorno, upsert) |
| `oggetto`, `acquisto`, `vendita`, `piattaforma`… | Compravendita / Flipping | `trading_items` |
| `data`, `descrizione`, `entrata`, `uscita` (o `importo` con segno) | Estratto Conto / Finanze | `finance_transactions` |

Supporta `.csv/.tsv` (separatori `; , tab |`, UTF-8 e Windows-1252, formati numerici italiani e inglesi) e `.xlsx` (lettore interno, date seriali incluse). Il vecchio formato `.xls` va salvato come `.xlsx` o CSV.

### Coda Appunti & Telegram
- **Web**: bottone flottante 📝 (o cassetto nell'Assistente IA) → scrivi e premi Invio, nessuna chiamata. *Elabora Coda con IA* invia **tutte** le note in un'unica richiesta con il profilo `ingestion_batch`, mostra l'anteprima e svuota la coda solo dopo la tua conferma.
- **Telegram**: `/queue <testo>` accoda, `/digest` elabora tutto in blocco (body, finanze, compravendita; to-do ed eventi vengono elencati). Opzionale: `supabase secrets set GESTIONALE_OWNER_USER_ID="<uuid utente Supabase Auth>"` perché le note inserite dal webhook (service role) siano visibili all'app via RLS.

### Avvocato del Diavolo & Profili
Toggle `🤝 Assistente Costruttivo | 😈 Avvocato del Diavolo` nell'header dell'assistente. Con il toggle attivo il payload di sistema include la persona critica e le evidenze calcolate sui dati reali (buffer +25-35% sui preventivi, ore implicite vs ore produttive, profitto orario reale vs tariffa dev, sonno e recupero). Senza modello IA risponde comunque con la critica deterministica. La tariffa oraria si imposta in *Impostazioni*. Profili disponibili in `AI_PROFILES`: `ingestion_batch`, `devils_advocate`, `nutrition_fitness`, `finance_coach`, `general_brain`.

---

## ☁️ Come funziona oggi (cloud-first, utente unico)

- **Una sola fonte di verità: Supabase.** Il browser tiene solo una copia veloce (cache) e sincronizza da solo (`src/services/cloud.js`): invia le modifiche, riceve quelle fatte altrove (es. da Telegram) in tempo reale, e mostra sempre lo stato in alto ("Sincronizzato", "Offline", "Errore").
- **Accesso con email e password** (Supabase Auth). Il database accetta **un solo utente**: il primo che si registra; ogni altro tentativo viene rifiutato (migrazione `007`/`008`). I dati senza proprietario vengono adottati dal primo utente.
- **Telegram** (`supabase/functions/telegram-webhook`): risponde "✅" solo se il database ha confermato la scrittura; ogni salvataggio ha il tasto *Annulla*. Risponde solo al proprietario (`TELEGRAM_ALLOWED_USER_ID`).
- **Fornitori IA in fila (niente attese infinite)**: si usano quelli con la chiave sul server, in quest'ordine: **OpenAI** (modello "mini", scelto in automatico; trascrive anche i vocali), poi **Gemini** (modello "lite", ragionamento spento), poi **Claude**. Se uno non risponde entro il suo tetto di tempo o dà errore, subentra il successivo. Chi ha risposto è sempre dichiarato. Nelle Impostazioni, *Verifica IA* controlla entrambi.
- **Telegram senza doppioni e senza attesa**: il bot conferma subito a Telegram e lavora in sottofondo; ogni messaggio viene elaborato una volta sola (registro `telegram_processed_updates`, migrazione `009`).
- **Nell'app si salva subito, con "Annulla" per 5 secondi**: niente finestra di conferma nell'uso quotidiano.
- **Solo IA, niente regole di ripiego**: assistente, Second Brain e Telegram usano esclusivamente Gemini. Se non risponde compare l'errore con il motivo (e su Telegram il messaggio viene messo in coda) — nessun dato viene indovinato da espressioni regolari.
- **IA**: la chiave sta solo sul server (secret `GEMINI_API_KEY`). Il modello viene scoperto dinamicamente (niente nomi di modello scritti nel codice). Se l'IA non risponde l'app lo dice chiaramente, non finge. *Impostazioni → Verifica IA* controlla tutto.
- **Second Brain**: prima mostra "Cosa ho capito" e salva solo dopo la tua conferma.
- **Inbox unico** in alto: scrivi qualsiasi cosa e Invio; "Da parte" mette la nota in coda per elaborarla in blocco con una sola richiesta IA.

### Segreti da impostare su Supabase (Edge Functions → Secrets)
`OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` (ne basta una, meglio due: la seconda fa da riserva), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID`. Opzionali: `OPENAI_MODEL`, `GEMINI_MODEL`, `ANTHROPIC_MODEL` (per forzare un modello). Mai nel codice o in chat.

### Edge Functions: codice condiviso
`src/services/gemini-core.js` è la copia canonica; `node scripts/sync-edge-shared.mjs` la copia nelle funzioni. Un test verifica che non ci siano differenze.

### Hosting gratuito
Supabase Free + Vercel Hobby bastano (uso personale). Attenzione: Supabase Free mette in pausa il progetto dopo ~1 settimana di inattività; Vercel Hobby è per uso non commerciale.

---

## 🗄️ Guida alla Configurazione di Supabase

### 1. Creazione Progetto
1. Accedi a [supabase.com](https://supabase.com) e crea un nuovo progetto indipendente.
2. Vai nella sezione **SQL Editor**.

### 2. Esecuzione Migrazioni
1. Copia ed esegui il file `supabase/migrations/001_initial_schema.sql` per creare:
   - Tabelle: `settings`, `clients`, `services_catalog`, `quotes`, `quote_items`, `quote_item_images`, `quote_extra_services`, `payments`, `todos`, `appointments`, `expenses`, `integrations_log`.
   - Abilitazione **Row Level Security (RLS)** su tutte le tabelle per isolare i dati per `user_id`.
   - Indici di performance per ricerche rapide.
2. Copia ed esegui il file `supabase/migrations/002_storage_buckets.sql` per configurare i bucket:
   - `quote-attachments`: Privato, max 5 MB, supporta JPEG, PNG, WebP. Accesso concesso solo all'utente proprietario.
   - `business-assets`: Per loghi aziendali.
3. Esegui in ordine le migration successive (`003`…`009`; `007` e `008` introducono sincronizzazione, blocco a utente unico e realtime). La `006_finances_and_queue.sql` crea `finance_transactions`, `trading_items` (con `net_profit` e `roi_percent` come colonne generate) e `ai_note_queue`, tutte con RLS.

### 3. Distribuzione Edge Functions
Assicurati di avere la CLI di Supabase installata (`supabase login`):
```bash
supabase functions deploy gemini-assistant --project-ref TUO_PROJECT_REF
supabase functions deploy google-calendar-sync --project-ref TUO_PROJECT_REF
supabase functions deploy notion-sync --project-ref TUO_PROJECT_REF
```
Imposta i segreti su Supabase:
```bash
supabase secrets set GEMINI_API_KEY="tua_chiave_gemini"
supabase secrets set GOOGLE_CLIENT_ID="tuo_client_id"
supabase secrets set GOOGLE_CLIENT_SECRET="tuo_client_secret"
supabase secrets set GOOGLE_REFRESH_TOKEN="tuo_refresh_token"
supabase secrets set NOTION_API_KEY="tua_notion_key"
supabase secrets set NOTION_DATABASE_ID="tuo_notion_db_id"
```

---

## 🤖 Integrazione Google Gemini (Edge Function o Diretta)

L'assistente si apre dalla casella **Inbox** in alto (Invio), dal tasto **+** sul telefono e dalla Scheda Cliente (con il cliente già impostato). Con **Avvocato del Diavolo** attivo non crea nulla: critica con i tuoi numeri.

### Funzionalità supportate:
- **Testo Libero**: Riconosce richieste multiple complesse (es. *"Devo attivare un abbonamento per lavorare, fare le foto prodotti per Cliente A e preparare i contenuti per Cliente B"*).
- **Registratore Vocale Diretto**: Utilizza l'API `MediaRecorder` del browser con timer in tempo reale.
- **Foto o Appunti Cartacei**: Caricamento immagini fino a 5 MB.
- **Anteprima e Disambiguazione**: Mostra le proposte strutturate con menu a tendina per confermare o correggere l'associazione del cliente prima del salvataggio definitivo. **Nessun record viene creato senza il consenso dell'utente**.

---

## 📅 Integrazione Google Calendar (Regole di Sincronizzazione)

- **Direzione Gestionale ➔ Google**: Ogni appuntamento o shooting creato o aggiornato nel gestionale viene inviato a Google Calendar tramite l'Edge Function.
- **Direzione Google ➔ Gestionale**: Gli eventi aggiornati su Google vengono importati salvando l'identificativo esterno `google_event_id` per evitare duplicati.
- **Regola di Risoluzione Conflitti**: Se un evento viene modificato contemporaneamente su entrambi i sistemi, ha precedenza la modifica con timestamp `updated_at` più recente. Tutte le operazioni e i potenziali conflitti vengono tracciati nella tabella `integrations_log`.

---

## 📄 Preventivi e Generazione PDF

### Foto di Voce Affiancate
Ogni singola voce di preventivo supporta fino a 20 immagini totali con didascalia (JPG, PNG, WebP fino a 5 MB). Nel PDF generato, le immagini appaiono **affiancate direttamente accanto alla riga della voce**, garantendo una lettura professionale.

### Denominazione File Standard
Il nome del file generato rispetta scrupolosamente il formato:
```
Preventivo - [Numero] - [Nome Cognome] - [Azienda].pdf
```
Caratteri speciali e spazi anomali vengono automaticamente sanificati (`sanitizeFileName`).

### Totale Modificabile & Opzione Mostra Totale
- È possibile specificare un **Totale Concordato** manuale che sovrascrive il calcolo matematico.
- L'opzione **"Mostra totale nel PDF"** (attiva di default) permette di nascondere il blocco finale del totale nel PDF, mostrando solo le singole voci e i loro prezzi (utile per listini o proposte modulari).

---

## 💾 Salvataggio Automatico su IndexedDB

Durante la compilazione del preventivo:
- Viene effettuato l'autosave locale ogni volta che si modifica un campo, includendo immagini in base64.
- In caso di ricaricamento o chiusura accidentale del browser, l'editor ripristina la bozza locale con un avviso chiaro.
- È possibile scartare volontariamente la bozza per tornare ai dati originari.
- **Protezione click accidentali sullo sfondo**: La finestra modale non si chiude se una selezione di testo iniziata all'interno termina sullo sfondo.

---

## 📦 Backup & Ripristino per Nuove Installazioni

Dal menu laterale (*Copia di sicurezza* / *Ripristina*):
1. **Esporta Backup**: Genera un file `.json` contenente impostazioni, clienti, preventivi, voci, immagini base64, to-do, appuntamenti e spese.
2. **Ripristina Backup**: Consente di caricare il file su una nuova installazione completamente vuota, ricostruendo l'intero database senza dipendere da vecchi URL o bucket remoti.

---

## 🚢 Distribuzione su Vercel o Netlify

L'applicazione è interamente compatibile con hosting statici:
- **Directory di Build**: `dist`
- **Comando di Build**: `npm run build`
- **Comando di Sviluppo**: `npm run dev`

Non richiede server Node.js attivo in produzione, in quanto interagisce direttamente con Supabase e le Edge Functions lato cloud.
