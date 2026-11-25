# UX Audit, Design System & Safe Redesign Plan — Gestionale AI

> **Branch di lavoro**: `ui-ux-redesign`  
> **Vincolo architetturale**: **Zero modifiche** alla logica di business, allo state management (`src/services/store.js`, `src/services/cloud.js`), alle Edge Functions o alle chiamate API (`src/services/ai-client.js`, `src/services/personal-rag.js`). Tutti i `132` test automatici esistenti (`tests/*.test.js`), gli ID del DOM, i selettori `data-*` e le firme dei moduli rimangono invariati al 100%.

---

## 1. Audit UX (`/figma-spec`)

L'ispezione del codice attuale ([index.html](file:///Users/antonio/Gestionale1/index.html), [src/styles/main.css](file:///Users/antonio/Gestionale1/src/styles/main.css), [src/styles/ui.css](file:///Users/antonio/Gestionale1/src/styles/ui.css) e i moduli in `src/modules/*.js`) ha evidenziato quattro criticità strutturali che penalizzano leggibilità, gerarchia visiva ed ergonomia durante l'uso prolungato.

### 1.1 "Split-Brain" dei fogli di stile, Densità Informativa e Gerarchia Visiva

1. **Conflitto tra due fogli di stile (`main.css` vs `ui.css`) e stili inline hardcoded**:
   - [src/styles/main.css](file:///Users/antonio/Gestionale1/src/styles/main.css#L12-L58) definisce un tema freddo in stile "slate/zinc" (`--bg: #f6f7f9`, `--accent: #2563eb`, sidebar scura `#09090b`, `font-size: 13.5px`).
   - [src/styles/ui.css](file:///Users/antonio/Gestionale1/src/styles/ui.css#L1-L26) (caricato successivamente in [index.html](file:///Users/antonio/Gestionale1/index.html#L16-L17)) sovrascrive metà delle variabili con una palette "warm paper" (`--bg: #f7f6f3`, `--accent: #3b5bdb`, sidebar chiara `#fffefb`, `font-size: 14.5px`) ricorrendo a `!important` (es. `.ai-modal-header { background: #fff !important; }`).
   - Allo stesso tempo, i moduli JS ([dashboard.js](file:///Users/antonio/Gestionale1/src/modules/dashboard.js), [finances.js](file:///Users/antonio/Gestionale1/src/modules/finances.js), [body.js](file:///Users/antonio/Gestionale1/src/modules/body.js), [clients.js](file:///Users/antonio/Gestionale1/src/modules/clients.js), [quotes.js](file:///Users/antonio/Gestionale1/src/modules/quotes.js), [brain.js](file:///Users/antonio/Gestionale1/src/modules/brain.js), [ai-assistant.js](file:///Users/antonio/Gestionale1/src/modules/ai-assistant.js)) contengono centinaia di `style="..."` inline con esadecimali freddi hardcoded (`#f8fafc`, `#f1f5f9`, `#1e40af`, `#fafafa`, `#e2e8f0`) che ignorano i token CSS e creano un contrasto incoerente tra superfici calde e box grigio-azzurri.
2. **Gerarchia tipografica e KPI Card disomogenee**:
   - Nelle viste [finances.js](file:///Users/antonio/Gestionale1/src/modules/finances.js#L43-L61), [body.js](file:///Users/antonio/Gestionale1/src/modules/body.js#L71-L108) e [brain.js](file:///Users/antonio/Gestionale1/src/modules/brain.js#L50-L68), le card metriche usano padding, raggi e dimensioni del font cablati inline (`24px`, `22px`, `18px`, `11px`) senza una classe condivisa `.kpi-card`.
   - I valori numerici in tabelle e card inline non applicano sistematicamente `font-variant-numeric: tabular-nums`, disallineando importi in Euro, pesi corporei e percentuali.
3. **Navigazione e Top Bar sovraffollata su viewport medi (`1024px–1366px`)**:
   - In [index.html](file:///Users/antonio/Gestionale1/index.html#L72-L103), la `.top-bar` comprime su una singola riga alta `60px`: il pulsante Indietro (`#back-btn`), il titolo pagina (`#page-title-text`), l'intero form di cattura rapida (`#inbox-form` con input + pulsante *"Invia"* + pulsante *"Da parte"* + badge `#inbox-queue-chip`) e l'indicatore cloud (`#sync-wrap`). Su laptop 13" il titolo pagina e la barra di cattura entrano in competizione spaziale.
   - Esiste inoltre una duplicazione visiva per la coda note: il chip `#inbox-queue-chip` nella Top Bar e il widget flottante `.queue-widget` in basso a destra ([src/modules/note-queue-ui.js](file:///Users/antonio/Gestionale1/src/modules/note-queue-ui.js)).

---

### 1.2 Ergonomia dell'Assistente AI e del Personal RAG

1. **Modale AI bloccante che copre e sfoca i dati del gestionale**:
   - Attualmente [src/modules/ai-assistant.js](file:///Users/antonio/Gestionale1/src/modules/ai-assistant.js#L13-L101) apre `#ai-assistant-overlay` come `.modal-overlay` centrato con `background: rgba(9, 9, 11, 0.48)` e `backdrop-filter: blur(6px)`.
   - **Problema UX critico**: quando l'utente apre l'Assistente AI o il *Devil's Advocate* mentre sta consultando un preventivo, la scheda di un cliente, il bilancio finanziario o la matrice del peso, **lo sfondo viene oscurato e sfocato**, impedendo di leggere o confrontare i numeri sottostanti mentre si formula il prompt o si valuta la risposta dell'AI.
   - **Soluzione ergonomica (Side-Drawer / Pannello Laterale Docked su Desktop)**:
     - Trasformare `#ai-assistant-overlay` su desktop (`>= 1024px`) in un **Drawer laterale destro non bloccante** (`width: 440px`, espandibile a `640px` con un toggle `.ai-expand-toggle`, senza blur sullo sfondo e con `pointer-events: none` sull'overlay esterno così da permettere lo scroll e la lettura della pagina sottostante), mantenendo il formato *Bottom-Sheet / Full-Screen* su mobile (`< 768px`).
     - Aggiungere nel header del Drawer un **pill di contesto visibile** che mostra la sezione attiva (es. `Contesto: Preventivi · Salute · Finanze`) e una scorciatoia rapida da tastiera (`⌘K` / `Ctrl+K` per la Quick Inbox o `⌘J` per il Drawer AI).
2. **Interfaccia "Chiedi a te stesso" ([src/modules/brain-chat.js](file:///Users/antonio/Gestionale1/src/modules/brain-chat.js))**:
   - I controlli della privacy per dominio (`#rag-domain-toggles`) e il selettore argomento (`#rag-domain-select`) sono attualmente impilati sopra i messaggi con molti stili inline (`font-size: 11px`, bordi tratteggiati `#cbd5e1`). Riorganizzarli in una **Context & Privacy Bar** compatta e sticky in testa alla chat migliora lo spazio verticale dedicato alla conversazione e rende immediatamente leggibile lo stato del lucchetto *"🔒 Finanze escluse di default"*.

---

### 1.3 Ottimizzazione di Tabelle, Form, Filtri, Skeleton e Feedback Visivi

| Area UI | Problema Attuale | Soluzione Progettata |
| :--- | :--- | :--- |
| **Tabelle Dati** ([quotes.js](file:///Users/antonio/Gestionale1/src/modules/quotes.js), [finances.js](file:///Users/antonio/Gestionale1/src/modules/finances.js), [body.js](file:///Users/antonio/Gestionale1/src/modules/body.js)) | Nelle righe di [quotes.js](file:///Users/antonio/Gestionale1/src/modules/quotes.js#L118-L132) ci sono **5 bottoni testuali affiancati** (`💼 Gestisci`, `✏️ Modifica`, `📄 PDF`, `📋 Duplica`, `🗑️`) che mandano a capo le righe su schermi medi e creano rumore visivo. | Mantenere l'azione primaria (`💼 Gestisci`) come bottone compatto con label e trasformare le azioni secondarie (`Modifica`, `PDF`, `Duplica`, `Elimina`) in **Icon Buttons (`.btn-icon`)** allineati in un gruppo `.row-actions` con `title`/tooltip chiaro, **preservando tutte le classi CSS esistenti** (`.quote-manage-btn`, `.quote-edit-btn`, `.quote-pdf-btn`, `.quote-duplicate-btn`, `.quote-trash-btn`). |
| **Filtri e Ricerca** ([clients.js](file:///Users/antonio/Gestionale1/src/modules/clients.js), [quotes.js](file:///Users/antonio/Gestionale1/src/modules/quotes.js), [finances.js](file:///Users/antonio/Gestionale1/src/modules/finances.js)) | Barre di filtro costruite con wrapper flex inline eterogenei e select/input di altezze diverse. | Standardizzare con il componente `.filter-toolbar` (`height: 38px` uniforme per input, select e segmented pills). |
| **Form e Modali** ([shell.js](file:///Users/antonio/Gestionale1/src/modules/shell.js)) | I form modali usano spaziatura uniforme ma mancano di raggruppamento visivo per campi correlati (es. Valori economici vs Note) e stato `:focus-visible` coerente. | Introdurre `.form-section`, `.form-grid-2`, `.form-grid-3` e hint contestuali `.field-hint` ad alto contrasto. |
| **Stati di Caricamento (Skeleton)** ([ui.css](file:///Users/antonio/Gestionale1/src/styles/ui.css#L172-L185), [ai-assistant.js](file:///Users/antonio/Gestionale1/src/modules/ai-assistant.js#L71-L74)) | `body.is-loading::before` blocca l'intera finestra con testo statico `"Sincronizzo i tuoi dati…"`, mentre l'AI mostra solo l'emoji `✨` che ruota. | Sostituire i loader testuali con **Shimmer Skeleton Loaders** strutturati (`.skeleton`, `.skeleton-line`, `.skeleton-kpi`, `.ai-thinking-skeleton`) e trasformare il sync iniziale in un banner/skeleton non bloccante. |
| **Empty States & Feedback** | Alcune liste vuote mostrano solo una riga di testo grigio `<p class="empty-state">`. | Arricchire `.empty-state` con contenitore bordato tratteggiato morbido, iconografia sobria, testo guida e CTA contestuale. |

---

## 2. Design System nel Codice (`/figma-generate-design`)

Il Design System viene unificato e centralizzato nei file CSS del progetto ([src/styles/main.css](file:///Users/antonio/Gestionale1/src/styles/main.css) e [src/styles/ui.css](file:///Users/antonio/Gestionale1/src/styles/ui.css)), eliminando il conflitto tra variabili e garantendo piena retrocompatibilità con tutti i nomi di token già usati nei moduli (`--bg`, `--card-bg`, `--text-main`, `--text-muted`, `--border`, `--accent`, ecc.).

### 2.1 Palette Colori: "Warm Daylight Studio" (Riposante per uso prolungato)

Progettata per sessioni lavorative lunghe: evita il bianco ottico puro (`#ffffff`) sullo sfondo generale per ridurre l'affaticamento visivo, usando una carta calda neutra (`#F6F5F2`) combinata con card bianche nitide (`#FFFFFF`) e inchiostro antracite profondo (`#18181B`) con rapporto di contrasto WCAG AAA (`> 12:1`).

```css
:root {
  /* ── Surface Hierarchy (Warm Neutral Daylight) ─────────────────── */
  --surface-canvas:   #F6F5F2; /* Sfondo pagina riposante (no abbagliamento) */
  --surface-sidebar:  #FAF9F6; /* Sidebar leggermente distinta dal canvas */
  --surface-card:     #FFFFFF; /* Card, tabelle e pannelli operativi */
  --surface-subtle:   #F1EFEA; /* Header tabelle, box secondari, pillole neutre */
  --surface-hover:    #EAE7E0; /* Hover su righe e controlli neutri */
  --surface-elevated: rgba(255, 255, 255, 0.94); /* Topbar & Drawer con backdrop blur */

  /* ── Text Hierarchy ────────────────────────────────────────────── */
  --text-primary:     #18181B; /* Titoli, dati principali, importi (WCAG AAA) */
  --text-secondary:   #52525B; /* Testo secondario, label form, descrizioni */
  --text-tertiary:    #71717A; /* Metadati, timestamp, placeholder (WCAG AA) */
  --text-on-accent:   #FFFFFF;

  /* ── Borders & Dividers ────────────────────────────────────────── */
  --border-subtle:    #ECEAE4; /* Divisori interni tabella */
  --border-default:   #E2DFD7; /* Bordo standard card e input */
  --border-strong:    #C8C4B9; /* Hover/Focus secondario */

  /* ── Primary Brand Accent (Indigo Royal — alta leggibilità) ───── */
  --accent-primary:   #364FC7;
  --accent-hover:     #2B40A8;
  --accent-subtle:    #EDF2FF;
  --accent-border:    #BAC8FF;
  --accent-ring:      rgba(54, 79, 199, 0.18);

  /* ── AI & Second Brain Accent (Violet Indigo) ──────────────────── */
  --ai-primary:       #5F3DC4;
  --ai-subtle:        #F3F0FF;
  --ai-border:        #D0BFFF;

  /* ── Semantic Status Colors (Basso abbagliamento, alto contrasto) */
  --status-success-fg: #166534;
  --status-success-bg: #DCFCE7;
  --status-success-bd: #BBF7D0;

  --status-warning-fg: #92400E;
  --status-warning-bg: #FEF3C7;
  --status-warning-bd: #FDE68A;

  --status-danger-fg:  #991B1B;
  --status-danger-bg:  #FEE2E2;
  --status-danger-bd:  #FECACA;

  --status-info-fg:    #1E40AF;
  --status-info-bg:    #DBEAFE;
  --status-info-bd:    #BFDBFE;

  /* ── Backward-Compatible Aliases (usati dai moduli esistenti) ──── */
  --bg:               var(--surface-canvas);
  --bg-subtle:        var(--surface-subtle);
  --card-bg:          var(--surface-card);
  --card-bg-hover:    var(--surface-hover);
  --text-main:        var(--text-primary);
  --text-secondary:   #52525B;
  --text-muted:       var(--text-tertiary);
  --border:           var(--border-default);
  --border-strong:    #C8C4B9;
  --accent:           var(--accent-primary);
  --accent-hover:     #2B40A8;
  --accent-light:     var(--accent-subtle);
  --accent-ring:      rgba(54, 79, 199, 0.18);
  --success:          #15803D;
  --success-bg:       var(--status-success-bg);
  --warning:          #B45309;
  --warning-bg:       var(--status-warning-bg);
  --danger:           #B91C1C;
  --danger-bg:        var(--status-danger-bg);
  --purple:           var(--ai-primary);
  --purple-bg:        var(--ai-subtle);
}
```

### 2.2 Scala Tipografica e Numerica

- **Font UI & Lettura (`--font-sans`)**: `'Inter', -apple-system, BlinkMacSystemFont, sans-serif` con `font-feature-settings: "cv02", "cv03", "cv04", "cv11"`.
- **Font Dati & Valute (`--font-mono`)**: `'JetBrains Mono', monospace` con `font-variant-numeric: tabular-nums` applicato a importi (`€`), percentuali, date in tabella, metriche corporee e notazione esercizi (`4x8@80kg`).

| Token | Dimensione | Line-Height | Peso | Utilizzo |
| :--- | :--- | :--- | :--- | :--- |
| `--text-2xs` | `11px` (`0.6875rem`) | `1.35` | `600` | Badge, contatori, label uppercase di sezione (`letter-spacing: 0.05em`) |
| `--text-xs` | `12.5px` (`0.781rem`) | `1.45` | `500` | Metadati, hint dei campi, header tabelle (`<th>`), filtri secondari |
| `--text-sm` | `13.5px` (`0.844rem`) | `1.5` | `400/500` | Celle tabelle (`<td>`), bottoni standard, voci di navigazione |
| `--text-base` | `14.5px` (`0.906rem`) | `1.55` | `400` | Corpo testo predefinito, input form, messaggi chat AI |
| `--text-lg` | `16px` (`1rem`) | `1.4` | `600` | Titoli di card (`.section-title`), header modali |
| `--text-xl` | `20px` (`1.25rem`) | `1.25` | `700` | Titolo vista nella Top Bar (`#page-title-text`), valori KPI secondari |
| `--text-2xl` | `26px` (`1.625rem`) | `1.15` | `700` | Valori KPI principali (`.kpi-value`), saldo netto, peso attuale |

### 2.3 Griglia di Spaziatura, Raggi ed Elevazione

- **Spaziatura (base 4px)**: `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-5: 20px`, `--space-6: 24px`, `--space-8: 32px`.
- **Raggi di curvatura**: `--radius-xs: 6px`, `--radius-sm: 8px`, `--radius-md: 12px`, `--radius-lg: 16px`, `--radius-full: 9999px`.
- **Ombre progressive a bassa opacità**:
  - `--shadow-xs`: `0 1px 2px rgba(24, 24, 27, 0.04)` (card a riposo)
  - `--shadow-sm`: `0 2px 6px -1px rgba(24, 24, 27, 0.06), 0 1px 2px rgba(24, 24, 27, 0.04)` (card interattive / hover)
  - `--shadow-drawer`: `-8px 0 32px -4px rgba(24, 24, 27, 0.12), -1px 0 0 var(--border-default)` (Drawer laterale Assistente AI)

### 2.4 Componenti UI Riutilizzabili (Classi Utility del Design System)

1. **`.kpi-grid` & `.kpi-card`**: Card metrica standardizzata con `.kpi-label` (uppercase `11px`), `.kpi-value` (`26px` tabular-nums), `.kpi-sub` (`12.5px` con delta semantico).
2. **`.ai-drawer-mode` (Assistente AI laterale non bloccante)**:
   - Su desktop (`>= 1024px`), `#ai-assistant-overlay` si ancora a destra (`justify-content: flex-end; background: transparent; backdrop-filter: none; pointer-events: none;`), mentre `.ai-modal` diventa un pannello a tutta altezza (`pointer-events: auto; width: 440px; height: calc(100vh - 24px); margin: 12px; border-radius: var(--radius-lg); box-shadow: var(--shadow-drawer);`).
   - Include un bottone nel header (`#ai-toggle-width-btn`) per allargare il drawer a `680px` quando si leggono analisi lunghe o tabelle generate dall'AI, senza mai oscurare i dati del gestionale a sinistra.
3. **`.filter-toolbar`**: Barra filtri unificata per Clienti, Preventivi, Finanze e Fonti RAG.
4. **`.row-actions` & `.btn-icon`**: Gruppo azioni compatto per le righe di tabella che elimina l'andata a capo dei 5 bottoni nei Preventivi.
5. **`.skeleton` & `.skeleton-shimmer`**: Animazione fluida `linear-gradient` per stati di caricamento AI, RAG e sincronizzazione.
6. **`.surface-box` & `.callout-box`**: Classi semantiche che sostituiscono i `div style="background: #f8fafc; border: 1px solid #e2e8f0..."` sparsi nei moduli JS.

---

## 3. Piano di Intervento Sicuro (`/plan`)

Di seguito la lista **esatta ed esaustiva** dei file e dei componenti UI che verranno toccati. Nessun file in `src/services/`, `src/utils/` o `supabase/` verrà modificato.

### Fase A — Fondamenta Design System e Shell Applicativa
1. **[src/styles/main.css](file:///Users/antonio/Gestionale1/src/styles/main.css)** & **[src/styles/ui.css](file:///Users/antonio/Gestionale1/src/styles/ui.css)**:
   - Unificazione dei token `:root` con la palette *Warm Daylight Studio* e mantenimento di tutti gli alias esistenti.
   - Definizione dei componenti `.kpi-card`, `.filter-toolbar`, `.row-actions`, `.btn-icon`, `.surface-box`, `.callout-box`, `.skeleton`, e del layout **Side-Drawer non bloccante** per `#ai-assistant-overlay`.
   - Risoluzione della compressione nella `.top-bar` su viewport medi (`1024px–1366px`) e armonizzazione del widget coda (`.queue-widget`).
2. **[index.html](file:///Users/antonio/Gestionale1/index.html)**:
   - Raffinamento semantico e di spaziatura della `.top-bar` e della `#quick-inbox` (mantenendo invariati tutti gli ID: `#inbox-form`, `#inbox-input`, `#inbox-later-btn`, `#inbox-queue-chip`, `#back-btn`, `#page-title-text`, `#sync-wrap`, `#open-ai-assistant`).

### Fase B — Ergonomia Assistente AI & Personal RAG ("Secondo Cervello")
3. **[src/modules/ai-assistant.js](file:///Users/antonio/Gestionale1/src/modules/ai-assistant.js)**:
   - Trasformazione del pannello `#ai-assistant-overlay` in **Side-Drawer non bloccante** su desktop con pulsante per espandere/ridurre l'ampiezza (`#ai-toggle-width-btn`) e pillola del contesto attivo, sostituendo gli stili inline hardcoded con classi del Design System e aggiungendo uno skeleton shimmer durante l'elaborazione (`#ai-loading-section`).
4. **[src/modules/brain.js](file:///Users/antonio/Gestionale1/src/modules/brain.js)**, **[src/modules/brain-chat.js](file:///Users/antonio/Gestionale1/src/modules/brain-chat.js)**, **[src/modules/brain-profile.js](file:///Users/antonio/Gestionale1/src/modules/brain-profile.js)**, **[src/modules/brain-sources.js](file:///Users/antonio/Gestionale1/src/modules/brain-sources.js)**:
   - Pulizia degli stili inline in *Chiedi a te stesso* (`brain-chat.js`): barra privacy/argomento compatta in alto, bolle messaggi ad alta leggibilità, pillole fonti espandibili ordinate e skeleton loader durante la generazione della risposta.
   - Uniformazione delle KPI card e dei tab in `brain.js`, della mappa identità in `brain-profile.js` e della tabella/dropzone importazione in `brain-sources.js`.

### Fase C — Viste Core del Gestionale (Oggi, Finanze, Corpo, Clienti, Preventivi, Secondarie)
5. **[src/modules/dashboard.js](file:///Users/antonio/Gestionale1/src/modules/dashboard.js)** (*Oggi*):
   - Sostituzione dei box inline (`#fafafa`) nella sezione *Fatti estratti dal Secondo Cervello* e allineamento visivo delle 4 card del bento grid (*Agenda*, *Focus*, *Corpo*, *Spese*).
6. **[src/modules/finances.js](file:///Users/antonio/Gestionale1/src/modules/finances.js)** (*Finanze*):
   - Applicazione di `.kpi-card` alle 4 metriche di bilancio, pulizia della barra di inserimento rapido (`#quick-tx-form`) e allineamento `tabular-nums` nella tabella movimenti.
7. **[src/modules/body.js](file:///Users/antonio/Gestionale1/src/modules/body.js)** (*Corpo & Salute*):
   - Applicazione di `.kpi-card` alle 4 card biometriche, pulizia dei pannelli inline (`#f8fafc`) per inserimento metriche e workout, e miglioramento della leggibilità della matrice storica e delle schede allenamento.
8. **[src/modules/clients.js](file:///Users/antonio/Gestionale1/src/modules/clients.js)** & **[src/modules/quotes.js](file:///Users/antonio/Gestionale1/src/modules/quotes.js)** (*Clienti & Preventivi*):
   - Applicazione di `.filter-toolbar` ai filtri di ricerca e stato.
   - Compattazione della colonna azioni in `quotes.js` (azione primaria + `.btn-icon` con tooltip per Modifica, PDF, Duplica, Elimina, mantenendo intatte tutte le classi `.quote-*-btn`).
9. **[src/modules/todos.js](file:///Users/antonio/Gestionale1/src/modules/todos.js)**, **[src/modules/calendar.js](file:///Users/antonio/Gestionale1/src/modules/calendar.js)**, **[src/modules/catalog.js](file:///Users/antonio/Gestionale1/src/modules/catalog.js)**, **[src/modules/settings.js](file:///Users/antonio/Gestionale1/src/modules/settings.js)**:
   - Rimozione degli stili inline residui nei pannelli secondari (es. sezione Avanzate in Impostazioni) per garantire coerenza visiva su tutte le 10 viste dell'applicazione.

---

### Garanzie di Sicurezza (Checklist Pre- e Post-Intervento)
- [x] Branch dedicato attivo: `ui-ux-redesign`.
- [ ] **Zero modifiche** a `src/services/*`, `src/utils/*`, `supabase/*`, `tests/*`.
- [ ] **100% compatibilità selettori DOM**: tutti gli `id`, `name`, `data-*` e classi agganciate da event listener (`.quote-manage-btn`, `.del-tx`, `.del-fact-btn`, `#rag-domain-toggles`, ecc.) restano identici.
- [ ] Esecuzione di `npm test` (132/132 test verdi) e `npm run build` dopo ogni modulo.
- [ ] Verifica visiva end-to-end nel browser (desktop + mobile responsive) tramite subagent `/browser`.
