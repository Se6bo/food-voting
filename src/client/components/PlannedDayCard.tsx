import { useState } from "react";
import type { PlannedDay, PlannedDayProposal, VoteValue } from "../../shared/types";
import { ApiRequestError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  formatAmount,
  formatDateTime,
  formatDay,
  mealEmoji,
  mealSlotEmoji,
  mealSlotLabel,
  relativeDayLabel,
} from "../lib/format";
import { useToast } from "../lib/toast";
import { Button, ConfirmDialog, Spinner } from "./ui";

/** Verständlicher Text dazu, warum eine Abstimmung geschlossen ist. */
function closedMessage(day: PlannedDay): string {
  switch (day.closedReason) {
    case "past":
      return "Dieser Tag ist vorbei. Das Ergebnis bleibt sichtbar.";
    case "admin":
      return "Diese Abstimmung wurde von einem Admin geschlossen.";
    default:
      return `Die Abstimmung ist seit ${formatDateTime(day.deadline)} Uhr geschlossen.`;
  }
}

/** Basis-Klassen der beiden Abstimmungs-Buttons (aktiv/inaktiv je nach myVote). */
function voteButtonClasses(active: boolean, negative: boolean): string {
  if (active) {
    return negative
      ? "border-slate-700 bg-slate-700 text-white hover:bg-slate-800 dark:border-slate-500 dark:bg-slate-600"
      : "border-brand-600 bg-brand-600 text-white hover:bg-brand-700 dark:border-brand-500 dark:bg-brand-500 dark:text-slate-950";
  }
  return "border-slate-300 bg-white text-slate-700 hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:bg-[#1a222c] dark:text-slate-200 dark:hover:bg-slate-800";
}

