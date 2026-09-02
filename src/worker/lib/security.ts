import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";
import type { AppVariables } from "./auth";

/**
 * CSRF-Schutz.
 *
 * Erste Verteidigungslinie ist das SameSite=Lax-Cookie, das Cookies bei
 * cross-site POSTs gar nicht erst mitsendet. Zusaetzlich pruefen wir bei allen
 * veraendernden Requests den Origin-Header gegen den Host des Requests. Das
 * kommt ohne Token-Handshake aus und ist fuer eine Same-Origin-SPA robust.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const csrfProtection: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (
  c,
  next,
) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header("Origin");
    if (origin) {
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        return c.json({ error: "Ungueltige Anfrage." }, 403);
      }
      if (originHost !== new URL(c.req.url).host) {
        return c.json({ error: "Ungueltige Anfrage-Herkunft." }, 403);
      }
    }
    // Fehlender Origin-Header: bei modernen Browsern senden fetch/XHR ihn bei
    // veraendernden Requests immer mit. Wir verlangen deshalb zusaetzlich den
    // vom Client gesetzten Marker-Header, den ein einfaches Formular von einer
    // fremden Seite nicht setzen kann.
    else if (c.req.header("X-Requested-With") !== "fetch") {
      return c.json({ error: "Ungueltige Anfrage." }, 403);
    }
  }
  await next();
};

/** Sicherheits-Header fuer alle Antworten des Workers. */
export const securityHeaders: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (
  c,
  next,
) => {
  await next();
  const headers = c.res.headers;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  if (!headers.has("Content-Security-Policy")) {
    headers.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        // Bilder duerfen von beliebigen https-Quellen kommen (Rezeptbilder).
        "img-src 'self' https: data:",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; "),
    );
  }
};

/**
 * Einfaches Rate Limiting ueber D1: zaehlt Versuche pro Schluessel im
 * Zeitfenster. Fuer den MVP ausreichend und ohne zusaetzliche Infrastruktur.
 */
export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export async function checkRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM login_attempts WHERE bucket_key = ? AND attempted_at > ?",
  )
    .bind(key, since)
    .first<{ count: number }>();
  const count = row?.count ?? 0;
  return { allowed: count < limit, retryAfterSeconds: count < limit ? 0 : windowSeconds };
}

export async function recordRateLimitAttempt(env: Env, key: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO login_attempts (bucket_key, attempted_at) VALUES (?, ?)").bind(
      key,
      new Date().toISOString(),
    ),
    // Aufraeumen alter Eintraege, damit die Tabelle nicht unbegrenzt waechst.
    env.DB.prepare("DELETE FROM login_attempts WHERE attempted_at < datetime('now', '-1 day')"),
  ]);
}

export async function clearRateLimit(env: Env, key: string): Promise<void> {
  await env.DB.prepare("DELETE FROM login_attempts WHERE bucket_key = ?").bind(key).run();
}

/** Client-IP aus dem Cloudflare-Header, mit Fallback fuer lokale Entwicklung. */
export function clientIp(headers: Headers): string {
  return headers.get("CF-Connecting-IP") ?? headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
}
