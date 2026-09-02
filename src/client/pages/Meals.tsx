import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Meal } from "../../shared/types";
import { ApiRequestError, api } from "../lib/api";
import { formatAmount, mealEmoji } from "../lib/format";
import { useToast } from "../lib/toast";
import { Alert, Button, ConfirmDialog, EmptyState, PageLoader } from "../components/ui";

export function MealsPage() {
  const toast = useToast();
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<Meal | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ meals: Meal[] }>("/meals");
      setMeals(data.meals);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Die Essen konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return meals;
    return meals.filter(
      (meal) =>
        meal.name.toLowerCase().includes(term) ||
        meal.ingredients.some((i) => i.name.toLowerCase().includes(term)),
    );
  }, [meals, search]);

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/meals/${deleting.id}`);
      setMeals((prev) => prev.filter((meal) => meal.id !== deleting.id));
      toast.success(`"${deleting.name}" wurde gelöscht.`);
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Das Essen konnte nicht gelöscht werden.");
    } finally {
      setDeleteBusy(false);
    }
  }

  if (loading) return <PageLoader label="Essen werden geladen ..." />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Essen</h1>
          <p className="mt-1 text-sm muted">Alle Gerichte mit ihren Zutaten.</p>
        </div>
        <Link to="/essen/neu" className="btn-primary">
          Essen hinzufügen
        </Link>
      </header>

      {error && <Alert kind="error">{error}</Alert>}

      {meals.length > 0 && (
        <input
          type="search"
          className="input max-w-sm"
          placeholder="Nach Gericht oder Zutat suchen ..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Essen durchsuchen"
        />
      )}

      {meals.length === 0 ? (
        <EmptyState
          title="Noch keine Essen angelegt"
          description="Lege euer erstes Gericht an - inklusive Zutaten für die Einkaufsliste."
          action={
            <Link to="/essen/neu" className="btn-primary">
              Essen hinzufügen
            </Link>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon="🔍" title="Nichts gefunden" description="Zu deiner Suche gibt es kein Gericht." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((meal) => (
            <article key={meal.id} className="card flex flex-col overflow-hidden transition-shadow hover:shadow-card-hover">
              {meal.image && (
                <img
                  src={meal.image}
                  alt=""
                  loading="lazy"
                  className="h-36 w-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              )}
              <div className="flex flex-1 flex-col p-5">
                <h2 className="flex items-start gap-2.5 text-base font-semibold">
                  <span aria-hidden="true">{mealEmoji(meal.name)}</span>
                  <span className="min-w-0 break-words">{meal.name}</span>
                </h2>
                {meal.description && <p className="mt-1.5 line-clamp-3 text-sm muted">{meal.description}</p>}

                {meal.cookidooUrl && (
                  <a
                    href={meal.cookidooUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-flex w-fit items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                  >
                    Rezept auf Cookidoo öffnen ↗
                  </a>
                )}

                {meal.ingredients.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm muted">
                    {meal.ingredients.slice(0, 4).map((ingredient) => (
                      <li key={ingredient.id}>
                        {formatAmount(ingredient.amount, ingredient.unit)} {ingredient.name}
                      </li>
                    ))}
                    {meal.ingredients.length > 4 && (
                      <li className="italic">+ {meal.ingredients.length - 4} weitere</li>
                    )}
                  </ul>
                )}

                <div className="mt-auto pt-4">
                  <p className="text-xs muted">Von {meal.createdByName ?? "Unbekannt"}</p>
                  {meal.canEdit && (
                    <div className="mt-3 flex gap-2">
                      <Link to={`/essen/${meal.id}`} className="btn-secondary flex-1">
                        Bearbeiten
                      </Link>
                      <Button variant="ghost" onClick={() => setDeleting(meal)} aria-label={`${meal.name} löschen`}>
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                        </svg>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Essen löschen"
        message={`Soll "${deleting?.name}" wirklich gelöscht werden? Damit verschwinden auch die zugehörigen Planungen und Stimmen.`}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
        busy={deleteBusy}
      />
    </div>
  );
}
