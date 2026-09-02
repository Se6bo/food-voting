import { Hono } from "hono";
import type { ShoppingItem } from "../../shared/types";
import type { Env } from "../lib/env";
import type { AppVariables } from "../lib/auth";
import { currentUser, requireAuth } from "../lib/auth";
import { newId } from "../lib/ids";
import { getSettings } from "../lib/settings";
import { addDays, isValidIsoDate, todayInZone } from "../lib/time";
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

/**
 * Die Einkaufsliste entsteht aus den Zutaten der geplanten Essen. Wir spiegeln
 * die generierten Positionen in `shopping_items`, damit der Zustand (abgehakt,
 * entfernt) erhalten bleibt und Haken stabile IDs bekommen.
 */
async function syncGeneratedItems(
  env: Env,
  range: { from: string; to: string },
): Promise<Map<string, string[]>> {
  const { results } = await env.DB.prepare(
    `SELECT m.name AS meal_name, i.name, i.amount, i.unit
       FROM meal_days md
       JOIN meals m ON m.id = md.meal_id
       JOIN ingredients i ON i.meal_id = m.id
      WHERE md.date >= ? AND md.date <= ?
      ORDER BY md.date ASC, i.position ASC`,
  )
    .bind(range.from, range.to)
    .all<{ meal_name: string; name: string; amount: number | null; unit: string | null }>();

  const input: AggregatableIngredient[] = results.map((row) => ({
    name: row.name,
    amount: row.amount,
    unit: row.unit,
    source: row.meal_name,
  }));
  const aggregated = aggregateIngredients(input);

  const { results: existing } = await env.DB.prepare(
    "SELECT id, source_key, name, amount, unit FROM shopping_items WHERE source_key IS NOT NULL",
  ).all<{ id: string; source_key: string; name: string; amount: number | null; unit: string | null }>();
  const existingByKey = new Map(existing.map((row) => [row.source_key, row]));

  const statements = [];
  const activeKeys = new Set<string>();
  for (const item of aggregated) {
    activeKeys.add(item.key);
    const current = existingByKey.get(item.key);
    if (!current) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO shopping_items (id, source_key, name, amount, unit, is_manual)
           VALUES (?, ?, ?, ?, ?, 0)
           ON CONFLICT(source_key) DO NOTHING`,
        ).bind(newId(), item.key, item.name, item.amount, item.unit),
      );
    } else if (
      current.amount !== item.amount ||
      current.unit !== item.unit ||
      current.name !== item.name
    ) {
      // Der Plan hat sich geaendert -> Menge aktualisieren, Haken behalten.
      statements.push(
        env.DB.prepare("UPDATE shopping_items SET name = ?, amount = ?, unit = ? WHERE source_key = ?")
          .bind(item.name, item.amount, item.unit, item.key),
      );
    }
  }

  // Positionen, deren Essen nicht mehr geplant ist, verschwinden wieder.
  const staleKeys = existing.filter((row) => !activeKeys.has(row.source_key)).map((r) => r.source_key);
  if (staleKeys.length > 0) {
    const placeholders = staleKeys.map(() => "?").join(", ");
    statements.push(
      env.DB.prepare(`DELETE FROM shopping_items WHERE source_key IN (${placeholders})`).bind(
        ...staleKeys,
      ),
    );
  }

  if (statements.length > 0) await env.DB.batch(statements);

  return new Map(aggregated.map((item) => [item.key, item.sources]));
}

const shopping = new Hono<{ Bindings: Env; Variables: AppVariables }>();

shopping.use("*", requireAuth);

shopping.get("/", async (c) => {
  const settings = await getSettings(c.env);
  const today = todayInZone();
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");
  const from = fromParam && isValidIsoDate(fromParam) ? fromParam : today;
  const to = toParam && isValidIsoDate(toParam) ? toParam : addDays(today, settings.planningDaysAhead);

  const sourcesByKey = await syncGeneratedItems(c.env, { from, to });

  const { results } = await c.env.DB.prepare(
    `SELECT id, source_key, name, amount, unit, is_manual, checked, hidden
       FROM shopping_items
      WHERE hidden = 0
      ORDER BY is_manual ASC, checked ASC, rowid ASC`,
  ).all<ItemRow>();

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
  const body = await c.req.json().catch(() => ({}));
  const name = requireString(body.name, "name", { max: 120, label: "Artikel" });
  const amount = optionalAmount(body.amount);
  const unit = optionalString(body.unit, 20);

  const id = newId();
  await c.env.DB.prepare(
    "INSERT INTO shopping_items (id, source_key, name, amount, unit, is_manual) VALUES (?, NULL, ?, ?, ?, 1)",
  )
    .bind(id, name, amount, unit)
    .run();

  return c.json(
    { item: { id, name, amount, unit, checked: false, isManual: true, sources: [] } satisfies ShoppingItem },
    201,
  );
});

/** Abhaken / wieder aktivieren. */
shopping.put("/:id", async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.checked !== "boolean") {
    throw new ValidationError("Ungueltiger Wert.", { checked: "Ungueltiger Wert." });
  }

  const result = await c.env.DB.prepare(
    `UPDATE shopping_items
        SET checked = ?, checked_by = ?, checked_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END
      WHERE id = ?`,
  )
    .bind(body.checked ? 1 : 0, body.checked ? user.id : null, body.checked ? 1 : 0, id)
    .run();

  if (!result.meta.changes) return c.json({ error: "Dieser Artikel existiert nicht mehr." }, 404);
  return c.json({ ok: true });
});

/**
 * Loeschen: manuelle Artikel verschwinden ganz, generierte werden nur
 * ausgeblendet - sonst waeren sie beim naechsten Laden sofort wieder da.
 */
shopping.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT is_manual FROM shopping_items WHERE id = ?")
    .bind(id)
    .first<{ is_manual: number }>();
  if (!row) return c.json({ error: "Dieser Artikel existiert nicht mehr." }, 404);

  if (row.is_manual === 1) {
    await c.env.DB.prepare("DELETE FROM shopping_items WHERE id = ?").bind(id).run();
  } else {
    await c.env.DB.prepare("UPDATE shopping_items SET hidden = 1, checked = 0 WHERE id = ?")
      .bind(id)
      .run();
  }
  return c.json({ ok: true });
});

/** "Erledigte loeschen" - raeumt alle abgehakten Positionen weg. */
shopping.post("/clear-checked", async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM shopping_items WHERE checked = 1 AND is_manual = 1"),
    c.env.DB.prepare("UPDATE shopping_items SET hidden = 1, checked = 0 WHERE checked = 1 AND is_manual = 0"),
  ]);
  return c.json({ ok: true });
});

/** Liste vollstaendig neu aufbauen: Haken zuruecksetzen, Ausgeblendetes zurueckholen. */
shopping.post("/reset", async (c) => {
  await c.env.DB.prepare(
    "UPDATE shopping_items SET hidden = 0, checked = 0, checked_by = NULL, checked_at = NULL WHERE is_manual = 0",
  ).run();
  return c.json({ ok: true });
});

export { shopping };
