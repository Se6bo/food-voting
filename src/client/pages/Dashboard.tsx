import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PlannedDay } from "../../shared/types";
import { ApiRequestError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { PlannedDayCard } from "../components/PlannedDayCard";
import { Alert, EmptyState, PageLoader } from "../components/ui";

interface PlanningResponse {
  days: PlannedDay[];
  today: string;
}

export function DashboardPage() {
  const { user } = useAuth();
  const [days, setDays] = useState<PlannedDay[]>([]);
  const [today, setToday] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<PlanningResponse>("/planning");
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handleDayChange(updated: PlannedDay) {
    setDays((prev) => prev.map((day) => (day.id === updated.id ? updated : day)));
  }

  if (loading) return <PageLoader label="Essensplan wird geladen ..." />;

  const upcoming = days.filter((day) => !day.isPast);
  // Offene Tage zählen, an denen es mindestens einen Vorschlag gibt, bei dem
  // der Benutzer noch nicht abgestimmt hat.
  const openVotes = upcoming.filter(
    (day) => day.votingOpen && day.proposals.some((proposal) => proposal.myVote === null),
  ).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hallo {user?.name?.split(" ")[0]} 👋
        </h1>
        <p className="mt-1 text-sm muted">
          {openVotes > 0
            ? `Du kannst noch für ${openVotes} ${openVotes === 1 ? "Tag" : "Tage"} abstimmen.`
            : upcoming.length > 0
              ? "Du hast für alle offenen Tage abgestimmt. Guten Appetit!"
              : "Noch nichts geplant - leg gleich los."}
        </p>
      </header>

      {error && <Alert kind="error">{error}</Alert>}

      {upcoming.length === 0 ? (
        <EmptyState
          title="Noch kein Essen geplant"
          description="Lege ein Essen an und ordne es einem Tag zu - danach kann die Gruppe abstimmen."
          action={
            <Link to="/essen/neu" className="btn-primary">
              Essen hinzufügen
            </Link>
          }
        />
      ) : (
        <>
          <section aria-labelledby="plan-heading" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 id="plan-heading" className="section-title">
                Kommende Tage
              </h2>
              <Link
                to="/essensplan"
                className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                Alle ansehen
              </Link>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {upcoming.slice(0, 6).map((day) => (
                <PlannedDayCard key={day.id} day={day} today={today} onChange={handleDayChange} manageVoting={false} />
              ))}
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-3">
            <Link to="/essen/neu" className="card group p-5 transition-shadow hover:shadow-card-hover">
              <span className="text-2xl" aria-hidden="true">➕</span>
              <h3 className="mt-2 font-semibold">Essen hinzufügen</h3>
              <p className="mt-1 text-sm muted">Neues Gericht mit Zutaten anlegen.</p>
            </Link>
            <Link to="/essensplan" className="card group p-5 transition-shadow hover:shadow-card-hover">
              <span className="text-2xl" aria-hidden="true">📅</span>
              <h3 className="mt-2 font-semibold">Essensplan</h3>
              <p className="mt-1 text-sm muted">Alle geplanten Tage im Überblick.</p>
            </Link>
            <Link to="/einkaufsliste" className="card group p-5 transition-shadow hover:shadow-card-hover">
              <span className="text-2xl" aria-hidden="true">🛒</span>
              <h3 className="mt-2 font-semibold">Einkaufsliste</h3>
              <p className="mt-1 text-sm muted">Automatisch aus dem Plan erzeugt.</p>
            </Link>
          </section>
        </>
      )}
    </div>
  );
}
