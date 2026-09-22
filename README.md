# VRCManagerX

Applicazione desktop (Windows) che gestisce automaticamente le richieste di invito ricevute su VRChat quando lo stato è **Ask Me**, tramite whitelist, blacklist e modalità **Trusted Only**.

```
Richiesta in arrivo → Identifica utente → Blacklist? → REJECT
                                         → Whitelist? → ACCEPT
                                         → Trusted Only? → REJECT
                                         → altrimenti IGNORE (decidi tu in VRChat)
```

## Avvio rapido

Requisiti: Node.js 22+ (testato con Node 24) su Windows 10/11.

```bash
npm install
npm run dev        # sviluppo, con hot reload
npm run build      # compila in out/
npm start          # avvia la build compilata
npm test           # test unitari (regole, motore, persistenza, parsing)
npm run dist       # crea installer + versione portable in dist/
```

Se `npm install` non scarica Electron (npm 11 può bloccare gli script di installazione), esegui `node node_modules/electron/install.js`.

## Come si integra con VRChat (verificato)

VRChat **non ha un'API pubblica ufficiale né OAuth per app di terze parti**. L'app usa l'API web documentata dalla community ([vrchat.community](https://vrchat.community), [specifica OpenAPI](https://github.com/vrchatapi/specification)), la stessa usata dal sito di VRChat. Gli endpoint sono stati verificati sulla specifica aggiornata al 21/09/2026:

| Funzione | Endpoint |
|---|---|
| Login | `GET /auth/user` con HTTP Basic, poi `POST /auth/twofactorauth/{totp,emailotp,otp}/verify` |
| Sessione / logout | cookie `auth` (+ `twoFactorAuth`), `GET /auth`, `PUT /logout` |
| Monitoraggio in tempo reale | websocket `wss://pipeline.vrchat.cloud/?authToken=…`, evento `notification` di tipo `requestInvite` |
| Richieste pendenti all'avvio | `GET /auth/user/notifications` (una chiamata per connessione) |
| **Accetta** | `POST /invite/{userId}` `{ instanceId, messageSlot }`: invita il richiedente nella tua istanza, come fa il client |
| **Rifiuta** | `POST /invite/{notificationId}/response` `{ responseSlot }` |
| Pulizia notifica | `PUT /auth/user/notifications/{id}/hide` |
| Messaggi (reason) | `GET/PUT /message/{userId}/{message\|requestResponse}/{slot}` |
| Ricerca utenti | `GET /users?search=`, `GET /users/{id}`, `GET /auth/user/friends` |

### Limiti reali della piattaforma

- **I "reason" non sono testo libero.** VRChat invia solo testi salvati negli *invite message slot* dell'account (12 per tipo). L'app scrive i tuoi messaggi negli slot scelti nelle impostazioni (default: slot 12 per l'accettazione e slot 11/12 per i rifiuti). **Ogni slot si può modificare solo una volta ogni 60 minuti**: se lo slot è in cooldown, l'app mostra lo stato e riprova da sola alla scadenza. Nel frattempo VRChat usa il testo precedente, e il log registra il testo effettivamente inviato.
- **Accettare = invitare nella tua istanza attuale.** Se non sei in un'istanza (offline, caricamento), l'accettazione non è possibile: la richiesta resta intatta e viene registrata come errore.
- **Lo username degli altri utenti non è più esposto da VRChat** (solo il display name). Le card mostrano display name, ID `usr_…`, avatar e una nota privata.
- L'API non è supportata ufficialmente e può cambiare senza preavviso.

### Rispetto delle regole di VRChat ([Creator Guidelines – API](https://hello.vrchat.com/creator-guidelines))

- Nessun polling a intervalli fissi: tutto è guidato dagli eventi del websocket.
- Richieste REST serializzate e distanziate (min. 1 s), cache delle ricerche, backoff esponenziale sui 429 senza ritentare subito.
- User-Agent identificativo `VRCManagerX/<versione> <contatto>`: imposta un contatto (Discord/email) in *Settings → Advanced*.
- Il cookie di sessione viene riutilizzato, così non si crea una nuova sessione a ogni avvio (VRChat limita le sessioni).
- **Nota importante:** le linee guida chiedono alle app di non raccogliere né conservare credenziali VRChat *altrui*. VRCManagerX è pensato per essere usato **solo dal proprietario dell'account sul proprio PC**: le credenziali vanno direttamente ad `api.vrchat.cloud`, la password non viene mai salvata e la sessione resta cifrata su quel computer. Non trasformarlo in un servizio che gestisce account di altre persone. L'uso delle API resta sotto la tua responsabilità.

## Funzionalità

- Login VRChat con 2FA (app authenticator, codice email, codice di recupero), "resta connesso", logout.
- Gestione di sessione scaduta, disconnessione, perdita di rete, rate limit, errori API e VRChat non raggiungibile, con riconnessione automatica (backoff + ripresa dopo lo standby).
- Whitelist e Blacklist: aggiungi (ricerca per nome, ID `usr_…`, link del profilo o dalla lista amici), rimuovi, cerca, modifica (nota privata, aggiornamento da VRChat), sposta tra liste; niente duplicati.
- Trusted Only, interruttore globale "Enable Automation" e interruttori separati per accettazione/rifiuto automatico.
- Opzione "solo quando lo stato è Ask Me" (attiva di default).
- Messaggi personalizzabili con stato di sincronizzazione degli slot.
- Dashboard (stato automazione, connessione, account, statistiche, attività recenti), Activity Log con filtri (All, Accepted, Rejected, Ignored, Whitelist, Blacklist, Errors), ricerca, dettagli ed esportazione CSV/JSON.
- Notifiche discrete nell'app, tema scuro/chiaro/sistema, icona nel tray (l'automazione continua a finestra chiusa), avvio con Windows.

