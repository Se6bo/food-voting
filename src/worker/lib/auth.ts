import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { PublicUser, Role } from "../../shared/types";
import type { Env } from "./env";
import { isProduction } from "./env";
import { newId, newToken, sha256Hex } from "./ids";

export const SESSION_COOKIE = "fv_session";
const SESSION_TTL_DAYS = 30;

export interface AppVariables {
  user: PublicUser | null;
}

export type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  created_at: string;
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  };
}

/** Legt eine Session an und setzt das HttpOnly-Cookie. */
export async function createSession(c: AppContext, userId: string): Promise<void> {
  const token = newToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  await c.env.DB.prepare(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(tokenHash, userId, expiresAt.toISOString())
    .run();

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    // In Produktion zwingend über HTTPS; lokal würde Secure das Cookie
    // auf http://localhost blockieren.
    secure: isProduction(c.env),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86_400,
  });
}

export async function destroySession(c: AppContext): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const tokenHash = await sha256Hex(token);
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(tokenHash).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isProduction(c.env) });
}

/** Alle Sessions eines Benutzers beenden (z.B. bei Rollenwechsel oder Löschung). */
export async function destroyAllSessionsFor(env: Env, userId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

/**
 * Lädt den Benutzer aus dem Session-Cookie. Setzt `user` immer (ggf. null),
 * blockt aber nicht - das übernehmen `requireAuth` / `requireAdmin`.
 */
export const loadUser: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (
  c,
  next,
) => {
  c.set("user", null);
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const tokenHash = await sha256Hex(token);
    const row = await c.env.DB.prepare(
      `SELECT u.id, u.name, u.email, u.role, u.created_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.expires_at > datetime('now')`,
    )
      .bind(tokenHash)
      .first<UserRow>();
    if (row) {
      c.set("user", toPublicUser(row));
    } else {
      // Abgelaufene oder unbekannte Session -> Cookie entfernen.
      deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isProduction(c.env) });
    }
  }
  await next();
};

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (
  c,
  next,
) => {
  if (!c.get("user")) {
    return c.json({ error: "Bitte melde dich an." }, 401);
  }
  await next();
};

/**
 * Admin-Prüfung ausschließlich serverseitig anhand der Rolle aus der
 * Datenbank. Der Client kann seine Rolle nie selbst behaupten.
 */
export const requireAdmin: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (
  c,
  next,
) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Bitte melde dich an." }, 401);
  if (user.role !== "admin") {
    return c.json({ error: "Dafür fehlen dir die Berechtigungen." }, 403);
  }
  await next();
};

/** Hilfsfunktion für Routen: garantiert nicht-null Benutzer hinter requireAuth. */
export function currentUser(c: AppContext): PublicUser {
  const user = c.get("user");
  if (!user) throw new Error("currentUser() ohne requireAuth aufgerufen");
  return user;
}

export async function createUser(
  env: Env,
  data: { name: string; email: string; passwordHash: string; role: Role },
): Promise<PublicUser> {
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, email_lower, password_hash, role)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, data.name, data.email, data.email.toLowerCase(), data.passwordHash, data.role)
    .run();

  const row = await env.DB.prepare(
    "SELECT id, name, email, role, created_at FROM users WHERE id = ?",
  )
    .bind(id)
    .first<UserRow>();
  if (!row) throw new Error("Benutzer konnte nicht angelegt werden");
  return toPublicUser(row);
}

/** Aufräumen abgelaufener Sessions - günstig genug für den MVP. */
export async function purgeExpiredSessions(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}
