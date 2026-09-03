import { Hono } from "hono";
import type { Env } from "../lib/env";
import type { AppVariables } from "../lib/auth";
import {
  createSession,
  createUser,
  currentUser,
  destroySession,
  loadUserById,
  purgeExpiredSessions,
  requireAuth,
} from "../lib/auth";
import { newId, newToken } from "../lib/ids";
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

  // Gruppen-Zuordnung: Wer einen gültigen Einladungscode angibt, tritt genau
  // dieser Gruppe bei. Ohne Code (oder mit leerem Feld) wird automatisch eine
  // brandneue, eigene Gruppe gegründet - die Registrierung setzt damit immer
  // eine Gruppe, egal welcher Weg genommen wird. Ein unbekannter Code ist ein
  // normaler Validierungsfehler wie bei jedem anderen Formularfeld.
  const rawCode = typeof body.groupInviteCode === "string" ? body.groupInviteCode.trim() : "";
  let groupId: string;
  let createdGroupId: string | null = null;

  if (rawCode) {
    // Groß-/Kleinschreibung ignorieren, damit abgetippte Codes nicht an der
    // Schreibweise scheitern (die generierten Codes mischen Groß- und Kleinbuchstaben).
    const group = await c.env.DB.prepare(
      "SELECT id FROM groups WHERE LOWER(invite_code) = LOWER(?)",
    )
      .bind(rawCode)
      .first<{ id: string }>();
    if (!group) {
      throw new ValidationError("Unbekannter Einladungscode.", {
        groupInviteCode:
          "Dieser Einladungscode ist nicht gültig. Ohne Code bekommst du automatisch eine eigene neue Gruppe.",
      });
    }
    groupId = group.id;
  } else {
    // Gruppe zuerst mit created_by = NULL anlegen (die User-ID existiert erst
    // nach dem User-Insert) und unten nachziehen.
    createdGroupId = newId();
    await c.env.DB.prepare(
      "INSERT INTO groups (id, name, invite_code, created_by) VALUES (?, ?, ?, NULL)",
    )
      .bind(createdGroupId, `Gruppe von ${name}`, newToken())
      .run();
    groupId = createdGroupId;
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser(c.env, { name, email, passwordHash, role, groupId });
  if (createdGroupId) {
    await c.env.DB.prepare("UPDATE groups SET created_by = ? WHERE id = ?")
      .bind(user.id, createdGroupId)
      .run();
  }
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

  const user = await loadUserById(c.env, row.id);
  return c.json({ user });
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
