/**
 * Client für den Cookidoo-Import: ruft nicht mehr selbst die inoffizielle
 * Cookidoo-API auf, sondern einen separaten Proxy-Dienst (Node.js) auf
 * einem Heimrechner mit normaler Internetleitung.
 *
 * Hintergrund: Cookidoo/Vorwerk blockt Anfragen aus Cloudflare-Workers-
 * Rechenzentrums-IPs nach erfolgreichem Login mit einem AWS-CloudFront-WAF-
 * 403 ("Request blocked..."). Derselbe Aufruf von einer normalen Heim-IP
 * aus funktioniert nachweislich. Der komplette OAuth2/PKCE/Cookie-Jar-
 * Login-Flow (vorher hier, ~500 Zeilen) läuft deshalb jetzt im Proxy; dieser
 * Client ist nur noch ein dünner HTTP-Client dafür.
 */

import type { IngredientInput } from "../../shared/types";
import type { Env } from "./env";

export class CookidooError extends Error {}

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

/** Ist der Import konfiguriert? Kein Netzwerkzugriff, keine sensiblen Daten. */
export function isCookidooEnabled(env: Env): boolean {
  return Boolean(env.COOKIDOO_PROXY_URL && env.COOKIDOO_PROXY_TOKEN);
}

function requireProxyConfig(env: Env): { url: string; token: string } {
  if (!env.COOKIDOO_PROXY_URL || !env.COOKIDOO_PROXY_TOKEN) {
    throw new CookidooError("Der Cookidoo-Import ist nicht konfiguriert.");
  }
  return { url: env.COOKIDOO_PROXY_URL, token: env.COOKIDOO_PROXY_TOKEN };
}

async function proxyRequest(env: Env, path: string): Promise<unknown> {
  const { url, token } = requireProxyConfig(env);
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new CookidooError("Der Cookidoo-Proxy ist gerade nicht erreichbar. Bitte später erneut versuchen.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new CookidooError(
      body?.error ?? `Der Cookidoo-Proxy hat einen Fehler gemeldet (Status ${res.status}).`,
    );
  }
  return res.json();
}

export async function searchCookidooRecipes(env: Env, query: string): Promise<CookidooSearchHit[]> {
  return (await proxyRequest(env, `/search?q=${encodeURIComponent(query)}`)) as CookidooSearchHit[];
}

export async function getCookidooRecipeDetails(env: Env, id: string): Promise<CookidooRecipeDetails> {
  return (await proxyRequest(env, `/recipes/${encodeURIComponent(id)}`)) as CookidooRecipeDetails;
}
