import { Hono } from "hono";
import type { Env } from "../lib/env";
import type { AppVariables } from "../lib/auth";
import {
  createSession,
  createUser,
  currentUser,
  destroySession,
  purgeExpiredSessions,
  requireAuth,
} from "../lib/auth";
import { hashPassword, verifyPassword } from "../lib/password";
import { checkRateLimit, clearRateLimit, clientIp, recordRateLimitAttempt } from "../lib/security";
import { getSettings } from "../lib/settings";
import {
  MIN_PASSWORD_LENGTH,
  ValidationError,
  requireEmail,
  requirePassword,
  requireString,
} from "../lib/validation";

// Pro Konto streng (verhindert gezieltes Durchprobieren eines Passworts),
// pro IP deutlich lockerer: hinter einem gemeinsamen Anschluss (WG, NAT)
// würde ein strenger IP-Zähler sonst alle Mitbewohner aussperren.
const LOGIN_LIMIT_PER_ACCOUNT = 8;
const LOGIN_LIMIT_PER_IP = 40;
const LOGIN_WINDOW_SECONDS = 15 * 60;

const auth = new Hono<{ Bindings: Env; Variables: AppVariables }>();

auth.post("/register", async (c) => {
  const settings = await getSettings(c.env);
  const body = await c.req.json().catch(() => ({}));

  const name = requireString(body.name, "name", { min: 2, max: 80, label: "Name" });
  const email = requireEmail(body.email);
  const password = requirePassword(body.password);
  const passwordConfirm = body.passwordConfirm;

  if (password !== passwordConfirm) {
    throw new ValidationError("Die Passwörter stimmen nicht überein.", {
      passwordConfirm: "Die Passwörter stimmen nicht überein.",
    });
  }

  const emailLower = email.toLowerCase();
  const adminEmail = c.env.ADMIN_EMAIL?.trim().toLowerCase();
  const isConfiguredAdmin = Boolean(adminEmail) && emailLower === adminEmail;

  // Der erste Admin wird über die Umgebungsvariable ADMIN_EMAIL bestimmt und
  // darf sich immer registrieren - auch wenn die Registrierung geschlossen ist.
  if (!settings.registrationOpen && !isConfiguredAdmin) {
    return c.json({ error: "Die Registrierung ist derzeit deaktiviert." }, 403);
  }

  const inviteCode = c.env.SIGNUP_INVITE_CODE?.trim();
  if (inviteCode && !isConfiguredAdmin && body.inviteCode !== inviteCode) {
    throw new ValidationError("Ungültiger Einladungscode.", {
      inviteCode: "Der Einladungscode stimmt nicht.",
    });
  }

  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email_lower = ?")
    .bind(emailLower)
    .first<{ id: string }>();
  if (existing) {
    throw new ValidationError("Diese E-Mail-Adresse wird bereits verwendet.", {
      email: "Diese E-Mail-Adresse ist bereits registriert.",
    });
  }

  // Der allererste Benutzer wird Admin, damit die Anwendung nie ohne
  // Administrator dasteht. Danach entscheidet ausschließlich ADMIN_EMAIL.
  const userCount = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{
    count: number;
  }>();
  const role = isConfiguredAdmin || (userCount?.count ?? 0) === 0 ? "admin" : "user";

  const passwordHash = await hashPassword(password);
  const user = await createUser(c.env, { name, email, passwordHash, role });
  await createSession(c, user.id);

  return c.json({ user }, 201);
});

auth.post("/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return c.json({ error: "Bitte E-Mail und Passwort eingeben." }, 400);
  }

  // Zwei Buckets: pro IP und pro Konto. So kann weder ein einzelner Angreifer
  // viele Konten durchprobieren noch ein Konto von vielen IPs aus.
  const ipKey = `ip:${clientIp(c.req.raw.headers)}`;
  const emailKey = `email:${email}`;
  const limits: Array<[string, number]> = [
    [emailKey, LOGIN_LIMIT_PER_ACCOUNT],
    [ipKey, LOGIN_LIMIT_PER_IP],
  ];
  for (const [key, limit] of limits) {
    const { allowed } = await checkRateLimit(c.env, key, limit, LOGIN_WINDOW_SECONDS);
    if (!allowed) {
      return c.json(
        { error: "Zu viele Login-Versuche. Bitte versuche es in 15 Minuten erneut." },
        429,
      );
    }
  }

  const row = await c.env.DB.prepare(
    "SELECT id, password_hash FROM users WHERE email_lower = ?",
  )
    .bind(email)
    .first<{ id: string; password_hash: string }>();

  const valid = row ? await verifyPassword(password, row.password_hash) : false;

  if (!row || !valid) {
    await recordRateLimitAttempt(c.env, ipKey);
    await recordRateLimitAttempt(c.env, emailKey);
    // Bewusst dieselbe Meldung für "Konto unbekannt" und "Passwort falsch",
    // damit keine gültigen E-Mail-Adressen ausgelesen werden können.
    return c.json({ error: "E-Mail-Adresse oder Passwort ist falsch." }, 401);
  }

  // Erfolgreicher Login räumt beide Zähler ab.
  await clearRateLimit(c.env, emailKey);
  await clearRateLimit(c.env, ipKey);
  await createSession(c, row.id);
  c.executionCtx.waitUntil(purgeExpiredSessions(c.env));

  const user = await c.env.DB.prepare(
    "SELECT id, name, email, role, created_at FROM users WHERE id = ?",
  )
    .bind(row.id)
    .first<{ id: string; name: string; email: string; role: "user" | "admin"; created_at: string }>();

  return c.json({
    user: user && {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.created_at,
    },
  });
});

auth.post("/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

/** Eigenes Profil ändern (Name / Passwort). */
auth.put("/profile", requireAuth, async (c) => {
  const user = currentUser(c);
  const body = await c.req.json().catch(() => ({}));
  const name = requireString(body.name, "name", { min: 2, max: 80, label: "Name" });

  const wantsPasswordChange = typeof body.newPassword === "string" && body.newPassword.length > 0;
  if (wantsPasswordChange) {
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ password_hash: string }>();
    if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
      throw new ValidationError("Aktuelles Passwort ist falsch.", {
        currentPassword: "Das aktuelle Passwort stimmt nicht.",
      });
    }
    const newPassword = requirePassword(body.newPassword, "newPassword");
    const passwordHash = await hashPassword(newPassword);
    await c.env.DB.prepare("UPDATE users SET name = ?, password_hash = ? WHERE id = ?")
      .bind(name, passwordHash, user.id)
      .run();
  } else {
    await c.env.DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(name, user.id).run();
  }

  return c.json({ user: { ...user, name } });
});

export { auth, MIN_PASSWORD_LENGTH };
