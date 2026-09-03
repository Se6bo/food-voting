import { Hono } from "hono";
import type {
  Ingredient,
  MealSlot,
  PlannedDay,
  PlannedDayProposal,
  VoteValue,
} from "../../shared/types";
import { MEAL_SLOTS } from "../../shared/types";
import type { Env } from "../lib/env";
import type { AppVariables } from "../lib/auth";
import { currentUser, requireAuth, requireGroupId } from "../lib/auth";
import { isMissingMigrationError, MIGRATION_0004_MISSING_MESSAGE } from "../lib/db-errors";
import { newId } from "../lib/ids";
import { getSettings } from "../lib/settings";
import { addDays, isValidIsoDate, todayInZone, votingState } from "../lib/time";
import { ValidationError, requireString } from "../lib/validation";

/** Validiert einen vom Client geschickten Slot-Wert gegen die drei erlaubten. */
function requireSlot(value: unknown): MealSlot {
  if (typeof value === "string" && (MEAL_SLOTS as string[]).includes(value)) {
    return value as MealSlot;
  }
  throw new ValidationError("Ungültiges Zeitfenster.", {
    slot: "Bitte wähle Mittagessen, Mittagssnack oder Abendessen.",
  });
}

interface PlanDayRow {
  id: string;
  date: string;
  slot: string;
  voting_open: number;
}

interface ProposalRow {
  id: string;
  plan_day_id: string;
  created_by: string | null;
  created_at: string;
  meal_id: string;
  meal_name: string;
  meal_description: string | null;
  meal_image: string | null;
  meal_cookidoo_url: string | null;
  created_by_name: string | null;
}

interface VoteRow {
  proposal_id: string;
  user_id: string;
  vote: number;
}

interface IngredientRow {
  id: string;
  meal_id: string;
  name: string;
  amount: number | null;
  unit: string | null;
}

/**
 * Gewinner eines geschlossenen Tages: der Vorschlag mit der höchsten
 * Ja-minus-Nein-Differenz. Bei Gleichstand gewinnt die höhere Zahl an
 * Ja-Stimmen, danach der früher eingereichte Vorschlag - damit ist die
 * Entscheidung immer eindeutig und reproduzierbar.
 */
function pickWinner(proposals: PlannedDayProposal[]): string | null {
  let best: PlannedDayProposal | null = null;
  for (const proposal of proposals) {
    if (!best) {
      best = proposal;
      continue;
    }
    const diff = proposal.votes.yes - proposal.votes.no;
    const bestDiff = best.votes.yes - best.votes.no;
    if (diff > bestDiff || (diff === bestDiff && proposal.votes.yes > best.votes.yes)) {
      best = proposal;
    }
  }
  return best?.id ?? null;
}

/** Verständliche Meldung, warum eine Abstimmung geschlossen ist. */
function closedVotingMessage(reason: "past" | "deadline" | "admin" | null): string {
  switch (reason) {
    case "past":
      return "Dieser Tag liegt in der Vergangenheit. Abstimmen ist nicht mehr möglich.";
    case "admin":
      return "Diese Abstimmung wurde von einem Admin geschlossen.";
    default:
      return "Die Abstimmung für diesen Tag ist bereits geschlossen.";
  }
}

/**
 * Lädt geplante Tage (plan_days) einer Gruppe inklusive aller Vorschläge,
 * Abstimmungsergebnisse und Zutaten. Die Deadline wird hier - und nur hier -
 * serverseitig ausgewertet; der Gewinner wird für geschlossene Tage live
 * berechnet und nie gespeichert.
 */
