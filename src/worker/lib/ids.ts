/** Kollisionsarme, URL-sichere IDs. crypto.randomUUID ist auf Workers verfügbar. */
export function newId(): string {
  return crypto.randomUUID();
}

/** Zufalls-Token für Session-Cookies (128 Bit, base64url). */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 als Hex - wir speichern nie den rohen Session-Token in der DB. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
