/**
 * Typen, die Worker und Client gemeinsam nutzen. Die Datei wird von beiden
 * tsconfig-Projekten eingebunden und darf daher weder DOM- noch Workers-APIs
 * referenzieren.
 */

export type Role = "user" | "admin";

/** Vote-Werte: 1 = Ja / gefällt mir, -1 = Nein. */
export type VoteValue = 1 | -1;

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface Ingredient {
  id: string;
  name: string;
  amount: number | null;
  unit: string | null;
}

/** Zutat wie sie vom Client beim Anlegen/Bearbeiten geschickt wird. */
export interface IngredientInput {
  name: string;
  amount: number | null;
  unit: string | null;
}

export interface Meal {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  ingredients: Ingredient[];
  /** Darf der aktuelle Benutzer dieses Essen bearbeiten/löschen? */
  canEdit: boolean;
}

export interface VoteSummary {
  yes: number;
  no: number;
  total: number;
  /** Zustimmung in Prozent, 0 wenn noch niemand abgestimmt hat. */
  approval: number;
}

export interface PlannedDay {
  id: string;
  date: string;
  meal: {
    id: string;
    name: string;
    description: string | null;
    image: string | null;
    ingredients: Ingredient[];
  };
  votes: VoteSummary;
  myVote: VoteValue | null;
  /** Serverseitig berechnet - der Client entscheidet das nie selbst. */
  votingOpen: boolean;
  /** Warum die Abstimmung geschlossen ist (für verständliche UI-Texte). */
  closedReason: "past" | "deadline" | "admin" | null;
  /** ISO-Zeitpunkt, bis zu dem abgestimmt werden darf. */
  deadline: string;
  isToday: boolean;
  isPast: boolean;
}

export interface ShoppingItem {
  id: string;
  name: string;
  amount: number | null;
  unit: string | null;
  checked: boolean;
  isManual: boolean;
  /** Essen, aus denen dieser Eintrag zusammengefasst wurde. */
  sources: string[];
}

export interface AppSettings {
  appName: string;
  planningDaysAhead: number;
  registrationOpen: boolean;
  voteDeadlineHour: number;
}

export interface ApiError {
  error: string;
  /** Feldbezogene Validierungsfehler für Formulare. */
  fields?: Record<string, string>;
}