### Priorità delle regole

| Situazione | Risultato |
|---|---|
| Utente in blacklist | Rifiutato (anche con Trusted Only) |
| Utente in whitelist | Accettato |
| Sconosciuto + Trusted Only attivo | Rifiutato |
| Sconosciuto + Trusted Only disattivo | **Lasciato intatto** |
| Automazione disattivata | Nessuna azione (solo registrazione nel log) |

Casi limite: con il rifiuto automatico della blacklist disattivato, un utente blacklistato non viene mai accettato (Trusted Only lo rifiuta comunque, altrimenti resta intatto). Con l'accettazione automatica disattivata, un utente in whitelist resta intatto e non viene mai rifiutato.

## Sicurezza

- Password mai salvata; resta in memoria solo per la chiamata di login.
- Cookie di sessione cifrati con **Windows DPAPI** (Electron `safeStorage`) in `session.bin`; se la cifratura non è disponibile non viene salvato nulla.
- I token non arrivano mai all'interfaccia: il renderer è isolato (`contextIsolation`, `sandbox`, niente Node) e comunica solo tramite un bridge tipizzato, con validazione zod lato main di ogni input.
- CSP restrittiva, navigazione e nuove finestre bloccate, permessi del browser negati.
- Log e messaggi di errore passano da un filtro di redazione (cookie, token, Basic auth, password).
- Solo HTTPS/WSS verso host VRChat. Le immagini profilo passano da un protocollo interno (`vrcmx-img://`) con allowlist degli host; il cookie viene inviato solo ad `api.vrchat.cloud`.

## Dati

In `%APPDATA%\VRCManagerX\` (apribile da *Settings → Advanced → Open folder*):

| File | Contenuto |
|---|---|
| `settings.json` | impostazioni |
| `lists.json` | whitelist e blacklist |
| `stats.json`, `processed.json` | statistiche, richieste già gestite |
| `session.bin` | sessione cifrata (DPAPI) |
| `logs/activity.jsonl`, `logs/errors.log` | log attività e diagnostica |

Al primo avvio dopo il cambio di nome, i dati della vecchia cartella `%APPDATA%\GoyChat Manager\` (liste, impostazioni, statistiche, log e sessione) vengono copiati automaticamente nella nuova. La vecchia cartella resta intatta e si può eliminare dopo aver verificato che è tutto a posto.

Le scritture sono atomiche e mantengono un `.bak`. Un file corrotto viene rinominato `*.corrupt-<timestamp>` e l'app riparte dal backup o dai default, mostrando un avviso nella dashboard.

## Architettura

```
src/
├── main/                      processo principale (logica, nessuna UI)
│   ├── auth/                  login.ts · session.ts · logout.ts
│   ├── vrchat/                http.ts (client) · connection.ts (websocket) · inviteMonitor.ts
│   │                          userLookup.ts · inviteActions.ts · messageSlots.ts · presence.ts
│   ├── users/                 userStore.ts (whitelist/blacklist) · userSearch.ts
│   ├── automation/            rules.ts (valutazione pura + Trusted Only) · handlers.ts (accept/reject)
│   │                          engine.ts · stores.ts
│   ├── logging/               activityLog.ts · errorLog.ts · redact.ts
│   ├── storage/               jsonStore.ts · secureStore.ts · schemas.ts
│   ├── app/                   controller.ts (orchestrazione) · window.ts · tray.ts
│   ├── ipc/handlers.ts        API esposta alla UI, validata
│   └── images/                proxy immagini
├── preload/                   bridge sicuro (window.vrcmx)
├── shared/                    tipi, default e validazione comuni
└── renderer/                  UI React: Dashboard, Whitelist, Blacklist, Activity, Settings
```

La UI non contiene logica di gestione degli inviti: legge uno snapshot di stato e invia comandi.

`npm run preview:ui` avvia solo l'interfaccia nel browser con un backend finto (nessuna chiamata a VRChat), utile per lavorare sul design.

---
VRCManagerX è uno strumento indipendente, non affiliato né approvato da VRChat Inc.
