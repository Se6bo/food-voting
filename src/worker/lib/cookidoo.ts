/**
 * Client für den Cookidoo-Import: Login (inoffizielle, reverse-engineerte
 * OAuth2/PKCE-API von Vorwerk), Token-Refresh, Rezeptsuche und Rezeptdetails.
 *
 * Portiert (idiomatisch, nicht 1:1) aus der Python-Referenzimplementierung
 * `cookidoo-api` (MIT, https://github.com/miaucl/cookidoo-api), die auch von
 * der Home-Assistant-Integration produktiv genutzt wird. Läuft ausschließlich
 * mit Workers-Runtime-APIs (fetch, crypto.subtle, crypto.getRandomValues) -
 * keine Node/Python-Abhängigkeiten.
 *
 * Nur für Deutschland fest verdrahtet (country_code "de", language "de-DE"),
 * weil das die einzige Locale ist, die diese App braucht.
 */

import type { IngredientInput } from "../../shared/types";
import type { Env } from "./env";
import { isMissingMigrationError, MIGRATION_0002_MISSING_MESSAGE } from "./db-errors";

export class CookidooError extends Error {}

/** Cookidoo-Anmeldung ist fehlgeschlagen (z. B. falsche Zugangsdaten). */
export class CookidooAuthError extends CookidooError {}

/**
 * D1-Zugriff ist fehlgeschlagen, weil migrations/0002_cookidoo.sql auf der
 * Ziel-Datenbank noch nicht angewendet wurde (Tabelle/Spalte fehlt). Kein
 * `CookidooError`, damit die Route dafür einen eigenen Status (503 statt
 * 502) liefern kann.
 */
export class CookidooMigrationMissingError extends Error {}

const CIAM_BASE_URL = "https://ciam.prod.cookidoo.vorwerk-digital.com";
const CIAM_LOGIN_SRV_URL = `${CIAM_BASE_URL}/login-srv/login`;
const OIDC_DISCOVERY_URL = `${CIAM_BASE_URL}/.well-known/openid-configuration`;

// Öffentlicher OAuth2-Client der offiziellen Cookidoo-Mobile-App (kein
// Client-Secret nötig, siehe cookidoo-api/const.py für die Begründung).
const OAUTH_CLIENT_ID = "mobile-android";
const OAUTH_REDIRECT_URI = "com.vorwerk.cookidoo://code-grant";
const OAUTH_SCOPE = "openid profile email offline offline_access";
// Etwas früher als der eigentliche Ablauf (typ. 12h) erneuern.
const TOKEN_EXPIRY_MARGIN_S = 300;

const API_ENDPOINT = "https://cookidoo.de";
const COUNTRY_CODE = "de";
const LANGUAGE = "de-DE";
const SEARCH_LOCALE = "de";

// Der Login-Flow läuft hinter Cloudflare; ohne einen browserähnlichen
// User-Agent werden Requests häufiger als Bot markiert (403).
const LOGIN_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const MAX_REDIRECTS = 10;

// Cloudflare kann statt der echten Login-Seite eine Bot-Challenge
// ("Interstitial"/"Managed Challenge") ausliefern, z. B. weil Anfragen aus
// gemeinsam genutzten Workers-Rechenzentrums-IPs häufiger als verdächtig
// eingestuft werden. Das lässt sich anhand öffentlich dokumentierter,
// stabiler Merkmale der tatsächlichen HTTP-Antwort erkennen (kein Raten):
//  - Response-Header "cf-mitigated: challenge" - wird von Cloudflare selbst
//    gesetzt, wenn eine Anfrage mit einer Challenge beantwortet wurde
//    (siehe Cloudflare-Doku "Detect a Challenge Page response").
//  - HTML-Titel "Just a moment..." - der Standardtitel der Cloudflare-
//    Interstitial-Seite.
//  - Vorkommen von "/cdn-cgi/challenge-platform/" im HTML - der Pfad, unter
//    dem Cloudflare das Challenge-Skript einbindet.
// Diese Erkennung entlarvt eine Challenge nur, wenn eines dieser konkreten
// Merkmale tatsächlich vorliegt; jede andere unerwartete Antwort bleibt bei
// der bisherigen, allgemeineren Fehlermeldung.
const CLOUDFLARE_CHALLENGE_MESSAGE =
  "Cookidoo hat die Anmeldung blockiert (Bot-Schutz). Das kann bei Anfragen aus Cloudflare-Workern " +
  "gelegentlich vorkommen — bitte später erneut versuchen.";

