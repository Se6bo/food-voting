import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Meal, PlannedDay } from "../../shared/types";
import { ApiRequestError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDay } from "../lib/format";
import { useToast } from "../lib/toast";
import { PlannedDayCard } from "../components/PlannedDayCard";
import { Alert, Button, EmptyState, Modal, PageLoader } from "../components/ui";

interface PlanningResponse {
  days: PlannedDay[];
  today: string;
  range: { from: string; to: string };
}

/** Ein Essen für einen Tag vorschlagen. Steht allen offen - mehrere Vorschläge
 * pro Tag sind erlaubt, solange die Abstimmung läuft. */
function AssignDialog({
  open,
  onClose,
  onSaved,
  defaultDate,
  plannedDates,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  defaultDate: string;
  plannedDates: Set<string>;
}) {
  const toast = useToast();
  const [meals, setMeals] = useState<Meal[]>([]);
  const [date, setDate] = useState(defaultDate);
  const [mealId, setMealId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDate(defaultDate);
    setError(null);
    api
      .get<{ meals: Meal[] }>("/meals")
      .then((data) => {
        setMeals(data.meals);
        setMealId((current) => current || data.meals[0]?.id || "");
      })
      .catch(() => setError("Die Essen konnten nicht geladen werden."));
  }, [open, defaultDate]);

  async function handleSave() {
    if (!mealId) {
      setError("Bitte wähle ein Essen aus.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post("/planning", { date, mealId });
      toast.success("Essen wurde eingeplant.");
      onSaved();
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Das Essen konnte nicht eingeplant werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Essen einplanen"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={handleSave} loading={saving}>
            Einplanen
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}

        <div>
          <label className="label" htmlFor="assign-date">
            Tag
          </label>
          <input
            id="assign-date"
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          {plannedDates.has(date) && (
            <p className="mt-1.5 text-sm text-amber-600 dark:text-amber-400">
              Für diesen Tag gibt es bereits Vorschläge. Weitere sind erlaubt, solange die
              Abstimmung läuft.
            </p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="assign-meal">
            Essen
          </label>
          {meals.length === 0 ? (
            <p className="text-sm muted">
              Es gibt noch keine Essen.{" "}
              <Link to="/essen/neu" className="text-brand-600 hover:underline dark:text-brand-400">
                Jetzt eines anlegen
              </Link>
              .
            </p>
          ) : (
            <select
              id="assign-meal"
              className="input"
              value={mealId}
              onChange={(e) => setMealId(e.target.value)}
            >
              {meals.map((meal) => (
                <option key={meal.id} value={meal.id}>
                  {meal.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    </Modal>
  );
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

  const plannedDates = useMemo(() => new Set(days.map((day) => day.date)), [days]);

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
          description="Ordne ein Essen einem Tag zu, damit die Gruppe abstimmen kann."
          action={<Button onClick={() => setDialogOpen(true)}>Essen einplanen</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {days.map((day) => (
            <div key={day.id} className="relative">
              <PlannedDayCard day={day} today={today} onChange={handleDayChange} showIngredients />
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
      )}

      <AssignDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={load}
        defaultDate={today}
        plannedDates={plannedDates}
      />
    </div>
  );
}
