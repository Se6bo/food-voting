import { Hono } from "hono";
import type { Ingredient, IngredientInput, Meal } from "../../shared/types";
import type { Env } from "../lib/env";
import type { AppVariables } from "../lib/auth";
import { currentUser, requireAuth, requireGroupId } from "../lib/auth";
import { newId } from "../lib/ids";
import { isMissingMigrationError, MIGRATION_0002_MISSING_MESSAGE } from "../lib/db-errors";
import {
  ValidationError,
  optionalAmount,
  optionalCookidooUrl,
  optionalImageUrl,
  optionalString,
  requireString,
} from "../lib/validation";

const MAX_INGREDIENTS = 60;

interface MealRow {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  cookidoo_id: string | null;
  cookidoo_url: string | null;
}

/** Extrahiert die Rezept-ID aus einer Cookidoo-URL (letztes Pfadsegment). */
function extractCookidooId(url: string): string | null {
  const match = url.match(/\/recipes\/recipe\/[^/]+\/([^/?#]+)/);
  return match ? match[1] : null;
}

interface IngredientRow {
  id: string;
  meal_id: string;
  name: string;
  amount: number | null;
  unit: string | null;
}

export function parseIngredients(value: unknown): IngredientInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ValidationError("Zutaten haben ein ungültiges Format.", {
      ingredients: "Zutaten konnten nicht gelesen werden.",
    });
  }
  if (value.length > MAX_INGREDIENTS) {
    throw new ValidationError("Zu viele Zutaten.", {
      ingredients: `Bitte höchstens ${MAX_INGREDIENTS} Zutaten angeben.`,
    });
  }
  const result: IngredientInput[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    // Leere Zeilen im Formular werden stillschweigend ignoriert.
    if (typeof entry.name !== "string" || entry.name.trim() === "") continue;
    result.push({
      name: requireString(entry.name, "ingredients", { max: 120, label: "Zutat" }),
      amount: optionalAmount(entry.amount, "ingredients"),
      unit: optionalString(entry.unit, 20),
    });
  }
  return result;
}

/** Lädt Essen inklusive Zutaten in zwei Abfragen statt N+1. */
export async function loadMeals(
  env: Env,
  viewer: { id: string; role: string; groupId: string },
  mealIds?: string[],
): Promise<Meal[]> {
  let mealRows: MealRow[];
  if (mealIds) {
    if (mealIds.length === 0) return [];
    const placeholders = mealIds.map(() => "?").join(", ");
    const { results } = await env.DB.prepare(
      `SELECT m.*, u.name AS created_by_name
         FROM meals m LEFT JOIN users u ON u.id = m.created_by
        WHERE m.group_id = ? AND m.id IN (${placeholders})`,
    )
      .bind(viewer.groupId, ...mealIds)
      .all<MealRow>();
    mealRows = results;
  } else {
    const { results } = await env.DB.prepare(
      `SELECT m.*, u.name AS created_by_name
         FROM meals m LEFT JOIN users u ON u.id = m.created_by
        WHERE m.group_id = ?
        ORDER BY m.name COLLATE NOCASE ASC`,
    )
      .bind(viewer.groupId)
      .all<MealRow>();
    mealRows = results;
  }
  if (mealRows.length === 0) return [];

  const placeholders = mealRows.map(() => "?").join(", ");
  const { results: ingredientRows } = await env.DB.prepare(
    `SELECT id, meal_id, name, amount, unit FROM ingredients
      WHERE meal_id IN (${placeholders}) ORDER BY position ASC, rowid ASC`,
  )
    .bind(...mealRows.map((m) => m.id))
    .all<IngredientRow>();

  const byMeal = new Map<string, Ingredient[]>();
  for (const row of ingredientRows) {
    const list = byMeal.get(row.meal_id) ?? [];
    list.push({ id: row.id, name: row.name, amount: row.amount, unit: row.unit });
    byMeal.set(row.meal_id, list);
  }

  return mealRows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    image: row.image,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ingredients: byMeal.get(row.id) ?? [],
    // Berechtigung kommt vom Server, nicht vom Client.
    canEdit: viewer.role === "admin" || row.created_by === viewer.id,
    cookidooUrl: row.cookidoo_url,
  }));
}

