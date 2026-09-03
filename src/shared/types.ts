/**
 * Typen, die Worker und Client gemeinsam nutzen. Die Datei wird von beiden
 * tsconfig-Projekten eingebunden und darf daher weder DOM- noch Workers-APIs
 * referenzieren.
 */

export type Role = "user" | "admin";

/** Vote-Werte: 1 = Ja / gefällt mir, -1 = Nein. */
export type VoteValue = 1 | -1;

/** Mahlzeiten-Zeitfenster: pro Tag lässt sich jedes davon getrennt planen. */
export type MealSlot = "lunch" | "snack" | "dinner";

/** Anzeigereihenfolge der drei Zeitfenster eines Tages. */
export const MEAL_SLOTS: MealSlot[] = ["lunch", "snack", "dinner"];

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  /** Jeder Benutzer gehört genau einer Gruppe an (getrennter Essensplan). */
  groupId: string | null;
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
  /** Link zum Original-Rezept auf Cookidoo, falls aus dem Import übernommen. */
  cookidooUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
}

/** Essenskategorie einer Gruppe, z.B. "Vegetarisch" oder "Schnell" - erleichtert das Wiederfinden. */
export interface MealCategory {
  id: string;
  name: string;
}

export interface VoteSummary {
  yes: number;
  no: number;
  total: number;
  /** Zustimmung in Prozent, 0 wenn noch niemand abgestimmt hat. */
  approval: number;
}

export interface PlannedDayProposal {
  id: string;
  meal: {
    id: string;
    name: string;
    description: string | null;
    image: string | null;
    ingredients: Ingredient[];
    cookidooUrl: string | null;
  };
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  votes: VoteSummary;
  myVote: VoteValue | null;
}

export interface PlannedDay {
  id: string;
  date: string;
  /** Welches Zeitfenster des Tages das ist - jedes wird getrennt geplant. */
  slot: MealSlot;
  /** Beliebig viele Rezeptvorschläge für diesen Tag statt einem festen Essen. */
  proposals: PlannedDayProposal[];
  /**
   * ID des Vorschlags mit der höchsten Ja-minus-Nein-Differenz, sobald die
   * Abstimmung geschlossen ist. Solange die Abstimmung offen ist (oder es
   * keine Vorschläge gibt), ist der Gewinner unbekannt -> null. Wird nicht
   * gespeichert, sondern bei jedem Lesezugriff serverseitig live berechnet.
   */
  winningProposalId: string | null;
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

/** Eigene Gruppe eines Benutzers (GET /api/groups/me). */
export interface MyGroup {
  id: string;
  name: string;
  inviteCode: string;
  inviteUrl: string;
  memberCount: number;
  members: Array<{ id: string; name: string; email: string }>;
}

/** Gruppen-Metadaten in der Admin-Übersicht (GET /api/admin/groups). */
export interface AdminGroup {
  id: string;
  name: string;
  inviteCode: string;
  inviteUrl: string;
  memberCount: number;
  createdAt: string;
}

export interface ApiError {
  error: string;
  /** Feldbezogene Validierungsfehler für Formulare. */
  fields?: Record<string, string>;
}
