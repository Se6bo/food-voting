import { Hono } from "hono";
import type { Env } from "../lib/env";
import type { AppVariables } from "../lib/auth";
import { currentUser, requireAuth, requireGroupId } from "../lib/auth";
import { newId } from "../lib/ids";
import { getSettings } from "../lib/settings";
import { votingState } from "../lib/time";
import { ValidationError, requireString } from "../lib/validation";
import { loadPlannedDays } from "./planning";

const votes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

votes.use("*", requireAuth);

/**
 * Eigene Stimmen im Überblick (Stimmen auf einzelne Vorschläge). Die Antwort
 * zeigt Tag und Essen des Vorschlags, damit die Profilseite eine lesbare
 * Historie bauen kann.
 */
votes.get("/", async (c) => {
  const user = currentUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT pv.id, pv.vote, pv.updated_at, pd.date, m.name AS meal_name
       FROM proposal_votes pv
       JOIN meal_proposals mp ON mp.id = pv.proposal_id
       JOIN plan_days pd ON pd.id = mp.plan_day_id
       JOIN meals m ON m.id = mp.meal_id
      WHERE pv.user_id = ?
      ORDER BY pd.date DESC, pv.updated_at DESC`,
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
 * Lädt den Tag+Slot eines Vorschlags für die Antwort nach der Abstimmung.
 * Ein Datum reicht nicht mehr aus, seit pro Tag bis zu drei Slots
 * (Mittagessen/Mittagssnack/Abendessen) mit je eigenen plan_days-Zeilen
 * existieren - daher wird gezielt nach der plan_day_id gefiltert.
 */
async function loadProposalDay(
  c: { env: Env },
  viewer: { id: string; groupId: string },
  date: string,
  planDayId: string,
) {
  const days = await loadPlannedDays(c.env, viewer, { from: date, to: date });
  return days.find((day) => day.id === planDayId);
}

/**
 * Stimme für einen Vorschlag abgeben oder ändern. Ein Benutzer hat genau eine
 * Stimme pro Vorschlag (Ja oder Nein) - erneutes Abstimmen überschreibt die
 * alte Stimme (Upsert über das UNIQUE-Constraint (user_id, proposal_id)).
 *
 * Die Deadline wird hier serverseitig geprüft - das Frontend blendet den
 * Button zwar aus, das ist aber nur Komfort, keine Absicherung.
 */
votes.post("/", async (c) => {
  const user = currentUser(c);
  const groupId = requireGroupId(user);
  const body = await c.req.json().catch(() => ({}));

  const proposalId = requireString(body.proposalId, "proposalId", { max: 64, label: "Vorschlag" });
  const rawVote = body.vote;
  if (rawVote !== 1 && rawVote !== -1) {
    throw new ValidationError("Ungültige Stimme.", { vote: "Bitte stimme mit Ja oder Nein ab." });
  }

  // Gruppen-Check in der Query: ein Vorschlag aus einer fremden Gruppe
  // existiert für diesen Benutzer schlicht nicht (404, kein Datenleck).
  const proposal = await c.env.DB.prepare(
    `SELECT mp.id, pd.id AS plan_day_id, pd.date, pd.voting_open
       FROM meal_proposals mp
       JOIN plan_days pd ON pd.id = mp.plan_day_id
      WHERE mp.id = ? AND pd.group_id = ?`,
  )
    .bind(proposalId, groupId)
    .first<{ id: string; plan_day_id: string; date: string; voting_open: number }>();
  if (!proposal) {
    return c.json({ error: "Dieser Vorschlag existiert nicht (mehr)." }, 404);
  }

  const settings = await getSettings(c.env);
  const state = votingState(proposal.date, proposal.voting_open === 1, settings.voteDeadlineHour);
  if (!state.open) {
    const message =
      state.reason === "past"
        ? "Dieser Tag liegt in der Vergangenheit. Abstimmen ist nicht mehr möglich."
        : state.reason === "admin"
          ? "Diese Abstimmung wurde von einem Admin geschlossen."
          : "Die Abstimmung für diesen Tag ist bereits geschlossen.";
    return c.json(
      { error: message, closedReason: state.reason, deadline: state.deadline.toISOString() },
      409,
    );
  }

  await c.env.DB.prepare(
    `INSERT INTO proposal_votes (id, user_id, proposal_id, vote) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, proposal_id)
     DO UPDATE SET vote = excluded.vote, updated_at = datetime('now')`,
  )
    .bind(newId(), user.id, proposalId, rawVote)
    .run();

  const day = await loadProposalDay(c, { id: user.id, groupId }, proposal.date, proposal.plan_day_id);
  return c.json({ ok: true, day });
});

/** Eigene Stimme für einen Vorschlag zurücknehmen, solange die Abstimmung offen ist. */
votes.delete("/:proposalId", async (c) => {
  const user = currentUser(c);
  const groupId = requireGroupId(user);
  const proposalId = c.req.param("proposalId");

  const proposal = await c.env.DB.prepare(
    `SELECT mp.id, pd.id AS plan_day_id, pd.date, pd.voting_open
       FROM meal_proposals mp
       JOIN plan_days pd ON pd.id = mp.plan_day_id
      WHERE mp.id = ? AND pd.group_id = ?`,
  )
    .bind(proposalId, groupId)
    .first<{ id: string; plan_day_id: string; date: string; voting_open: number }>();
  if (!proposal) {
    return c.json({ error: "Dieser Vorschlag existiert nicht (mehr)." }, 404);
  }

  const settings = await getSettings(c.env);
  const state = votingState(proposal.date, proposal.voting_open === 1, settings.voteDeadlineHour);
  if (!state.open) {
    return c.json({ error: "Die Abstimmung für diesen Tag ist bereits geschlossen." }, 409);
  }

  await c.env.DB.prepare("DELETE FROM proposal_votes WHERE user_id = ? AND proposal_id = ?")
    .bind(user.id, proposalId)
    .run();

  const day = await loadProposalDay(c, { id: user.id, groupId }, proposal.date, proposal.plan_day_id);
  return c.json({ ok: true, day });
});

export { votes };
