import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { IngredientInput, Meal } from "../../shared/types";
import { ApiRequestError, api } from "../lib/api";
import { useToast } from "../lib/toast";
import { Alert, Button, PageLoader } from "../components/ui";

interface IngredientRow extends IngredientInput {
  /** Stabiler Key für React, unabhängig von der Position in der Liste. */
  key: string;
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

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!id) return;
    api
      .get<{ meal: Meal }>(`/meals/${id}`)
      .then(({ meal }) => {
        setName(meal.name);
        setDescription(meal.description ?? "");
        setImage(meal.image ?? "");
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
    };

    try {
      const result = isEdit
        ? await api.put<{ meal: Meal }>(`/meals/${id}`, payload)
        : await api.post<{ meal: Meal }>("/meals", payload);

      // Optional direkt einplanen - spart einen zweiten Arbeitsschritt.
      if (!isEdit && planDate) {
        try {
          await api.post("/planning", { date: planDate, mealId: result.meal.id });
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
            <p className="mt-1.5 text-sm muted">
              Wähle einen Tag, dann kann die Gruppe sofort abstimmen.
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
