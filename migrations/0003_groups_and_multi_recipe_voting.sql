-- Migration 0003: Gruppen (getrennte Essenspläne) + Mehrfach-Rezeptvorschläge
-- pro Tag mit Ja/Nein-Abstimmung je Vorschlag.
--
-- Ersetzt das bisherige "ein Essen pro Tag + eine Abstimmung"-Modell
-- (meal_days/votes) durch mehrere Vorschläge pro Tag (plan_days/
-- meal_proposals/proposal_votes). Für meal_days/votes gibt es dafür keine
-- sinnvolle 1:1-Migration - der Verlust der bisherigen (Test-)Daten in genau
-- diesen beiden Tabellen ist vom Betreiber ausdrücklich akzeptiert.

-- ---------------------------------------------------------------------------
-- Gruppen: jede Gruppe hat einen komplett eigenen, von anderen Gruppen
-- getrennten Essensplan/Rezeptkatalog/Einkaufsliste.
-- ---------------------------------------------------------------------------
CREATE TABLE groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bestehende Installation: alles wandert in eine automatisch erzeugte
-- "Standard"-Gruppe. Der zufällige Einladungscode wird direkt in SQLite
-- erzeugt (randomblob/hex), damit kein vorhersehbarer Wert im Git-Repo
-- landet. Auf einer frischen, leeren DB (noch kein Nutzer registriert)
-- liefert die SELECT-Unterabfrage keine Zeile -> INSERT fügt dann nichts
-- ein, was hier korrekt ist (die erste echte Registrierung gründet ihre
-- eigene Gruppe ganz normal über die App).
INSERT INTO groups (id, name, invite_code, created_by)
SELECT lower(hex(randomblob(16))), 'Standard', lower(hex(randomblob(12))), id
  FROM users ORDER BY created_at ASC LIMIT 1;

-- group_id bleibt bewusst NULLABLE auf DB-Ebene (SQLite erlaubt kein
-- nachträgliches NOT NULL ohne aufwändigen Tabellen-Neubau) - die Anwendung
-- stellt aber an jeder Schreibstelle sicher, dass ein Nutzer/Essen/
-- Einkaufsartikel immer eine Gruppe hat.
ALTER TABLE users ADD COLUMN group_id TEXT REFERENCES groups(id) ON DELETE SET NULL;
UPDATE users SET group_id = (SELECT id FROM groups WHERE name = 'Standard' LIMIT 1);

ALTER TABLE meals ADD COLUMN group_id TEXT REFERENCES groups(id) ON DELETE CASCADE;
UPDATE meals SET group_id = (SELECT id FROM groups WHERE name = 'Standard' LIMIT 1);

ALTER TABLE shopping_items ADD COLUMN group_id TEXT REFERENCES groups(id) ON DELETE CASCADE;
UPDATE shopping_items SET group_id = (SELECT id FROM groups WHERE name = 'Standard' LIMIT 1);

DROP TABLE IF EXISTS votes;
DROP TABLE IF EXISTS meal_days;

-- ---------------------------------------------------------------------------
-- Essensplan: pro Tag beliebig viele Rezeptvorschläge statt genau einem
-- Essen. Der Gewinner (höchste Ja-minus-Nein-Differenz) wird nicht
-- gespeichert, sondern bei jedem Lesezugriff live berechnet, sobald die
-- Abstimmung für den Tag geschlossen ist.
-- ---------------------------------------------------------------------------
CREATE TABLE plan_days (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  voting_open INTEGER NOT NULL DEFAULT 1,       -- Admin-Override: 0 = manuell geschlossen
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (group_id, date)
);
CREATE INDEX idx_plan_days_group_date ON plan_days(group_id, date);

CREATE TABLE meal_proposals (
  id          TEXT PRIMARY KEY,
  plan_day_id TEXT NOT NULL REFERENCES plan_days(id) ON DELETE CASCADE,
  meal_id     TEXT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (plan_day_id, meal_id)                 -- dasselbe Essen nicht zweimal am selben Tag vorschlagen
);
CREATE INDEX idx_meal_proposals_plan_day ON meal_proposals(plan_day_id);

CREATE TABLE proposal_votes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposal_id TEXT NOT NULL REFERENCES meal_proposals(id) ON DELETE CASCADE,
  vote        INTEGER NOT NULL CHECK (vote IN (-1, 1)),  -- 1 = Ja, -1 = Nein
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, proposal_id)                 -- ein Benutzer, eine Stimme pro Vorschlag
);
CREATE INDEX idx_proposal_votes_proposal ON proposal_votes(proposal_id);
