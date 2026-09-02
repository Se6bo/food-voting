import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { PublicUser } from "../../shared/types";
import { ApiRequestError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDateOnly, formatTimestampShort } from "../lib/format";
import { useTheme } from "../lib/theme";
import { useToast } from "../lib/toast";
import { Alert, Button } from "../components/ui";

interface MyVote {
  id: string;
  vote: 1 | -1;
  date: string;
  mealName: string;
  updatedAt: string;
}

export function ProfilePage() {
  const { user, setUser } = useAuth();
  const { theme, toggle } = useTheme();
  const toast = useToast();

  const [name, setName] = useState(user?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [votes, setVotes] = useState<MyVote[]>([]);

  useEffect(() => {
    api
      .get<{ votes: MyVote[] }>("/votes")
      .then((data) => setVotes(data.votes))
      .catch(() => {
        // Die Stimmenhistorie ist nur ein Extra - kein Grund für eine Fehlermeldung.
      });
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFields({});
    setSaving(true);
    try {
      const result = await api.put<{ user: PublicUser }>("/auth/profile", {
        name,
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
      });
      setUser(result.user);
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Profil gespeichert.");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setFields(err.fields);
        setError(Object.keys(err.fields).length > 0 ? null : err.message);
      } else {
        setError("Das Profil konnte nicht gespeichert werden.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Profil</h1>
        <p className="mt-1 text-sm muted">Deine Daten und Einstellungen.</p>
      </header>

      <section className="card p-5 sm:p-6">
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide muted">E-Mail</dt>
            <dd className="mt-1 break-words text-sm font-medium">{user?.email}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide muted">Rolle</dt>
            <dd className="mt-1 text-sm font-medium">
              {user?.role === "admin" ? "Administrator" : "Benutzer"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide muted">Dabei seit</dt>
            <dd className="mt-1 text-sm font-medium">
              {user ? formatTimestampShort(user.createdAt) : "-"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="section-title mb-4">Darstellung</h2>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">
              {theme === "dark" ? "Dunkles Design" : "Helles Design"}
            </p>
            <p className="mt-0.5 text-sm muted">Die Auswahl wird auf diesem Gerät gespeichert.</p>
          </div>
          <Button variant="secondary" onClick={toggle}>
            {theme === "dark" ? "☀️ Hell" : "🌙 Dunkel"}
          </Button>
        </div>
      </section>

      <form onSubmit={handleSubmit} className="card space-y-5 p-5 sm:p-6" noValidate>
        <h2 className="section-title">Daten ändern</h2>
        {error && <Alert kind="error">{error}</Alert>}

        <div>
          <label className="label" htmlFor="profile-name">
            Name
          </label>
          <input
            id="profile-name"
            className="input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {fields.name && <p className="field-error">{fields.name}</p>}
        </div>

        <fieldset className="space-y-4 border-t border-slate-200 pt-5 dark:border-slate-800">
          <legend className="sr-only">Passwort ändern</legend>
          <p className="text-sm muted">
            Passwort ändern? Dann beide Felder ausfüllen - sonst einfach leer lassen.
          </p>

          <div>
            <label className="label" htmlFor="current-password">
              Aktuelles Passwort
            </label>
            <input
              id="current-password"
              type="password"
              className="input"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            {fields.currentPassword && <p className="field-error">{fields.currentPassword}</p>}
          </div>

          <div>
            <label className="label" htmlFor="new-password">
              Neues Passwort
            </label>
            <input
              id="new-password"
              type="password"
              className="input"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mindestens 8 Zeichen"
            />
            {fields.newPassword && <p className="field-error">{fields.newPassword}</p>}
          </div>
        </fieldset>

        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            Speichern
          </Button>
        </div>
      </form>

      {votes.length > 0 && (
        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <h2 className="section-title">Deine Stimmen</h2>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {votes.slice(0, 15).map((vote) => (
              <li key={vote.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{vote.mealName}</p>
                  <p className="text-xs muted">{formatDateOnly(vote.date)}</p>
                </div>
                <span aria-hidden="true" className="text-lg">
                  {vote.vote === 1 ? "👍" : "👎"}
                </span>
                <span className="sr-only">{vote.vote === 1 ? "Ja-Stimme" : "Nein-Stimme"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
