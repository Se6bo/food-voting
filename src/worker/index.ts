import { Hono } from "hono";
import type { Env } from "./lib/env";
import type { AppVariables } from "./lib/auth";
import { loadUser, requireAuth, currentUser } from "./lib/auth";
import { csrfProtection, securityHeaders } from "./lib/security";
import { getSettings } from "./lib/settings";
import { ValidationError } from "./lib/validation";
import { APP_TIMEZONE, todayInZone } from "./lib/time";
import { auth } from "./routes/auth";
import { groups } from "./routes/groups";
import { meals } from "./routes/meals";
import { planning } from "./routes/planning";
import { votes } from "./routes/votes";
import { shopping } from "./routes/shopping";
import { admin } from "./routes/admin";
import { cookidoo } from "./routes/cookidoo";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use("*", securityHeaders);

const api = new Hono<{ Bindings: Env; Variables: AppVariables }>();
api.use("*", csrfProtection);
api.use("*", loadUser);

/** Kontext für den Client: Benutzer, Einstellungen, Zeitzone. */
api.get("/me", async (c) => {
  const settings = await getSettings(c.env);
  return c.json({
    user: c.get("user"),
    settings: { appName: settings.appName, registrationOpen: settings.registrationOpen },
    today: todayInZone(),
    timezone: APP_TIMEZONE,
  });
});

api.get("/settings", requireAuth, async (c) => {
  const settings = await getSettings(c.env);
  // Der volle Satz an Einstellungen ist für angemeldete Benutzer unkritisch
  // und wird für die Anzeige der Deadline gebraucht.
  return c.json({ settings, user: currentUser(c) });
});

api.route("/auth", auth);
api.route("/groups", groups);
api.route("/meals", meals);
api.route("/planning", planning);
api.route("/votes", votes);
api.route("/shopping-list", shopping);
api.route("/admin", admin);
api.route("/cookidoo", cookidoo);

api.notFound((c) => c.json({ error: "Diese Schnittstelle gibt es nicht." }, 404));

/**
 * Zentrale Fehlerbehandlung: Validierungsfehler werden verständlich
 * durchgereicht, alles andere wird geloggt und dem Benutzer nur als neutrale
 * Meldung gezeigt - keine Stacktraces oder SQL-Fehler nach außen.
 */
api.onError((err, c) => {
  if (err instanceof ValidationError) {
    return c.json({ error: err.message, fields: err.fields }, 400);
  }
  console.error("Unerwarteter Fehler:", err);
  return c.json(
    { error: "Da ist etwas schiefgelaufen. Bitte versuche es noch einmal." },
    500,
  );
});

app.route("/api", api);

/**
 * Alles außerhalb von /api liefert die gebaute React-App aus. Das
 * `not_found_handling = "single-page-application"` in wrangler.toml sorgt
 * dafür, dass Client-Routen wie /essensplan die index.html bekommen.
 */
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
