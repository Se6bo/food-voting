import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { IngredientInput, Meal, MealCategory, MealSlot } from "../../shared/types";
import { MEAL_SLOTS } from "../../shared/types";
import { ApiRequestError, api } from "../lib/api";
import { mealSlotLabel } from "../lib/format";
import { useToast } from "../lib/toast";
import { Alert, Button, PageLoader } from "../components/ui";

interface IngredientRow extends IngredientInput {
  /** Stabiler Key für React, unabhängig von der Position in der Liste. */
  key: string;
}

interface CookidooHit {
  id: string;
  title: string;
  image: string | null;
}

interface CookidooRecipe {
  name: string;
  description: string | null;
  image: string | null;
  ingredients: IngredientInput[];
  cookidooUrl: string;
}

const COMMON_UNITS = ["g", "kg", "ml", "l", "Stk", "TL", "EL", "Prise", "Bund", "Dose", "Packung", "Zehe"];

function emptyRow(): IngredientRow {
  return { key: crypto.randomUUID(), name: "", amount: null, unit: "" };
}

export function MealFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [rows, setRows] = useState<IngredientRow[]>([emptyRow()]);
  const [planDate, setPlanDate] = useState("");
  const [planSlot, setPlanSlot] = useState<MealSlot>("lunch");
  const [cookidooUrl, setCookidooUrl] = useState<string | null>(null);

  // Kategorie
  const [categories, setCategories] = useState<MealCategory[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  // Cookidoo-Import
  const [cookidooEnabled, setCookidooEnabled] = useState(false);
  const [cookidooQuery, setCookidooQuery] = useState("");
  const [cookidooResults, setCookidooResults] = useState<CookidooHit[]>([]);
  const [cookidooSearching, setCookidooSearching] = useState(false);
  const [cookidooImportingId, setCookidooImportingId] = useState<string | null>(null);
  const [cookidooError, setCookidooError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getOrDefault<{ enabled: boolean }>("/cookidoo/status", { enabled: false })
      .then((data) => setCookidooEnabled(data.enabled));
  }, []);

  useEffect(() => {
    api
      .getOrDefault<{ categories: MealCategory[] }>("/categories", { categories: [] })
      .then((data) => setCategories(data.categories));
  }, []);

  async function createCategory() {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    setCreatingCategory(true);
    setCategoryError(null);
    try {
      const { category } = await api.post<{ category: MealCategory }>("/categories", { name: trimmed });
      setCategories((prev) => [...prev, category].sort((a, b) => a.name.localeCompare(b.name, "de")));
      setCategoryId(category.id);
      setNewCategoryName("");
      setShowNewCategory(false);
    } catch (err) {
      setCategoryError(
        err instanceof ApiRequestError ? err.message : "Die Kategorie konnte nicht angelegt werden.",
      );
    } finally {
      setCreatingCategory(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    api
      .get<{ meal: Meal }>(`/meals/${id}`)
      .then(({ meal }) => {
        setName(meal.name);
        setDescription(meal.description ?? "");
        setImage(meal.image ?? "");
        setCookidooUrl(meal.cookidooUrl);
        setCategoryId(meal.categoryId ?? "");
        setRows(
          meal.ingredients.length > 0
            ? meal.ingredients.map((ingredient) => ({
                key: ingredient.id,
                name: ingredient.name,
                amount: ingredient.amount,
                unit: ingredient.unit ?? "",
              }))
            : [emptyRow()],
        );
      })
      .catch((err) =>
        setError(err instanceof ApiRequestError ? err.message : "Das Essen konnte nicht geladen werden."),
      )
      .finally(() => setLoading(false));
  }, [id]);

  async function runCookidooSearch() {
    const query = cookidooQuery.trim();
    if (!query) return;
    setCookidooSearching(true);
    setCookidooError(null);
    try {
      const data = await api.get<{ recipes: CookidooHit[] }>(
        `/cookidoo/search?q=${encodeURIComponent(query)}`,
      );
      setCookidooResults(data.recipes);
    } catch (err) {
      setCookidooError(
        err instanceof ApiRequestError ? err.message : "Die Cookidoo-Suche ist fehlgeschlagen.",
      );
    } finally {
      setCookidooSearching(false);
    }
  }

  async function importCookidooRecipe(hit: CookidooHit) {
    setCookidooImportingId(hit.id);
    setCookidooError(null);
    try {
      const recipe = await api.get<CookidooRecipe>(`/cookidoo/recipes/${encodeURIComponent(hit.id)}`);
      setName(recipe.name);
      setDescription(recipe.description ?? "");
      setImage(recipe.image ?? "");
      setCookidooUrl(recipe.cookidooUrl);
      setRows(
        recipe.ingredients.length > 0
          ? recipe.ingredients.map((ingredient) => ({ key: crypto.randomUUID(), ...ingredient }))
          : [emptyRow()],
      );
      toast.success(`"${recipe.name}" wurde übernommen. Bitte prüfen und dann speichern.`);
    } catch (err) {
      setCookidooError(
        err instanceof ApiRequestError ? err.message : "Das Rezept konnte nicht übernommen werden.",
      );
    } finally {
      setCookidooImportingId(null);
    }
  }

  function updateRow(key: string, patch: Partial<IngredientRow>) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: string) {
    setRows((prev) => (prev.length === 1 ? [emptyRow()] : prev.filter((row) => row.key !== key)));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFields({});
    setSaving(true);

    const ingredients = rows
      .filter((row) => row.name.trim() !== "")
      .map((row) => ({
        name: row.name.trim(),
        amount: row.amount,
        unit: row.unit?.trim() || null,
      }));

    const payload = {
      name,
      description: description || null,
      image: image || null,
      ingredients,
      cookidooUrl,
      categoryId: categoryId || null,
    };

    try {
      const result = isEdit
        ? await api.put<{ meal: Meal }>(`/meals/${id}`, payload)
        : await api.post<{ meal: Meal }>("/meals", payload);

      // Optional direkt einplanen - spart einen zweiten Arbeitsschritt.
      if (!isEdit && planDate) {
        try {
          await api.post("/planning", { date: planDate, slot: planSlot, mealId: result.meal.id });
          toast.success("Essen erfolgreich hinzugefügt und eingeplant.");
        } catch (err) {
          toast.info(
            err instanceof ApiRequestError
              ? `Essen gespeichert, aber nicht eingeplant: ${err.message}`
              : "Essen gespeichert, konnte aber nicht eingeplant werden.",
          );
        }
      } else {
        toast.success(isEdit ? "Änderungen gespeichert." : "Essen erfolgreich hinzugefügt.");
      }

      navigate("/essen");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setFields(err.fields);
        setError(Object.keys(err.fields).length > 0 ? null : err.message);
      } else {
        setError("Das Essen konnte nicht gespeichert werden.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageLoader label="Essen wird geladen ..." />;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {isEdit ? "Essen bearbeiten" : "Essen hinzufügen"}
        </h1>
        <p className="mt-1 text-sm muted">
          Die Zutaten landen automatisch in der Einkaufsliste, sobald das Essen eingeplant ist.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        {error && <Alert kind="error">{error}</Alert>}

        {cookidooEnabled && (
          <section className="card space-y-4 p-5 sm:p-6">
            <div>
              <h2 className="section-title">Aus Cookidoo importieren</h2>
              <p className="mt-1 text-sm muted">
                Rezept aus deinem Cookidoo-Account suchen und mit einem Klick als Essen übernehmen -
                du kannst danach noch alles anpassen.
              </p>
            </div>

            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="z. B. Linsensuppe"
                value={cookidooQuery}
                onChange={(e) => setCookidooQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runCookidooSearch();
                  }
                }}
                aria-label="Cookidoo durchsuchen"
              />
              <Button
                type="button"
                variant="secondary"
                loading={cookidooSearching}
                onClick={() => void runCookidooSearch()}
              >
                Suchen
              </Button>
            </div>

            {cookidooError && <Alert kind="error">{cookidooError}</Alert>}

            {cookidooResults.length > 0 && (
              <ul className="grid gap-2 sm:grid-cols-2">
                {cookidooResults.map((hit) => (
                  <li
                    key={hit.id}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5 dark:border-slate-800"
                  >
                    {hit.image ? (
                      <img
                        src={hit.image}
                        alt=""
                        loading="lazy"
                        className="h-12 w-12 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <span
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg dark:bg-slate-800"
                        aria-hidden="true"
                      >
                        🍽️
                      </span>
                    )}
                    <span className="min-w-0 flex-1 break-words text-sm font-medium">{hit.title}</span>
                    <Button
                      type="button"
                      variant="secondary"
                      loading={cookidooImportingId === hit.id}
                      onClick={() => void importCookidooRecipe(hit)}
                    >
                      Übernehmen
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Wird nur mitgeschickt, nicht direkt bearbeitet - Ursprung des Imports. */}
        <input type="hidden" name="cookidooUrl" value={cookidooUrl ?? ""} />

        <section className="card space-y-5 p-5 sm:p-6">
          <div>
            <label className="label" htmlFor="meal-name">
              Name des Essens
            </label>
            <input
              id="meal-name"
              className="input"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Spaghetti Bolognese"
            />
            {fields.name && <p className="field-error">{fields.name}</p>}
          </div>

          <div>
            <label className="label" htmlFor="meal-description">
              Beschreibung <span className="font-normal muted">(optional)</span>
            </label>
            <textarea
              id="meal-description"
              className="input min-h-[96px] resize-y"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Kurze Notiz zum Gericht, Zubereitung oder Besonderheiten."
            />
          </div>

          <div>
            <label className="label" htmlFor="meal-image">
              Bild-URL <span className="font-normal muted">(optional)</span>
            </label>
            <input
              id="meal-image"
              type="url"
              className="input"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="https://..."
            />
            {fields.image && <p className="field-error">{fields.image}</p>}
          </div>

          <div>
            <label className="label" htmlFor="meal-category">
              Kategorie <span className="font-normal muted">(optional)</span>
            </label>
            <div className="flex gap-2">
              <select
                id="meal-category"
                className="input"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Keine Kategorie</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <Button type="button" variant="secondary" onClick={() => setShowNewCategory((v) => !v)}>
                + Neu
              </Button>
            </div>
            {showNewCategory && (
              <div className="mt-2 flex gap-2">
                <input
                  className="input flex-1"
                  placeholder="Neue Kategorie"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void createCategory();
                    }
                  }}
                  aria-label="Name der neuen Kategorie"
                />
                <Button
                  type="button"
                  variant="secondary"
                  loading={creatingCategory}
                  onClick={() => void createCategory()}
                >
                  Anlegen
                </Button>
              </div>
            )}
            {categoryError && <p className="field-error mt-1.5">{categoryError}</p>}
            {fields.categoryId && <p className="field-error">{fields.categoryId}</p>}
          </div>
        </section>

        <section className="card p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="section-title">Zutaten</h2>
              <p className="mt-1 text-sm muted">Menge und Einheit sind optional (z. B. bei Salz).</p>
            </div>
          </div>

          {fields.ingredients && <p className="field-error mb-3">{fields.ingredients}</p>}

          <ul className="space-y-3">
            {rows.map((row, index) => (
              <li key={row.key} className="flex gap-2">
                <div className="w-20 shrink-0">
                  <input
                    className="input px-2.5"
                    inputMode="decimal"
                    aria-label={`Menge für Zutat ${index + 1}`}
                    placeholder="500"
                    value={row.amount === null ? "" : String(row.amount)}
                    onChange={(e) => {
                      const raw = e.target.value.replace(",", ".");
                      const parsed = raw === "" ? null : Number.parseFloat(raw);
                      updateRow(row.key, {
                        amount: parsed !== null && Number.isFinite(parsed) ? parsed : null,
                      });
                    }}
                  />
                </div>
                <div className="w-24 shrink-0">
                  <input
                    className="input px-2.5"
                    list="units"
                    aria-label={`Einheit für Zutat ${index + 1}`}
                    placeholder="g"
                    value={row.unit ?? ""}
                    onChange={(e) => updateRow(row.key, { unit: e.target.value })}
                  />
                </div>
                <input
                  className="input min-w-0 flex-1"
                  aria-label={`Name der Zutat ${index + 1}`}
                  placeholder="Hackfleisch"
                  value={row.name}
                  onChange={(e) => updateRow(row.key, { name: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  aria-label={`Zutat ${index + 1} entfernen`}
                  className="shrink-0 rounded-xl px-2.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800 dark:hover:text-red-400"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>

          <datalist id="units">
            {COMMON_UNITS.map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </datalist>

          <Button
            type="button"
            variant="secondary"
            className="mt-4"
            onClick={() => setRows((prev) => [...prev, emptyRow()])}
          >
            + Zutat hinzufügen
          </Button>
        </section>

        {!isEdit && (
          <section className="card p-5 sm:p-6">
            <label className="label" htmlFor="plan-date">
              Direkt einplanen <span className="font-normal muted">(optional)</span>
            </label>
            <input
              id="plan-date"
              type="date"
              className="input max-w-xs"
              value={planDate}
              onChange={(e) => setPlanDate(e.target.value)}
            />
            {planDate && (
              <div className="mt-3 flex flex-wrap gap-2">
                {MEAL_SLOTS.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setPlanSlot(slot)}
                    aria-pressed={planSlot === slot}
                    className={[
                      "btn min-h-[44px] whitespace-nowrap border px-3",
                      planSlot === slot
                        ? "border-brand-600 bg-brand-600 text-white hover:bg-brand-700 dark:border-brand-500 dark:bg-brand-500 dark:text-slate-950"
                        : "border-slate-300 bg-white text-slate-700 hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:bg-[#1a222c] dark:text-slate-200 dark:hover:bg-slate-800",
                    ].join(" ")}
                  >
                    {mealSlotLabel(slot)}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1.5 text-sm muted">
              Wähle einen Tag und eine Mahlzeit, dann kann die Gruppe sofort abstimmen.
            </p>
          </section>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => navigate(-1)} disabled={saving}>
            Abbrechen
          </Button>
          <Button type="submit" loading={saving}>
            {isEdit ? "Änderungen speichern" : "Essen hinzufügen"}
          </Button>
        </div>
      </form>
    </div>
  );
}
