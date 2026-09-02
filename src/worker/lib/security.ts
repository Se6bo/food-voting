import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";
import type { AppVariables } from "./auth";

/**
 * CSRF-Schutz.
 *
 * Erste Verteidigungslinie ist das SameSite=Lax-Cookie, das Cookies bei
 * cross-site POSTs gar nicht erst mitsendet. Zusätzlich prüfen wir bei allen
 * verändernden Requests den Origin-Header gegen den Host des Requests. Das
 * kommt ohne Token-Handshake aus und ist für eine Same-Origin-SPA robust.
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
        return c.json({ error: "Ungültige Anfrage." }, 403);
      }
      if (originHost !== new URL(c.req.url).host) {
        return c.json({ error: "Ungültige Anfrage-Herkunft." }, 403);
      }
    }
    // Fehlender Origin-Header: bei modernen Browsern senden fetch/XHR ihn bei
    // verändernden Requests immer mit. Wir verlangen deshalb zusätzlich den
    // vom Client gesetzten Marker-Header, den ein einfaches Formular von einer
    // fremden Seite nicht setzen kann.
    else if (c.req.header("X-Requested-With") !== "fetch") {
      return c.json({ error: "Ungültige Anfrage." }, 403);
    }
  }
  await next();
};

/** Sicherheits-Header für alle Antworten des Workers. */
export const securityHeaders: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (
  c,
  next,
) => {
  await next();

  const applyTo = (headers: Headers) => {
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    if (!headers.has("Content-Security-Policy")) {
      headers.set(
        "Content-Security-Policy",
        [
          "default-src 'self'",
          // Bilder dürfen von beliebigen https-Quellen kommen (Rezeptbilder).
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

  try {
    applyTo(c.res.headers);
  } catch {
    // Manche Antworten haben unveränderliche Header - etwa Antworten aus
    // ASSETS.fetch() oder aus dem Fehler-Handler. Dann bauen wir die Antwort
    // mit denselben Daten neu auf, statt den Request scheitern zu lassen.
    const original = c.res;
    const headers = new Headers(original.headers);
    applyTo(headers);
    c.res = new Response(original.body, {
      status: original.status,
      statusText: original.statusText,
      headers,
    });
  }
};

/**
 * Einfaches Rate Limiting über D1: zählt Versuche pro Schlüssel im
 * Zeitfenster. Für den MVP ausreichend und ohne zusätzliche Infrastruktur.
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
    // Aufräumen alter Einträge, damit die Tabelle nicht unbegrenzt wächst.
    env.DB.prepare("DELETE FROM login_attempts WHERE attempted_at < datetime('now', '-1 day')"),
  ]);
}

export async function clearRateLimit(env: Env, key: string): Promise<void> {
  await env.DB.prepare("DELETE FROM login_attempts WHERE bucket_key = ?").bind(key).run();
}

/** Client-IP aus dem Cloudflare-Header, mit Fallback für lokale Entwicklung. */
export function clientIp(headers: Headers): string {
  return headers.get("CF-Connecting-IP") ?? headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
}
