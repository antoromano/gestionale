# Piano di risanamento — Gestionale

Stato: **bozza da approvare**. Nessuna modifica è stata fatta al codice né a Supabase per scrivere questo piano.

## 1. Obiettivo in una frase
Un solo archivio dei dati (nel cloud), un login solo per te, e un'app che mostra **sempre** quello che c'è lì: se scrivi a Telegram, lo vedi nell'app, dal PC e dal telefono.

## 2. Domanda: stiamo trasformando l'app in una SaaS?
**Sì per come è costruita, no per come la usi.**
- Da fuori resta la tua app personale. Un solo utente: tu.
- Dentro cambia il principio: prima i dati stavano nel browser (local-first), ora stanno nel cloud (cloud-first) e il browser li mostra.
- Serve un **login**. Oggi nel tuo Supabase non esiste nessun utente: l'app non ha mai avuto un accesso.
- Si può tenere una copia nel browser per far vedere i dati anche con la rete lenta. Scrivere nuovi dati, almeno all'inizio, richiede la connessione.

È la scelta giusta perché Telegram non può scrivere dentro un browser: il cloud è l'unico posto raggiungibile da entrambi.

## 3. Servono server o un dominio?
**No, quello che hai basta.** Non c'è niente da affittare.

| Cosa | Dove sta | Costo |
|---|---|---|
| Dati, login, funzioni del bot | Supabase (piano gratuito) | 0 € |
| Il sito dell'app | Vercel | 0 € |
| Indirizzo | `qualcosa.vercel.app` | 0 € (il dominio proprio è facoltativo) |
| Bot | Telegram | 0 € |
| Intelligenza artificiale | Google Gemini | gratis con limiti |

Attenzioni vere, da conoscere prima di fidarti:
1. **Supabase gratuito mette in pausa il progetto dopo circa una settimana senza uso.** Se il progetto è in pausa il bot non risponde. Rimedio: un controllo periodico gratuito che lo tiene sveglio, oppure il piano a pagamento (circa 25 $/mese) se l'app diventa critica.
2. **Vercel gratuito (Hobby) è pensato per uso personale non commerciale.** Se usi l'app per la tua attività da freelance è una zona grigia: leggi le condizioni. Alternative gratuite per un sito statico: Cloudflare Pages o Netlify.
3. **Gemini gratuito ha limiti di richieste e può usare i tuoi dati per migliorare i prodotti Google.** Nelle note finiscono nomi e importi dei clienti. Per dati sensibili conviene il piano a pagamento a consumo (pochi centesimi al mese per questo uso).
4. I numeri esatti dei limiti cambiano: li controllo sui siti ufficiali prima di scrivere cifre nel codice.

## 4. Com'è oggi e come sarà

```
OGGI
  Telegram ──► Supabase (righe senza proprietario)
  Browser  ──► archivio del browser          (non si parlano)

DOPO
  Telegram ─┐
            ├──► Supabase (con il tuo login) ◄── App (PC e telefono)
  App ──────┘
```

## 5. Cosa si tiene e cosa si cambia
**Si tiene:** calcoli, finanze, importatore CSV/Excel, test, pagine già fatte, tabelle già create.
**Si cambia:**
- Il livello che legge e scrive i dati (`src/services/store.js`): parla con Supabase.
- Login (link via email).
- Il bot: scrive col tuo nome, controlla ogni scrittura e conferma solo se è andata a buon fine.
- I modelli Gemini, con avviso a schermo se falliscono.
- L'estrazione del Second Brain, con anteprima prima di salvare.

## 6. Le fasi
Ogni fase ha una prova che puoi fare tu. Non si passa alla successiva senza.

### Fase 0 — Messa in sicurezza (nessun rischio)
- Tu: premi *Esporta* nell'app e conserva il file. È la copia di tutti i dati nel browser.
- Io: controllo che le tabelle di Supabase abbiano le colonne che il codice si aspetta. Ne troveremo di mancanti, è normale.
- **Prova:** elenco scritto delle differenze tra l'app e il database.

### Fase 1 — Login e un solo utente
- Registrazione con la tua email, poi **chiudo le nuove registrazioni**: nessun altro potrà creare un account.
- Regole di sicurezza già presenti sulle tabelle: da verificare.
- I dati di stamattina arrivati da Telegram (senza proprietario) vengono collegati a te.
- **Prova:** accedi, esci, rientri.

### Fase 2 — L'app legge e scrive nel cloud
- All'avvio carica i dati da Supabase, ogni modifica viene salvata lì.
- *Importa backup*: il file della Fase 0 viene caricato nel cloud una volta sola.
- **Prova:** crei un cliente dal PC e lo vedi dal telefono.

### Fase 3 — Telegram che dice la verità
- Il bot scrive col tuo `user_id`, verifica che sia andato a buon fine, altrimenti scrive il motivo.
- `/queue` e `/digest` pubblicati e provati.
- **Prova (insieme):** scrivi "peso 75 kg" a Telegram e lo vedi nell'app.

### Fase 4 — Intelligenza artificiale affidabile
- Modello attuale per estrazione e confronto di testi (nomi verificati sulla documentazione ufficiale, non a memoria).
- Se la chiamata fallisce: messaggio chiaro, non salvataggio di fatti inventati.
- Second Brain: elenco di ciò che ha capito, tu confermi o correggi. Etichetta "estratto dall'IA" o "regole semplici".
- **Prova:** la nota su Marco di TechCorp produce Cliente, Contatto, Tecnologia, Budget, Scadenza, Preferenza.

### Fase 5 — Test di verità
- Un test che simula tutto il percorso: messaggio Telegram → cloud → app.
- Regola da qui in poi: nessuna funzione è "finita" senza questa prova.

### Fase 6 — Nuova interfaccia
- Una casella per scrivere qualsiasi cosa, poche pagine chiare (Oggi, Soldi, Corpo, Clienti, Cervello), via i pulsanti doppi.
- Prima di partire ti mostro uno schizzo e decidi tu.

## 7. Cosa tocco sul tuo Supabase
Solo dopo il tuo sì, e una fase alla volta:
- aggiunta di colonne e regole di sicurezza (migration, reversibili con un nuovo script);
- pubblicazione delle due funzioni del bot (sostituiscono la versione 4);
- 2 impostazioni dei segreti, che inserisci **tu** nel pannello Supabase: io non vedo mai i valori.
- Non elimino tabelle né righe.

## 8. Rischi e come li gestisco
| Rischio | Come |
|---|---|
| Perdere dati del browser | Backup in Fase 0, importazione controllata in Fase 2 |
| Colonne diverse tra app e database | Verifica in Fase 0, correzioni prima di scrivere |
| Progetto in pausa (piano gratuito) | Controllo periodico o piano a pagamento |
| Nessuna connessione | All'inizio l'app mostra gli ultimi dati scaricati e avvisa che non può salvare |
| Un'altra "dichiarazione di funzionamento" senza prova | Ogni fase ha una prova tua; Fase 5 ha un test automatico |

## 9. Decisioni che servono da te
1. **Approvi il passaggio cloud-first?**
2. **Quanto ti pesa non poter scrivere senza connessione?** (se molto, aggiungiamo una coda offline in una fase dedicata)
3. **Vercel gratuito va bene per te** o preferisci un'alternativa?
4. **Gemini:** gratuito con i limiti di riservatezza di cui sopra, o a pagamento?
5. Vuoi il **dominio personalizzato** o va bene `.vercel.app`?
