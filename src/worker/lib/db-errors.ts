/**
 * Erkennt D1/SQLite-Fehler, die typischerweise darauf hindeuten, dass eine
 * Migration auf der Ziel-Datenbank noch nicht angewendet wurde: eine fehlende
 * Tabelle ("no such table") oder eine fehlende Spalte. Letztere meldet SQLite
 * je nach Anfrageart unterschiedlich - "no such column" bei SELECT/WHERE,
 * aber "has no column named" bei INSERT/UPDATE mit expliziter Spaltenliste
 * (genau der Fall bei den cookidoo_id/cookidoo_url-Schreibzugriffen). Wird
 * genutzt, um solche Fehler von anderen Fehlerquellen (Netzwerk,
 * Cookidoo-Login, ...) zu unterscheiden, statt sie als generischen
 * Serverfehler durchzureichen.
 */
export function isMissingMigrationError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /no such table/i.test(message) || /no such column/i.test(message) || /has no column named/i.test(message);
}

/** Nutzersichere Meldung für fehlende Migration 0002 (Cookidoo-Import). */
export const MIGRATION_0002_MISSING_MESSAGE =
  "Die Cookidoo-Datenbank-Migration wurde noch nicht angewendet. Bitte migrations/0002_cookidoo.sql per Cloudflare-D1-Konsole ausführen oder `npm run db:migrate` laufen lassen.";
