import { Hono } from "hono";
import type { Env } from "../lib/env";
import type { AppVariables } from "../lib/auth";
import { currentUser, requireAuth } from "../lib/auth";
import { newId } from "../lib/ids";
import { getSettings } from "../lib/settings";
import { votingState } from "../lib/time";
import { ValidationError, requireString } from "../lib/validation";
import { loadPlannedDays } from "./planning";

const votes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

votes.use("*", requireAuth);

/** Eigene Stimmen im Ueberblick. */
votes.get("/", async (c) => {
  const user = currentUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.vote, v.updated_at, md.date, m.name AS meal_name
       FROM votes v
       JOIN meal_days md ON md.id = v.meal_day_id
       JOIN meals m ON m.id = md.meal_id
      WHERE v.user_id = ?
      ORDER BY md.date DESC`,
  )
    .bind(user.id)
    .all<{ id: string; vote: number; updated_at: string; date: string; meal_name: string }>();

  return c.json({
    votes: results.map((row) => ({
      id: row.id,
      vote: row.vote > 0 ? 1 : -1,
      date: row.date,
      mealName: row.meal_name,
      updatedAt: row.updated_at,
    })),
  });
});

/**
 * Stimme abgeben oder aendern.
 *
 * Die Deadline wird hier serverseitig geprueft - das Frontend blendet den
 * Button zwar aus, das ist aber nur Komfort, keine Absicherung.
 */
votes.post("/", async (c) => {
  const user = currentUser(c);
  const body = await c.req.json().catch(() => ({}));

  const mealDayId = requireString(body.mealDayId, "mealDayId", { max: 64, label: "Tag" });
  const rawVote = body.vote;
  if (rawVote !== 1 && rawVote !== -1) {
    throw new ValidationError("Ungueltige Stimme.", { vote: "Bitte stimme mit Ja oder Nein ab." });
  }

  const day = await c.env.DB.prepare("SELECT id, date, voting_open FROM meal_days WHERE id = ?")
    .bind(mealDayId)
    .first<{ id: string; date: string; voting_open: number }>();
  if (!day) return c.json({ error: "Fuer diesen Tag ist kein Essen geplant." }, 404);

  const settings = await getSettings(c.env);
  const state = votingState(day.date, day.voting_open === 1, settings.voteDeadlineHour);
  if (!state.open) {
    const message =
      state.reason === "past"
        ? "Dieser Tag liegt in der Vergangenheit. Abstimmen ist nicht mehr moeglich."
        : state.reason === "admin"
          ? "Diese Abstimmung wurde von einem Admin geschlossen."
          : "Die Abstimmung fuer diesen Tag ist bereits geschlossen.";
    return c.json({ error: message, closedReason: state.reason, deadline: state.deadline.toISOString() }, 409);
  }

  // Ein Benutzer, eine Stimme pro Tag: das UNIQUE-Constraint auf
  // (user_id, meal_day_id) macht den Upsert eindeutig.
  await c.env.DB.prepare(
    `INSERT INTO votes (id, user_id, meal_day_id, vote) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, meal_day_id)
     DO UPDATE SET vote = excluded.vote, updated_at = datetime('now')`,
  )
    .bind(newId(), user.id, mealDayId, rawVote)
    .run();

  const [day2] = await loadPlannedDays(c.env, user.id, { from: day.date, to: day.date });
  return c.json({ ok: true, day: day2 });
});

/** Eigene Stimme zuruecknehmen, solange die Abstimmung offen ist. */
votes.delete("/:mealDayId", async (c) => {
  const user = currentUser(c);
  const mealDayId = c.req.param("mealDayId");

  const day = await c.env.DB.prepare("SELECT date, voting_open FROM meal_days WHERE id = ?")
    .bind(mealDayId)
    .first<{ date: string; voting_open: number }>();
  if (!day) return c.json({ error: "Fuer diesen Tag ist kein Essen geplant." }, 404);

  const settings = await getSettings(c.env);
  const state = votingState(day.date, day.voting_open === 1, settings.voteDeadlineHour);
  if (!state.open) {
    return c.json({ error: "Die Abstimmung fuer diesen Tag ist bereits geschlossen." }, 409);
  }

  await c.env.DB.prepare("DELETE FROM votes WHERE user_id = ? AND meal_day_id = ?")
    .bind(user.id, mealDayId)
    .run();

  const [day2] = await loadPlannedDays(c.env, user.id, { from: day.date, to: day.date });
  return c.json({ ok: true, day: day2 });
});

export { votes };
