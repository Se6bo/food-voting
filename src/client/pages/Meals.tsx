import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Meal, MealCategory } from "../../shared/types";
import { ApiRequestError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatAmount, mealEmoji } from "../lib/format";
import { useToast } from "../lib/toast";
import { PlanMealDialog } from "../components/PlanMealDialog";
import { Alert, Button, ConfirmDialog, EmptyState, Modal, PageLoader } from "../components/ui";

/** Kategorien anlegen/löschen - hilft, Essen bei vielen Einträgen wiederzufinden. */
function CategoryManagerModal({
  open,
  onClose,
  categories,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  categories: MealCategory[];
  onChange: (categories: MealCategory[]) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
    }
  }, [open]);

  async function addCategory() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const { category } = await api.post<{ category: MealCategory }>("/categories", { name: trimmed });
      onChange([...categories, category].sort((a, b) => a.name.localeCompare(b.name, "de")));
      setName("");
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Die Kategorie konnte nicht angelegt werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeCategory(category: MealCategory) {
    setDeletingId(category.id);
    try {
      await api.delete(`/categories/${category.id}`);
      onChange(categories.filter((c) => c.id !== category.id));
      toast.success(`"${category.name}" wurde gelöscht.`);
    } catch (err) {
      toast.error(
        err instanceof ApiRequestError ? err.message : "Die Kategorie konnte nicht gelöscht werden.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Modal
      open={open}
      title="Kategorien verwalten"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Fertig
        </Button>
      }
    >
      <div className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}

        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="z. B. Vegetarisch"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addCategory();
              }
            }}
            aria-label="Neue Kategorie"
          />
          <Button type="button" variant="secondary" loading={saving} onClick={() => void addCategory()}>
            Hinzufügen
          </Button>
        </div>

        {categories.length === 0 ? (
          <p className="text-sm muted">Noch keine Kategorien angelegt.</p>
        ) : (
          <ul className="space-y-1.5">
            {categories.map((category) => (
              <li
                key={category.id}
                className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3.5 py-2 text-sm dark:bg-slate-800/50"
              >
                <span>{category.name}</span>
                <button
                  type="button"
                  onClick={() => void removeCategory(category)}
                  disabled={deletingId === category.id}
                  aria-label={`${category.name} löschen`}
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800 dark:hover:text-red-400"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

export function MealsPage() {
  const toast = useToast();
  const { today } = useAuth();
  const [meals, setMeals] = useState<Meal[]>([]);
  const [categories, setCategories] = useState<MealCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [planningMeal, setPlanningMeal] = useState<Meal | null>(null);
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
    api
      .getOrDefault<{ categories: MealCategory[] }>("/categories", { categories: [] })
      .then((data) => setCategories(data.categories));
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return meals.filter((meal) => {
      if (categoryFilter && meal.categoryId !== categoryFilter) return false;
      if (!term) return true;
      return (
        meal.name.toLowerCase().includes(term) ||
        meal.ingredients.some((i) => i.name.toLowerCase().includes(term))
      );
    });
  }, [meals, search, categoryFilter]);

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
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            className="input max-w-sm flex-1"
            placeholder="Nach Gericht oder Zutat suchen ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Essen durchsuchen"
          />
          {categories.length > 0 && (
            <select
              className="input w-auto"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Nach Kategorie filtern"
            >
              <option value="">Alle Kategorien</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          )}
          <Button type="button" variant="ghost" onClick={() => setCategoryManagerOpen(true)}>
            Kategorien verwalten
          </Button>
        </div>
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
                {meal.categoryName && (
                  <span className="badge mt-1.5 w-fit bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    {meal.categoryName}
                  </span>
                )}
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

                <div className="mt-auto space-y-2 pt-4">
                  <p className="text-xs muted">Von {meal.createdByName ?? "Unbekannt"}</p>
                  <div className="flex gap-2">
                    <Button variant="secondary" className="flex-1" onClick={() => setPlanningMeal(meal)}>
                      Einplanen
                    </Button>
                    {meal.canEdit && (
                      <>
                        <Link to={`/essen/${meal.id}`} className="btn-secondary flex-1">
                          Bearbeiten
                        </Link>
                        <Button variant="ghost" onClick={() => setDeleting(meal)} aria-label={`${meal.name} löschen`}>
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                          </svg>
                        </Button>
                      </>
                    )}
                  </div>
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

      <CategoryManagerModal
        open={categoryManagerOpen}
        onClose={() => setCategoryManagerOpen(false)}
        categories={categories}
        onChange={setCategories}
      />

      <PlanMealDialog
        open={planningMeal !== null}
        onClose={() => setPlanningMeal(null)}
        onSaved={() => {}}
        defaultDate={today}
        fixedMeal={planningMeal ? { id: planningMeal.id, name: planningMeal.name } : null}
      />
    </div>
  );
}
