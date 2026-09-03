-- Migration 0004: Essenskategorien + Mahlzeiten-Zeitfenster (Mittagessen/
-- Mittagssnack/Abendessen).
--
-- 1) Essenskategorien: pro Gruppe frei anlegbar, damit Essen bei vielen
--    Einträgen leichter wiederzufinden sind (Filter in der Essen-Liste und
--    beim Einplanen).
-- 2) plan_days bekommt ein "slot"-Feld: statt einem Essen pro Tag lassen sich
--    jetzt bis zu drei getrennte Essensplanungen je Tag anlegen (Mittagessen,
--    Mittagssnack, Abendessen), jede mit eigenen Vorschlägen/Abstimmungen.

-- ---------------------------------------------------------------------------
-- Essenskategorien
-- ---------------------------------------------------------------------------
CREATE TABLE meal_categories (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (group_id, name COLLATE NOCASE)
);
CREATE INDEX idx_meal_categories_group ON meal_categories(group_id);

ALTER TABLE meals ADD COLUMN category_id TEXT REFERENCES meal_categories(id) ON DELETE SET NULL;
CREATE INDEX idx_meals_category ON meals(category_id);

-- ---------------------------------------------------------------------------
-- plan_days: "slot" ergänzen (lunch/snack/dinner) und den bisherigen
-- UNIQUE(group_id, date) auf UNIQUE(group_id, date, slot) erweitern. SQLite
-- erlaubt kein nachträgliches Ändern von Table-Constraints -> Tabelle neu
-- aufbauen. Bestehende Planungen werden alle "lunch" (Mittagessen)
-- zugeordnet.
--
-- D1 erzwingt Fremdschlüssel unabhängig von "PRAGMA foreign_keys" (das
-- Pragma wird von D1 ignoriert) - ein DROP TABLE auf plan_days würde die
-- abhängigen meal_proposals/proposal_votes sonst per ON DELETE CASCADE mit
-- wegreißen. Deshalb werden beide vor dem DROP in Backup-Tabellen gesichert
-- und danach wieder eingespielt, statt sich (wirkungslos) auf ein
-- deaktiviertes Foreign-Key-Pragma zu verlassen.
-- ---------------------------------------------------------------------------
CREATE TABLE plan_days_new (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  slot        TEXT NOT NULL DEFAULT 'lunch' CHECK (slot IN ('lunch', 'snack', 'dinner')),
  voting_open INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (group_id, date, slot)
);

INSERT INTO plan_days_new (id, group_id, date, slot, voting_open, created_at)
  SELECT id, group_id, date, 'lunch', voting_open, created_at FROM plan_days;

CREATE TABLE meal_proposals_backup_0004 AS SELECT * FROM meal_proposals;
CREATE TABLE proposal_votes_backup_0004 AS SELECT * FROM proposal_votes;

DROP TABLE plan_days;
ALTER TABLE plan_days_new RENAME TO plan_days;
CREATE INDEX idx_plan_days_group_date ON plan_days(group_id, date);

INSERT INTO meal_proposals SELECT * FROM meal_proposals_backup_0004;
INSERT INTO proposal_votes SELECT * FROM proposal_votes_backup_0004;

DROP TABLE meal_proposals_backup_0004;
DROP TABLE proposal_votes_backup_0004;
