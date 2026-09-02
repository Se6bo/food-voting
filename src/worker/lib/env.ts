export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  /** E-Mail, die bei der Registrierung automatisch Admin wird. */
  ADMIN_EMAIL?: string;
  /** Optionaler Einladungscode für die Registrierung. */
  SIGNUP_INVITE_CODE?: string;
  /**
   * Zugangsdaten für den Cookidoo-Import (optional). Nur gesetzt, wenn der
   * Betreiber den eigenen Cookidoo-Account dafür freigeben möchte - fehlt
   * eine der beiden Variablen, bleibt das Feature deaktiviert.
   */
  COOKIDOO_EMAIL?: string;
  COOKIDOO_PASSWORD?: string;
}

export function isProduction(env: Env): boolean {
  return env.ENVIRONMENT === "production";
}
