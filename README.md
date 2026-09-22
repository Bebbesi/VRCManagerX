# VRCManagerX

A Windows desktop app that automatically handles the invite requests you receive on VRChat while your status is **Ask Me**, using a whitelist, a blacklist and a **Trusted Only** mode.

```
Incoming request → Identify user → Blacklisted? → REJECT
                                 → Whitelisted? → ACCEPT
                                 → Trusted Only? → REJECT
                                 → otherwise IGNORE (you decide in VRChat)
```

## Quick start

Requirements: Node.js 22+ (tested with Node 24) on Windows 10/11.

```bash
npm install
npm run dev        # development, with hot reload
npm run build      # compile into out/
npm start          # run the compiled build
npm test           # unit tests (rules, engine, persistence, parsing)
npm run dist       # build the installer + portable version into dist/
```

If `npm install` doesn't download Electron (npm 11 can block install scripts), run `node node_modules/electron/install.js`.

## How it integrates with VRChat (verified)

VRChat **has no official public API and no OAuth for third-party apps**. The app uses the community-documented web API ([vrchat.community](https://vrchat.community), [OpenAPI specification](https://github.com/vrchatapi/specification)), the same one the VRChat website uses. The endpoints were checked against the specification as of 2026-09-21:

| Feature | Endpoint |
|---|---|
| Login | `GET /auth/user` with HTTP Basic, then `POST /auth/twofactorauth/{totp,emailotp,otp}/verify` |
| Session / logout | `auth` cookie (+ `twoFactorAuth`), `GET /auth`, `PUT /logout` |
| Real-time monitoring | websocket `wss://pipeline.vrchat.cloud/?authToken=…`, `notification` event of type `requestInvite` |
| Pending requests at startup | `GET /auth/user/notifications` (one call per connection) |
| **Accept** | `POST /invite/{userId}` `{ instanceId, messageSlot }`: invites the requester to your instance, as the client does |
| **Reject** | `POST /invite/{notificationId}/response` `{ responseSlot }` |
| Notification cleanup | `PUT /auth/user/notifications/{id}/hide` |
| Messages (reasons) | `GET/PUT /message/{userId}/{message\|requestResponse}/{slot}` |
| User search | `GET /users?search=`, `GET /users/{id}`, `GET /auth/user/friends` |

### Platform limitations

- **Reasons are not free text.** VRChat only sends texts saved in the account's *invite message slots* (12 per type). The app writes your messages into the slots chosen in the settings (default: slot 12 for accepting and slots 11/12 for rejecting). **Each slot can only be changed once every 60 minutes**: if a slot is on cooldown, the app shows its status and retries on its own when the cooldown ends. In the meantime VRChat uses the previous text, and the log records the text that was actually sent.
- **Accepting = inviting to your current instance.** If you aren't in an instance (offline, loading), accepting isn't possible: the request is left untouched and logged as an error.
- **VRChat no longer exposes other users' usernames** (only the display name). Cards show the display name, `usr_…` ID, avatar and a private note.
- The API is not officially supported and may change without notice.

### Following VRChat's rules ([Creator Guidelines – API](https://hello.vrchat.com/creator-guidelines))

- No fixed-interval polling: everything is driven by websocket events.
- REST requests are serialized and spaced out (at least 1 s apart), searches are cached, and 429s get exponential backoff with no immediate retry.
- Identifying User-Agent `VRCManagerX/<version> <contact>`: set a contact (Discord/email) in *Settings → Advanced*.
- The session cookie is reused, so a new session isn't created on every launch (VRChat limits sessions).
- **Important:** the guidelines ask apps not to collect or store *other people's* VRChat credentials. VRCManagerX is meant to be used **only by the account owner on their own PC**: credentials go straight to `api.vrchat.cloud`, the password is never saved and the session stays encrypted on that computer. Don't turn it into a service that manages other people's accounts. Use of the API is your own responsibility.

## Features

- VRChat login with 2FA (authenticator app, email code, recovery code), "stay signed in", logout.
- Handles expired sessions, disconnections, network loss, rate limits, API errors and VRChat being unreachable, with automatic reconnection (backoff + resume after sleep).
- Whitelist and blacklist: add (search by name, `usr_…` ID, profile link or from your friends list), remove, search, edit (private note, refresh from VRChat), move between lists; no duplicates.
- Trusted Only, a global "Enable Automation" switch and separate switches for auto-accept and auto-reject.
- "Only when status is Ask Me" option (on by default).
- Customizable messages with slot sync status.
- Dashboard (automation status, connection, account, statistics, recent activity), Activity Log with filters (All, Accepted, Rejected, Ignored, Whitelist, Blacklist, Errors), search, details and CSV/JSON export.
- Unobtrusive in-app notifications, dark/light/system theme, tray icon (automation keeps running with the window closed), start with Windows.

### Rule priority

| Situation | Result |
|---|---|
| User on the blacklist | Rejected (even with Trusted Only) |
| User on the whitelist | Accepted |
| Unknown + Trusted Only on | Rejected |
| Unknown + Trusted Only off | **Left untouched** |
| Automation off | No action (logged only) |

Edge cases: with blacklist auto-reject turned off, a blacklisted user is never accepted (Trusted Only still rejects them, otherwise the request is left untouched). With auto-accept turned off, a whitelisted user is left untouched and never rejected.

## Security

- The password is never saved; it stays in memory only for the login call.
- Session cookies are encrypted with **Windows DPAPI** (Electron `safeStorage`) in `session.bin`; if encryption isn't available, nothing is saved.
- Tokens never reach the UI: the renderer is isolated (`contextIsolation`, `sandbox`, no Node) and talks only through a typed bridge, with zod validation of every input on the main side.
- Strict CSP, navigation and new windows blocked, browser permissions denied.
- Logs and error messages go through a redaction filter (cookies, tokens, Basic auth, passwords).
- HTTPS/WSS to VRChat hosts only. Profile images go through an internal protocol (`vrcmx-img://`) with a host allowlist; the cookie is only sent to `api.vrchat.cloud`.

## Data

Stored in `%APPDATA%\VRCManagerX\` (open it from *Settings → Advanced → Open folder*):

| File | Contents |
|---|---|
| `settings.json` | settings |
| `lists.json` | whitelist and blacklist |
| `stats.json`, `processed.json` | statistics, requests already handled |
| `session.bin` | encrypted session (DPAPI) |
| `logs/activity.jsonl`, `logs/errors.log` | activity log and diagnostics |

On the first launch after the rename, data from the old `%APPDATA%\GoyChat Manager\` folder (lists, settings, statistics, logs and session) is copied into the new one automatically. The old folder is left intact and can be deleted once you've checked everything is in place.

Writes are atomic and keep a `.bak`. A corrupted file is renamed to `*.corrupt-<timestamp>` and the app restarts from the backup or the defaults, showing a warning on the dashboard.

## Architecture

```
src/
├── main/                      main process (logic, no UI)
│   ├── auth/                  login.ts · session.ts · logout.ts
│   ├── vrchat/                http.ts (client) · connection.ts (websocket) · inviteMonitor.ts
│   │                          userLookup.ts · inviteActions.ts · messageSlots.ts · presence.ts
│   ├── users/                 userStore.ts (whitelist/blacklist) · userSearch.ts
│   ├── automation/            rules.ts (pure evaluation + Trusted Only) · handlers.ts (accept/reject)
│   │                          engine.ts · stores.ts
│   ├── logging/               activityLog.ts · errorLog.ts · redact.ts
│   ├── storage/               jsonStore.ts · secureStore.ts · schemas.ts
│   ├── app/                   controller.ts (orchestration) · window.ts · tray.ts
│   ├── ipc/handlers.ts        API exposed to the UI, validated
│   └── images/                image proxy
├── preload/                   secure bridge (window.vrcmx)
├── shared/                    shared types, defaults and validation
└── renderer/                  React UI: Dashboard, Whitelist, Blacklist, Activity, Settings
```

The UI contains no invite-handling logic: it reads a state snapshot and sends commands.

`npm run preview:ui` runs just the UI in the browser with a fake backend (no calls to VRChat), handy for design work.

---
VRCManagerX is an independent tool, not affiliated with or endorsed by VRChat Inc.