export function PlannedDayCard({
  day,
  today,
  onChange,
  showIngredients = false,
  showDate = true,
  manageVoting = true,
  allowRemoveProposals = false,
}: {
  day: PlannedDay;
  today: string;
  onChange: (day: PlannedDay) => void;
  showIngredients?: boolean;
  /** Ausblenden, wenn das Datum schon außerhalb der Karte angezeigt wird (z.B. gruppierte Tagesansicht). */
  showDate?: boolean;
  /** Blendet die Öffnen/Schließen-Steuerung der Abstimmung aus (z.B. im Dashboard). */
  manageVoting?: boolean;
  /** Zeigt pro Vorschlag einen Entfernen-Knopf für eigene Vorschläge (Admin: alle) – nur Essensplan-Seite. */
  allowRemoveProposals?: boolean;
}) {
  const toast = useToast();
  const { user } = useAuth();
  /** Laufende Abstimmungs-Anfrage ("clear" = eigene Stimme zurücknehmen). */
  const [pending, setPending] = useState<{ proposalId: string; action: VoteValue | "clear" } | null>(null);
  /** Aufgeklappte Zutatenlisten je Vorschlag. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /** Bestätigungsdialog fürs vorzeitige Schließen. */
  const [confirmClose, setConfirmClose] = useState(false);
  /** Laufende Öffnen/Schließen-Anfrage - getrennt vom Abstimmen-Pending. */
  const [votingBusy, setVotingBusy] = useState(false);
  /** Vorschlag, der gerade im Bestätigungsdialog zum Entfernen steht. */
  const [removeTarget, setRemoveTarget] = useState<PlannedDayProposal | null>(null);
  /** Laufende Entfernen-Anfrage. */
  const [removeBusy, setRemoveBusy] = useState(false);

  async function vote(proposal: PlannedDayProposal, value: VoteValue) {
    if (pending || removeBusy) return;
    // Gleiche Reaktion nochmal tippen = eigene Stimme zurücknehmen.
    const clearing = proposal.myVote === value;
    setPending({ proposalId: proposal.id, action: clearing ? "clear" : value });
    try {
      const result = clearing
        ? await api.delete<{ day: PlannedDay }>(`/votes/${proposal.id}`)
        : await api.post<{ day: PlannedDay }>("/votes", {
            proposalId: proposal.id,
            vote: value,
          });
      onChange(result.day);
      if (clearing) {
        toast.info("Deine Stimme wurde zurückgenommen.");
      } else {
        toast.success("Deine Stimme wurde gespeichert.");
      }
    } catch (err) {
      toast.error(
        err instanceof ApiRequestError ? err.message : "Deine Stimme konnte nicht gespeichert werden.",
      );
    } finally {
      setPending(null);
    }
  }

  /**
   * Abstimmung des Tages schließen oder wieder öffnen - jedes Gruppenmitglied
   * darf das, nicht nur Admins (siehe /api/planning/:id/voting).
   */
  async function setVotingOpen(open: boolean) {
    if (votingBusy || removeBusy) return;
    setVotingBusy(true);
    try {
      const result = await api.put<{ day: PlannedDay }>(`/planning/${day.id}/voting`, { open });
      onChange(result.day);
      toast.success(open ? "Die Abstimmung wurde wieder geöffnet." : "Die Abstimmung wurde beendet.");
    } catch (err) {
      toast.error(
        err instanceof ApiRequestError ? err.message : "Das hat leider nicht geklappt.",
      );
    } finally {
      setVotingBusy(false);
    }
  }

  /**
   * Einen einzelnen Vorschlag entfernen - nur bei offener Abstimmung möglich
   * (der Server prüft das zusätzlich). Stimmen zu diesem Vorschlag löscht der
   * Server per FK-Cascade gleich mit.
   */
  async function removeProposal(target: PlannedDayProposal) {
    if (removeBusy) return;
    setRemoveBusy(true);
    try {
      const result = await api.delete<{ day: PlannedDay }>(`/planning/proposals/${target.id}`);
      onChange(result.day);
      toast.success("Der Vorschlag wurde entfernt.");
    } catch (err) {
      toast.error(
        err instanceof ApiRequestError ? err.message : "Der Vorschlag konnte nicht entfernt werden.",
      );
    } finally {
      setRemoveBusy(false);
      setRemoveTarget(null);
    }
  }

  const relative = relativeDayLabel(day.date, today);

  return (
    <article
      className={[
        "card overflow-hidden transition-shadow hover:shadow-card-hover",
        day.isToday ? "ring-2 ring-brand-500/40" : "",
        day.isPast ? "opacity-75" : "",
      ].join(" ")}
    >
      <div className="p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="badge bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <span aria-hidden="true">{mealSlotEmoji(day.slot)}</span> {mealSlotLabel(day.slot)}
          </span>
          {showDate && (
            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
              {formatDay(day.date)}
            </span>
          )}
          {relative && (
            <span className="badge bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              {relative}
            </span>
          )}
          {!day.votingOpen && (
            <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              Abstimmung geschlossen
            </span>
          )}
        </div>

        {day.proposals.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-center text-sm muted dark:bg-slate-800/50">
            Noch keine Vorschläge für diesen Tag.
          </p>
        ) : (
          <div className="space-y-3">
            {day.proposals.map((proposal) => {
              const isWinner = !day.votingOpen && day.winningProposalId === proposal.id;
              const ingredients = proposal.meal.ingredients;
              const isExpanded = expanded[proposal.id] ?? false;
              // In welchem Button dreht sich gerade der Spinner?
              let busyValue: VoteValue | null = null;
              if (pending && pending.proposalId === proposal.id) {
                busyValue = pending.action === "clear" ? proposal.myVote : pending.action;
              }
              return (
                <article
                  key={proposal.id}
                  className={[
                    "overflow-hidden rounded-2xl border bg-slate-50 dark:bg-slate-800/50",
                    isWinner
                      ? "border-emerald-400 ring-1 ring-emerald-400/60 dark:border-emerald-500 dark:ring-emerald-500/60"
                      : "border-slate-200 dark:border-slate-700/60",
                  ].join(" ")}
                >
                  {proposal.meal.image && (
                    <img
                      src={proposal.meal.image}
                      alt=""
                      loading="lazy"
                      className="h-32 w-full object-cover sm:h-36"
                      onError={(e) => {
                        // Kaputte Bild-URLs sollen das Layout nicht zerschießen.
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  )}

                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="flex min-w-0 items-start gap-2 text-base font-semibold tracking-tight">
                        <span aria-hidden="true">{mealEmoji(proposal.meal.name)}</span>
                        <span className="min-w-0 break-words">{proposal.meal.name}</span>
                      </h3>
                      {isWinner && (
                        <span className="badge shrink-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                          <span aria-hidden="true">🏆</span> Gewinner
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="text-xs muted">
                        Von {proposal.createdByName ?? "Unbekannt"}
                      </p>
                      {day.votingOpen &&
                        allowRemoveProposals &&
                        user &&
                        (user.role === "admin" || proposal.createdBy === user.id) && (
                          <button
                            type="button"
                            onClick={() => setRemoveTarget(proposal)}
                            disabled={removeBusy || pending !== null || votingBusy}
                            aria-label="Vorschlag entfernen"
                            title="Vorschlag entfernen"
                            className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                          >
                            Entfernen
                          </button>
                        )}
                    </div>

                    {showIngredients && ingredients.length > 0 && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((prev) => ({ ...prev, [proposal.id]: !isExpanded }))
                          }
                          aria-expanded={isExpanded}
                          className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
                        >
                          {isExpanded
                            ? "Zutaten ausblenden"
                            : `Zutaten anzeigen (${ingredients.length})`}
                        </button>
                        {isExpanded && (
                          <ul className="mt-2 space-y-1 text-sm muted">
                            {ingredients.map((ingredient) => (
                              <li key={ingredient.id} className="flex gap-2">
                                <span aria-hidden="true">•</span>
                                <span>
                                  {formatAmount(ingredient.amount, ingredient.unit)} {ingredient.name}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {day.votingOpen ? (
                      <>
                        <div className="mt-4 flex gap-2">
                          <button
                            type="button"
                            onClick={() => vote(proposal, 1)}
                            disabled={pending !== null || votingBusy || removeBusy}
                            aria-pressed={proposal.myVote === 1}
                            aria-label={`Dafür stimmen – ${proposal.votes.yes} ${
                              proposal.votes.yes === 1 ? "Ja-Stimme" : "Ja-Stimmen"
                            }`}
                            className={[
                              "btn min-h-[44px] flex-1 whitespace-nowrap border px-3",
                              voteButtonClasses(proposal.myVote === 1, false),
                            ].join(" ")}
                          >
                            {busyValue === 1 ? (
                              <Spinner className="h-4 w-4" />
                            ) : (
                              <span aria-hidden="true">👍</span>
                            )}
                            {proposal.votes.yes}
                            <span className="sr-only">Ja-Stimmen</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => vote(proposal, -1)}
                            disabled={pending !== null || votingBusy || removeBusy}
                            aria-pressed={proposal.myVote === -1}
                            aria-label={`Dagegen stimmen – ${proposal.votes.no} ${
                              proposal.votes.no === 1 ? "Nein-Stimme" : "Nein-Stimmen"
                            }`}
                            className={[
                              "btn min-h-[44px] flex-1 whitespace-nowrap border px-3",
                              voteButtonClasses(proposal.myVote === -1, true),
                            ].join(" ")}
                          >
                            {busyValue === -1 ? (
                              <Spinner className="h-4 w-4" />
                            ) : (
                              <span aria-hidden="true">👎</span>
                            )}
                            {proposal.votes.no}
                            <span className="sr-only">Nein-Stimmen</span>
                          </button>
                        </div>
                        {proposal.myVote !== null && (
                          <p className="mt-2 text-xs muted">
                            Du hast mit {proposal.myVote === 1 ? "Ja" : "Nein"} gestimmt. Nochmal
                            tippen nimmt die Stimme zurück.
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="mt-4 flex items-center gap-4 text-sm">
                        <span className="flex items-center gap-1.5 font-medium text-brand-700 dark:text-brand-400">
                          <span aria-hidden="true">👍</span> {proposal.votes.yes}
                          <span className="sr-only">Ja-Stimmen</span>
                        </span>
                        <span className="flex items-center gap-1.5 font-medium text-slate-500 dark:text-slate-400">
                          <span aria-hidden="true">👎</span> {proposal.votes.no}
                          <span className="sr-only">Nein-Stimmen</span>
                        </span>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="mt-4">
          {day.votingOpen ? (
            <>
              <p className="text-xs muted">Abstimmen möglich bis {formatDateTime(day.deadline)} Uhr.</p>
              {day.proposals.length > 0 && manageVoting && (
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-2 min-h-[44px]"
                  onClick={() => setConfirmClose(true)}
                  disabled={pending !== null || votingBusy || removeBusy}
                >
                  Abstimmung jetzt beenden
                </Button>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm muted dark:bg-slate-800/50">
                {closedMessage(day)}
              </p>
              {day.closedReason === "admin" && manageVoting && (
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-[44px]"
                  onClick={() => setVotingOpen(true)}
                  loading={votingBusy}
                  disabled={pending !== null || votingBusy || removeBusy}
                >
                  Abstimmung wieder öffnen
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmClose}
        title="Abstimmung jetzt beenden?"
        message={`Wenn du die Abstimmung für ${formatDay(day.date)} jetzt beendest, steht sofort der aktuell führende Vorschlag als Gewinner fest und niemand kann mehr abstimmen.`}
        confirmLabel="Abstimmung beenden"
        onConfirm={async () => {
          await setVotingOpen(false);
          setConfirmClose(false);
        }}
        onCancel={() => setConfirmClose(false)}
        busy={votingBusy}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title="Vorschlag entfernen?"
        message={
          removeTarget
            ? `Soll „${removeTarget.meal.name}“ vom ${formatDay(day.date)} wirklich entfernt werden? Dabei werden auch alle Stimmen zu diesem Vorschlag gelöscht.`
            : ""
        }
        confirmLabel="Entfernen"
        onConfirm={async () => {
          if (removeTarget) await removeProposal(removeTarget);
        }}
        onCancel={() => setRemoveTarget(null)}
        busy={removeBusy}
      />
    </article>
  );
}
