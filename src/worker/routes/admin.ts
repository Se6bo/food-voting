import { Hono } from "hono";
import type { Env } from "../lib/env";
import type { AppVariables } from "../lib/auth";
import { currentUser, destroyAllSessionsFor, requireAdmin } from "../lib/auth";
import { getSettings, updateSettings } from "../lib/settings";
import { addDays, todayInZone, votingState } from "../lib/time";
import { ValidationError, requireString } from "../lib/validation";

const admin = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Jede Admin-Route liegt hinter der serverseitigen Rollenpruefung.
admin.use("*", requireAdmin);

// ---------------------------------------------------------------------------
// Benutzerverwaltung
// ---------------------------------------------------------------------------

admin.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.created_at,
            (SELECT COUNT(*) FROM meals m WHERE m.created_by = u.id) AS meal_count,
            (SELECT COUNT(*) FROM votes v WHERE v.user_id = u.id) AS vote_count
       FROM users u
      ORDER BY u.created_at ASC`,
  ).all<{
    id: string;
    name: string;
    email: string;
    role: "user" | "admin";
    created_at: string;
    meal_count: number;
    vote_count: number;
  }>();

  return c.json({
    users: results.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      createdAt: row.created_at,
      mealCount: row.meal_count,
      voteCount: row.vote_count,
    })),
  });
});

/** Zaehlt die verbleibenden Admins - schuetzt vor dem "letzten Admin"-Problem. */
async function adminCount(c: { env: Env }): Promise<number> {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").first<{
    count: number;
  }>();
  return row?.count ?? 0;
}

admin.put("/users/:id", async (c) => {
  const actor = currentUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const role = body.role;

  if (role !== "user" && role !== "admin") {
    throw new ValidationError("Ungueltige Rolle.", { role: "Rolle muss 'user' oder 'admin' sein." });
  }

  const target = await c.env.DB.prepare("SELECT id, role FROM users WHERE id = ?")
    .bind(id)
    .first<{ id: string; role: "user" | "admin" }>();
  if (!target) return c.json({ error: "Dieser Benutzer existiert nicht mehr." }, 404);
  if (target.role === role) return c.json({ ok: true });

  // Sich selbst degradieren ist erlaubt, solange noch ein anderer Admin bleibt.
  if (target.role === "admin" && role === "user" && (await adminCount(c)) <= 1) {
    return c.json({ error: "Es muss mindestens ein Admin uebrig bleiben." }, 409);
  }

  await c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  // Rollenwechsel beendet bestehende Sessions, damit niemand mit veralteten
  // Rechten weiterarbeitet. Der eigene Login bleibt bestehen.
  if (id !== actor.id) await destroyAllSessionsFor(c.env, id);

  return c.json({ ok: true });
});

admin.delete("/users/:id", async (c) => {
  const actor = currentUser(c);
  const id = c.req.param("id");

  if (id === actor.id) {
    return c.json({ error: "Du kannst dein eigenes Konto hier nicht loeschen." }, 409);
  }

  const target = await c.env.DB.prepare("SELECT role FROM users WHERE id = ?")
    .bind(id)
    .first<{ role: "user" | "admin" }>();
  if (!target) return c.json({ error: "Dieser Benutzer existiert nicht mehr." }, 404);
  if (target.role === "admin" && (await adminCount(c)) <= 1) {
    return c.json({ error: "Es muss mindestens ein Admin uebrig bleiben." }, 409);
  }

  // Essen bleiben erhalten (created_by wird zu NULL), Stimmen und Sessions
  // verschwinden per ON DELETE CASCADE.
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Abstimmungen
// ---------------------------------------------------------------------------

admin.get("/votes", async (c) => {
  const settings = await getSettings(c.env);
  const today = todayInZone();
  const from = c.req.query("from") ?? addDays(today, -14);
  const to = c.req.query("to") ?? addDays(today, settings.planningDaysAhead);

  const { results } = await c.env.DB.prepare(
    `SELECT md.id, md.date, md.voting_open, m.name AS meal_name,
            COALESCE(SUM(CASE WHEN v.vote = 1 THEN 1 ELSE 0 END), 0) AS yes_votes,
            COALESCE(SUM(CASE WHEN v.vote = -1 THEN 1 ELSE 0 END), 0) AS no_votes
       FROM meal_days md
       JOIN meals m ON m.id = md.meal_id
       LEFT JOIN votes v ON v.meal_day_id = md.id
      WHERE md.date >= ? AND md.date <= ?
      GROUP BY md.id
      ORDER BY md.date ASC`,
  )
    .bind(from, to)
    .all<{
      id: string;
      date: string;
      voting_open: number;
      meal_name: string;
      yes_votes: number;
      no_votes: number;
    }>();

  const now = new Date();
  return c.json({
    polls: results.map((row) => {
      const state = votingState(row.date, row.voting_open === 1, settings.voteDeadlineHour, now);
      const yes = Number(row.yes_votes);
      const no = Number(row.no_votes);
      const total = yes + no;
      return {
        id: row.id,
        date: row.date,
        mealName: row.meal_name,
        adminOpen: row.voting_open === 1,
        open: state.open,
        closedReason: state.reason,
        deadline: state.deadline.toISOString(),
        votes: { yes, no, total, approval: total === 0 ? 0 : Math.round((yes / total) * 100) },
      };
    }),
  });
});

/** Abstimmung manuell schliessen oder wieder oeffnen. */
admin.put("/votes/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.open !== "boolean") {
    throw new ValidationError("Ungueltiger Wert.", { open: "Ungueltiger Wert." });
  }

  const result = await c.env.DB.prepare("UPDATE meal_days SET voting_open = ? WHERE id = ?")
    .bind(body.open ? 1 : 0, id)
    .run();
  if (!result.meta.changes) return c.json({ error: "Diese Abstimmung existiert nicht." }, 404);
  return c.json({ ok: true });
});

/** Einzelne Stimmen eines Tages einsehen. */
admin.get("/votes/:id/details", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.name AS user_name, v.vote, v.updated_at
       FROM votes v JOIN users u ON u.id = v.user_id
      WHERE v.meal_day_id = ?
      ORDER BY v.updated_at DESC`,
  )
    .bind(c.req.param("id"))
    .all<{ user_name: string; vote: number; updated_at: string }>();

  return c.json({
    votes: results.map((row) => ({
      userName: row.user_name,
      vote: row.vote > 0 ? 1 : -1,
      updatedAt: row.updated_at,
    })),
  });
});

