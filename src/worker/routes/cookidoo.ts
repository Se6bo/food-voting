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
 * Fehler gegenüber dem Cookidoo-Proxy werden nie mit Details (Tokens,
 * Stacktraces) an den Client durchgereicht - nur eine verständliche
 * deutsche Meldung, passend zur zentralen Fehlerkonvention aus index.ts.
 *  - jeder `CookidooError` (Proxy nicht erreichbar, Proxy meldet einen
 *    Fehler, unerwartetes Antwortformat, ...) -> 502 mit der konkreten,
 *    bereits nutzersicheren `CookidooError`-Meldung. Alle
 *    `throw new CookidooError(...)`-Stellen in lib/cookidoo.ts sind bewusst
 *    so formuliert, dass ihre Message gefahrlos an den Client geht.
 *  - alles, was kein `CookidooError` ist (unerwarteter/nicht klassifizierter
 *    Fehler) -> 502 mit generischer Meldung, weil dessen Message ungeprüft
 *    und potenziell unsicher ist (könnte Stacktrace-artige Details enthalten).
 */
function cookidooErrorResponse(c: AppContext, err: unknown, subject: string) {
  if (err instanceof CookidooError) {
    console.error("Cookidoo-Fehler:", err.message);
    return c.json({ error: err.message }, 502);
  }
  console.error("Unerwarteter Cookidoo-Fehler:", err);
  return c.json(
    { error: `${subject} konnte gerade nicht von Cookidoo geladen werden. Bitte versuche es später erneut.` },
    502,
  );
}

export { cookidoo };
