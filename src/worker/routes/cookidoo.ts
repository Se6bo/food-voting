import { Hono } from "hono";
import type { Env } from "../lib/env";
import type { AppContext, AppVariables } from "../lib/auth";
import { requireAuth } from "../lib/auth";
import { CookidooError, getCookidooRecipeDetails, isCookidooEnabled, searchCookidooRecipes } from "../lib/cookidoo";

const cookidoo = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/** Keine Auth nötig - verrät nichts Sensibles, nur ob das Feature aktiv ist. */
cookidoo.get("/status", (c) => c.json({ enabled: isCookidooEnabled(c.env) }));

cookidoo.get("/search", requireAuth, async (c) => {
  if (!isCookidooEnabled(c.env)) {
    return c.json({ error: "Der Cookidoo-Import ist nicht aktiviert." }, 404);
  }
  const query = c.req.query("q")?.trim();
  if (!query) return c.json({ recipes: [] });

  try {
    const recipes = await searchCookidooRecipes(c.env, query);
    return c.json({ recipes });
  } catch (err) {
    return cookidooErrorResponse(c, err, "Die Cookidoo-Suche");
  }
});

cookidoo.get("/recipes/:id", requireAuth, async (c) => {
  if (!isCookidooEnabled(c.env)) {
    return c.json({ error: "Der Cookidoo-Import ist nicht aktiviert." }, 404);
  }
  try {
    const recipe = await getCookidooRecipeDetails(c.env, c.req.param("id"));
    return c.json(recipe);
  } catch (err) {
    return cookidooErrorResponse(c, err, "Das Rezept");
  }
});

/**
 * Login-/Netzwerkfehler gegenüber Cookidoo werden nie mit Details (Zugangs-
 * daten, Stacktraces) an den Client durchgereicht - nur eine verständliche
 * deutsche Meldung, passend zur zentralen Fehlerkonvention aus index.ts.
 */
function cookidooErrorResponse(c: AppContext, err: unknown, subject: string) {
  if (err instanceof CookidooError) {
    console.error("Cookidoo-Fehler:", err.message);
  } else {
    console.error("Unerwarteter Cookidoo-Fehler:", err);
  }
  return c.json(
    { error: `${subject} konnte gerade nicht von Cookidoo geladen werden. Bitte versuche es später erneut.` },
    502,
  );
}

export { cookidoo };