// ---------------------------------------------------------------------------
// Systemeinstellungen
// ---------------------------------------------------------------------------

admin.get("/settings", async (c) => c.json({ settings: await getSettings(c.env) }));

admin.put("/settings", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const patch: Parameters<typeof updateSettings>[1] = {};

  if (body.appName !== undefined) {
    patch.appName = requireString(body.appName, "appName", { max: 40, label: "App-Name" });
  }
  if (body.planningDaysAhead !== undefined) {
    const days = Number(body.planningDaysAhead);
    if (!Number.isInteger(days) || days < 1 || days > 60) {
      throw new ValidationError("Ungueltiger Zeitraum.", {
        planningDaysAhead: "Bitte einen Wert zwischen 1 und 60 Tagen waehlen.",
      });
    }
    patch.planningDaysAhead = days;
  }
  if (body.registrationOpen !== undefined) {
    if (typeof body.registrationOpen !== "boolean") {
      throw new ValidationError("Ungueltiger Wert.", { registrationOpen: "Ungueltiger Wert." });
    }
    patch.registrationOpen = body.registrationOpen;
  }
  if (body.voteDeadlineHour !== undefined) {
    const hour = Number(body.voteDeadlineHour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new ValidationError("Ungueltige Uhrzeit.", {
        voteDeadlineHour: "Bitte eine Stunde zwischen 0 und 23 waehlen.",
      });
    }
    patch.voteDeadlineHour = hour;
  }

  await updateSettings(c.env, patch);
  return c.json({ settings: await getSettings(c.env) });
});

/** Kennzahlen fuer das Admin-Dashboard. */
admin.get("/stats", async (c) => {
  const today = todayInZone();
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM meals) AS meals,
       (SELECT COUNT(*) FROM meal_days WHERE date >= ?1) AS planned,
       (SELECT COUNT(*) FROM votes) AS votes,
       (SELECT COUNT(*) FROM shopping_items WHERE hidden = 0) AS shopping_items`,
  )
    .bind(today)
    .first<{ users: number; meals: number; planned: number; votes: number; shopping_items: number }>();

  return c.json({
    stats: {
      users: row?.users ?? 0,
      meals: row?.meals ?? 0,
      plannedDays: row?.planned ?? 0,
      votes: row?.votes ?? 0,
      shoppingItems: row?.shopping_items ?? 0,
    },
  });
});

export { admin };
