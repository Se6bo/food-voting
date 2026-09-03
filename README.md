**English** · [Deutsch](#deutsch)

# 🍲 Meal Voting

Shared meal planning, voting, and shopping list for shared flats and families.
Runs entirely on Cloudflare (Workers + D1).

---

## Features

| Area | What's possible |
| --- | --- |
| **Accounts** | Register, log in, edit profile and password |
| **Meal plan** | Upcoming days as cards, any number of recipe proposals per day – any group member can propose one |
| **Voting** | 👍 / 👎 per proposal, vote changeable until the deadline; the winner is the proposal with the highest yes-minus-no difference (tie-break: more yes votes, then the proposal submitted earlier), computed only after voting closes (live on every read, never stored) and shown in the UI with a winner marker |
| **Deadline** | Voting for a day is open until 11:59 pm the evening before – enforced server-side |
| **Meals** | Dishes with description, image, and structured ingredients (amount / unit / name) |
| **Groups** | Every user belongs to exactly one group; meals, plan, votes, and shopping list are strictly separated per group (other groups are invisible); registering without an invite code automatically founds a new group of one's own, a valid invite code joins the corresponding group instead; the profile page shows your own invite link to share; a global admin additionally sees a cross-group management view with ONLY metadata of all groups (name, member count, invite link) – NEVER their meals/plan/vote data; an admin can create empty groups and delete them (deletion only when they have 0 members) |
| **Shopping list** | Generated automatically from the planned meals, aggregates quantities, checkable |
| **Admin** | Manage users and roles, edit/delete meals, manage groups, close a day's voting early (with a confirmation dialog, since that immediately locks in the winner) or reopen it (no confirmation needed, uncritical), manage settings |
| **Design** | Light and dark mode, mobile first, fully responsive |

---

## Technical Decisions

The stack follows the recommendation from the assignment. In three places the
implementation deliberately deviates – in each case because the alternative
is simpler and has fewer moving parts:

**One Worker instead of Pages + a separate Worker.**
The built React client is served directly from the same Worker that also
serves the API, via [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/).
Advantage: frontend and API share one origin. Session cookies are therefore
first-party, there are no CORS special cases, and there's only one deployment
instead of two.

**PBKDF2 instead of bcrypt/argon2.**
Workers offer WebCrypto natively; bcrypt or argon2 would require a WASM
module and thus noticeably more bundle size and cold-start time. PBKDF2-
HMAC-SHA256 with 210,000 iterations is used – the current OWASP
recommendation for this method. See `src/worker/lib/password.ts`.

**Origin check instead of a CSRF token.**
The session cookie is `SameSite=Lax`, so browsers won't even send it on
cross-site POSTs. In addition, the Worker checks the `Origin` header against
its own host on every mutating request. For a same-origin SPA this is
equivalent to a token handshake, but without token management. See
`src/worker/lib/security.ts`.

Also avoided without extra dependencies: validation (instead of zod),
state management (React context is enough), and date formatting (`Intl`).

### Stack

- **Frontend** React 18 + TypeScript, Vite, Tailwind CSS, React Router
- **Backend** Cloudflare Workers with [Hono](https://hono.dev/) as the router
- **Database** Cloudflare D1 (SQLite) with migrations
- **Auth** server-side sessions, HttpOnly cookies

---

## Project Structure

```
├── migrations/              D1 migrations (SQL)
├── public/                  Static files (theme bootstrap)
├── src/
│   ├── shared/types.ts      Types shared between Worker and client
│   ├── worker/
│   │   ├── index.ts         Entry point, routing, error handling
│   │   ├── lib/             Auth, passwords, time/deadline, units,
│   │   │                    validation, security, settings
│   │   └── routes/          auth, groups, meals, planning, votes,
│   │                        shopping, admin, cookidoo
│   └── client/
│       ├── components/      Layout, planned-day card, UI building blocks
│       ├── lib/             API client, auth context, theme, toasts, formats
│       └── pages/           Login, registration, dashboard, plan, meals,
│                            shopping list, profile, admin
├── wrangler.toml            Cloudflare configuration
└── .env.example             Template for local secrets
```

---

## Local Development

Requirement: Node.js 20 or newer.

```bash
git clone https://github.com/Se6bo/food-voting.git
cd food-voting
npm install

# Create secrets for local development
cp .env.example .dev.vars      # .dev.vars is in .gitignore

# Set up the local D1 database
npm run db:migrate:local

# Build the client and start the Worker (http://localhost:8787)
npm run preview
```

`npm run preview` builds the client and starts the Worker, which serves API
and UI together – this matches production most closely.

For fast UI iteration with hot reload, use two terminals:

```bash
npm run dev:worker    # Worker + D1 on port 8787
npm run dev           # Vite on port 5173, /api is proxied to 8787
```

More scripts:

```bash
npm run typecheck     # Check TypeScript for Worker and client
npm run build         # Typecheck + production build
```

### Setting Up the First Admin

The first admin is **never stored in code or in the database**, but
determined via an environment variable:

1. Set `ADMIN_EMAIL` in `.dev.vars` (locally) or as a secret (production).
2. Register with exactly that email address – the account automatically
   gets the `admin` role.

As a safety net, the very first registered user also becomes an admin, so
the application never ends up without an administrator.

Invite codes belong to groups, not to the app as a whole, and need no
configuration: if someone registers without a code, the app automatically
founds a new group of their own with a randomly generated invite code
(visible on the members' profile page and in the admin group overview).
Anyone who provides a valid code during registration joins the corresponding
group instead. There is no server-side secret for this (anymore) – the
former environment variable `SIGNUP_INVITE_CODE` was removed when groups
were introduced.

Alternatively, an admin can close registration entirely in the admin area.

---

## Deployment to Cloudflare

### 1. GitHub repository

```bash
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

### 2. Log in to Cloudflare

```bash
npx wrangler login
```

### 3. Create the D1 database

```bash
npx wrangler d1 create food-voting-db
```

The command outputs a `database_id`. Enter it in `wrangler.toml`, replacing
the placeholder:

```toml
[[d1_databases]]
binding = "DB"
database_name = "food-voting-db"
database_id = "the-id-that-was-printed"
```

### 4. Run migrations

```bash
npm run db:migrate        # equivalent to: wrangler d1 migrations apply food-voting-db --remote
```

### 5. Set secrets

Secrets do **not** belong in `wrangler.toml` and not in the repository:

```bash
npx wrangler secret put ADMIN_EMAIL
```

### 6. Deploy

```bash
npm run deploy
```

The command builds the client and uploads the Worker along with the UI.
Then open the printed URL and register with the `ADMIN_EMAIL`.

> In production (`ENVIRONMENT = "production"`) the Worker sets the session
> cookie with `Secure` – the application must therefore run over HTTPS. On
> Cloudflare that's the default.

### 7. View logs

`wrangler.toml` enables Workers Logs for `env.production`
(`[env.production.observability]`). This makes server logs – including
`console.error`/`console.log`, among them the detailed Cookidoo error
messages – appear in the Cloudflare dashboard under **Workers & Pages →
food-voting → "Logs" tab**, once a new deploy has happened afterwards (after
`npm run deploy` or the next automatic Cloudflare build). A CLI call like
`wrangler tail` is no longer necessary for this. Any Git integration
(automatic build on push) that may have been set up in the Cloudflare
project settings themselves is not visible from this repository – the repo
itself contains no `.github/workflows` workflow.

---

## API

All endpoints live under `/api`. Mutating calls require a valid session and
a matching `Origin` header.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/me` | Current user, app name, registration status, date, timezone |
| `GET` | `/api/settings` | Full system settings (signed-in users) |
| `POST` | `/api/auth/register` | Register (with optional group invite code) |
| `POST` | `/api/auth/login` | Log in (rate-limited) |
| `POST` | `/api/auth/logout` | Log out |
| `PUT` | `/api/auth/profile` | Change name and password |
| `GET` | `/api/groups/me` | Own group: name, invite code/link, member list |
| `GET` | `/api/meals` | Meals of the own group, with ingredients |
| `GET` | `/api/meals/:id` | Single meal from the own group |
| `POST` | `/api/meals` | Create a meal in the own group |
| `PUT` | `/api/meals/:id` | Edit a meal (own meal, or any as admin – own group only) |
| `DELETE` | `/api/meals/:id` | Delete a meal (own meal, or any as admin – own group only) |
| `GET` | `/api/planning` | Meal plan of the own group, incl. all proposals per day, votes, and winner |
| `POST` | `/api/planning` | Submit a meal as a proposal for a day |
| `DELETE` | `/api/planning/:id` | Remove a planned day with all its proposals (admin) |
| `GET` | `/api/votes` | Own votes (across all proposals) |
| `POST` | `/api/votes` | Vote for/against a proposal or change a vote |
| `DELETE` | `/api/votes/:proposalId` | Retract own vote on a proposal |
| `GET` | `/api/shopping-list` | Aggregated shopping list of the own group |
| `POST` | `/api/shopping-list` | Add a manual item |
| `PUT` | `/api/shopping-list/:id` | Check / uncheck an item |
| `DELETE` | `/api/shopping-list/:id` | Remove an item |
| `POST` | `/api/shopping-list/clear-checked` | Remove checked items |
| `POST` | `/api/shopping-list/reset` | Rebuild the list from the plan |
| `GET` | `/api/admin/users` | User list (admin) |
| `PUT` | `/api/admin/users/:id` | Change role (admin) |
| `DELETE` | `/api/admin/users/:id` | Delete a user (admin) |
| `GET` | `/api/admin/groups` | All groups with metadata: name, member count, invite link (admin) |
| `POST` | `/api/admin/groups` | Create a new, empty group (admin) |
| `DELETE` | `/api/admin/groups/:id` | Delete a group, only if it has 0 members (admin) |
| `GET` | `/api/admin/votes` | All votes/polls of the own group (admin; NOT cross-group) |
| `PUT` | `/api/admin/votes/:id` | Open/close a day's voting (admin, own group only) |
| `GET` `PUT` | `/api/admin/settings` | System settings (admin) |
| `GET` | `/api/admin/stats` | Key figures for the admin dashboard, across all groups (admin) |
| `GET` | `/api/cookidoo/status` | Is the Cookidoo import enabled? |
| `GET` | `/api/cookidoo/search?q=...` | Search Cookidoo recipes |
| `GET` | `/api/cookidoo/recipes/:id` | Recipe details for import |

---

## Data Model

```
groups ──┬── users ──── sessions
         ├── meals ──── ingredients
         ├── plan_days ── meal_proposals ── proposal_votes
         └── shopping_items

meal_proposals also references meals; proposal_votes also references users.

settings         (app name, planning horizon, registration, deadline hour)
login_attempts   (rate limiting)
cookidoo_session (Cookidoo OAuth2 tokens, a single row for the whole deployment)
```

Important rules enforced in the database:

- `groups.invite_code` is `UNIQUE` – every invite code belongs to exactly one group.
- `users.group_id` references the user's own group (`ON DELETE SET NULL`); the
  application logic (`requireGroupId`) requires every signed-in user to have one.
- `meals.group_id` and `shopping_items.group_id` strictly separate meals and
  the shopping list by group (`ON DELETE CASCADE` when a group is deleted).
- `plan_days`: `UNIQUE(group_id, date)` – exactly one planning entry per group
  and day, with any number of proposals attached.
- `meal_proposals`: `UNIQUE(plan_day_id, meal_id)` – the same meal cannot be
  proposed twice for the same day.
- `proposal_votes`: `UNIQUE(user_id, proposal_id)` – one vote per user and
  per proposal.
- Foreign keys with `ON DELETE CASCADE` clean up dependent data; when a user
  is deleted, their meals are kept (`created_by` becomes `NULL`).
- A group can only be deleted once it has 0 members (application logic in
  `/api/admin/groups`, not a DB constraint).

---

## Security

- Passwords as salted PBKDF2-SHA256 with 210,000 iterations, constant-time comparison
- Server-side sessions; the cookie holds a random token, only its SHA-256 hash is stored
- Cookies `HttpOnly`, `SameSite=Lax`, additionally `Secure` in production
- CSRF protection via origin checking on all mutating requests
- Authorization exclusively server-side – the client can never claim its own role
- Login rate limiting: strict per account, noticeably more lenient per IP, so
  a shared connection doesn't lock out all flatmates
- All database access via bound parameters (prepared statements)
- Image URLs are restricted to `http`/`https`, `javascript:` is rejected
- Security headers incl. a Content Security Policy without `unsafe-inline` for scripts
- Technical errors are logged, only a generic message goes out to the client
- A role change terminates the affected user's sessions

---

## Voting Deadline

The deadline is tied to a fixed app timezone (`Europe/Berlin`), not the
browser's timezone – otherwise users would end up with different deadlines.

Voting for a planned day is open until **11:59:59 pm the evening before**
(the hour is configurable in the admin area). For Friday that means: until
Thursday 11:59 pm. After that, the result stays visible, but votes can no
longer be cast or changed.

The check happens in `src/worker/lib/time.ts` and is evaluated server-side on
every voting attempt. Daylight-saving transitions are accounted for. The
frontend merely hides the button – that's a convenience, not a safeguard.

In addition, an admin can close a day's voting early at any time, independent
of the deadline, or reopen a closed one (`PUT /api/admin/votes/:id`). Closing
requires a confirmation in the admin area, because it immediately locks in
the currently leading proposal as the winner; reopening is uncritical and
needs no confirmation.

---

## Shopping List

The list is built from the ingredients of all planned meals in the period.
Ingredients with the same name are aggregated, but only within the same unit
dimension:

| Input | Result |
| --- | --- |
| 500 g tomatoes + 500 g tomatoes | 1 kg tomatoes |
| 1 l broth + 500 ml broth | 1.5 l broth |
| 1 tsp + 2 tsp curry powder | 1 tbsp curry powder |
| 500 g tomatoes + 2 pcs tomatoes | stay as two entries |
| Salt (no amount) from two dishes | one entry without an amount |

Recognized are mg/g/kg, ml/cl/dl/l, pieces, tsp/tbsp, and units without a
sensible conversion (pinch, bunch, can, package, clove …), each with and
without special characters. The checked state is preserved when the plan
changes; if the amount changes, it's updated. When a meal disappears from
the plan, its ingredient disappears too.

*Note: the actual "day with any number of proposals" model only builds the
shopping list from the **winner** of each closed day – see "Data model" and
`src/worker/routes/shopping.ts`. While a day is still open, there are
multiple proposals and thus no unambiguous quantity yet.*

---

## Cookidoo Import

Meals can optionally be imported directly from Thermomix **Cookidoo**: in the
"Add meal" form, search for a recipe and use "Apply" to pre-fill title,
image, and the full ingredient list into the form. Everything can still be
adjusted afterwards before saving.

This runs through the **operator's own Cookidoo account** (one account for
the whole app, not per user) and an **unofficial, reverse-engineered API**
from Vorwerk – there is no public/official interface for this.

### Architecture: Worker → proxy service on a home computer

Cookidoo/Vorwerk blocks requests coming from Cloudflare Workers data-center
IPs with a bot-protection 403 – this also affects successfully logged-in
sessions. The same calls work fine from an ordinary home internet
connection, though. The entire login/search/recipe-detail flow therefore no
longer runs **in the Worker**, but in a small, separate Node.js service on a
home computer (a permanently running process, e.g. as a systemd service).
The Worker only calls this proxy over HTTP and passes through its (already
user-safe) error messages:

```
Cloudflare Worker  --HTTP + bearer token-->  Proxy service (home computer)  -->  Cookidoo
```

The Cookidoo credentials (`COOKIDOO_EMAIL`/`COOKIDOO_PASSWORD`) therefore
live **only locally on the proxy machine** (in its `.env`), never in
Cloudflare anymore. The Worker no longer knows them at all, only the proxy
URL and a separate, purely internal token.

Concretely, this means:

- It is used exclusively for the private use of the operator's own subscription.
- Cookidoo can change its internal API at any time without notice; the
  import can therefore stop working at any time without this app having
  done anything wrong. Only search and import are affected – the rest of
  the app keeps working independently of that.
- The import only works while the proxy machine is on and online. If it
  goes down, the Worker returns a clear error message instead of crashing.
- Without `COOKIDOO_PROXY_URL`/`COOKIDOO_PROXY_TOKEN` set, the feature is
  fully disabled (`GET /api/cookidoo/status` returns `{ "enabled": false }`),
  nothing crashes.

### Enabling it

```bash
npx wrangler secret put COOKIDOO_PROXY_URL
npx wrangler secret put COOKIDOO_PROXY_TOKEN
npm run deploy
```

For local development, put `COOKIDOO_PROXY_URL` and `COOKIDOO_PROXY_TOKEN`
into `.dev.vars` instead (stays in `.gitignore` as before and is never
committed).

---

## License

MIT

---

<a id="deutsch"></a>

## 🇩🇪 Deutsch

# 🍲 Essensplan

Gemeinsame Essensplanung, Abstimmung und Einkaufsliste für WGs und Familien.
Läuft vollständig auf Cloudflare (Workers + D1).

---

## Funktionsumfang

| Bereich | Was möglich ist |
| --- | --- |
| **Konten** | Registrieren, anmelden, Profil und Passwort ändern |
| **Essensplan** | Kommende Tage als Karten, beliebig viele Rezeptvorschläge pro Tag – jeder Gruppenteilnehmer kann vorschlagen |
| **Abstimmung** | 👍 / 👎 pro Vorschlag, Stimme änderbar bis zur Deadline; Gewinner ist der Vorschlag mit der höchsten Ja-minus-Nein-Differenz (Tie-Break: mehr Ja-Stimmen, dann der früher eingereichte Vorschlag), wird erst nach Schließen der Abstimmung berechnet (live bei jedem Lesezugriff, nie gespeichert) und in der Oberfläche mit einer Gewinner-Kennzeichnung angezeigt |
| **Deadline** | Für einen Tag darf bis zum Vorabend 23:59 Uhr abgestimmt werden – serverseitig erzwungen |
| **Essen** | Gerichte mit Beschreibung, Bild und strukturierten Zutaten (Menge / Einheit / Name) |
| **Gruppen** | Jeder Nutzer gehört genau einer Gruppe an; Essen, Plan, Abstimmungen und Einkaufsliste sind strikt pro Gruppe getrennt (andere Gruppen sind unsichtbar); eine Registrierung ohne Einladungscode gründet automatisch eine neue eigene Gruppe, mit gültigem Einladungscode tritt man stattdessen der zugehörigen Gruppe bei; im Profil sieht man den eigenen Einladungslink zum Teilen; ein globaler Admin sieht zusätzlich eine gruppenübergreifende Verwaltungsansicht mit NUR Metadaten aller Gruppen (Name, Mitgliederzahl, Einladungslink) – NIE deren Essens-/Plan-/Abstimmungsdaten; Admin kann leere Gruppen anlegen und löschen (Löschen nur wenn 0 Mitglieder) |
| **Einkaufsliste** | Entsteht automatisch aus den geplanten Essen, fasst Mengen zusammen, abhakbar |
| **Admin** | Benutzer und Rollen verwalten, Essen bearbeiten/löschen, Gruppen verwalten, Abstimmung eines Tages vorzeitig schließen (mit Bestätigungsdialog, da damit sofort der Gewinner feststeht) oder wieder öffnen (ohne Bestätigung, unkritisch), Einstellungen |
| **Design** | Light- und Dark-Mode, Mobile First, vollständig responsiv |

---

## Technische Entscheidungen

Der Stack folgt der Empfehlung aus der Aufgabenstellung. An drei Stellen
weicht die Umsetzung bewusst ab – jeweils, weil die Alternative einfacher ist
und weniger bewegliche Teile hat:

**Ein Worker statt Pages + separatem Worker.**
Der gebaute React-Client wird über [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
direkt vom selben Worker ausgeliefert, der auch die API bedient. Vorteil:
Frontend und API teilen sich eine Origin. Session-Cookies sind damit
First-Party, es gibt keine CORS-Sonderfälle und nur ein Deployment statt zwei.

**PBKDF2 statt bcrypt/argon2.**
Workers bieten WebCrypto nativ an; bcrypt oder argon2 würden ein
WASM-Modul und damit spürbar mehr Bundle-Größe und Cold-Start-Zeit bedeuten.
Verwendet wird PBKDF2-HMAC-SHA256 mit 210.000 Iterationen – der aktuellen
OWASP-Empfehlung für dieses Verfahren. Siehe `src/worker/lib/password.ts`.

**Origin-Prüfung statt CSRF-Token.**
Das Session-Cookie ist `SameSite=Lax`, wodurch Browser es bei
cross-site-POSTs gar nicht erst mitsenden. Zusätzlich prüft der Worker bei
jedem verändernden Request den `Origin`-Header gegen den eigenen Host. Für
eine Same-Origin-SPA ist das gleichwertig zu einem Token-Handshake, aber ohne
Token-Verwaltung. Siehe `src/worker/lib/security.ts`.

Ohne zusätzliche Abhängigkeiten kommen außerdem aus: Validierung (statt zod),
State-Management (React-Context reicht) und Datumsformatierung (`Intl`).

### Stack

- **Frontend** React 18 + TypeScript, Vite, Tailwind CSS, React Router
- **Backend** Cloudflare Workers mit [Hono](https://hono.dev/) als Router
- **Datenbank** Cloudflare D1 (SQLite) mit Migrationen
- **Auth** serverseitige Sessions, HttpOnly-Cookies

---

## Projektstruktur

```
├── migrations/              D1-Migrationen (SQL)
├── public/                  Statische Dateien (Theme-Bootstrap)
├── src/
│   ├── shared/types.ts      Typen, die Worker und Client teilen
│   ├── worker/
│   │   ├── index.ts         Einstiegspunkt, Routing, Fehlerbehandlung
│   │   ├── lib/             Auth, Passwörter, Zeit/Deadline, Einheiten,
│   │   │                    Validierung, Sicherheit, Einstellungen
│   │   └── routes/          auth, groups, meals, planning, votes,
│   │                        shopping, admin, cookidoo
│   └── client/
│       ├── components/      Layout, Karte für geplante Tage, UI-Bausteine
│       ├── lib/             API-Client, Auth-Context, Theme, Toasts, Formate
│       └── pages/           Login, Registrierung, Dashboard, Plan, Essen,
│                            Einkaufsliste, Profil, Admin
├── wrangler.toml            Cloudflare-Konfiguration
└── .env.example             Vorlage für lokale Secrets
```

---

## Lokale Entwicklung

Voraussetzung: Node.js 20 oder neuer.

```bash
git clone https://github.com/Se6bo/food-voting.git
cd food-voting
npm install

# Secrets für die lokale Entwicklung anlegen
cp .env.example .dev.vars      # .dev.vars ist in .gitignore

# Lokale D1-Datenbank aufsetzen
npm run db:migrate:local

# Client bauen und Worker starten (http://localhost:8787)
npm run preview
```

`npm run preview` baut den Client und startet den Worker, der API und
Oberfläche gemeinsam ausliefert – das entspricht der Produktion am genauesten.

Für schnelles UI-Iterieren mit Hot Reload zwei Terminals:

```bash
npm run dev:worker    # Worker + D1 auf Port 8787
npm run dev           # Vite auf Port 5173, /api wird auf 8787 weitergeleitet
```

Weitere Skripte:

```bash
npm run typecheck     # TypeScript für Worker und Client prüfen
npm run build         # Typecheck + Produktions-Build
```

### Ersten Admin einrichten

Der erste Admin wird **nie im Code oder in der Datenbank hinterlegt**, sondern
über eine Umgebungsvariable bestimmt:

1. In `.dev.vars` (lokal) bzw. als Secret (Produktion) `ADMIN_EMAIL` setzen.
2. Mit genau dieser E-Mail-Adresse registrieren – das Konto erhält
   automatisch die Rolle `admin`.

Als Sicherheitsnetz wird zusätzlich der allererste registrierte Benutzer zum
Admin, damit die Anwendung nie ohne Administrator dasteht.

Einladungscodes gehören zu Gruppen, nicht zur App insgesamt, und brauchen
keine Konfiguration: Registriert sich jemand ohne Code, gründet die App
automatisch eine neue eigene Gruppe mit einem zufällig generierten
Einladungscode (sichtbar im Profil der Mitglieder und in der
Admin-Gruppenübersicht). Wer beim Registrieren einen gültigen Code angibt,
tritt stattdessen der zugehörigen Gruppe bei. Ein Server-Secret dafür gibt es
nicht (mehr) – die frühere Umgebungsvariable `SIGNUP_INVITE_CODE`
wurde mit der Einführung von Gruppen entfernt.

Alternativ kann ein Admin die Registrierung im Admin-Bereich ganz schließen.

---

## Deployment auf Cloudflare

### 1. GitHub-Repository

```bash
git remote add origin https://github.com/<benutzer>/<repo>.git
git push -u origin main
```

### 2. Bei Cloudflare anmelden

```bash
npx wrangler login
```

### 3. D1-Datenbank anlegen

```bash
npx wrangler d1 create food-voting-db
```

Der Befehl gibt eine `database_id` aus. Diese in `wrangler.toml` eintragen und
den Platzhalter ersetzen:

```toml
[[d1_databases]]
binding = "DB"
database_name = "food-voting-db"
database_id = "hier-die-ausgegebene-id"
```

### 4. Migrationen ausführen

```bash
npm run db:migrate        # entspricht: wrangler d1 migrations apply food-voting-db --remote
```

### 5. Secrets setzen

Secrets gehören **nicht** in `wrangler.toml` und nicht ins Repository:

```bash
npx wrangler secret put ADMIN_EMAIL
```

### 6. Deployen

```bash
npm run deploy
```

Der Befehl baut den Client und lädt Worker samt Oberfläche hoch. Danach die
ausgegebene URL öffnen und mit der `ADMIN_EMAIL` registrieren.

> In Produktion (`ENVIRONMENT = "production"`) setzt der Worker das
> Session-Cookie mit `Secure` – die Anwendung muss also über HTTPS laufen.
> Bei Cloudflare ist das der Standard.

### 7. Logs ansehen

`wrangler.toml` aktiviert für `env.production` Workers Logs
(`[env.production.observability]`). Damit erscheinen Server-Logs – inklusive
`console.error`/`console.log`, u. a. die differenzierten Cookidoo-
Fehlermeldungen – im Cloudflare-Dashboard unter **Workers & Pages →
food-voting → Tab „Logs"**, sobald danach neu deployt wurde (nach
`npm run deploy` bzw. dem nächsten automatischen Cloudflare-Build). Ein
CLI-Aufruf wie `wrangler tail` ist dafür nicht mehr nötig. Eine eventuell in
den Cloudflare-Projekteinstellungen selbst eingerichtete Git-Integration
(automatischer Build bei Push) ist von diesem Repository aus nicht
einsehbar – im Repo selbst liegt kein `.github/workflows`-Workflow.

---

## API

Alle Endpunkte liegen unter `/api`. Verändernde Aufrufe brauchen eine gültige
Session und einen passenden `Origin`-Header.

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/api/me` | Aktueller Benutzer, App-Name, Registrierungsstatus, Datum, Zeitzone |
| `GET` | `/api/settings` | Vollständige Systemeinstellungen (für angemeldete Benutzer) |
| `POST` | `/api/auth/register` | Registrieren (mit optionalem Gruppen-Einladungscode) |
| `POST` | `/api/auth/login` | Anmelden (rate-limited) |
| `POST` | `/api/auth/logout` | Abmelden |
| `PUT` | `/api/auth/profile` | Name und Passwort ändern |
| `GET` | `/api/groups/me` | Eigene Gruppe: Name, Einladungscode/-link, Mitgliederliste |
| `GET` | `/api/meals` | Essen der eigenen Gruppe mit Zutaten |
| `GET` | `/api/meals/:id` | Einzelnes Essen der eigenen Gruppe |
| `POST` | `/api/meals` | Essen in der eigenen Gruppe anlegen |
| `PUT` | `/api/meals/:id` | Essen bearbeiten (eigenes oder als Admin – nur eigene Gruppe) |
| `DELETE` | `/api/meals/:id` | Essen löschen (eigenes oder als Admin – nur eigene Gruppe) |
| `GET` | `/api/planning` | Essensplan der eigenen Gruppe inkl. aller Vorschläge je Tag, Stimmen und Gewinner |
| `POST` | `/api/planning` | Essen als Vorschlag für einen Tag einreichen |
| `DELETE` | `/api/planning/:id` | Geplanten Tag mit allen Vorschlägen entfernen (Admin) |
| `GET` | `/api/votes` | Eigene Stimmen (über alle Vorschläge) |
| `POST` | `/api/votes` | Für/gegen einen Vorschlag stimmen oder Stimme ändern |
| `DELETE` | `/api/votes/:proposalId` | Eigene Stimme zu einem Vorschlag zurücknehmen |
| `GET` | `/api/shopping-list` | Zusammengefasste Einkaufsliste der eigenen Gruppe |
| `POST` | `/api/shopping-list` | Eigenen Artikel hinzufügen |
| `PUT` | `/api/shopping-list/:id` | Abhaken / wieder aktivieren |
| `DELETE` | `/api/shopping-list/:id` | Artikel entfernen |
| `POST` | `/api/shopping-list/clear-checked` | Erledigte entfernen |
| `POST` | `/api/shopping-list/reset` | Liste neu aus dem Plan aufbauen |
| `GET` | `/api/admin/users` | Benutzerliste (Admin) |
| `PUT` | `/api/admin/users/:id` | Rolle ändern (Admin) |
| `DELETE` | `/api/admin/users/:id` | Benutzer löschen (Admin) |
| `GET` | `/api/admin/groups` | Alle Gruppen mit Metadaten: Name, Mitgliederzahl, Einladungslink (Admin) |
| `POST` | `/api/admin/groups` | Neue, leere Gruppe anlegen (Admin) |
| `DELETE` | `/api/admin/groups/:id` | Gruppe löschen, nur wenn 0 Mitglieder (Admin) |
| `GET` | `/api/admin/votes` | Alle Abstimmungen DER EIGENEN GRUPPE (Admin; NICHT gruppenübergreifend) |
| `PUT` | `/api/admin/votes/:id` | Abstimmung eines Tages öffnen/schließen (Admin, nur eigene Gruppe) |
| `GET` `PUT` | `/api/admin/settings` | Systemeinstellungen (Admin) |
| `GET` | `/api/admin/stats` | Kennzahlen fürs Admin-Dashboard, gruppenübergreifend (Admin) |
| `GET` | `/api/cookidoo/status` | Ist der Cookidoo-Import aktiviert? |
| `GET` | `/api/cookidoo/search?q=...` | Cookidoo-Rezepte suchen |
| `GET` | `/api/cookidoo/recipes/:id` | Rezeptdetails für den Import |

---

## Datenmodell

```
groups ──┬── users ──── sessions
         ├── meals ──── ingredients
         ├── plan_days ── meal_proposals ── proposal_votes
         └── shopping_items

meal_proposals verweist zusätzlich auf meals; proposal_votes zusätzlich auf users.

settings         (App-Name, Planungszeitraum, Registrierung, Deadline-Stunde)
login_attempts   (Rate Limiting)
cookidoo_session (Cookidoo-OAuth2-Tokens, eine einzige Zeile für den gesamten Betrieb)
```

Wichtige Regeln in der Datenbank:

- `groups.invite_code` ist `UNIQUE` – jeder Einladungscode gehört genau einer Gruppe.
- `users.group_id` verweist auf die eigene Gruppe (`ON DELETE SET NULL`); die
  Anwendungslogik (`requireGroupId`) verlangt von jedem angemeldeten Benutzer eine Gruppe.
- `meals.group_id` und `shopping_items.group_id` trennen Essen und
  Einkaufsliste strikt nach Gruppe (`ON DELETE CASCADE` beim Löschen einer Gruppe).
- `plan_days`: `UNIQUE(group_id, date)` – pro Gruppe und Tag genau ein
  Planungseintrag mit beliebig vielen Vorschlägen.
- `meal_proposals`: `UNIQUE(plan_day_id, meal_id)` – dasselbe Essen kann
  nicht zweimal am selben Tag vorgeschlagen werden.
- `proposal_votes`: `UNIQUE(user_id, proposal_id)` – eine Stimme pro
  Benutzer und Vorschlag.
- Fremdschlüssel mit `ON DELETE CASCADE` räumen abhängige Daten auf; beim
  Löschen eines Benutzers bleiben dessen Essen erhalten (`created_by` wird `NULL`).
- Eine Gruppe lässt sich erst löschen, wenn sie 0 Mitglieder hat
  (Anwendungslogik in `/api/admin/groups`, kein DB-Constraint).

---

## Sicherheit

- Passwörter als PBKDF2-SHA256 mit Salt, 210.000 Iterationen, Vergleich in konstanter Zeit
- Sessions serverseitig; das Cookie enthält ein Zufallstoken, gespeichert wird nur dessen SHA-256-Hash
- Cookies `HttpOnly`, `SameSite=Lax`, in Produktion zusätzlich `Secure`
- CSRF-Schutz über Origin-Prüfung bei allen verändernden Requests
- Autorisierung ausschließlich serverseitig – der Client kann seine Rolle nie selbst behaupten
- Rate Limiting beim Login: streng pro Konto, deutlich lockerer pro IP, damit ein
  gemeinsamer Anschluss nicht alle Mitbewohner aussperrt
- Alle Datenbankzugriffe über gebundene Parameter (Prepared Statements)
- Bild-URLs werden auf `http`/`https` beschränkt, `javascript:` wird abgelehnt
- Sicherheits-Header inkl. Content-Security-Policy ohne `unsafe-inline` für Skripte
- Technische Fehler werden geloggt, nach außen geht nur eine verständliche Meldung
- Rollenwechsel beendet die Sessions des betroffenen Benutzers

---

## Abstimmungs-Deadline

Die Deadline hängt an einer festen App-Zeitzone (`Europe/Berlin`), nicht an der
Zeitzone des Browsers – sonst hätten Benutzer unterschiedliche Deadlines.

Für einen geplanten Tag darf bis zum **Vorabend 23:59:59 Uhr** abgestimmt
werden (die Stunde ist im Admin-Bereich einstellbar). Für Freitag heißt das:
bis Donnerstag 23:59 Uhr. Danach bleibt das Ergebnis sichtbar, Stimmen lassen
sich aber nicht mehr abgeben oder ändern.

Die Prüfung passiert in `src/worker/lib/time.ts` und wird bei jedem
Abstimmungsversuch serverseitig ausgewertet. Sommer-/Winterzeitwechsel sind
dabei berücksichtigt. Das Frontend blendet den Button lediglich aus – das ist
Komfort, keine Absicherung.

Zusätzlich kann ein Admin die Abstimmung eines Tages jederzeit unabhängig von
der Deadline vorzeitig schließen oder eine bereits geschlossene wieder öffnen
(`PUT /api/admin/votes/:id`). Das Schließen verlangt im Admin-Bereich eine
Bestätigung, weil damit sofort der bis dahin führende Vorschlag als Gewinner
feststeht; das Wiederöffnen ist unkritisch und braucht keine Bestätigung.

---

## Einkaufsliste

Die Liste entsteht aus den Zutaten aller geplanten Essen im Zeitraum. Zutaten
mit gleichem Namen werden zusammengefasst, aber nur innerhalb derselben
Einheiten-Dimension:

| Eingabe | Ergebnis |
| --- | --- |
| 500 g Tomaten + 500 g Tomaten | 1 kg Tomaten |
| 1 l Brühe + 500 ml Brühe | 1,5 l Brühe |
| 1 TL + 2 TL Currypulver | 1 EL Currypulver |
| 500 g Tomaten + 2 Stk Tomaten | bleiben zwei Einträge |
| Salz (ohne Menge) aus zwei Gerichten | ein Eintrag ohne Menge |

Erkannt werden mg/g/kg, ml/cl/dl/l, Stück, TL/EL sowie Einheiten ohne sinnvolle
Umrechnung (Prise, Bund, Dose, Packung, Zehe …), jeweils mit und ohne Umlaute.
Der Haken-Zustand bleibt erhalten, wenn sich der Plan ändert; ändert sich die
Menge, wird sie aktualisiert. Verschwindet ein Essen aus dem Plan, verschwindet
auch seine Zutat.

*Hinweis: Da pro Tag mehrere Vorschläge konkurrieren können, baut die Liste
sich erst aus den Zutaten des **Gewinners** eines geschlossenen Tages auf –
solange ein Tag offen ist, gibt es keine eindeutige Menge (siehe
„Datenmodell" und `src/worker/routes/shopping.ts`).*

---

## Cookidoo-Import

Essen lassen sich optional direkt aus Thermomix **Cookidoo** übernehmen: im
Formular "Essen hinzufügen" nach einem Rezept suchen und mit "Übernehmen"
Titel, Bild und die vollständige Zutatenliste ins Formular vorausfüllen.
Danach lässt sich alles noch anpassen, bevor gespeichert wird.

Das läuft über den **eigenen Cookidoo-Account des Betreibers** (ein Konto für
die ganze App, nicht pro Benutzer) und eine **inoffizielle, reverse-
engineerte API** von Vorwerk - es gibt dafür keine öffentliche/offizielle
Schnittstelle.

### Architektur: Worker → Proxy-Dienst auf einem Heimrechner

Cookidoo/Vorwerk blockt Anfragen, die aus Cloudflare-Workers-Rechenzentrums-
IPs kommen, mit einem Bot-Schutz-403 - das betrifft auch erfolgreich
eingeloggte Sessions. Von einer gewöhnlichen Heim-Internetleitung aus
funktionieren dieselben Aufrufe hingegen. Der komplette Login-/Such-/
Rezeptdetail-Flow läuft deshalb **nicht mehr im Worker**, sondern in einem
kleinen, separaten Node.js-Dienst auf einem Heimrechner (dauerhaft laufender
Prozess, z. B. als systemd-Service). Der Worker ruft nur noch diesen Proxy
per HTTP auf und reicht dessen (bereits nutzersichere) Fehlermeldungen
durch:

```
Cloudflare Worker  --HTTP + Bearer-Token-->  Proxy-Dienst (Heimrechner)  -->  Cookidoo
```

Die Cookidoo-Zugangsdaten (`COOKIDOO_EMAIL`/`COOKIDOO_PASSWORD`) liegen damit
**nur noch lokal auf dem Proxy-Rechner** (in dessen `.env`), nie mehr in
Cloudflare. Der Worker kennt sie gar nicht mehr, sondern nur die Proxy-URL
und ein separates, rein internes Token.

Das bedeutet konkret:

- Es wird ausschließlich für den privaten Gebrauch des eigenen Abos genutzt.
- Cookidoo kann seine interne API jederzeit ohne Vorwarnung ändern; der
  Import kann dadurch jederzeit aufhören zu funktionieren, ohne dass diese
  App etwas falsch gemacht hat. Betroffen sind nur Suche und Übernahme -
  der Rest der App läuft unabhängig davon weiter.
- Der Import funktioniert nur, solange der Proxy-Rechner an und online ist.
  Fällt er aus, liefert der Worker eine verständliche Fehlermeldung statt
  abzustürzen.
- Ohne gesetzte `COOKIDOO_PROXY_URL`/`COOKIDOO_PROXY_TOKEN` ist das Feature
  vollständig deaktiviert (`GET /api/cookidoo/status` liefert
  `{ "enabled": false }`), nichts stürzt ab.

### Aktivieren

```bash
npx wrangler secret put COOKIDOO_PROXY_URL
npx wrangler secret put COOKIDOO_PROXY_TOKEN
npm run deploy
```

Für lokale Entwicklung stattdessen `COOKIDOO_PROXY_URL` und
`COOKIDOO_PROXY_TOKEN` in `.dev.vars` eintragen (bleibt wie gehabt in
`.gitignore` und wird nie committet).

---

## Lizenz

MIT