function isCloudflareChallengeResponse(res: Response, body: string): boolean {
  if (res.headers.get("cf-mitigated") === "challenge") return true;
  if (/<title>\s*just a moment/i.test(body)) return true;
  if (body.includes("/cdn-cgi/challenge-platform/")) return true;
  return false;
}

export interface CookidooSearchHit {
  id: string;
  title: string;
  image: string | null;
}

export interface CookidooRecipeDetails {
  name: string;
  description: string | null;
  image: string | null;
  ingredients: IngredientInput[];
  cookidooUrl: string;
}

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  /** Unix-Zeitstempel in Sekunden. */
  expiresAt: number;
}

/** Ist der Import konfiguriert? Kein Netzwerkzugriff, keine sensiblen Daten. */
export function isCookidooEnabled(env: Env): boolean {
  return Boolean(env.COOKIDOO_EMAIL && env.COOKIDOO_PASSWORD);
}

function requireCredentials(env: Env): { email: string; password: string } {
  if (!env.COOKIDOO_EMAIL || !env.COOKIDOO_PASSWORD) {
    throw new CookidooError("Der Cookidoo-Import ist nicht konfiguriert.");
  }
  return { email: env.COOKIDOO_EMAIL, password: env.COOKIDOO_PASSWORD };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// -----------------------------------------------------------------------
// Token-Speicherung (D1, eine einzelne Zeile - siehe migrations/0002_cookidoo.sql)
// -----------------------------------------------------------------------

async function loadStoredSession(env: Env): Promise<StoredSession | null> {
  let row: { access_token: string; refresh_token: string; expires_at: number } | null;
  try {
    row = await env.DB.prepare(
      "SELECT access_token, refresh_token, expires_at FROM cookidoo_session WHERE id = 1",
    ).first<{ access_token: string; refresh_token: string; expires_at: number }>();
  } catch (err) {
    if (isMissingMigrationError(err)) {
      throw new CookidooMigrationMissingError(MIGRATION_0002_MISSING_MESSAGE);
    }
    throw err;
  }
  if (!row) return null;
  return { accessToken: row.access_token, refreshToken: row.refresh_token, expiresAt: row.expires_at };
}

async function saveSession(env: Env, session: StoredSession): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO cookidoo_session (id, access_token, refresh_token, expires_at, updated_at)
       VALUES (1, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         updated_at = datetime('now')`,
    )
      .bind(session.accessToken, session.refreshToken, session.expiresAt)
      .run();
  } catch (err) {
    if (isMissingMigrationError(err)) {
      throw new CookidooMigrationMissingError(MIGRATION_0002_MISSING_MESSAGE);
    }
    throw err;
  }
}

// -----------------------------------------------------------------------
// Kleine Helfer: Cookie-Jar (Workers-fetch führt Cookies über Redirects und
// getrennte Requests nicht selbst mit) und PKCE.
// -----------------------------------------------------------------------

class CookieJar {
  private cookies = new Map<string, string>();

  applyFrom(headers: Headers): void {
    const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const raw =
      typeof getSetCookie === "function"
        ? getSetCookie.call(headers)
        : headers.get("set-cookie")
          ? [headers.get("set-cookie") as string]
          : [];
    for (const cookieStr of raw) {
      const pair = cookieStr.split(";", 1)[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge };
}

function randomState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(12)));
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

// Der Login-Flow leitet nach dem Absenden der Zugangsdaten (Erfolg wie
// Fehler, z. B. "invalid_username_password") empirisch nicht auf
// CIAM_BASE_URL zurück, sondern auf die separate Login-UI unter
// eu.login.vorwerk.com - beide Hosts gehören zum selben offiziellen
// Cookidoo-Login-Flow und sind deshalb hier explizit als vertrauenswürdig
// gelistet (Hostname-Vergleich, kein String-Contains/Suffix-Vergleich, um
// z. B. "evilciam.prod.cookidoo.vorwerk-digital.com.attacker.com" sicher
// abzulehnen).
const TRUSTED_LOGIN_HOSTS = new Set(["ciam.prod.cookidoo.vorwerk-digital.com", "eu.login.vorwerk.com"]);

function assertCiamOrigin(url: string): void {
  // Die Redirect-Kette trägt die Cookies eines laufenden Logins - ein
  // Redirect auf einen fremden Host wird deshalb nicht befolgt.
  const target = new URL(url);
  if (target.protocol !== "https:" || !TRUSTED_LOGIN_HOSTS.has(target.hostname)) {
    throw new CookidooError("Cookidoo-Login wurde außerhalb der Login-Domain weitergeleitet.");
  }
}

// -----------------------------------------------------------------------
// OIDC-Discovery
// -----------------------------------------------------------------------

async function discoverOidc(): Promise<{ authorizationEndpoint: string; tokenEndpoint: string }> {
  let res: Response;
  try {
    res = await fetch(OIDC_DISCOVERY_URL, { headers: { "User-Agent": LOGIN_USER_AGENT } });
  } catch {
    throw new CookidooError("Cookidoo ist gerade nicht erreichbar (OIDC-Discovery).");
  }
  if (!res.ok) {
    throw new CookidooError(`Cookidoo-OIDC-Discovery fehlgeschlagen (Status ${res.status}).`);
  }
  const data = (await res.json().catch(() => null)) as
    | { authorization_endpoint?: string; token_endpoint?: string }
    | null;
  if (!data?.authorization_endpoint || !data.token_endpoint) {
    throw new CookidooError("Cookidoo-OIDC-Discovery lieferte keine gültigen Endpunkte.");
  }
  return { authorizationEndpoint: data.authorization_endpoint, tokenEndpoint: data.token_endpoint };
}

// -----------------------------------------------------------------------
// Login-Flow: Authorization Code + PKCE gegen den CIAM-Identity-Provider.
// -----------------------------------------------------------------------

async function fetchLoginPage(
  authorizationEndpoint: string,
  params: Record<string, string>,
  jar: CookieJar,
): Promise<string> {
  let url = `${authorizationEndpoint}?${new URLSearchParams(params).toString()}`;
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const headers = new Headers({ "User-Agent": LOGIN_USER_AGENT });
    const cookie = jar.header();
    if (cookie) headers.set("Cookie", cookie);

    let res: Response;
    try {
      res = await fetch(url, { headers, redirect: "manual" });
    } catch {
      throw new CookidooError("Cookidoo-Loginseite ist gerade nicht erreichbar.");
    }
    jar.applyFrom(res.headers);

    if (isRedirectStatus(res.status)) {
      const location = res.headers.get("Location");
      if (!location) throw new CookidooError("Cookidoo-Login: Weiterleitung ohne Ziel.");
      url = new URL(location, url).toString();
      continue;
    }
    const body = await res.text().catch(() => "");
    if (isCloudflareChallengeResponse(res, body)) {
      throw new CookidooError(CLOUDFLARE_CHALLENGE_MESSAGE);
    }
    if (res.status !== 200) {
      throw new CookidooError(`Cookidoo-Loginseite nicht erreichbar (Status ${res.status}).`);
    }
    return body;
  }
  throw new CookidooError("Cookidoo-Login: zu viele Weiterleitungen beim Laden der Loginseite.");
}

function extractRequestId(html: string): string {
  const match =
    html.match(/<input[^>]*name=["']requestId["'][^>]*value=["']([^"']+)["']/i) ??
    html.match(/<input[^>]*value=["']([^"']+)["'][^>]*name=["']requestId["']/i);
  if (!match) {
    throw new CookidooError("Cookidoo-Loginformular konnte nicht gelesen werden.");
  }
  return match[1];
}

async function submitCredentials(
  requestId: string,
  email: string,
  password: string,
  state: string,
  jar: CookieJar,
): Promise<string> {
  let url = CIAM_LOGIN_SRV_URL;
  let method: "GET" | "POST" = "POST";
  let body: string | undefined = new URLSearchParams({ requestId, username: email, password }).toString();

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const headers = new Headers({ "User-Agent": LOGIN_USER_AGENT });
    const cookie = jar.header();
    if (cookie) headers.set("Cookie", cookie);
    if (method === "POST") headers.set("Content-Type", "application/x-www-form-urlencoded");

    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: method === "POST" ? body : undefined, redirect: "manual" });
    } catch {
      throw new CookidooError("Cookidoo-Login ist gerade nicht erreichbar.");
    }
    jar.applyFrom(res.headers);

    const location = res.headers.get("Location");
    if (!isRedirectStatus(res.status) || !location) break;

    if (location.startsWith(OAUTH_REDIRECT_URI)) {
      const query = new URL(location).searchParams;
      // Der Callback muss den gesendeten State exakt spiegeln (RFC 6749 §10.12).
      if (query.get("state") !== state) {
        throw new CookidooError("Cookidoo-Login: State-Parameter stimmt nicht überein.");
      }
      const code = query.get("code");
      if (!code) break;
      return code;
    }

    const nextUrl = new URL(location, url).toString();
    assertCiamOrigin(nextUrl);
    url = nextUrl;
    method = "GET";
    body = undefined;
  }

  throw new CookidooAuthError(
    "Cookidoo-Login fehlgeschlagen. Bitte COOKIDOO_EMAIL und COOKIDOO_PASSWORD prüfen.",
  );
}

function parseTokenResponse(payload: unknown, fallbackRefreshToken?: string): StoredSession {
  if (typeof payload !== "object" || payload === null) {
    throw new CookidooError("Cookidoo-Login lieferte eine unerwartete Antwort.");
  }
  const data = payload as Record<string, unknown>;
  const accessToken = data.access_token;
  const refreshToken = typeof data.refresh_token === "string" ? data.refresh_token : fallbackRefreshToken;
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 43_200;
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
    throw new CookidooError("Cookidoo-Login lieferte keine gültigen Tokens.");
  }
  return { accessToken, refreshToken, expiresAt: nowSeconds() + expiresIn };
}

async function exchangeCode(tokenEndpoint: string, code: string, verifier: string): Promise<StoredSession> {
  let res: Response;
  try {
    res = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": LOGIN_USER_AGENT },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: OAUTH_REDIRECT_URI,
        code_verifier: verifier,
        client_id: OAUTH_CLIENT_ID,
      }).toString(),
    });
  } catch {
    throw new CookidooError("Cookidoo-Token-Austausch ist gerade nicht erreichbar.");
  }
  if (!res.ok) {
    throw new CookidooError(`Cookidoo-Token-Austausch fehlgeschlagen (Status ${res.status}).`);
  }
  return parseTokenResponse(await res.json().catch(() => null));
}

async function performLogin(email: string, password: string): Promise<StoredSession> {
  const oidc = await discoverOidc();
  const jar = new CookieJar();
  const { verifier, challenge } = await pkcePair();
  const state = randomState();
  const params = {
    response_type: "code",
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    market: COUNTRY_CODE,
    scope: OAUTH_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ui_locales: LANGUAGE,
  };
  const loginHtml = await fetchLoginPage(oidc.authorizationEndpoint, params, jar);
  const requestId = extractRequestId(loginHtml);
  const code = await submitCredentials(requestId, email, password, state, jar);
  return exchangeCode(oidc.tokenEndpoint, code, verifier);
}

async function refreshSession(refreshToken: string): Promise<StoredSession> {
  const oidc = await discoverOidc();
  let res: Response;
  try {
    res = await fetch(oidc.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": LOGIN_USER_AGENT },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }).toString(),
    });
  } catch {
    throw new CookidooError("Cookidoo-Token-Erneuerung ist gerade nicht erreichbar.");
  }
  if (!res.ok) {
    throw new CookidooError(`Cookidoo-Token-Erneuerung fehlgeschlagen (Status ${res.status}).`);
  }
  return parseTokenResponse(await res.json().catch(() => null), refreshToken);
}

/** Liefert einen gültigen Access-Token, loggt sich bei Bedarf ein oder erneuert ihn. */
async function ensureAccessToken(env: Env, forceRelogin = false): Promise<string> {
  const credentials = requireCredentials(env);

  if (!forceRelogin) {
    const stored = await loadStoredSession(env);
    if (stored) {
      if (stored.expiresAt - TOKEN_EXPIRY_MARGIN_S > nowSeconds()) {
        return stored.accessToken;
      }
      try {
        const refreshed = await refreshSession(stored.refreshToken);
        await saveSession(env, refreshed);
        return refreshed.accessToken;
      } catch (err) {
        // Fehlende Migration soll sichtbar bleiben, nicht als abgelaufener
        // Refresh-Token missgedeutet werden.
        if (err instanceof CookidooMigrationMissingError) throw err;
        // Refresh-Token abgelaufen/ungültig - unten wird neu eingeloggt.
      }
    }
  }

  const session = await performLogin(credentials.email, credentials.password);
  await saveSession(env, session);
  return session.accessToken;
}

// -----------------------------------------------------------------------
// API-Aufrufe (Suche, Rezeptdetails)
// -----------------------------------------------------------------------

function buildApiUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(path, API_ENDPOINT);
  if (params) for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

// Wird nur serverseitig geloggt (console.error), NIE an den Client
// durchgereicht - dient allein dazu, im Cloudflare-Logs-Tab sichtbar zu
// machen, was ein `!res.ok` von der Cookidoo-API (insbesondere ein 403 bei
// der Suche) tatsächlich zurückliefert, z. B. um eine IP-/ASN-basierte
// Anti-Bot-Sperre gegen Cloudflare-Workers-Adressen von einem anderen
// Fehlerursprung zu unterscheiden. Der Body wird nur einmal als Text
// gelesen (kein `res.json()`-Versuch, der bei nicht-JSON-Antworten selbst
// scheitern würde).
async function logCookidooApiFailure(res: Response): Promise<void> {
  const headers: Record<string, string> = {};
  for (const [key, value] of res.headers.entries()) headers[key] = value;
  let bodySnippet: string | undefined;
  try {
    bodySnippet = (await res.text()).slice(0, 500);
  } catch {
    // Body nicht lesbar - für die Diagnose einfach weglassen.
  }
  console.error("Cookidoo-API-403-Diagnose:", { status: res.status, headers, bodySnippet });
}

async function cookidooApiRequest(
  env: Env,
  path: string,
  params?: Record<string, string>,
): Promise<unknown> {
  let token = await ensureAccessToken(env);
  let res = await requestWithToken(path, params, token);

  if (res.status === 401) {
    // Access-Token abgelehnt - einmal neu einloggen und erneut versuchen.
    token = await ensureAccessToken(env, true);
    res = await requestWithToken(path, params, token);
  }

  if (res.status === 204) return null;
  if (!res.ok) {
    await logCookidooApiFailure(res);
    throw new CookidooError(`Cookidoo-Anfrage fehlgeschlagen (Status ${res.status}).`);
  }
  try {
    return await res.json();
  } catch {
    throw new CookidooError("Antwort von Cookidoo konnte nicht gelesen werden.");
  }
}

async function requestWithToken(
  path: string,
  params: Record<string, string> | undefined,
  token: string,
): Promise<Response> {
  try {
    return await fetch(buildApiUrl(path, params), {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new CookidooError("Cookidoo ist gerade nicht erreichbar.");
  }
}

function extractImage(assets: unknown): string | null {
  if (!Array.isArray(assets)) return null;
  for (const asset of assets) {
    if (typeof asset !== "object" || asset === null) continue;
    const entry = asset as Record<string, unknown>;
    for (const key of ["square", "portrait", "landscape"] as const) {
      const value = entry[key];
      if (typeof value === "string" && value) return value;
    }
  }
  return null;
}

function extractAmount(quantity: unknown): number | null {
  if (typeof quantity !== "object" || quantity === null) return null;
  const q = quantity as Record<string, unknown>;
  if (typeof q.value === "number") return q.value;
  const from = typeof q.from === "number" ? q.from : null;
  const to = typeof q.to === "number" ? q.to : null;
  if (from !== null && to !== null) return Math.round(((from + to) / 2) * 1000) / 1000;
  return null;
}

export async function searchCookidooRecipes(env: Env, query: string): Promise<CookidooSearchHit[]> {
  const raw = await cookidooApiRequest(env, `/search/${SEARCH_LOCALE}`, { query });
  if (!raw || typeof raw !== "object") return [];
  const data = raw as Record<string, unknown>;
  // Die Suche liefert die Treffer je nach Endpunkt-Variante unter "data" oder
  // "recipes" - siehe cookidoo_search_result_from_json in der Referenz.
  const rawHits = Array.isArray(data.data) ? data.data : Array.isArray(data.recipes) ? data.recipes : [];

  const hits: CookidooSearchHit[] = [];
  for (const item of rawHits) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id : null;
    if (!id) continue;
    const title =
      typeof entry.title === "string" ? entry.title : typeof entry.name === "string" ? entry.name : "";
    hits.push({ id, title, image: extractImage(entry.descriptiveAssets) });
  }
  return hits;
}

export async function getCookidooRecipeDetails(env: Env, id: string): Promise<CookidooRecipeDetails> {
  const raw = await cookidooApiRequest(env, `/recipes/recipe/${LANGUAGE}/${encodeURIComponent(id)}`);
  if (!raw || typeof raw !== "object") {
    throw new CookidooError("Cookidoo-Rezept konnte nicht gelesen werden.");
  }
  const data = raw as Record<string, unknown>;

  const name = typeof data.title === "string" ? data.title : "";
  const image = extractImage(data.descriptiveAssets);

  const ingredients: IngredientInput[] = [];
  const groups = Array.isArray(data.recipeIngredientGroups) ? data.recipeIngredientGroups : [];
  for (const group of groups) {
    if (typeof group !== "object" || group === null) continue;
    const list = (group as Record<string, unknown>).recipeIngredients;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item !== "object" || item === null) continue;
      const entry = item as Record<string, unknown>;
      const ingredientName = typeof entry.ingredientNotation === "string" ? entry.ingredientNotation.trim() : "";
      if (!ingredientName) continue;
      const unit = typeof entry.unitNotation === "string" ? entry.unitNotation.trim() : "";
      ingredients.push({
        name: ingredientName,
        amount: extractAmount(entry.quantity),
        unit: unit || null,
      });
    }
  }

  const recipeId = typeof data.id === "string" ? data.id : id;
  return {
    name,
    // Cookidoo liefert keine kurze Beschreibung im Sinne dieses Datenmodells
    // (nur lange Freitext-Notizen/Kategorien) - bewusst leer gelassen, der
    // Nutzer kann nach dem Import selbst etwas eintragen.
    description: null,
    image,
    ingredients,
    cookidooUrl: `${API_ENDPOINT}/recipes/recipe/${LANGUAGE}/${recipeId}`,
  };
}