export async function loadPlannedDays(
  env: Env,
  viewer: { id: string; groupId: string },
  range: { from: string; to: string },
): Promise<PlannedDay[]> {
  const settings = await getSettings(env);
  const { results: planDays } = await env.DB.prepare(
    `SELECT id, date, slot, voting_open FROM plan_days
      WHERE group_id = ? AND date >= ? AND date <= ?
      ORDER BY date ASC,
               CASE slot WHEN 'lunch' THEN 0 WHEN 'snack' THEN 1 WHEN 'dinner' THEN 2 ELSE 3 END ASC`,
  )
    .bind(viewer.groupId, range.from, range.to)
    .all<PlanDayRow>();
  if (planDays.length === 0) return [];

  const dayIds = planDays.map((day) => day.id);
  const dayPlaceholders = dayIds.map(() => "?").join(", ");

  const { results: proposals } = await env.DB.prepare(
    `SELECT mp.id, mp.plan_day_id, mp.created_by, mp.created_at,
            m.id AS meal_id, m.name AS meal_name,
            m.description AS meal_description, m.image AS meal_image,
            m.cookidoo_url AS meal_cookidoo_url,
            u.name AS created_by_name
       FROM meal_proposals mp
       JOIN meals m ON m.id = mp.meal_id
       LEFT JOIN users u ON u.id = mp.created_by
      WHERE mp.plan_day_id IN (${dayPlaceholders})
      ORDER BY mp.created_at ASC, mp.rowid ASC`,
  )
    .bind(...dayIds)
    .all<ProposalRow>();

  // Stimmen und Zutaten nur laden, wenn es überhaupt Vorschläge gibt -
  // sonst würde "IN ()" eine leere Werteliste erzeugen.
  const proposalsById = new Map<string, ProposalRow>();
  const voteQueries: string[] = [];
  const mealIds: string[] = [];
  for (const proposal of proposals) {
    proposalsById.set(proposal.id, proposal);
    voteQueries.push("?");
    if (!mealIds.includes(proposal.meal_id)) mealIds.push(proposal.meal_id);
  }

  const votesByProposal = new Map<string, { yes: number; no: number; myVote: VoteValue | null }>();
  if (proposals.length > 0) {
    const { results: votes } = await env.DB.prepare(
      `SELECT proposal_id, user_id, vote FROM proposal_votes
        WHERE proposal_id IN (${voteQueries.join(", ")})`,
    )
      .bind(...proposals.map((p) => p.id))
      .all<VoteRow>();
    for (const vote of votes) {
      const entry = votesByProposal.get(vote.proposal_id) ?? { yes: 0, no: 0, myVote: null };
      if (vote.vote === 1) entry.yes += 1;
      else entry.no += 1;
      if (vote.user_id === viewer.id) entry.myVote = vote.vote > 0 ? 1 : -1;
      votesByProposal.set(vote.proposal_id, entry);
    }
  }

  const ingredientsByMeal = new Map<string, Ingredient[]>();
  if (mealIds.length > 0) {
    const placeholders = mealIds.map(() => "?").join(", ");
    const { results: ingredientRows } = await env.DB.prepare(
      `SELECT id, meal_id, name, amount, unit FROM ingredients
        WHERE meal_id IN (${placeholders}) ORDER BY position ASC, rowid ASC`,
    )
      .bind(...mealIds)
      .all<IngredientRow>();
    for (const row of ingredientRows) {
      const list = ingredientsByMeal.get(row.meal_id) ?? [];
      list.push({ id: row.id, name: row.name, amount: row.amount, unit: row.unit });
      ingredientsByMeal.set(row.meal_id, list);
    }
  }

  const now = new Date();
  const today = todayInZone(now);

  return planDays.map((day) => {
    const state = votingState(day.date, day.voting_open === 1, settings.voteDeadlineHour, now);
    const dayProposals: PlannedDayProposal[] = proposals
      .filter((proposal) => proposal.plan_day_id === day.id)
      .map((proposal) => {
        const summary = votesByProposal.get(proposal.id) ?? {
          yes: 0,
          no: 0,
          myVote: null as VoteValue | null,
        };
        const total = summary.yes + summary.no;
        return {
          id: proposal.id,
          meal: {
            id: proposal.meal_id,
            name: proposal.meal_name,
            description: proposal.meal_description,
            image: proposal.meal_image,
            ingredients: ingredientsByMeal.get(proposal.meal_id) ?? [],
            cookidooUrl: proposal.meal_cookidoo_url,
          },
          createdBy: proposal.created_by,
          createdByName: proposal.created_by_name,
          createdAt: proposal.created_at,
          votes: {
            yes: summary.yes,
            no: summary.no,
            total,
            approval: total === 0 ? 0 : Math.round((summary.yes / total) * 100),
          },
          myVote: summary.myVote,
        };
      });

    return {
      id: day.id,
      date: day.date,
      slot: day.slot as MealSlot,
      proposals: dayProposals,
      // Nur geschlossene Tage haben einen Gewinner.
      winningProposalId: state.open ? null : pickWinner(dayProposals),
      votingOpen: state.open,
      closedReason: state.reason,
      deadline: state.deadline.toISOString(),
      isToday: day.date === today,
      isPast: day.date < today,
    };
  });
}

