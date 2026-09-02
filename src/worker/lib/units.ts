/**
 * Einheiten-Normalisierung fuer die Einkaufsliste.
 *
 * Ziel: "500 g Tomaten" + "500 g Tomaten" -> "1 kg Tomaten", ohne dabei
 * Unsinn zu erzeugen. Deshalb werden nur Zutaten mit derselben *Dimension*
 * (Masse, Volumen, Stueck ...) zusammengefasst. "2 Stk Tomaten" und
 * "500 g Tomaten" bleiben zwei getrennte Eintraege.
 */

export type Dimension = "mass" | "volume" | "count" | "spoon" | "other";

interface UnitDefinition {
  /** Kanonische Schreibweise fuer die Anzeige. */
  canonical: string;
  dimension: Dimension;
  /** Faktor zur Basiseinheit der Dimension (g bzw. ml). */
  factor: number;
}

/** Alle Schreibweisen, die wir erkennen, jeweils klein geschrieben. */
const UNIT_ALIASES: Record<string, UnitDefinition> = {
  // Masse - Basis: Gramm
  mg: { canonical: "mg", dimension: "mass", factor: 0.001 },
  g: { canonical: "g", dimension: "mass", factor: 1 },
  gr: { canonical: "g", dimension: "mass", factor: 1 },
  gramm: { canonical: "g", dimension: "mass", factor: 1 },
  kg: { canonical: "kg", dimension: "mass", factor: 1000 },
  kilo: { canonical: "kg", dimension: "mass", factor: 1000 },
  kilogramm: { canonical: "kg", dimension: "mass", factor: 1000 },

  // Volumen - Basis: Milliliter
  ml: { canonical: "ml", dimension: "volume", factor: 1 },
  cl: { canonical: "cl", dimension: "volume", factor: 10 },
  dl: { canonical: "dl", dimension: "volume", factor: 100 },
  l: { canonical: "l", dimension: "volume", factor: 1000 },
  liter: { canonical: "l", dimension: "volume", factor: 1000 },

  // Stueckzahlen
  stk: { canonical: "Stk", dimension: "count", factor: 1 },
  stueck: { canonical: "Stk", dimension: "count", factor: 1 },
  "stück": { canonical: "Stk", dimension: "count", factor: 1 },
  st: { canonical: "Stk", dimension: "count", factor: 1 },
  x: { canonical: "Stk", dimension: "count", factor: 1 },

  // Loeffelmasse - untereinander umrechenbar (1 EL = 3 TL)
  tl: { canonical: "TL", dimension: "spoon", factor: 1 },
  teeloeffel: { canonical: "TL", dimension: "spoon", factor: 1 },
  el: { canonical: "EL", dimension: "spoon", factor: 3 },
  essloeffel: { canonical: "EL", dimension: "spoon", factor: 3 },
};

/** Einheiten ohne sinnvolle Umrechnung: exakt gleiche Einheit wird summiert. */
const KNOWN_OTHER_UNITS = [
  "Prise",
  "Bund",
  "Dose",
  "Packung",
  "Zehe",
  "Scheibe",
  "Blatt",
  "Becher",
  "Glas",
  "Tasse",
];

export interface NormalizedUnit {
  canonical: string | null;
  dimension: Dimension;
  factor: number;
}

export function normalizeUnit(unit: string | null | undefined): NormalizedUnit {
  if (!unit) return { canonical: null, dimension: "count", factor: 1 };
  const key = unit.trim().toLowerCase().replace(/\.$/, "");
  if (!key) return { canonical: null, dimension: "count", factor: 1 };

  const known = UNIT_ALIASES[key];
  if (known) return { canonical: known.canonical, dimension: known.dimension, factor: known.factor };

  const other = KNOWN_OTHER_UNITS.find((u) => u.toLowerCase() === key);
  if (other) return { canonical: other, dimension: "other", factor: 1 };

  // Unbekannte Einheit: unveraendert uebernehmen, nur exakte Treffer summieren.
  return { canonical: unit.trim(), dimension: "other", factor: 1 };
}

