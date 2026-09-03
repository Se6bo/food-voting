import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlannedDay } from "../../shared/types";
import { ApiRequestError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDay, relativeDayLabel } from "../lib/format";
import { useToast } from "../lib/toast";
import { PlanMealDialog } from "../components/PlanMealDialog";
import { PlannedDayCard } from "../components/PlannedDayCard";
import { Alert, Button, EmptyState, PageLoader } from "../components/ui";

interface PlanningResponse {
  days: PlannedDay[];
  today: string;
  range: { from: string; to: string };
}

export function PlanPage() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [days, setDays] = useState<PlannedDay[]>([]);
  const [today, setToday] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    try {
      const range = showPast ? "?from=1970-01-01" : "";
      const data = await api.get<PlanningResponse>(`/planning${range}`);
      setDays(data.days);
      setToday(data.today);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Der Essensplan konnte nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }, [showPast]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Für die Warnung im Dialog: für welche Tag+Mahlzeit-Kombinationen gibt es schon Vorschläge. */
  const plannedSlots = useMemo(() => new Set(days.map((day) => `${day.date}|${day.slot}`)), [days]);

  // Der Server liefert die Tage bereits nach Datum, dann Mahlzeit sortiert -
  // Map-Einfügereihenfolge reicht deshalb für eine stabile Gruppierung.
  const groupedByDate = useMemo(() => {
    const map = new Map<string, PlannedDay[]>();
    for (const day of days) {
      const list = map.get(day.date) ?? [];
      list.push(day);
      map.set(day.date, list);
    }
    return [...map.entries()];
  }, [days]);

  function handleDayChange(updated: PlannedDay) {
    setDays((prev) => prev.map((day) => (day.id === updated.id ? updated : day)));
  }

  async function removeDay(day: PlannedDay) {
    try {
      await api.delete(`/planning/${day.id}`);
      setDays((prev) => prev.filter((d) => d.id !== day.id));
      toast.success(`${formatDay(day.date)} wurde aus dem Plan entfernt.`);
    } catch (err) {
      toast.error(
        err instanceof ApiRequestError ? err.message : "Die Planung konnte nicht entfernt werden.",
      );
    }
  }

  if (loading) return <PageLoader label="Essensplan wird geladen ..." />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Essensplan</h1>
          <p className="mt-1 text-sm muted">Was in den nächsten Tagen auf den Tisch kommt.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowPast((v) => !v)}>
            {showPast ? "Nur kommende" : "Vergangene zeigen"}
          </Button>
          <Button onClick={() => setDialogOpen(true)}>Essen einplanen</Button>
        </div>
      </header>

      {error && <Alert kind="error">{error}</Alert>}

      {days.length === 0 ? (
        <EmptyState
          icon="📅"
          title="Der Plan ist noch leer"
          description="Ordne ein Essen einem Tag und einer Mahlzeit zu, damit die Gruppe abstimmen kann."
          action={<Button onClick={() => setDialogOpen(true)}>Essen einplanen</Button>}
        />
      ) : (
        <div className="space-y-8">
          {groupedByDate.map(([date, dayGroup]) => {
            const relative = relativeDayLabel(date, today);
            return (
              <section key={date}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold tracking-tight">{formatDay(date)}</h2>
                  {relative && (
                    <span className="badge bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                      {relative}
                    </span>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {dayGroup.map((day) => (
                    <div key={day.id} className="relative">
                      <PlannedDayCard
                        day={day}
                        today={today}
                        onChange={handleDayChange}
                        showIngredients
                        showDate={false}
                      />
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => removeDay(day)}
                          aria-label={`${formatDay(day.date)} aus dem Plan entfernen`}
                          title="Aus dem Plan entfernen"
                          className="absolute right-3 top-3 rounded-lg bg-white/90 p-2 text-slate-500 shadow-sm transition-colors hover:bg-white hover:text-red-600 dark:bg-slate-900/90 dark:text-slate-400 dark:hover:text-red-400"
                        >
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <PlanMealDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={load}
        defaultDate={today}
        plannedSlots={plannedSlots}
      />
    </div>
  );
}