/**
 * Lädt einen einzelnen Tag+Slot - praktisch für Antworten nach
 * Schreibzugriffen. Ein Datum allein reicht nicht mehr aus, seit pro Tag bis
 * zu drei getrennte Slots (Mittagessen/Mittagssnack/Abendessen) existieren.
 */
async function loadDay(
  env: Env,
  viewer: { id: string; groupId: string },
  date: string,
  slot: MealSlot,
): Promise<PlannedDay | undefined> {
  const days = await loadPlannedDays(env, viewer, { from: date, to: date });
  return days.find((day) => day.slot === slot);
}

const planning = new Hono<{ Bindings: Env; Variables: AppVariables }>();

planning.use("*", requireAuth);

/**
 * Essensplan der eigenen Gruppe. Standardmäßig ab heute bis
 * `planningDaysAhead` Tage in die Zukunft; mit `?from=&to=` kann ein eigener
 * Zeitraum geladen werden (z.B. für "Vergangene zeigen").
 */
planning.get("/", async (c) => {
  const user = currentUser(c);
  const groupId = requireGroupId(user);
  const settings = await getSettings(c.env);
  const today = todayInZone();

  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");
  const from = fromParam && isValidIsoDate(fromParam) ? fromParam : today;
  const to = toParam && isValidIsoDate(toParam) ? toParam : addDays(today, settings.planningDaysAhead);

  const days = await loadPlannedDays(c.env, { id: user.id, groupId }, { from, to });
  return c.json({ days, range: { from, to }, today });
});

/**
 * Ein Essen für einen Tag vorschlagen. Pro Tag sind beliebig viele Vorschläge
 * erlaubt (solange die Abstimmung offen ist) - die Gruppe stimmt danach je
 * Vorschlag ab. Dasselbe Essen kann für denselben Tag nicht doppelt
 * vorgeschlagen werden (UNIQUE-Constraint in der DB).
 */
