import { useState } from "react";
import type { PlannedDay, VoteValue } from "../../shared/types";
import { ApiRequestError, api } from "../lib/api";
import { formatAmount, formatDateTime, formatDay, mealEmoji, relativeDayLabel } from "../lib/format";
import { useToast } from "../lib/toast";
import { ApprovalBar, Spinner } from "./ui";

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

export function PlannedDayCard({
  day,
  today,
  onChange,
  showIngredients = false,
}: {
  day: PlannedDay;
  today: string;
  onChange: (day: PlannedDay) => void;
  showIngredients?: boolean;
}) {
  const toast = useToast();
  const [pending, setPending] = useState<VoteValue | "clear" | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function vote(value: VoteValue) {
    if (pending) return;
    setPending(value);
    try {
      // Gleiche Stimme nochmal = Stimme zurücknehmen.
      if (day.myVote === value) {
        const result = await api.delete<{ day: PlannedDay }>(`/votes/${day.id}`);
        onChange(result.day);
        toast.info("Deine Stimme wurde zurückgenommen.");
      } else {
        const result = await api.post<{ day: PlannedDay }>("/votes", {
          mealDayId: day.id,
          vote: value,
        });
        onChange(result.day);
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

  const relative = relativeDayLabel(day.date, today);
  const ingredients = day.meal.ingredients;

  return (
    <article
      className={[
        "card overflow-hidden transition-shadow hover:shadow-card-hover",
        day.isToday ? "ring-2 ring-brand-500/40" : "",
        day.isPast ? "opacity-75" : "",
      ].join(" ")}
    >
      {day.meal.image && (
        <img
          src={day.meal.image}
          alt=""
          loading="lazy"
          className="h-40 w-full object-cover sm:h-48"
          onError={(e) => {
            // Kaputte Bild-URLs sollen das Layout nicht zerschießen.
            e.currentTarget.style.display = "none";
          }}
        />
      )}

      <div className="p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
            {formatDay(day.date)}
          </span>
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

        <h3 className="flex items-start gap-2.5 text-lg font-semibold tracking-tight">
          <span aria-hidden="true">{mealEmoji(day.meal.name)}</span>
          <span className="min-w-0 break-words">{day.meal.name}</span>
        </h3>
        {day.meal.description && (
          <p className="mt-1.5 text-sm muted">{day.meal.description}</p>
        )}
        {day.meal.cookidooUrl && (
          <a
            href={day.meal.cookidooUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex w-fit items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            Rezept auf Cookidoo öffnen ↗
          </a>
        )}

        {showIngredients && ingredients.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
              aria-expanded={expanded}
            >
              {expanded ? "Zutaten ausblenden" : `Zutaten anzeigen (${ingredients.length})`}
            </button>
            {expanded && (
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

        <div className="mt-4 flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 font-medium text-brand-700 dark:text-brand-400">
            <span aria-hidden="true">👍</span> {day.votes.yes}
            <span className="sr-only">Ja-Stimmen</span>
          </span>
          <span className="flex items-center gap-1.5 font-medium text-slate-500 dark:text-slate-400">
            <span aria-hidden="true">👎</span> {day.votes.no}
            <span className="sr-only">Nein-Stimmen</span>
          </span>
        </div>

        <div className="mt-3">
          <ApprovalBar approval={day.votes.approval} total={day.votes.total} />
        </div>

        {day.votingOpen ? (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => vote(1)}
              disabled={pending !== null}
              aria-pressed={day.myVote === 1}
              className={[
                "btn min-h-[44px] flex-1 whitespace-nowrap border px-3",
                day.myVote === 1
                  ? "border-brand-600 bg-brand-600 text-white hover:bg-brand-700 dark:border-brand-500 dark:bg-brand-500 dark:text-slate-950"
                  : "border-slate-300 bg-white text-slate-700 hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:bg-[#1a222c] dark:text-slate-200 dark:hover:bg-slate-800",
              ].join(" ")}
            >
              {pending === 1 ? <Spinner className="h-4 w-4" /> : <span aria-hidden="true">👍</span>}
              Gefällt mir
            </button>
            <button
              type="button"
              onClick={() => vote(-1)}
              disabled={pending !== null}
              aria-pressed={day.myVote === -1}
              className={[
                "btn min-h-[44px] flex-1 whitespace-nowrap border px-3",
                day.myVote === -1
                  ? "border-slate-700 bg-slate-700 text-white hover:bg-slate-800 dark:border-slate-500 dark:bg-slate-600"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#1a222c] dark:text-slate-200 dark:hover:bg-slate-800",
              ].join(" ")}
            >
              {pending === -1 ? <Spinner className="h-4 w-4" /> : <span aria-hidden="true">👎</span>}
              Eher nicht
            </button>
          </div>
        ) : (
          <p className="mt-4 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm muted dark:bg-slate-800/50">
            {closedMessage(day)}
          </p>
        )}

        {day.votingOpen && day.myVote !== null && (
          <p className="mt-2 text-xs muted">
            Du hast mit {day.myVote === 1 ? "Ja" : "Nein"} gestimmt. Nochmal tippen nimmt die Stimme
            zurück. Änderbar bis {formatDateTime(day.deadline)} Uhr.
          </p>
        )}
        {day.votingOpen && day.myVote === null && (
          <p className="mt-2 text-xs muted">
            Abstimmen möglich bis {formatDateTime(day.deadline)} Uhr.
          </p>
        )}
      </div>
    </article>
  );
}
