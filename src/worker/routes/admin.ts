import { Hono } from "hono";
import type { AdminGroup, MealSlot } from "../../shared/types";
import type { Env } from "../lib/env";
import type { AppVariables } from "../lib/auth";
import { currentUser, destroyAllSessionsFor, requireAdmin, requireGroupId } from "../lib/auth";
import { newId, newToken } from "../lib/ids";
import { getSettings, updateSettings } from "../lib/settings";
import { addDays, todayInZone, votingState } from "../lib/time";
import { ValidationError, requireString } from "../lib/validation";

const admin = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Jede Admin-Route liegt hinter der serverseitigen Rollenprüfung.
admin.use("*", requireAdmin);

// ---------------------------------------------------------------------------
// Benutzerverwaltung
// ---------------------------------------------------------------------------

admin.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.created_at,
            (SELECT COUNT(*) FROM meals m WHERE m.created_by = u.id) AS meal_count,
            (SELECT COUNT(*) FROM proposal_votes pv WHERE pv.user_id = u.id) AS vote_count
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

/** Zählt die verbleibenden Admins - schützt vor dem "letzten Admin"-Problem. */
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
    throw new ValidationError("Ungültige Rolle.", { role: "Rolle muss 'user' oder 'admin' sein." });
  }

  const target = await c.env.DB.prepare("SELECT id, role FROM users WHERE id = ?")
    .bind(id)
    .first<{ id: string; role: "user" | "admin" }>();
  if (!target) return c.json({ error: "Dieser Benutzer existiert nicht mehr." }, 404);
  if (target.role === role) return c.json({ ok: true });

  // Sich selbst degradieren ist erlaubt, solange noch ein anderer Admin bleibt.
  if (target.role === "admin" && role === "user" && (await adminCount(c)) <= 1) {
    return c.json({ error: "Es muss mindestens ein Admin übrig bleiben." }, 409);
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
    return c.json({ error: "Du kannst dein eigenes Konto hier nicht löschen." }, 409);
  }

  const target = await c.env.DB.prepare("SELECT role FROM users WHERE id = ?")
    .bind(id)
    .first<{ role: "user" | "admin" }>();
  if (!target) return c.json({ error: "Dieser Benutzer existiert nicht mehr." }, 404);
  if (target.role === "admin" && (await adminCount(c)) <= 1) {
    return c.json({ error: "Es muss mindestens ein Admin übrig bleiben." }, 409);
  }

  // Essen bleiben erhalten (created_by wird zu NULL), Stimmen und Sessions
  // verschwinden per ON DELETE CASCADE.
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Gruppenverwaltung
// ---------------------------------------------------------------------------

/** Einladungslink aus der Origin des Requests bauen (funktioniert lokal wie remote). */
function inviteUrl(origin: string, code: string): string {
  return `${origin}/registrieren?einladung=${encodeURIComponent(code)}`;
}

admin.get("/groups", async (c) => {
  const origin = new URL(c.req.url).origin;
  const { results } = await c.env.DB.prepare(
    `SELECT g.id, g.name, g.invite_code, g.created_at,
            COUNT(u.id) AS member_count
       FROM groups g
       LEFT JOIN users u ON u.group_id = g.id
      GROUP BY g.id
      ORDER BY g.created_at ASC`,
  ).all<{
    id: string;
    name: string;
    invite_code: string;
    created_at: string;
    member_count: number;
  }>();

  const groups: AdminGroup[] = results.map((row) => ({
    id: row.id,
    name: row.name,
    inviteCode: row.invite_code,
    inviteUrl: inviteUrl(origin, row.invite_code),
    memberCount: row.member_count,
    createdAt: row.created_at,
  }));
  return c.json({ groups });
});