async function replaceIngredients(env: Env, mealId: string, ingredients: IngredientInput[]) {
  const statements = [env.DB.prepare("DELETE FROM ingredients WHERE meal_id = ?").bind(mealId)];
  ingredients.forEach((ingredient, index) => {
    statements.push(
      env.DB.prepare(
        "INSERT INTO ingredients (id, meal_id, name, amount, unit, position) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(newId(), mealId, ingredient.name, ingredient.amount, ingredient.unit, index),
    );
  });
  await env.DB.batch(statements);
}

const meals = new Hono<{ Bindings: Env; Variables: AppVariables }>();

meals.use("*", requireAuth);

meals.get("/", async (c) => {
  const user = currentUser(c);
  // Ohne Gruppe gibt es für diesen Benutzer nichts zu sehen.
  const groupId = requireGroupId(user);
  return c.json({ meals: await loadMeals(c.env, { id: user.id, role: user.role, groupId }) });
});

meals.get("/:id", async (c) => {
  const user = currentUser(c);
  const groupId = requireGroupId(user);
  const list = await loadMeals(c.env, { id: user.id, role: user.role, groupId }, [
    c.req.param("id"),
  ]);
  if (list.length === 0) return c.json({ error: "Dieses Essen gibt es nicht (mehr)." }, 404);
  return c.json({ meal: list[0] });
});

meals.post("/", async (c) => {
  const user = currentUser(c);
  // Die Gruppe kommt nie vom Client, sondern immer vom angemeldeten Benutzer -
  // so kann niemand Essen in einer fremden Gruppe anlegen.
  const groupId = requireGroupId(user);
  const body = await c.req.json().catch(() => ({}));

  const name = requireString(body.name, "name", { min: 2, max: 120, label: "Name des Essens" });
  const description = optionalString(body.description, 2000);
  const image = optionalImageUrl(body.image);
  const ingredients = parseIngredients(body.ingredients);
  const cookidooUrl = optionalCookidooUrl(body.cookidooUrl);
  const cookidooId = cookidooUrl ? extractCookidooId(cookidooUrl) : null;

  const id = newId();
  try {
    await c.env.DB.prepare(
      "INSERT INTO meals (id, name, description, image, created_by, group_id, cookidoo_id, cookidoo_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(id, name, description, image, user.id, groupId, cookidooId, cookidooUrl)
      .run();
  } catch (err) {
    // cookidoo_id/cookidoo_url kommen aus migrations/0002_cookidoo.sql - ohne
    // die Migration schlägt jede Erstellung eines Essens mit einem D1-Fehler
    // fehl, den wir hier klar von echten Serverfehlern unterscheiden.
    if (isMissingMigrationError(err)) return c.json({ error: MIGRATION_0002_MISSING_MESSAGE }, 503);
    throw err;
  }
  if (ingredients.length > 0) await replaceIngredients(c.env, id, ingredients);

  const [meal] = await loadMeals(c.env, { id: user.id, role: user.role, groupId }, [id]);
  return c.json({ meal }, 201);
});

meals.put("/:id", async (c) => {
  const user = currentUser(c);
  const groupId = requireGroupId(user);
  const id = c.req.param("id");

  // Gruppen-Check in der SELECT-Query: Ein Essen aus einer fremden Gruppe
  // existiert für diesen Benutzer schlicht nicht (404, nicht 403).
  const existing = await c.env.DB.prepare(
    "SELECT created_by FROM meals WHERE id = ? AND group_id = ?",
  )
    .bind(id, groupId)
    .first<{ created_by: string | null }>();
  if (!existing) return c.json({ error: "Dieses Essen gibt es nicht (mehr)." }, 404);

  // Eigene Essen darf jeder bearbeiten, fremde nur Admins.
  if (user.role !== "admin" && existing.created_by !== user.id) {
    return c.json({ error: "Du kannst nur deine eigenen Essen bearbeiten." }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const name = requireString(body.name, "name", { min: 2, max: 120, label: "Name des Essens" });
  const description = optionalString(body.description, 2000);
  const image = optionalImageUrl(body.image);
  const ingredients = parseIngredients(body.ingredients);
  const cookidooUrl = optionalCookidooUrl(body.cookidooUrl);
  const cookidooId = cookidooUrl ? extractCookidooId(cookidooUrl) : null;

  try {
    await c.env.DB.prepare(
      `UPDATE meals SET name = ?, description = ?, image = ?, cookidoo_id = ?, cookidoo_url = ?,
         updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(name, description, image, cookidooId, cookidooUrl, id)
      .run();
  } catch (err) {
    if (isMissingMigrationError(err)) return c.json({ error: MIGRATION_0002_MISSING_MESSAGE }, 503);
    throw err;
  }
  await replaceIngredients(c.env, id, ingredients);

  const [meal] = await loadMeals(c.env, { id: user.id, role: user.role, groupId }, [id]);
  return c.json({ meal });
});

meals.delete("/:id", async (c) => {
  const user = currentUser(c);
  const groupId = requireGroupId(user);
  const id = c.req.param("id");

  const existing = await c.env.DB.prepare(
    "SELECT created_by FROM meals WHERE id = ? AND group_id = ?",
  )
    .bind(id, groupId)
    .first<{ created_by: string | null }>();
  if (!existing) return c.json({ error: "Dieses Essen gibt es nicht (mehr)." }, 404);
  if (user.role !== "admin" && existing.created_by !== user.id) {
    return c.json({ error: "Du kannst nur deine eigenen Essen löschen." }, 403);
  }

  // ON DELETE CASCADE räumt Zutaten, Planungen und Stimmen mit auf.
  await c.env.DB.prepare("DELETE FROM meals WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

export { meals };
