import { Hono } from "hono";
import type { Ingredient, PlannedDay, VoteValue } from "../../shared/types";
import type { Env } from "../lib/env";
import type { AppVariables } from "../lib/auth";
import { currentUser, requireAuth } from "../lib/auth";
import { newId } from "../lib/ids";
import { getSettings } from "../lib/settings";
import { addDays, isValidIsoDate, todayInZone, votingState } from "../lib/time";
import { ValidationError, requireString } from "../lib/validation";

interface PlannedRow {
  id: string;
  date: string;
  voting_open: number;
  meal_id: string;
  meal_name: string;
  meal_description: string | null;
  meal_image: string | null;
  yes_votes: number;
  no_votes: number;
  my_vote: number | null;
}

/**
 * Lädt geplante Tage inklusive Abstimmungsergebnis und Zutaten.
 * Die Deadline wird hier - und nur hier - serverseitig ausgewertet.
 */
export async function loadPlannedDays(
  env: Env,
  userId: string,
  range: { from: string; to: string },
): Promise<PlannedDay[]> {
  const settings = await getSettings(env);
  const { results } = await env.DB.prepare(
    `SELECT md.id, md.date, md.voting_open,
            m.id AS meal_id, m.name AS meal_name,
            m.description AS meal_description, m.image AS meal_image,
            COALESCE(SUM(CASE WHEN v.vote = 1 THEN 1 ELSE 0 END), 0) AS yes_votes,
            COALESCE(SUM(CASE WHEN v.vote = -1 THEN 1 ELSE 0 END), 0) AS no_votes,
            MAX(CASE WHEN v.user_id = ?1 THEN v.vote END) AS my_vote
       FROM meal_days md
       JOIN meals m ON m.id = md.meal_id
       LEFT JOIN votes v ON v.meal_day_id = md.id
      WHERE md.date >= ?2 AND md.date <= ?3
      GROUP BY md.id
      ORDER BY md.date ASC`,
  )
    .bind(userId, range.from, range.to)
    .all<PlannedRow>();

  if (results.length === 0) return [];

  const mealIds = [...new Set(results.map((r) => r.meal_id))];
  const placeholders = mealIds.map(() => "?").join(", ");
  const { results: ingredientRows } = await env.DB.prepare(
    `SELECT id, meal_id, name, amount, unit FROM ingredients
      WHERE meal_id IN (${placeholders}) ORDER BY position ASC, rowid ASC`,
  )
    .bind(...mealIds)
    .all<{ id: string; meal_id: string; name: string; amount: number | null; unit: string | null }>();

  const ingredientsByMeal = new Map<string, Ingredient[]>();
  for (const row of ingredientRows) {
    const list = ingredientsByMeal.get(row.meal_id) ?? [];
    list.push({ id: row.id, name: row.name, amount: row.amount, unit: row.unit });
    ingredientsByMeal.set(row.meal_id, list);
  }

  const now = new Date();
  const today = todayInZone(now);

  return results.map((row) => {
    const state = votingState(row.date, row.voting_open === 1, settings.voteDeadlineHour, now);
    const yes = Number(row.yes_votes);
    const no = Number(row.no_votes);
    const total = yes + no;
    return {
      id: row.id,
      date: row.date,
      meal: {
        id: row.meal_id,
        name: row.meal_name,
        description: row.meal_description,
        image: row.meal_image,
        ingredients: ingredientsByMeal.get(row.meal_id) ?? [],
      },
      votes: {
        yes,
        no,
        total,
        approval: total === 0 ? 0 : Math.round((yes / total) * 100),
      },
      myVote: row.my_vote === null ? null : ((row.my_vote > 0 ? 1 : -1) as VoteValue),
      votingOpen: state.open,
      closedReason: state.reason,
      deadline: state.deadline.toISOString(),
      isToday: row.date === today,
      isPast: row.date < today,
    };
  });
}

const planning = new Hono<{ Bindings: Env; Variables: AppVariables }>();

planning.use("*", requireAuth);

/**
 * Essensplan. Standardmäßig ab heute bis `planningDaysAhead` Tage in die
 * Zukunft; mit `?from=&to=` kann ein eigener Zeitraum geladen werden.
 */
planning.get("/", async (c) => {
  const user = currentUser(c);
  const settings = await getSettings(c.env);
  const today = todayInZone();

  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");
  const from = fromParam && isValidIsoDate(fromParam) ? fromParam : today;
  const to = toParam && isValidIsoDate(toParam) ? toParam : addDays(today, settings.planningDaysAhead);

  const days = await loadPlannedDays(c.env, user.id, { from, to });
  return c.json({ days, range: { from, to }, today });
});

/**
 * Essen einem Tag zuordnen. Pro Tag ist genau ein Essen geplant; ein erneutes
 * Zuordnen ersetzt den Eintrag.
 */
planning.post("/", async (c) => {
  const user = currentUser(c);
  const body = await c.req.json().catch(() => ({}));

  const date = requireString(body.date, "date", { max: 10, label: "Datum" });
  if (!isValidIsoDate(date)) {
    throw new ValidationError("Ungültiges Datum.", { date: "Bitte wähle ein gültiges Datum." });
  }
  const mealId = requireString(body.mealId, "mealId", { max: 64, label: "Essen" });

  const today = todayInZone();
  // Nur Admins dürfen die Vergangenheit umschreiben.
  if (date < today && user.role !== "admin") {
    throw new ValidationError("Datum liegt in der Vergangenheit.", {
      date: "Du kannst nur für heute oder später planen.",
    });
  }

  const meal = await c.env.DB.prepare("SELECT id FROM meals WHERE id = ?")
    .bind(mealId)
    .first<{ id: string }>();
  if (!meal) {
    throw new ValidationError("Unbekanntes Essen.", { mealId: "Bitte wähle ein vorhandenes Essen." });
  }

  const existing = await c.env.DB.prepare("SELECT id, meal_id FROM meal_days WHERE date = ?")
    .bind(date)
    .first<{ id: string; meal_id: string }>();

  if (existing) {
    if (existing.meal_id === mealId) {
      return c.json({ ok: true, changed: false });
    }
    // Nur Admins dürfen eine bestehende Planung überschreiben - sonst
    // könnte jemand eine laufende Abstimmung unter den Füßen wegziehen.
    if (user.role !== "admin") {
      return c.json(
        { error: "Für diesen Tag ist bereits ein Essen geplant. Das kann nur ein Admin ändern." },
        403,
      );
    }
    // Essen gewechselt -> alte Stimmen sind gegenstandslos.
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM votes WHERE meal_day_id = ?").bind(existing.id),
      c.env.DB.prepare("UPDATE meal_days SET meal_id = ? WHERE id = ?").bind(mealId, existing.id),
    ]);
    return c.json({ ok: true, changed: true });
  }

  await c.env.DB.prepare("INSERT INTO meal_days (id, meal_id, date) VALUES (?, ?, ?)")
    .bind(newId(), mealId, date)
    .run();
  return c.json({ ok: true, changed: true }, 201);
});

planning.delete("/:id", async (c) => {
  const user = currentUser(c);
  if (user.role !== "admin") {
    return c.json({ error: "Nur Admins können den Essensplan ändern." }, 403);
  }
  const result = await c.env.DB.prepare("DELETE FROM meal_days WHERE id = ?")
    .bind(c.req.param("id"))
    .run();
  if (!result.meta.changes) return c.json({ error: "Diese Planung gibt es nicht (mehr)." }, 404);
  return c.json({ ok: true });
});

export { planning };
