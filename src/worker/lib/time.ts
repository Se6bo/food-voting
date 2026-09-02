/**
 * Zeit- und Deadline-Logik.
 *
 * Die Abstimmungs-Deadline hängt an einer Kalender-Zeitzone, nicht an UTC:
 * "Für Freitag darf bis Donnerstag 23:59 Uhr abgestimmt werden" meint lokale
 * Zeit. Wir rechnen daher bewusst mit einer festen App-Zeitzone statt mit der
 * Zeitzone des Browsers - sonst hätten unterschiedliche Benutzer
 * unterschiedliche Deadlines.
 */

export const APP_TIMEZONE = "Europe/Berlin";

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function partsInZone(date: Date): DateParts {
  const parts: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl liefert im 24h-Format gelegentlich "24" für Mitternacht.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset der App-Zeitzone gegenüber UTC in Millisekunden zum Zeitpunkt `date`. */
function zoneOffsetMs(date: Date): number {
  const p = partsInZone(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Wandelt eine lokale Wanduhrzeit in den passenden UTC-Zeitpunkt um.
 * Zwei Durchläufe, damit Sommer-/Winterzeitwechsel korrekt getroffen werden.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let result = new Date(naive - zoneOffsetMs(new Date(naive)));
  result = new Date(naive - zoneOffsetMs(result));
  return result;
}

/** Heutiges Datum in der App-Zeitzone als ISO-Datum (YYYY-MM-DD). */
export function todayInZone(now: Date = new Date()): string {
  const p = partsInZone(now);
  return toIsoDate(p.year, p.month, p.day);
}

export function toIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Prüft ein ISO-Datum inklusive echter Kalendergültigkeit (kein 2025-02-30). */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Verschiebt ein ISO-Datum um `days` Tage (kalendarisch, ohne Zeitzonendrift). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return toIsoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/**
 * Abstimmungs-Deadline für einen geplanten Tag: der Vorabend um HH:59:59
 * lokaler Zeit (Standard 23:59:59).
 */
export function votingDeadline(isoDate: string, deadlineHour = 23): Date {
  const previousDay = addDays(isoDate, -1);
  const [y, m, d] = previousDay.split("-").map(Number);
  return zonedTimeToUtc(y, m, d, deadlineHour, 59, 59);
}

/**
 * Ist die Abstimmung für diesen Tag noch offen? Einzige Wahrheit - der Client
 * bekommt nur das Ergebnis, nie die Entscheidung.
 */
export function votingState(
  isoDate: string,
  adminOpen: boolean,
  deadlineHour = 23,
  now: Date = new Date(),
): { open: boolean; reason: "past" | "deadline" | "admin" | null; deadline: Date } {
  const deadline = votingDeadline(isoDate, deadlineHour);
  const today = todayInZone(now);
  if (isoDate < today) return { open: false, reason: "past", deadline };
  if (!adminOpen) return { open: false, reason: "admin", deadline };
  if (now.getTime() > deadline.getTime()) return { open: false, reason: "deadline", deadline };
  return { open: true, reason: null, deadline };
}
