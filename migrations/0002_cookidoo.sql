-- Migration 0002: Cookidoo-Import (Rezeptsuche + Übernahme über den eigenen Account).

-- Essen merken sich, aus welchem Cookidoo-Rezept sie übernommen wurden, damit
-- die App/Nutzer das Original-Rezept wiederfinden können. Beide Spalten sind
-- NULL, wenn ein Essen nicht aus Cookidoo importiert wurde.
ALTER TABLE meals ADD COLUMN cookidoo_id TEXT;
ALTER TABLE meals ADD COLUMN cookidoo_url TEXT;

-- ---------------------------------------------------------------------------
-- Cookidoo-Login-Session (OAuth2-Tokens)
--
-- Worker-Instanzen sind kurzlebig (kein verlässlicher In-Memory-Cache über
-- Requests hinweg), daher landet der aktuelle Access-/Refresh-Token in D1.
-- Es gibt bewusst nur eine Zeile: Der Import läuft über den einen konfigurierten
-- Cookidoo-Account des Betreibers, nicht pro App-Benutzer. Der CHECK erzwingt
-- diese Singleton-Eigenschaft.
-- ---------------------------------------------------------------------------
CREATE TABLE cookidoo_session (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,               -- Unix-Zeitstempel (Sekunden)
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
