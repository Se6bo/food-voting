import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { ShoppingItem } from "../../shared/types";
import { ApiRequestError, api } from "../lib/api";
import { formatAmount } from "../lib/format";
import { useToast } from "../lib/toast";
import { Alert, Button, ConfirmDialog, EmptyState, PageLoader } from "../components/ui";

export function ShoppingPage() {
  const toast = useToast();
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [adding, setAdding] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ items: ShoppingItem[] }>("/shopping-list");
      setItems(data.items);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Die Einkaufsliste konnte nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { open, done } = useMemo(
    () => ({
      open: items.filter((item) => !item.checked),
      done: items.filter((item) => item.checked),
    }),
    [items],
  );

  async function toggle(item: ShoppingItem) {
    const next = !item.checked;
    // Optimistisch umschalten - fühlt sich beim Einkaufen deutlich besser an.
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: next } : i)));
    try {
      await api.put(`/shopping-list/${item.id}`, { checked: next });
    } catch (err) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: item.checked } : i)));
      toast.error(
        err instanceof ApiRequestError ? err.message : "Die Änderung konnte nicht gespeichert werden.",
      );
    }
  }

  async function removeItem(item: ShoppingItem) {
    const snapshot = items;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await api.delete(`/shopping-list/${item.id}`);
    } catch (err) {
      setItems(snapshot);
      toast.error(err instanceof ApiRequestError ? err.message : "Der Artikel konnte nicht entfernt werden.");
    }
  }

  async function addItem(event: FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const parsed = newAmount.replace(",", ".");
      const { item } = await api.post<{ item: ShoppingItem }>("/shopping-list", {
        name: newName.trim(),
        amount: parsed === "" ? null : Number.parseFloat(parsed),
        unit: newUnit.trim() || null,
      });
      setItems((prev) => [...prev, item]);
      setNewName("");
      setNewAmount("");
      setNewUnit("");
      toast.success("Artikel hinzugefügt.");
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Der Artikel konnte nicht hinzugefügt werden.");
    } finally {
      setAdding(false);
    }
  }

  async function clearChecked() {
    setClearBusy(true);
    try {
      await api.post("/shopping-list/clear-checked");
      setItems((prev) => prev.filter((item) => !item.checked));
      toast.success("Erledigte Artikel wurden entfernt.");
      setClearOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Die Artikel konnten nicht entfernt werden.");
    } finally {
      setClearBusy(false);
    }
  }

  async function resetList() {
    try {
      await api.post("/shopping-list/reset");
      await load();
      toast.success("Die Liste wurde neu aus dem Essensplan aufgebaut.");
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Die Liste konnte nicht neu aufgebaut werden.");
    }
  }

  if (loading) return <PageLoader label="Einkaufsliste wird geladen ..." />;

  function renderItem(item: ShoppingItem) {
    return (
      <li key={item.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={item.checked}
            onChange={() => toggle(item)}
            className="h-5 w-5 shrink-0 cursor-pointer rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
          />
          <span className="min-w-0">
            <span
              className={[
                "block break-words text-sm",
                item.checked ? "text-slate-400 line-through dark:text-slate-500" : "font-medium",
              ].join(" ")}
            >
              {item.amount !== null || item.unit ? (
                <span className="tabular-nums">{formatAmount(item.amount, item.unit)} </span>
              ) : null}
              {item.name}
            </span>
            {item.sources.length > 0 && (
              <span className="mt-0.5 block text-xs muted">Für: {item.sources.join(", ")}</span>
            )}
            {item.isManual && <span className="mt-0.5 block text-xs muted">Manuell hinzugefügt</span>}
          </span>
        </label>
        <button
          type="button"
          onClick={() => removeItem(item)}
          aria-label={`${item.name} entfernen`}
          className="shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800 dark:hover:text-red-400"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </li>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Einkaufsliste</h1>
          <p className="mt-1 text-sm muted">
            Automatisch aus den Zutaten der geplanten Essen zusammengefasst.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={resetList}>
            Neu aufbauen
          </Button>
          {done.length > 0 && (
            <Button variant="secondary" onClick={() => setClearOpen(true)}>
              Erledigte löschen
            </Button>
          )}
        </div>
      </header>

      {error && <Alert kind="error">{error}</Alert>}

      <form onSubmit={addItem} className="card flex flex-col gap-2 p-4 sm:flex-row sm:p-5">
        <input
          className="input sm:w-20"
          inputMode="decimal"
          placeholder="Menge"
          aria-label="Menge"
          value={newAmount}
          onChange={(e) => setNewAmount(e.target.value)}
        />
        <input
          className="input sm:w-24"
          placeholder="Einheit"
          aria-label="Einheit"
          value={newUnit}
          onChange={(e) => setNewUnit(e.target.value)}
        />
        <input
          className="input flex-1"
          placeholder="Eigenen Artikel hinzufügen ..."
          aria-label="Artikel"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button type="submit" loading={adding} disabled={!newName.trim()}>
          Hinzufügen
        </Button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          icon="🛒"
          title="Die Einkaufsliste ist leer"
          description="Sobald ein Essen mit Zutaten eingeplant ist, erscheint hier automatisch die Einkaufsliste."
        />
      ) : (
        <div className="space-y-4">
          <section className="card overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3 sm:px-5 dark:border-slate-800">
              <h2 className="text-sm font-semibold">
                Noch zu kaufen <span className="muted">({open.length})</span>
              </h2>
            </div>
            {open.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm muted sm:px-5">
                Alles erledigt. 🎉
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">{open.map(renderItem)}</ul>
            )}
          </section>

          {done.length > 0 && (
            <section className="card overflow-hidden">
              <div className="border-b border-slate-200 px-4 py-3 sm:px-5 dark:border-slate-800">
                <h2 className="text-sm font-semibold">
                  Erledigt <span className="muted">({done.length})</span>
                </h2>
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">{done.map(renderItem)}</ul>
            </section>
          )}
        </div>
      )}

      <ConfirmDialog
        open={clearOpen}
        title="Erledigte löschen"
        message={`${done.length} erledigte ${done.length === 1 ? "Artikel wird" : "Artikel werden"} von der Liste entfernt. Über "Neu aufbauen" kannst du die Liste jederzeit wieder aus dem Essensplan erzeugen.`}
        confirmLabel="Entfernen"
        onConfirm={clearChecked}
        onCancel={() => setClearOpen(false)}
        busy={clearBusy}
      />
    </div>
  );
}