admin.post("/groups", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = requireString(body.name, "name", { min: 2, max: 80, label: "Gruppenname" });

  // Eine leere Gruppe ohne Mitglieder - der Einladungscode bringt später
  // die ersten Mitglieder hinein.
  const id = newId();
  await c.env.DB.prepare(
    "INSERT INTO groups (id, name, invite_code, created_by) VALUES (?, ?, ?, NULL)",
  )
    .bind(id, name, newToken())
    .run();

  return c.json({ ok: true }, 201);
});

admin.delete("/groups/:id", async (c) => {
  const id = c.req.param("id");

  const members = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE group_id = ?")
    .bind(id)
    .first<{ count: number }>();
  if ((members?.count ?? 0) > 0) {
    return c.json(
      { error: "Nur Gruppen ohne Mitglieder können gelöscht werden." },
      409,
    );
  }

  // Leere Gruppen haben keine Daten außerhalb der Gruppe selbst; die
  // ON DELETE CASCADE-Beziehungen (plan_days, meals, shopping_items) sind
  // damit gegenstandslos.
  const result = await c.env.DB.prepare("DELETE FROM groups WHERE id = ?").bind(id).run();
  if (!result.meta.changes) return c.json({ error: "Diese Gruppe gibt es nicht (mehr)." }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Abstimmungen (ein "Poll" = ein geplanter Tag mit beliebig vielen Vorschlägen)
// ---------------------------------------------------------------------------

interface PollProposalRow {
  id: string;
  plan_day_id: string;
  created_at: string;
  meal_name: string;
  created_by_name: string | null;
}

admin.get("/votes", async (c) => {
  const groupId = requireGroupId(currentUser(c));
  const settings = await getSettings(c.env);
  const today = todayInZone();
  const from = c.req.query("from") ?? addDays(today, -14);
  const to = c.req.query("to") ?? addDays(today, settings.planningDaysAhead);

  const { results: days } = await c.env.DB.prepare(
    `SELECT pd.id, pd.date, pd.slot, pd.voting_open, g.name AS group_name
       FROM plan_days pd
       JOIN groups g ON g.id = pd.group_id
      WHERE pd.date >= ? AND pd.date <= ? AND pd.group_id = ?
      ORDER BY pd.date ASC,
               CASE pd.slot WHEN 'lunch' THEN 0 WHEN 'snack' THEN 1 WHEN 'dinner' THEN 2 ELSE 3 END ASC`,
  )
    .bind(from, to, groupId)
    .all<{ id: string; date: string; slot: string; voting_open: number; group_name: string }>();

  let proposals: PollProposalRow[] = [];
  let votes: Array<{ proposal_id: string; vote: number }> = [];
  if (days.length > 0) {
    const dayIds = days.map((day) => day.id);
    const placeholders = dayIds.map(() => "?").join(", ");
    const proposalResult = await c.env.DB.prepare(
      `SELECT mp.id, mp.plan_day_id, mp.created_at, m.name AS meal_name,
              u.name AS created_by_name
         FROM meal_proposals mp
         JOIN meals m ON m.id = mp.meal_id
         LEFT JOIN users u ON u.id = mp.created_by
        WHERE mp.plan_day_id IN (${placeholders})
        ORDER BY mp.created_at ASC`,
    )
      .bind(...dayIds)
      .all<PollProposalRow>();
    proposals = proposalResult.results;

    if (proposals.length > 0) {
      const proposalIds = proposals.map((proposal) => proposal.id);
      const votePlaceholders = proposalIds.map(() => "?").join(", ");
      const voteResult = await c.env.DB.prepare(
        `SELECT proposal_id, vote FROM proposal_votes
          WHERE proposal_id IN (${votePlaceholders})`,
      )
        .bind(...proposalIds)
        .all<{ proposal_id: string; vote: number }>();
      votes = voteResult.results;
    }
  }

  const votesByProposal = new Map<string, { yes: number; no: number }>();
  for (const vote of votes) {
    const summary = votesByProposal.get(vote.proposal_id) ?? { yes: 0, no: 0 };
    if (vote.vote === 1) summary.yes += 1;
    else summary.no += 1;
    votesByProposal.set(vote.proposal_id, summary);
  }

  const now = new Date();
  return c.json({
    polls: days.map((day) => {
      const state = votingState(day.date, day.voting_open === 1, settings.voteDeadlineHour, now);
      const dayProposals = proposals
        .filter((proposal) => proposal.plan_day_id === day.id)
        .map((proposal) => {
          const summary = votesByProposal.get(proposal.id) ?? { yes: 0, no: 0 };
          const total = summary.yes + summary.no;
          return {
            id: proposal.id,
            mealName: proposal.meal_name,
            createdByName: proposal.created_by_name,
            createdAt: proposal.created_at,
            votes: {
              yes: summary.yes,
              no: summary.no,
              total,
              approval: total === 0 ? 0 : Math.round((summary.yes / total) * 100),
            },
          };
        });
      // Gewinner wie im Plan: höchste Ja-minus-Nein-Differenz (nur bei
      // geschlossenen Tagen relevant).
      let winnerProposalId: string | null = null;
      if (!state.open && dayProposals.length > 0) {
        let bestDiff = Number.NEGATIVE_INFINITY;
        let bestYes = -1;
        for (const proposal of dayProposals) {
          const diff = proposal.votes.yes - proposal.votes.no;
          if (diff > bestDiff || (diff === bestDiff && proposal.votes.yes > bestYes)) {
            bestDiff = diff;
            bestYes = proposal.votes.yes;
            winnerProposalId = proposal.id;
          }
        }
      }
      return {
        id: day.id,
        date: day.date,
        slot: day.slot as MealSlot,
        groupName: day.group_name,
        adminOpen: day.voting_open === 1,
        open: state.open,
        closedReason: state.reason,
        deadline: state.deadline.toISOString(),
        proposals: dayProposals,
        winnerProposalId,
      };
    }),
  });
});

/** Abstimmung eines Tages manuell schließen oder wieder öffnen. */
admin.put("/votes/:id", async (c) => {
  const groupId = requireGroupId(currentUser(c));
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.open !== "boolean") {
    throw new ValidationError("Ungültiger Wert.", { open: "Ungültiger Wert." });
  }

  const result = await c.env.DB.prepare(
    "UPDATE plan_days SET voting_open = ? WHERE id = ? AND group_id = ?",
  )
    .bind(body.open ? 1 : 0, id, groupId)
    .run();
  if (!result.meta.changes) return c.json({ error: "Diese Abstimmung existiert nicht." }, 404);
  return c.json({ ok: true });
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
      throw new ValidationError("Ungültiger Zeitraum.", {
        planningDaysAhead: "Bitte einen Wert zwischen 1 und 60 Tagen wählen.",
      });
    }
    patch.planningDaysAhead = days;
  }
  if (body.registrationOpen !== undefined) {
    if (typeof body.registrationOpen !== "boolean") {
      throw new ValidationError("Ungültiger Wert.", { registrationOpen: "Ungültiger Wert." });
    }
    patch.registrationOpen = body.registrationOpen;
  }
  if (body.voteDeadlineHour !== undefined) {
    const hour = Number(body.voteDeadlineHour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new ValidationError("Ungültige Uhrzeit.", {
        voteDeadlineHour: "Bitte eine Stunde zwischen 0 und 23 wählen.",
      });
    }
    patch.voteDeadlineHour = hour;
  }

  await updateSettings(c.env, patch);
  return c.json({ settings: await getSettings(c.env) });
});

/** Kennzahlen für das Admin-Dashboard (gruppenübergreifend). */
admin.get("/stats", async (c) => {
  const today = todayInZone();
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM meals) AS meals,
       (SELECT COUNT(*) FROM plan_days WHERE date >= ?1) AS planned,
       (SELECT COUNT(*) FROM proposal_votes) AS votes,
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
