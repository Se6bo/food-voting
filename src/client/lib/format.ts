/**
 * Anzeige-Helfer. Datumsformatierung läuft bewusst über die App-Zeitzone,
 * damit ein Benutzer im Urlaub dieselbe Deadline sieht wie zuhause.
 */

export const APP_TIMEZONE = "Europe/Berlin";

const weekdayLong = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: APP_TIMEZONE,
});

const weekdayShort = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: APP_TIMEZONE,
});

const dateTimeFormat = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: APP_TIMEZONE,
});

const dateOnly = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: APP_TIMEZONE,
});

/** ISO-Datum (YYYY-MM-DD) als Date um 12:00 UTC - vermeidet Zeitzonendrift. */
function isoToDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function formatDay(isoDate: string): string {
  return weekdayLong.format(isoToDate(isoDate));
}

export function formatDayShort(isoDate: string): string {
  return weekdayShort.format(isoToDate(isoDate));
}

export function formatDateOnly(isoDate: string): string {
  return dateOnly.format(isoToDate(isoDate));
}

export function formatDateTime(isoTimestamp: string): string {
  // SQLite liefert "YYYY-MM-DD HH:MM:SS" in UTC, ohne Zeitzonen-Suffix.
  const normalized = isoTimestamp.includes("T") ? isoTimestamp : `${isoTimestamp.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? isoTimestamp : dateTimeFormat.format(date);
}

export function formatTimestampShort(isoTimestamp: string): string {
  const normalized = isoTimestamp.includes("T") ? isoTimestamp : `${isoTimestamp.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? isoTimestamp : dateOnly.format(date);
}

/** "Heute", "Morgen" oder der Wochentag - liest sich natürlicher als ein Datum. */
export function relativeDayLabel(isoDate: string, today: string): string | null {
  if (isoDate === today) return "Heute";
  const todayDate = isoToDate(today);
  const tomorrow = new Date(todayDate.getTime() + 86_400_000);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);
  if (isoDate === tomorrowIso) return "Morgen";
  return null;
}

/** Mengen hübsch ausgeben: 1.5 -> "1,5", 2 -> "2". */
export function formatAmount(amount: number | null, unit: string | null): string {
  if (amount === null) return unit ?? "";
  const formatted = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(amount);
  return unit ? `${formatted} ${unit}` : formatted;
}

/** Ein passendes Emoji zum Essensnamen - kleine Freude, keine Logik daran hängen. */
const EMOJI_RULES: Array<[RegExp, string]> = [
  [/pizza/i, "🍕"],
  [/pasta|spaghetti|nudel|bolognese|carbonara|lasagne/i, "🍝"],
  [/curry|reis|risotto/i, "🍛"],
  [/suppe|eintopf|linsen/i, "🍲"],
  [/salat/i, "🥗"],
  [/burger/i, "🍔"],
  [/taco|burrito|wrap|quesadilla/i, "🌮"],
  [/sushi|maki/i, "🍣"],
  [/pfannkuchen|waffel|crepe/i, "🥞"],
  [/kartoffel|pommes|auflauf/i, "🥔"],
  [/fisch|lachs|garnele/i, "🐟"],
  [/huhn|haehnchen|hähnchen|chicken/i, "🍗"],
  [/steak|fleisch|schnitzel|gulasch/i, "🥩"],
  [/brot|toast|sandwich|stulle/i, "🥪"],
  [/ei\b|omelett|rührei|ruehrei/i, "🍳"],
  [/kuchen|dessert|nachtisch/i, "🍰"],
];

export function mealEmoji(name: string): string {
  for (const [pattern, emoji] of EMOJI_RULES) {
    if (pattern.test(name)) return emoji;
  }
  return "🍽️";
}
