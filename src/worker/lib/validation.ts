/**
 * Kleine, abhängigkeitsfreie Validierungshelfer. Bewusst kein zod: der MVP
 * braucht nur wenige Regeln und wir sparen uns Bundle-Größe.
 */

export class ValidationError extends Error {
  constructor(
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export function requireString(
  value: unknown,
  field: string,
  { min = 1, max = 200, label = field }: { min?: number; max?: number; label?: string } = {},
): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${label} fehlt.`, { [field]: `${label} ist erforderlich.` });
  }
  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw new ValidationError(`${label} ist zu kurz.`, {
      [field]: min === 1 ? `${label} ist erforderlich.` : `${label} muss mindestens ${min} Zeichen haben.`,
    });
  }
  if (trimmed.length > max) {
    throw new ValidationError(`${label} ist zu lang.`, {
      [field]: `${label} darf höchstens ${max} Zeichen haben.`,
    });
  }
  return trimmed;
}

export function optionalString(value: unknown, max = 2000): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function requireEmail(value: unknown): string {
  const email = requireString(value, "email", { max: 254, label: "E-Mail-Adresse" });
  if (!EMAIL_RE.test(email)) {
    throw new ValidationError("Ungültige E-Mail-Adresse.", {
      email: "Bitte gib eine gültige E-Mail-Adresse ein.",
    });
  }
  return email;
}

export const MIN_PASSWORD_LENGTH = 8;

export function requirePassword(value: unknown, field = "password"): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError("Passwort fehlt.", { [field]: "Passwort ist erforderlich." });
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError("Passwort zu kurz.", {
      [field]: `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.`,
    });
  }
  if (value.length > 200) {
    throw new ValidationError("Passwort zu lang.", {
      [field]: "Das Passwort darf höchstens 200 Zeichen haben.",
    });
  }
  return value;
}

/** Optionale Mengenangabe: positive Zahl oder null ("nach Geschmack"). */
export function optionalAmount(value: unknown, field = "amount"): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number.parseFloat(String(value).replace(",", "."));
  if (!Number.isFinite(num)) {
    throw new ValidationError("Ungültige Menge.", { [field]: "Menge muss eine Zahl sein." });
  }
  if (num < 0) {
    throw new ValidationError("Ungültige Menge.", { [field]: "Menge darf nicht negativ sein." });
  }
  if (num > 1_000_000) {
    throw new ValidationError("Menge zu groß.", { [field]: "Menge ist unrealistisch groß." });
  }
  // Auf 3 Nachkommastellen runden - mehr braucht keine Küche.
  return Math.round(num * 1000) / 1000;
}

/**
 * Bild-URLs: nur http(s) zulassen. Verhindert `javascript:`- und `data:`-URLs,
 * die sonst als XSS-Vektor über src-Attribute zurückkommen könnten.
 */
export function optionalImageUrl(value: unknown): string | null {
  const raw = optionalString(value, 2000);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError("Ungültige Bild-URL.", {
      image: "Bitte gib eine vollständige URL an (https://...).",
    });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ValidationError("Ungültige Bild-URL.", {
      image: "Nur http- und https-Adressen sind erlaubt.",
    });
  }
  return url.toString();
}

/**
 * Link zum Original-Rezept, der beim Cookidoo-Import mitgeschickt wird.
 * Bewusst auf die eine Domain beschränkt, die dieser Import erzeugt - so
 * kann niemand beliebige Links als "Cookidoo-Rezept" unterschieben.
 */
export function optionalCookidooUrl(value: unknown): string | null {
  const raw = optionalString(value, 500);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError("Ungültiger Cookidoo-Link.", {
      cookidooUrl: "Der Cookidoo-Link ist ungültig.",
    });
  }
  if (url.protocol !== "https:" || url.hostname !== "cookidoo.de") {
    throw new ValidationError("Ungültiger Cookidoo-Link.", {
      cookidooUrl: "Nur Links zu cookidoo.de sind erlaubt.",
    });
  }
  return url.toString();
}

export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  throw new ValidationError("Ungültiger Wert.", { [field]: "Ungültiger Wert." });
}
