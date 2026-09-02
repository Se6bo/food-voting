-- Migration 0001: Grundschema für Essensplanung, Abstimmung und Einkaufsliste.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Benutzer
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  email_lower   TEXT NOT NULL UNIQUE,           -- case-insensitive Login
  password_hash TEXT NOT NULL,                  -- PBKDF2-SHA256, siehe lib/password.ts
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Sessions (serverseitig, Cookie enthält nur den Hash-Lookup-Token)
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,                  -- SHA-256 des Cookie-Tokens
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Rate Limiting für Login-Versuche
-- ---------------------------------------------------------------------------
CREATE TABLE login_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket_key  TEXT NOT NULL,                    -- z.B. "ip:1.2.3.4" oder "email:a@b.c"
  attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_attempts_lookup ON login_attempts(bucket_key, attempted_at);

-- ---------------------------------------------------------------------------
-- Essen
-- ---------------------------------------------------------------------------
CREATE TABLE meals (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  image       TEXT,                             -- optionale Bild-URL
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_meals_created_by ON meals(created_by);
CREATE INDEX idx_meals_name ON meals(name);

-- ---------------------------------------------------------------------------
-- Zutaten (strukturiert: Menge | Einheit | Name)
-- ---------------------------------------------------------------------------
CREATE TABLE ingredients (
  id       TEXT PRIMARY KEY,
  meal_id  TEXT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  amount   REAL,                                -- NULL = "nach Geschmack"
  unit     TEXT,                                -- g, kg, ml, l, Stk, TL, EL, Prise ...
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_ingredients_meal ON ingredients(meal_id);

-- ---------------------------------------------------------------------------
-- Essensplan: ein Essen an einem Tag. Pro Tag genau ein Eintrag.
-- ---------------------------------------------------------------------------
CREATE TABLE meal_days (
  id          TEXT PRIMARY KEY,
  meal_id     TEXT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  date        TEXT NOT NULL UNIQUE,             -- ISO-Datum YYYY-MM-DD
  voting_open INTEGER NOT NULL DEFAULT 1,       -- Admin-Override: 0 = manuell geschlossen
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_meal_days_date ON meal_days(date);
CREATE INDEX idx_meal_days_meal ON meal_days(meal_id);

-- ---------------------------------------------------------------------------
-- Abstimmungen: ein Benutzer darf pro geplantem Tag nur eine Stimme abgeben.
-- ---------------------------------------------------------------------------
CREATE TABLE votes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meal_day_id TEXT NOT NULL REFERENCES meal_days(id) ON DELETE CASCADE,
  vote        INTEGER NOT NULL CHECK (vote IN (-1, 1)),  -- 1 = Ja, -1 = Nein
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, meal_day_id)
);
CREATE INDEX idx_votes_meal_day ON votes(meal_day_id);

-- ---------------------------------------------------------------------------
-- Einkaufsliste
--
-- Automatisch generierte Positionen werden nicht dupliziert gespeichert: sie
-- entstehen zur Laufzeit aus den Zutaten der geplanten Essen. Diese Tabelle
-- hält nur den Zustand, der nicht ableitbar ist -> Haken + manuelle Artikel.
-- ---------------------------------------------------------------------------
CREATE TABLE shopping_items (
  id          TEXT PRIMARY KEY,
  source_key  TEXT UNIQUE,                      -- Schlüssel der generierten Zutat, NULL bei manuellen Artikeln
  name        TEXT NOT NULL,
  amount      REAL,
  unit        TEXT,
  is_manual   INTEGER NOT NULL DEFAULT 0,
  checked     INTEGER NOT NULL DEFAULT 0,
  hidden      INTEGER NOT NULL DEFAULT 0,       -- generierte Position wurde manuell entfernt
  checked_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  checked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_shopping_items_source ON shopping_items(source_key);

-- ---------------------------------------------------------------------------
-- Systemeinstellungen (Admin-Bereich)
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO settings (key, value) VALUES
  ('app_name', 'Essensplan'),
  ('planning_days_ahead', '14'),
  ('registration_open', 'true'),
  ('vote_deadline_hour', '23');
