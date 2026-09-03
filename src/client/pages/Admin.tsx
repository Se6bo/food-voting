import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import type { AdminGroup, AppSettings, Meal, MealSlot, Role } from "../../shared/types";
import { ApiRequestError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDateOnly, formatDateTime, formatTimestampShort, mealSlotLabel } from "../lib/format";
import { useToast } from "../lib/toast";
import { Alert, Button, ConfirmDialog, EmptyState, PageLoader } from "../components/ui";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  mealCount: number;
  voteCount: number;
}

interface PollProposal {
  id: string;
  mealName: string;
  createdByName: string | null;
  createdAt: string;
  votes: { yes: number; no: number; total: number; approval: number };
}

interface Poll {
  id: string;
  date: string;
  slot: MealSlot;
  groupName: string;
  adminOpen: boolean;
  open: boolean;
  closedReason: "past" | "deadline" | "admin" | null;
  deadline: string;
  proposals: PollProposal[];
  winnerProposalId: string | null;
}

interface Stats {
  users: number;
  meals: number;
  plannedDays: number;
  votes: number;
  shoppingItems: number;
}

type Tab = "overview" | "users" | "groups" | "meals" | "polls" | "settings";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Überblick" },
  { id: "users", label: "Benutzer" },
  { id: "groups", label: "Gruppen" },
  { id: "meals", label: "Essen" },
  { id: "polls", label: "Abstimmungen" },
  { id: "settings", label: "Einstellungen" },
];

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wide muted">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function UsersTab() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ users: AdminUser[] }>("/admin/users");
      setUsers(data.users);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Benutzer konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeRole(user: AdminUser, role: Role) {
    try {
      await api.put(`/admin/users/${user.id}`, { role });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role } : u)));
      toast.success(`${user.name} ist jetzt ${role === "admin" ? "Administrator" : "Benutzer"}.`);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Die Rolle konnte nicht geändert werden.");
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/admin/users/${deleting.id}`);
      setUsers((prev) => prev.filter((u) => u.id !== deleting.id));
      toast.success(`${deleting.name} wurde gelöscht.`);
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Der Benutzer konnte nicht gelöscht werden.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageLoader label="Benutzer werden geladen ..." />;

  return (
    <div className="space-y-4">
      {error && <Alert kind="error">{error}</Alert>}

      {/* Tabelle auf Desktop, Karten auf Mobile - beides aus denselben Daten. */}
      <div className="card hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide muted dark:border-slate-800">
            <tr>
              <th scope="col" className="px-5 py-3 font-medium">Name</th>
              <th scope="col" className="px-5 py-3 font-medium">E-Mail</th>
              <th scope="col" className="px-5 py-3 font-medium">Rolle</th>
              <th scope="col" className="px-5 py-3 font-medium">Erstellt am</th>
              <th scope="col" className="px-5 py-3 text-right font-medium">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-5 py-3 font-medium">
                  {user.name}
                  {user.id === me?.id && <span className="ml-2 text-xs muted">(du)</span>}
                </td>
                <td className="px-5 py-3 muted">{user.email}</td>
                <td className="px-5 py-3">
                  <select
                    className="input py-1.5 text-sm"
                    value={user.role}
                    onChange={(e) => changeRole(user, e.target.value as Role)}
                    aria-label={`Rolle von ${user.name}`}
                  >
                    <option value="user">Benutzer</option>
                    <option value="admin">Administrator</option>
                  </select>
                </td>
                <td className="px-5 py-3 muted">{formatTimestampShort(user.createdAt)}</td>
                <td className="px-5 py-3 text-right">
                  <Button
                    variant="ghost"
                    onClick={() => setDeleting(user)}
                    disabled={user.id === me?.id}
                    className="text-red-600 dark:text-red-400"
                  >
                    Löschen
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {users.map((user) => (
          <div key={user.id} className="card space-y-3 p-4">
            <div>
              <p className="font-medium">
                {user.name}
                {user.id === me?.id && <span className="ml-2 text-xs muted">(du)</span>}
              </p>
              <p className="break-words text-sm muted">{user.email}</p>
              <p className="mt-1 text-xs muted">
                Seit {formatTimestampShort(user.createdAt)} · {user.mealCount} Essen · {user.voteCount} Stimmen
              </p>
            </div>
            <div className="flex gap-2">
              <select
                className="input py-1.5 text-sm"
                value={user.role}
                onChange={(e) => changeRole(user, e.target.value as Role)}
                aria-label={`Rolle von ${user.name}`}
              >
                <option value="user">Benutzer</option>
                <option value="admin">Administrator</option>
              </select>
              <Button
                variant="secondary"
                onClick={() => setDeleting(user)}
                disabled={user.id === me?.id}
                className="text-red-600 dark:text-red-400"
              >
                Löschen
              </Button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title="Benutzer löschen"
        message={`Soll ${deleting?.name} wirklich gelöscht werden? Die angelegten Essen bleiben erhalten, Stimmen werden entfernt.`}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
        busy={busy}
      />
    </div>
  );
}

function GroupsTab() {
  const toast = useToast();
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AdminGroup | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ groups: AdminGroup[] }>("/admin/groups");
      setGroups(data.groups);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Die Gruppen konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function copyInvite(group: AdminGroup) {
    try {
      await navigator.clipboard.writeText(group.inviteUrl);
      toast.success("Einladungslink kopiert.");
    } catch {
      toast.error("Der Link konnte nicht kopiert werden.");
    }
  }

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setFields({ name: "Bitte gib einen Namen für die Gruppe ein." });
      return;
    }
    setCreating(true);
    setFields({});
    try {
      await api.post("/admin/groups", { name: trimmed });
      setName("");
      toast.success(`Gruppe "${trimmed}" wurde angelegt.`);
      // Liste neu laden, damit die neue Gruppe samt Einladungslink erscheint.
      await load();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setFields(err.fields);
        if (Object.keys(err.fields).length === 0) toast.error(err.message);
      } else {
        toast.error("Die Gruppe konnte nicht angelegt werden.");
      }
    } finally {
      setCreating(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/admin/groups/${deleting.id}`);
      setGroups((prev) => prev.filter((group) => group.id !== deleting.id));
      toast.success(`Gruppe "${deleting.name}" wurde gelöscht.`);
      setDeleting(null);
    } catch (err) {
      // z.B. 409, falls sich inzwischen doch jemand der Gruppe angeschlossen hat.
      toast.error(err instanceof ApiRequestError ? err.message : "Die Gruppe konnte nicht gelöscht werden.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageLoader label="Gruppen werden geladen ..." />;

  return (
    <div className="space-y-4">
      {error && <Alert kind="error">{error}</Alert>}

      <form onSubmit={createGroup} className="card max-w-xl space-y-4 p-5 sm:p-6">
        <h2 className="text-base font-semibold">Neue Gruppe anlegen</h2>
        <div>
          <label className="label" htmlFor="group-name">
            Name
          </label>
          <input
            id="group-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z.B. Familie Mustermann"
          />
          {fields.name && <p className="field-error">{fields.name}</p>}
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={creating}>
            Gruppe anlegen
          </Button>
        </div>
      </form>

      {groups.length === 0 ? (
        <EmptyState icon="👥" title="Noch keine Gruppen angelegt" />
      ) : (
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          {groups.map((group) => (
            <div key={group.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
              <div className="min-w-0 flex-1 basis-48">
                <p className="font-medium">{group.name}</p>
                <p className="text-sm muted">
                  {group.memberCount} {group.memberCount === 1 ? "Mitglied" : "Mitglieder"} · seit{" "}
                  {formatTimestampShort(group.createdAt)}
                </p>
              </div>
              <div className="flex min-w-0 flex-1 basis-64 items-center gap-2">
                <code
                  title={group.inviteUrl}
                  className="min-w-0 flex-1 truncate rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-sm dark:border-slate-700 dark:bg-[#1a222c] dark:text-slate-100"
                >
                  {group.inviteUrl}
                </code>
                <Button variant="secondary" onClick={() => copyInvite(group)}>
                  Kopieren
                </Button>
              </div>
              <Button
                variant="ghost"
                className="text-red-600 dark:text-red-400"
                onClick={() => setDeleting(group)}
                disabled={group.memberCount > 0}
                title={group.memberCount > 0 ? "Nur Gruppen ohne Mitglieder können gelöscht werden." : undefined}
              >
                Löschen
              </Button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Gruppe löschen"
        message={`Soll die Gruppe "${deleting?.name}" wirklich gelöscht werden?`}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
        busy={busy}
      />
    </div>
  );
}

function MealsTab() {
  const toast = useToast();
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<Meal | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ meals: Meal[] }>("/meals")
      .then((data) => setMeals(data.meals))
      .catch(() => toast.error("Die Essen konnten nicht geladen werden."))
      .finally(() => setLoading(false));
  }, [toast]);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/meals/${deleting.id}`);
      setMeals((prev) => prev.filter((meal) => meal.id !== deleting.id));
      toast.success(`"${deleting.name}" wurde gelöscht.`);
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Das Essen konnte nicht gelöscht werden.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageLoader label="Essen werden geladen ..." />;
  if (meals.length === 0) return <EmptyState title="Noch keine Essen angelegt" />;

  return (
    <>
      <div className="card divide-y divide-slate-100 dark:divide-slate-800">
        {meals.map((meal) => (
          <div key={meal.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <p className="font-medium">{meal.name}</p>
              <p className="text-sm muted">
                {meal.ingredients.length} Zutaten · von {meal.createdByName ?? "Unbekannt"}
              </p>
            </div>
            <div className="flex gap-2">
              <Link to={`/essen/${meal.id}`} className="btn-secondary">
                Bearbeiten
              </Link>
              <Button variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => setDeleting(meal)}>
                Löschen
              </Button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title="Essen löschen"
        message={`Soll "${deleting?.name}" wirklich gelöscht werden? Zugehörige Planungen und Stimmen verschwinden ebenfalls.`}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
        busy={busy}
      />
    </>
  );
}

function PollsTab() {
  const toast = useToast();
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<Poll | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ polls: Poll[] }>("/admin/votes");
      setPolls(data.polls);
    } catch (err) {
      toast.error(
        err instanceof ApiRequestError ? err.message : "Die Abstimmungen konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleOpen(poll: Poll, next: boolean) {
    setBusyId(poll.id);
    try {
      await api.put(`/admin/votes/${poll.id}`, { open: next });
      toast.success(next ? "Abstimmung wurde geöffnet." : "Abstimmung wurde geschlossen.");
      // Frisch laden - offen/geschlossen samt Grund berechnet der Server.
      await load();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : "Die Änderung war nicht möglich.");
    } finally {
      setBusyId(null);
    }
  }

  // Vorzeitiges Schließen legt sofort den Gewinner fest und lässt niemanden
  // mehr abstimmen - dafür erst nach Bestätigung ausführen. Wieder-Öffnen ist
  // unkritisch (jederzeit reversibel) und läuft weiterhin ohne Zwischenschritt.
  async function confirmClose() {
    if (!pendingClose) return;
    await toggleOpen(pendingClose, false);
    setPendingClose(null);
  }

  if (loading) return <PageLoader label="Abstimmungen werden geladen ..." />;
  if (polls.length === 0) return <EmptyState icon="🗳️" title="Es gibt noch keine Abstimmungen" />;

  return (
    <div className="space-y-3">
      {polls.map((poll) => (
        <div key={poll.id} className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">
                {formatDateOnly(poll.date)} · {mealSlotLabel(poll.slot)} · {poll.groupName}
              </p>
              <p className="mt-0.5 text-xs muted">
                {poll.open
                  ? `Offen bis ${formatDateTime(poll.deadline)} Uhr`
                  : poll.closedReason === "past"
                    ? "Tag ist vorbei"
                    : poll.closedReason === "admin"
                      ? "Von einem Admin geschlossen"
                      : "Deadline abgelaufen"}
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => (poll.adminOpen ? setPendingClose(poll) : toggleOpen(poll, true))}
              loading={busyId === poll.id}
              disabled={busyId !== null}
            >
              {poll.adminOpen ? "Schließen" : "Öffnen"}
            </Button>
          </div>

          {poll.proposals.length === 0 ? (
            <p className="mt-3 rounded-xl bg-slate-50 px-3.5 py-3 text-sm muted dark:bg-slate-800/50">
              Noch keine Vorschläge für diesen Tag.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {poll.proposals.map((proposal) => {
                const isWinner = !poll.open && poll.winnerProposalId === proposal.id;
                return (
                  <li
                    key={proposal.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="text-sm font-medium">{proposal.mealName}</span>
                      {isWinner && (
                        <span className="badge ml-2 bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                          <span aria-hidden="true">🏆</span> Gewinner
                        </span>
                      )}
                      <span className="block text-xs muted">
                        Von {proposal.createdByName ?? "Unbekannt"}
                      </span>
                    </span>
                    <span className="text-sm tabular-nums muted">
                      👍 {proposal.votes.yes} · 👎 {proposal.votes.no} · {proposal.votes.approval}%
                      Zustimmung
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}

      <ConfirmDialog
        open={pendingClose !== null}
        title="Abstimmung vorzeitig beenden?"
        message={
          pendingClose
            ? `Wenn du die Abstimmung für ${formatDateOnly(pendingClose.date)} jetzt vorzeitig beendest, steht sofort der aktuell führende Vorschlag als Gewinner fest und niemand kann mehr abstimmen.`
            : ""
        }
        confirmLabel="Abstimmung beenden"
        onConfirm={confirmClose}
        onCancel={() => setPendingClose(null)}
        busy={busyId === pendingClose?.id}
      />
    </div>
  );
}

function SettingsTab() {
  const toast = useToast();
  const { refresh } = useAuth();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .get<{ settings: AppSettings }>("/admin/settings")
      .then((data) => setSettings(data.settings))
      .catch(() => toast.error("Die Einstellungen konnten nicht geladen werden."));
  }, [toast]);

  if (!settings) return <PageLoader label="Einstellungen werden geladen ..." />;

  async function save() {
    if (!settings) return;
    setSaving(true);
    setFields({});
    try {
      const result = await api.put<{ settings: AppSettings }>("/admin/settings", settings);
      setSettings(result.settings);
      await refresh();
      toast.success("Einstellungen gespeichert.");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setFields(err.fields);
        if (Object.keys(err.fields).length === 0) toast.error(err.message);
      } else {
        toast.error("Die Einstellungen konnten nicht gespeichert werden.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card max-w-xl space-y-5 p-5 sm:p-6">
      <div>
        <label className="label" htmlFor="app-name">
          Name der App
        </label>
        <input
          id="app-name"
          className="input"
          value={settings.appName}
          onChange={(e) => setSettings({ ...settings, appName: e.target.value })}
        />
        {fields.appName && <p className="field-error">{fields.appName}</p>}
      </div>

      <div>
        <label className="label" htmlFor="days-ahead">
          Planungszeitraum in Tagen
        </label>
        <input
          id="days-ahead"
          type="number"
          min={1}
          max={60}
          className="input max-w-[10rem]"
          value={settings.planningDaysAhead}
          onChange={(e) =>
            setSettings({ ...settings, planningDaysAhead: Number.parseInt(e.target.value, 10) || 1 })
          }
        />
        <p className="mt-1.5 text-sm muted">Wie weit der Essensplan in die Zukunft reicht.</p>
        {fields.planningDaysAhead && <p className="field-error">{fields.planningDaysAhead}</p>}
      </div>

      <div>
        <label className="label" htmlFor="deadline-hour">
          Abstimmen bis (Stunde am Vorabend)
        </label>
        <input
          id="deadline-hour"
          type="number"
          min={0}
          max={23}
          className="input max-w-[10rem]"
          value={settings.voteDeadlineHour}
          onChange={(e) =>
            setSettings({ ...settings, voteDeadlineHour: Number.parseInt(e.target.value, 10) || 0 })
          }
        />
        <p className="mt-1.5 text-sm muted">
          Standard 23 - abstimmen ist dann bis {settings.voteDeadlineHour}:59 Uhr am Vorabend möglich.
        </p>
        {fields.voteDeadlineHour && <p className="field-error">{fields.voteDeadlineHour}</p>}
      </div>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
          checked={settings.registrationOpen}
          onChange={(e) => setSettings({ ...settings, registrationOpen: e.target.checked })}
        />
        <span>
          <span className="block text-sm font-medium">Registrierung offen</span>
          <span className="block text-sm muted">
            Ist das deaktiviert, können sich keine neuen Benutzer mehr anmelden.
          </span>
        </span>
      </label>

      <div className="flex justify-end">
        <Button onClick={save} loading={saving}>
          Speichern
        </Button>
      </div>
    </div>
  );
}

function OverviewTab() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api
      .get<{ stats: Stats }>("/admin/stats")
      .then((data) => setStats(data.stats))
      .catch(() => {
        // Kennzahlen sind nur ein Extra.
      });
  }, []);

  if (!stats) return <PageLoader />;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard label="Benutzer" value={stats.users} />
      <StatCard label="Essen" value={stats.meals} />
      <StatCard label="Geplante Tage" value={stats.plannedDays} />
      <StatCard label="Abgegebene Stimmen" value={stats.votes} />
      <StatCard label="Artikel auf der Liste" value={stats.shoppingItems} />
    </div>
  );
}

export function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Admin-Bereich</h1>
        <p className="mt-1 text-sm muted">Benutzer, Gruppen, Essen, Abstimmungen und Systemeinstellungen.</p>
      </header>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div
          role="tablist"
          aria-label="Admin-Bereiche"
          className="inline-flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60"
        >
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={[
                "whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                tab === item.id
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200",
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel">
        {tab === "overview" && <OverviewTab />}
        {tab === "users" && <UsersTab />}
        {tab === "groups" && <GroupsTab />}
        {tab === "meals" && <MealsTab />}
        {tab === "polls" && <PollsTab />}
        {tab === "settings" && <SettingsTab />}
      </div>
    </div>
  );
}
