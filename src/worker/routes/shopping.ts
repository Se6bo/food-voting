import { Hono } from "hono";
import type { AppSettings, ShoppingItem } from "../../shared/types";
import type { Env } from "../lib/env";
import type { AppVariables } from "../lib/auth";
import { currentUser, requireAuth, requireGroupId } from "../lib/auth";
import { newId } from "../lib/ids";
import { getSettings } from "../lib/settings";
import { addDays, isValidIsoDate, todayInZone, votingState } from "../lib/time";
import { aggregateIngredients, type AggregatableIngredient } from "../lib/units";
import {
  ValidationError,
  optionalAmount,
  optionalString,
  requireString,
} from "../lib/validation";

interface ItemRow {
  id: string;
  source_key: string | null;
  name: string;
  amount: number | null;
  unit: string | null;
  is_manual: number;
  checked: number;
  hidden: number;
}

interface PlanDayRow {
  id: string;
  date: string;
  voting_open: number;
}

interface ProposalRow {
  id: string;
  plan_day_id: string;
  created_at: string;
  meal_id: string;
  meal_name: string;
}

interface VoteRow {
  proposal_id: string;
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
 * Gewinner eines Tages bestimmen: höchste Ja-minus-Nein-Differenz, bei
 * Gleichstand mehr Ja-Stimmen, dann der früher eingereichte Vorschlag.
 */
function pickWinner(
  proposals: ProposalRow[],
  votesByProposal: Map<string, { yes: number; no: number }>,
): ProposalRow | null {
  let best: ProposalRow | null = null;
  for (const proposal of proposals) {
    const summary = votesByProposal.get(proposal.id) ?? { yes: 0, no: 0 };
    if (!best) {
      best = proposal;
      continue;
    }
    const bestSummary = votesByProposal.get(best.id) ?? { yes: 0, no: 0 };
    const diff = summary.yes - summary.no;
    const bestDiff = bestSummary.yes - bestSummary.no;
    if (diff > bestDiff || (diff === bestDiff && summary.yes > bestSummary.yes)) {
      best = proposal;
    }
  }
  return best;
}

/**
 * Die Einkaufsliste entsteht aus den Zutaten der *Gewinner* geschlossener
 * Tage: Solange ein Tag offen ist, gibt es mehrere Vorschläge und damit keine
 * eindeutige Zutatenmenge. Sobald die Abstimmung vorbei ist (Deadline,
 * Vergangenheit oder Admin-Schließung), werden die Zutaten des Gewinners
 * übernommen.
 *
 * Die generierten Positionen werden in `shopping_items` gespiegelt, damit der
 * Zustand (abgehakt, entfernt) erhalten bleibt und Haken stabile IDs behalten.
 * `source_key` ist global UNIQUE - er wird deshalb mit der Gruppen-ID
 * präfixiert, damit zwei Gruppen dieselbe Zutat nicht gegenseitig
 * überschreiben.
 */
async function syncGeneratedItems(
  env: Env,
  settings: AppSettings,
  groupId: string,
  range: { from: string; to: string },
): Promise<Map<string, string[]>> {
  const { results: days } = await env.DB.prepare(
    "SELECT id, date, voting_open FROM plan_days WHERE group_id = ? AND date >= ? AND date <= ? ORDER BY date ASC",
  )
    .bind(groupId, range.from, range.to)
    .all<PlanDayRow>();

  let proposals: ProposalRow[] = [];
  let votes: VoteRow[] = [];
  if (days.length > 0) {
    const dayIds = days.map((day) => day.id);
    const placeholders = dayIds.map(() => "?").join(", ");
    const proposalResult = await env.DB.prepare(
      `SELECT mp.id, mp.plan_day_id, mp.created_at, m.id AS meal_id, m.name AS meal_name
         FROM meal_proposals mp
         JOIN meals m ON m.id = mp.meal_id
        WHERE mp.plan_day_id IN (${placeholders})
        ORDER BY mp.created_at ASC`,
    )
      .bind(...dayIds)
      .all<ProposalRow>();
    proposals = proposalResult.results;

    if (proposals.length > 0) {
      const proposalIds = proposals.map((proposal) => proposal.id);
      const votePlaceholders = proposalIds.map(() => "?").join(", ");
      const voteResult = await env.DB.prepare(
        `SELECT proposal_id, vote FROM proposal_votes
          WHERE proposal_id IN (${votePlaceholders})`,
      )
        .bind(...proposalIds)
        .all<VoteRow>();
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

  // Zutaten der Gewinner aller geschlossenen Tage einsammeln.
  const winnerMealIds = new Set<string>();
  const mealNames = new Map<string, string>();
  for (const day of days) {
    const state = votingState(day.date, day.voting_open === 1, settings.voteDeadlineHour);
    if (state.open) continue;
    const dayProposals = proposals.filter((proposal) => proposal.plan_day_id === day.id);
    const winner = pickWinner(dayProposals, votesByProposal);
    if (!winner) continue;
    winnerMealIds.add(winner.meal_id);
    mealNames.set(winner.meal_id, winner.meal_name);
  }

  const input: AggregatableIngredient[] = [];
  if (winnerMealIds.size > 0) {
    const placeholders = [...winnerMealIds].map(() => "?").join(", ");
    const { results: ingredientRows } = await env.DB.prepare(
      `SELECT id, meal_id, name, amount, unit FROM ingredients
        WHERE meal_id IN (${placeholders}) ORDER BY position ASC, rowid ASC`,
    )
      .bind(...winnerMealIds)
      .all<IngredientRow>();
    for (const row of ingredientRows) {
      input.push({
        name: row.name,
        amount: row.amount,
        unit: row.unit,
        source: mealNames.get(row.meal_id) ?? "Geplantes Essen",
      });
    }
  }

  const aggregated = aggregateIngredients(input);

  const { results: existing } = await env.DB.prepare(
    "SELECT id, source_key, name, amount, unit FROM shopping_items WHERE source_key IS NOT NULL AND group_id = ?",
  )
    .bind(groupId)
    .all<{ id: string; source_key: string; name: string; amount: number | null; unit: string | null }>();
  const existingByKey = new Map(existing.map((row) => [row.source_key, row]));

  const statements = [];
  const activeKeys = new Set<string>();
  const sourcesByKey = new Map<string, string[]>();
  for (const item of aggregated) {
    // Gruppen-Präfix, damit source_key über Gruppen hinweg eindeutig bleibt.
    const key = `${groupId}:${item.key}`;
    activeKeys.add(key);
    sourcesByKey.set(key, item.sources);
    const current = existingByKey.get(key);
    if (!current) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO shopping_items (id, source_key, name, amount, unit, is_manual, group_id)
           VALUES (?, ?, ?, ?, ?, 0, ?)
           ON CONFLICT(source_key) DO NOTHING`,
        ).bind(newId(), key, item.name, item.amount, item.unit, groupId),
      );
    } else if (
      current.amount !== item.amount ||
      current.unit !== item.unit ||
      current.name !== item.name
    ) {
      // Der Plan hat sich geändert -> Menge aktualisieren, Haken behalten.
      statements.push(
        env.DB.prepare(
          "UPDATE shopping_items SET name = ?, amount = ?, unit = ? WHERE source_key = ? AND group_id = ?",
        ).bind(item.name, item.amount, item.unit, key, groupId),
      );
    }
  }

  // Positionen, deren Essen nicht mehr geplant ist, verschwinden wieder.
  const staleKeys = existing
    .filter((row) => !activeKeys.has(row.source_key))
    .map((row) => row.source_key);
  if (staleKeys.length > 0) {
    const placeholders = staleKeys.map(() => "?").join(", ");
    statements.push(
      env.DB.prepare(`DELETE FROM shopping_items WHERE source_key IN (${placeholders})`).bind(
        ...staleKeys,
      ),
    );
  }

  if (statements.length > 0) await env.DB.batch(statements);

  return sourcesByKey;
}

const shopping = new Hono<{ Bindings: Env; Variables: AppVariables }>();

shopping.use("*", requireAuth);

shopping.get("/", async (c) => {
  const user = currentUser(c);
  const groupId = requireGroupId(user);
  const settings = await getSettings(c.env);
  const today = todayInZone();
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");
  const from = fromParam && isValidIsoDate(fromParam) ? fromParam : today;
  const to = toParam && isValidIsoDate(toParam) ? toParam : addDays(today, settings.planningDaysAhead);

  const sourcesByKey = await syncGeneratedItems(c.env, settings, groupId, { from, to });

  const { results } = await c.env.DB.prepare(
    `SELECT id, source_key, name, amount, unit, is_manual, checked, hidden
       FROM shopping_items
      WHERE hidden = 0 AND group_id = ?
      ORDER BY is_manual ASC, checked ASC, rowid ASC`,
  )
    .bind(groupId)
    .all<ItemRow>();

  const items: ShoppingItem[] = results.map((row) => ({
    id: row.id,
    name: row.name,
    amount: row.amount,
    unit: row.unit,
    checked: row.checked === 1,
    isManual: row.is_manual === 1,
    sources: row.source_key ? (sourcesByKey.get(row.source_key) ?? []) : [],
  }));

  return c.json({ items, range: { from, to } });
});

shopping.post("/", async (c) => {
  const user = currentUser(c);
  const groupId = requireGroupId(user);
  const body = await c.req.json().catch(() => ({}));
  const name = requireString(body.name, "name", { max: 120, label: "Artikel" });
  const amount = optionalAmount(body.amount);
  const unit = optionalString(body.unit, 20);

  const id = newId();
  await c.env.DB.prepare(
    "INSERT INTO shopping_items (id, source_key, name, amount, unit, is_manual, group_id) VALUES (?, NULL, ?, ?, ?, 1, ?)",
  )
    .bind(id, name, amount, unit, groupId)
    .run();

  return c.json(
    { item: { id, name, amount, unit, checked: false, isManual: true, sources: [] } satisfies ShoppingItem },
    201,
  );
});

/** Abhaken / wieder aktivieren - nur Artikel der eigenen Gruppe. */
shopping.put("/:id", async (c) => {
  const user = currentUser(c);
  const groupId = requireGroupId(user);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.checked !== "boolean") {
    throw new ValidationError("Ungültiger Wert.", { checked: "Ungültiger Wert." });
  }

  const result = await c.env.DB.prepare(
    `UPDATE shopping_items
        SET checked = ?, checked_by = ?, checked_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END
      WHERE id = ? AND group_id = ?`,
  )
    .bind(body.checked ? 1 : 0, body.checked ? user.id : null, body.checked ? 1 : 0, id, groupId)
    .run();

  if (!result.meta.changes) return c.json({ error: "Dieser Artikel existiert nicht mehr." }, 404);
  return c.json({ ok: true });
});

/**
 * Löschen: manuelle Artikel verschwinden ganz, generierte werden nur
 * ausgeblendet - sonst wären sie beim nächsten Laden sofort wieder da.
 */
shopping.delete("/:id", async (c) => {
  const user = currentUser(c);
  const groupId = requireGroupId(user);
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT is_manual FROM shopping_items WHERE id = ? AND group_id = ?",
  )
    .bind(id, groupId)
    .first<{ is_manual: number }>();
  if (!row) return c.json({ error: "Dieser Artikel existiert nicht mehr." }, 404);

  if (row.is_manual === 1) {
    await c.env.DB.prepare("DELETE FROM shopping_items WHERE id = ? AND group_id = ?")
      .bind(id, groupId)
      .run();
  } else {
    await c.env.DB.prepare(
      "UPDATE shopping_items SET hidden = 1, checked = 0 WHERE id = ? AND group_id = ?",
    )
      .bind(id, groupId)
      .run();
  }
  return c.json({ ok: true });
});

/** "Erledigte löschen" - räumt alle abgehakten Positionen der Gruppe weg. */
shopping.post("/clear-checked", async (c) => {
  const user = currentUser(c);
  const groupId = requireGroupId(user);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM shopping_items WHERE checked = 1 AND is_manual = 1 AND group_id = ?",
    ).bind(groupId),
    c.env.DB.prepare(
      "UPDATE shopping_items SET hidden = 1, checked = 0 WHERE checked = 1 AND is_manual = 0 AND group_id = ?",
    ).bind(groupId),
  ]);
  return c.json({ ok: true });
});

/** Liste der Gruppe komplett neu aufbauen: Haken zurücksetzen, Ausgeblendetes zurückholen. */
shopping.post("/reset", async (c) => {
  const user = currentUser(c);
  const groupId = requireGroupId(user);
  await c.env.DB.prepare(
    "UPDATE shopping_items SET hidden = 0, checked = 0, checked_by = NULL, checked_at = NULL WHERE is_manual = 0 AND group_id = ?",
  )
    .bind(groupId)
    .run();
  return c.json({ ok: true });
});

export { shopping };
