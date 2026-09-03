import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Meal, MealCategory, MealSlot } from "../../shared/types";
import { MEAL_SLOTS } from "../../shared/types";
import { ApiRequestError, api } from "../lib/api";
import { mealSlotLabel } from "../lib/format";
import { useToast } from "../lib/toast";
import { Alert, Button, Modal } from "./ui";

/**
 * Essen für einen Tag + ein Zeitfenster (Mittagessen/Mittagssnack/Abendessen)
 * vorschlagen. Steht allen offen - mehrere Vorschläge pro Tag+Zeitfenster
 * sind erlaubt, solange die Abstimmung läuft.
 *
 * Zwei Modi:
 * - freie Essenswahl (Essensplan-Seite: Tag, Zeitfenster und Essen wählen)
 * - festes Essen (Essen-Seite: "Einplanen"-Knopf, nur Tag + Zeitfenster wählen)
 */
export function PlanMealDialog({
  open,
  onClose,
  onSaved,
  defaultDate,
  defaultSlot = "lunch",
  fixedMeal = null,
  plannedSlots,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  defaultDate: string;
  defaultSlot?: MealSlot;
  /** Wenn gesetzt, ist das Essen fest vorgegeben - es gibt dann keine Essensauswahl. */
  fixedMeal?: { id: string; name: string } | null;
  /** Schlüssel `date|slot` mit vorhandenen Vorschlägen, für die Hinweis-Meldung. */
  plannedSlots?: Set<string>;
}) {
  const toast = useToast();
  const [meals, setMeals] = useState<Meal[]>([]);
  const [categories, setCategories] = useState<MealCategory[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [slot, setSlot] = useState<MealSlot>(defaultSlot);
  const [mealId, setMealId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDate(defaultDate);
    setSlot(defaultSlot);
    setCategoryFilter("");
    setError(null);
    if (fixedMeal) return;
    api
      .get<{ meals: Meal[] }>("/meals")
      .then((data) => {
        setMeals(data.meals);
        setMealId((current) => current || data.meals[0]?.id || "");
      })
      .catch(() => setError("Die Essen konnten nicht geladen werden."));
    api
      .getOrDefault<{ categories: MealCategory[] }>("/categories", { categories: [] })
      .then((data) => setCategories(data.categories));
  }, [open, defaultDate, defaultSlot, fixedMeal]);

  const filteredMeals = categoryFilter
    ? meals.filter((meal) => meal.categoryId === categoryFilter)
    : meals;

  useEffect(() => {
    if (!open || fixedMeal) return;
    // Nach einem Kategoriefilter darf die Auswahl nicht auf ein ausgeblendetes Essen zeigen.
    if (filteredMeals.length > 0 && !filteredMeals.some((meal) => meal.id === mealId)) {
      setMealId(filteredMeals[0].id);
    }
  }, [categoryFilter, meals]);

  async function handleSave() {
    const selectedMealId = fixedMeal ? fixedMeal.id : mealId;
    if (!selectedMealId) {
      setError("Bitte wähle ein Essen aus.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post("/planning", { date, slot, mealId: selectedMealId });
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

  const alreadyPlanned = plannedSlots?.has(`${date}|${slot}`) ?? false;

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

        {fixedMeal && (
          <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm font-medium dark:bg-slate-800/50">
            {fixedMeal.name}
          </div>
        )}

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
        </div>

        <div>
          <span className="label">Mahlzeit</span>
          <div className="flex flex-wrap gap-2">
            {MEAL_SLOTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSlot(s)}
                aria-pressed={slot === s}
                className={[
                  "btn min-h-[44px] flex-1 whitespace-nowrap border px-3",
                  slot === s
                    ? "border-brand-600 bg-brand-600 text-white hover:bg-brand-700 dark:border-brand-500 dark:bg-brand-500 dark:text-slate-950"
                    : "border-slate-300 bg-white text-slate-700 hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:bg-[#1a222c] dark:text-slate-200 dark:hover:bg-slate-800",
                ].join(" ")}
              >
                {mealSlotLabel(s)}
              </button>
            ))}
          </div>
          {alreadyPlanned && (
            <p className="mt-1.5 text-sm text-amber-600 dark:text-amber-400">
              Für {mealSlotLabel(slot)} an diesem Tag gibt es bereits Vorschläge. Weitere sind
              erlaubt, solange die Abstimmung läuft.
            </p>
          )}
        </div>

        {!fixedMeal && (
          <div>
            {categories.length > 0 && (
              <div className="mb-2">
                <label className="label" htmlFor="assign-category">
                  Kategorie <span className="font-normal muted">(zum Filtern)</span>
                </label>
                <select
                  id="assign-category"
                  className="input"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="">Alle Kategorien</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

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
            ) : filteredMeals.length === 0 ? (
              <p className="text-sm muted">Kein Essen in dieser Kategorie.</p>
            ) : (
              <select
                id="assign-meal"
                className="input"
                value={mealId}
                onChange={(e) => setMealId(e.target.value)}
              >
                {filteredMeals.map((meal) => (
                  <option key={meal.id} value={meal.id}>
                    {meal.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