planning.post("/", async (c) => {
  const user = currentUser(c);
  const groupId = requireGroupId(user);
  const body = await c.req.json().catch(() => ({}));

  const date = requireString(body.date, "date", { max: 10, label: "Datum" });
  if (!isValidIsoDate(date)) {
    throw new ValidationError("Ungültiges Datum.", { date: "Bitte wähle ein gültiges Datum." });
  }
  const slot = requireSlot(body.slot);
  const mealId = requireString(body.mealId, "mealId", { max: 64, label: "Essen" });

  const today = todayInZone();
  // Nur Admins dürfen die Vergangenheit umschreiben.
  if (date < today && user.role !== "admin") {
    throw new ValidationError("Datum liegt in der Vergangenheit.", {
      date: "Du kannst nur für heute oder später planen.",
    });
  }

  // Essen muss aus der eigenen Gruppe stammen - fremde Gruppen bleiben unsichtbar.
  const meal = await c.env.DB.prepare("SELECT id FROM meals WHERE id = ? AND group_id = ?")
    .bind(mealId, groupId)
    .first<{ id: string }>();
  if (!meal) {
    throw new ValidationError("Unbekanntes Essen.", {
      mealId: "Bitte wähle ein vorhandenes Essen aus deiner Gruppe.",
    });
  }

  const settings = await getSettings(c.env);
  const existingDay = await c.env.DB.prepare(
    "SELECT id, voting_open FROM plan_days WHERE group_id = ? AND date = ? AND slot = ?",
  )
    .bind(groupId, date, slot)
    .first<{ id: string; voting_open: number }>();

  let planDayId: string;
  if (existingDay) {
    // In einen bereits geschlossenen Tag können keine Vorschläge mehr
    // eingebracht werden - Ausnahme: Admins dürfen vergangene Tage pflegen.
    const state = votingState(date, existingDay.voting_open === 1, settings.voteDeadlineHour);
    if (!state.open && !(user.role === "admin" && date < today)) {
      return c.json(
        {
          error: closedVotingMessage(state.reason),
          closedReason: state.reason,
          deadline: state.deadline.toISOString(),
        },
        409,
      );
    }
    planDayId = existingDay.id;
  } else {
    planDayId = newId();
    try {
      await c.env.DB.prepare(
        "INSERT INTO plan_days (id, group_id, date, slot) VALUES (?, ?, ?, ?)",
      )
        .bind(planDayId, groupId, date, slot)
        .run();
    } catch (err) {
      if (isMissingMigrationError(err)) return c.json({ error: MIGRATION_0004_MISSING_MESSAGE }, 503);
      throw err;
    }
  }

  const existingProposal = await c.env.DB.prepare(
    "SELECT id FROM meal_proposals WHERE plan_day_id = ? AND meal_id = ?",
  )
    .bind(planDayId, mealId)
    .first<{ id: string }>();
  if (existingProposal) {
    // Schon vorgeschlagen - kein Fehler, aber auch keine neue Planung.
    return c.json({
      ok: true,
      changed: false,
      day: await loadDay(c.env, { id: user.id, groupId }, date, slot),
    });
  }

  await c.env.DB.prepare(
    "INSERT INTO meal_proposals (id, plan_day_id, meal_id, created_by) VALUES (?, ?, ?, ?)",
  )
    .bind(newId(), planDayId, mealId, user.id)
    .run();

  return c.json(
    {
      ok: true,
      changed: true,
      day: await loadDay(c.env, { id: user.id, groupId }, date, slot),
    },
    201,
  );
});

/**
 * Einen geplanten Tag (mit allen Vorschlägen) entfernen. Nur Admins - die
 * Löschung räumt per ON DELETE CASCADE auch Vorschläge und Stimmen auf.
 */
planning.delete("/:id", async (c) => {
  const user = currentUser(c);
  if (user.role !== "admin") {
    return c.json({ error: "Nur Admins können den Essensplan ändern." }, 403);
  }
  const groupId = requireGroupId(user);
  const result = await c.env.DB.prepare("DELETE FROM plan_days WHERE id = ? AND group_id = ?")
    .bind(c.req.param("id"), groupId)
    .run();
  if (!result.meta.changes) return c.json({ error: "Diese Planung gibt es nicht (mehr)." }, 404);
  return c.json({ ok: true });
});

/**
 * Abstimmung eines Tages vorzeitig schließen oder wieder öffnen - für jedes
 * Mitglied der eigenen Gruppe, nicht nur für Admins (die haben zusätzlich
 * den gleichwertigen Weg über /api/admin/votes/:id).
 */
planning.put("/:id/voting", async (c) => {
  const user = currentUser(c);
  const groupId = requireGroupId(user);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.open !== "boolean") {
    throw new ValidationError("Ungültiger Wert.", { open: "Ungültiger Wert." });
  }

  const day = await c.env.DB.prepare("SELECT id, date, slot FROM plan_days WHERE id = ? AND group_id = ?")
    .bind(id, groupId)
    .first<{ id: string; date: string; slot: string }>();
  if (!day) return c.json({ error: "Diese Planung gibt es nicht (mehr)." }, 404);

  await c.env.DB.prepare("UPDATE plan_days SET voting_open = ? WHERE id = ? AND group_id = ?")
    .bind(body.open ? 1 : 0, id, groupId)
    .run();

  return c.json({
    ok: true,
    day: await loadDay(c.env, { id: user.id, groupId }, day.date, day.slot as MealSlot),
  });
});

export { planning };
