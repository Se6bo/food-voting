export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  /** E-Mail, die bei der Registrierung automatisch Admin wird. */
  ADMIN_EMAIL?: string;
  /** Optionaler Einladungscode für die Registrierung. */
  SIGNUP_INVITE_CODE?: string;
}

export function isProduction(env: Env): boolean {
  return env.ENVIRONMENT === "production";
}