/** Zutatennamen fuer den Vergleich vereinheitlichen (Gross-/Kleinschreibung, Plural-Whitespace). */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Basiseinheit einer Dimension - in ihr wird intern gerechnet. */
function baseUnit(dimension: Dimension, fallback: string | null): string | null {
  switch (dimension) {
    case "mass":
      return "g";
    case "volume":
      return "ml";
    case "spoon":
      return "TL";
    case "count":
      return null;
    default:
      return fallback;
  }
}

/**
 * Rechnet einen Betrag in der Basiseinheit in eine gut lesbare Einheit um.
 * 1500 g -> 1.5 kg, 2000 ml -> 2 l, 3 TL -> 1 EL.
 */
function humanize(dimension: Dimension, amount: number, unit: string | null): { amount: number; unit: string | null } {
  if (dimension === "mass" && amount >= 1000) return { amount: amount / 1000, unit: "kg" };
  if (dimension === "volume" && amount >= 1000) return { amount: amount / 1000, unit: "l" };
  if (dimension === "spoon" && amount >= 3 && amount % 3 === 0) return { amount: amount / 3, unit: "EL" };
  return { amount, unit };
}

export interface AggregatableIngredient {
  name: string;
  amount: number | null;
  unit: string | null;
  /** Name des Essens, aus dem die Zutat stammt. */
  source: string;
}

export interface AggregatedIngredient {
  key: string;
  name: string;
  amount: number | null;
  unit: string | null;
  sources: string[];
}

/**
 * Fasst Zutaten mehrerer Essen zu einer Einkaufsliste zusammen.
 *
 * Zutaten ohne Mengenangabe (z.B. "Salz") werden zu einem Eintrag ohne Menge
 * zusammengefasst - Aufaddieren waere hier sinnlos.
 */
export function aggregateIngredients(items: AggregatableIngredient[]): AggregatedIngredient[] {
  interface Bucket {
    key: string;
    displayName: string;
    dimension: Dimension;
    unit: string | null;
    total: number;
    hasAmount: boolean;
    sources: Set<string>;
    order: number;
  }

  const buckets = new Map<string, Bucket>();
  let order = 0;

  for (const item of items) {
    const name = item.name.trim();
    if (!name) continue;
    const { canonical, dimension, factor } = normalizeUnit(item.unit);
    const hasAmount = item.amount !== null && Number.isFinite(item.amount);

    // Zutaten ohne Menge bekommen einen eigenen Bucket, damit "Salz" nicht
    // faelschlich mit "200 g Salz" verrechnet wird.
    const unitKey = dimension === "other" ? `other:${(canonical ?? "").toLowerCase()}` : dimension;
    const key = hasAmount
      ? `${normalizeName(name)}|${unitKey}`
      : `${normalizeName(name)}|noamount`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        displayName: name,
        dimension,
        unit: hasAmount ? baseUnit(dimension, canonical) : canonical,
        total: 0,
        hasAmount,
        sources: new Set(),
        order: order++,
      };
      buckets.set(key, bucket);
    }
    if (hasAmount) bucket.total += (item.amount as number) * factor;
    bucket.sources.add(item.source);
  }

  return [...buckets.values()]
    .sort((a, b) => a.order - b.order)
    .map((bucket) => {
      if (!bucket.hasAmount) {
        return {
          key: bucket.key,
          name: bucket.displayName,
          amount: null,
          unit: bucket.unit,
          sources: [...bucket.sources],
        };
      }
      const { amount, unit } = humanize(bucket.dimension, bucket.total, bucket.unit);
      return {
        key: bucket.key,
        name: bucket.displayName,
        // Auf 3 Nachkommastellen runden, damit 0.1+0.2 nicht als 0.30000000000000004 endet.
        amount: Math.round(amount * 1000) / 1000,
        unit,
        sources: [...bucket.sources],
      };
    });
}
