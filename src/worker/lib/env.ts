export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  /** E-Mail, die bei der Registrierung automatisch Admin wird. */
  ADMIN_EMAIL?: string;
  /** Optionaler Einladungscode für die Registrierung. */
  SIGNUP_INVITE_CODE?: string;
  /**
   * Zugriff auf den Cookidoo-Proxy (optional). Der eigentliche Cookidoo-
   * Login/-Import läuft nicht mehr im Worker, sondern in einem separaten
   * Node-Dienst auf einem Heimrechner mit normaler Internetleitung (Cookidoo
   * blockt Anfragen aus Cloudflare-Workers-Rechenzentrums-IPs). Fehlt eine
   * der beiden Variablen, bleibt das Feature deaktiviert.
   */
  COOKIDOO_PROXY_URL?: string;
  COOKIDOO_PROXY_TOKEN?: string;
}

export function isProduction(env: Env): boolean {
  return env.ENVIRONMENT === "production";
}
