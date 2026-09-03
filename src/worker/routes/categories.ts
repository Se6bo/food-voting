import { Hono } from "hono";
import type { MealCategory } from "../../shared/types";
import type { Env } from "../lib/env";
import type { AppVariables } from "../lib/auth";
import { currentUser, requireAuth, requireGroupId } from "../lib/auth";
import { isMissingMigrationError, MIGRATION_0004_MISSING_MESSAGE } from "../lib/db-errors";
import { newId } from "../lib/ids";
import { ValidationError, requireString } from "../lib/validation";

interface CategoryRow {
  id: string;
  name: string;
}

const categories = new Hono<{ Bindings: Env; Variables: AppVariables }>();

categories.use("*", requireAuth);

/**
 * Essenskategorien der eigenen Gruppe (z.B. "Vegetarisch", "Schnell") - dienen
 * nur dazu, Essen beim Einplanen und in der Essen-Liste leichter zu finden.
 */
categories.get("/", async (c) => {
  const groupId = requireGroupId(currentUser(c));
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT id, name FROM meal_categories WHERE group_id = ? ORDER BY name COLLATE NOCASE ASC",
    )
      .bind(groupId)
      .all<CategoryRow>();
    return c.json({ categories: results satisfies MealCategory[] });
  } catch (err) {
    if (isMissingMigrationError(err)) return c.json({ error: MIGRATION_0004_MISSING_MESSAGE }, 503);
    throw err;
  }
});

/** Jedes Gruppenmitglied darf Kategorien anlegen - keine Vorschau-Freigabe nötig. */
categories.post("/", async (c) => {
  const user = currentUser(c);
  const groupId = requireGroupId(user);
  const body = await c.req.json().catch(() => ({}));
  const name = requireString(body.name, "name", { min: 1, max: 60, label: "Kategoriename" });

  const id = newId();
  try {
    await c.env.DB.prepare(
      "INSERT INTO meal_categories (id, group_id, name, created_by) VALUES (?, ?, ?, ?)",
    )
      .bind(id, groupId, name, user.id)
      .run();
  } catch (err) {
    if (isMissingMigrationError(err)) return c.json({ error: MIGRATION_0004_MISSING_MESSAGE }, 503);
    if (err instanceof Error && /UNIQUE/i.test(err.message)) {
      throw new ValidationError("Diese Kategorie gibt es schon.", {
        name: "Diese Kategorie gibt es schon.",
      });
    }
    throw err;
  }

  return c.json({ category: { id, name } satisfies MealCategory }, 201);
});

/**
 * Kategorie löschen - Essen mit dieser Kategorie verlieren sie nur
 * (ON DELETE SET NULL), verschwinden aber nicht.
 */
categories.delete("/:id", async (c) => {
  const groupId = requireGroupId(currentUser(c));
  const id = c.req.param("id");
  const result = await c.env.DB.prepare("DELETE FROM meal_categories WHERE id = ? AND group_id = ?")
    .bind(id, groupId)
    .run();
  if (!result.meta.changes) return c.json({ error: "Diese Kategorie gibt es nicht (mehr)." }, 404);
  return c.json({ ok: true });
});

export { categories };
