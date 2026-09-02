# 🍲 Essensplan

Gemeinsame Essensplanung, Abstimmung und Einkaufsliste für WGs und Familien.
Läuft vollständig auf Cloudflare (Workers + D1).

---

## Funktionsumfang

| Bereich | Was möglich ist |
| --- | --- |
| **Konten** | Registrieren, anmelden, Profil und Passwort ändern |
| **Essensplan** | Kommende Tage als Karten, ein Essen pro Tag |
| **Abstimmung** | 👍 / 👎 pro Tag, Stimme änderbar bis zur Deadline |
| **Deadline** | Für einen Tag darf bis zum Vorabend 23:59 Uhr abgestimmt werden – serverseitig erzwungen |
| **Essen** | Gerichte mit Beschreibung, Bild und strukturierten Zutaten (Menge / Einheit / Name) |
| **Einkaufsliste** | Entsteht automatisch aus den geplanten Essen, fasst Mengen zusammen, abhakbar |
| **Admin** | Benutzer und Rollen verwalten, Essen bearbeiten/löschen, Abstimmungen öffnen/schließen, Einstellungen |
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
│   │   └── routes/          auth, meals, planning, votes, shopping, admin
│   └── client/
│       ├── components/      Layout, Abstimmungskarte, UI-Bausteine
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

Optional lässt sich mit `SIGNUP_INVITE_CODE` ein Einladungscode setzen. Ist er
gesetzt, brauchen neue Benutzer ihn bei der Registrierung. Alternativ kann ein
Admin die Registrierung im Admin-Bereich ganz schließen.

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
npx wrangler secret put SIGNUP_INVITE_CODE   # optional
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

---

## API

Alle Endpunkte liegen unter `/api`. Verändernde Aufrufe brauchen eine gültige
Session und einen passenden `Origin`-Header.

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/api/me` | Aktueller Benutzer, App-Name, Datum, Zeitzone |
| `POST` | `/api/auth/register` | Registrieren |
| `POST` | `/api/auth/login` | Anmelden (rate-limited) |
| `POST` | `/api/auth/logout` | Abmelden |
| `PUT` | `/api/auth/profile` | Name und Passwort ändern |
| `GET` | `/api/meals` | Alle Essen mit Zutaten |
| `POST` | `/api/meals` | Essen anlegen |
| `PUT` | `/api/meals/:id` | Essen bearbeiten (eigenes oder als Admin) |
| `DELETE` | `/api/meals/:id` | Essen löschen (eigenes oder als Admin) |
| `GET` | `/api/planning` | Essensplan inkl. Stimmen und Deadline-Status |
| `POST` | `/api/planning` | Essen einem Tag zuordnen |
| `DELETE` | `/api/planning/:id` | Tag aus dem Plan nehmen (Admin) |
| `GET` | `/api/votes` | Eigene Stimmen |
| `POST` | `/api/votes` | Abstimmen oder Stimme ändern |
| `DELETE` | `/api/votes/:mealDayId` | Eigene Stimme zurücknehmen |
| `GET` | `/api/shopping-list` | Zusammengefasste Einkaufsliste |
| `POST` | `/api/shopping-list` | Eigenen Artikel hinzufügen |
| `PUT` | `/api/shopping-list/:id` | Abhaken / wieder aktivieren |
| `DELETE` | `/api/shopping-list/:id` | Artikel entfernen |
| `POST` | `/api/shopping-list/clear-checked` | Erledigte entfernen |
| `POST` | `/api/shopping-list/reset` | Liste neu aus dem Plan aufbauen |
| `GET` | `/api/admin/users` | Benutzerliste (Admin) |
| `PUT` | `/api/admin/users/:id` | Rolle ändern (Admin) |
| `DELETE` | `/api/admin/users/:id` | Benutzer löschen (Admin) |
| `GET` | `/api/admin/votes` | Alle Abstimmungen (Admin) |
| `PUT` | `/api/admin/votes/:id` | Abstimmung öffnen/schließen (Admin) |
| `GET` `PUT` | `/api/admin/settings` | Systemeinstellungen (Admin) |
| `GET` | `/api/cookidoo/status` | Ist der Cookidoo-Import aktiviert? |
| `GET` | `/api/cookidoo/search?q=...` | Cookidoo-Rezepte suchen |
| `GET` | `/api/cookidoo/recipes/:id` | Rezeptdetails für den Import |

---

## Datenmodell

```
users ──┬── sessions
        ├── meals ──┬── ingredients
        │           └── meal_days ── votes
        └── votes

shopping_items   (Haken und eigene Artikel; generierte Positionen
                  entstehen aus ingredients der geplanten Essen)
settings         (App-Name, Planungszeitraum, Registrierung, Deadline-Stunde)
login_attempts   (Rate Limiting)
```

Wichtige Regeln in der Datenbank:

- `meal_days.date` ist `UNIQUE` – pro Tag genau ein Essen.
- `votes(user_id, meal_day_id)` ist `UNIQUE` – eine Stimme pro Benutzer und Tag.
- Fremdschlüssel mit `ON DELETE CASCADE` räumen abhängige Daten auf; beim
  Löschen eines Benutzers bleiben dessen Essen erhalten (`created_by` wird `NULL`).

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

---

## Cookidoo-Import

Essen lassen sich optional direkt aus Thermomix **Cookidoo** übernehmen: im
Formular "Essen hinzufügen" nach einem Rezept suchen und mit "Übernehmen"
Titel, Bild und die vollständige Zutatenliste ins Formular vorausfüllen.
Danach lässt sich alles noch anpassen, bevor gespeichert wird.

Das läuft über den **eigenen Cookidoo-Account des Betreibers** (ein Konto für
die ganze App, nicht pro Benutzer) und eine **inoffizielle, reverse-
engineerte API** von Vorwerk - es gibt dafür keine öffentliche/offizielle
Schnittstelle. Das bedeutet konkret:

- Es wird ausschließlich für den privaten Gebrauch des eigenen Abos genutzt.
- Cookidoo kann seine interne API jederzeit ohne Vorwarnung ändern; der
  Import kann dadurch jederzeit aufhören zu funktionieren, ohne dass diese
  App etwas falsch gemacht hat. Betroffen sind nur Suche und Übernahme -
  der Rest der App läuft unabhängig davon weiter.
- Ohne gesetzte Zugangsdaten ist das Feature vollständig deaktiviert
  (`GET /api/cookidoo/status` liefert `{ "enabled": false }`), nichts stürzt ab.

### Aktivieren

```bash
npx wrangler secret put COOKIDOO_EMAIL
npx wrangler secret put COOKIDOO_PASSWORD
npm run deploy
```

Für lokale Entwicklung stattdessen `COOKIDOO_EMAIL` und `COOKIDOO_PASSWORD`
in `.dev.vars` eintragen (bleibt wie gehabt in `.gitignore` und wird nie
committet).

---

## Lizenz

MIT
