import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ApiRequestError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { Alert, Button, PageLoader } from "../components/ui";

export function RegisterPage() {
  const { user, loading, register, appName } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  // Einladungscode aus der URL (?einladung=...) vorbelegen, z. B. vom
  // Gruppen-Einladungslink in src/worker/routes/groups.ts.
  const [searchParams] = useSearchParams();

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    passwordConfirm: "",
    groupInviteCode: searchParams.get("einladung") ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <PageLoader />;
  if (user) return <Navigate to="/" replace />;

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFields((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFields({});

    // Früher Hinweis noch vor dem Request - spart eine Runde.
    if (form.password !== form.passwordConfirm) {
      setFields({ passwordConfirm: "Die Passwörter stimmen nicht überein." });
      return;
    }

    setSubmitting(true);
    try {
      await register({
        name: form.name,
        email: form.email,
        password: form.password,
        passwordConfirm: form.passwordConfirm,
        groupInviteCode: form.groupInviteCode || undefined,
      });
      toast.success("Konto erstellt. Willkommen!");
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(Object.keys(err.fields).length > 0 ? null : err.message);
        setFields(err.fields);
      } else {
        setError("Registrierung fehlgeschlagen. Bitte versuche es noch einmal.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col justify-center px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl shadow-card dark:bg-brand-500" aria-hidden="true">
            🍲
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Konto erstellen</h1>
          <p className="mt-2 text-sm muted">Mach mit bei {appName}.</p>
        </div>

        <div className="card p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {error && <Alert kind="error">{error}</Alert>}

            <div>
              <label className="label" htmlFor="name">
                Name
              </label>
              <input
                id="name"
                className="input"
                autoComplete="name"
                required
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Alex"
              />
              {fields.name && <p className="field-error">{fields.name}</p>}
            </div>

            <div>
              <label className="label" htmlFor="email">
                E-Mail-Adresse
              </label>
              <input
                id="email"
                type="email"
                className="input"
                autoComplete="email"
                required
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                placeholder="du@beispiel.de"
              />
              {fields.email && <p className="field-error">{fields.email}</p>}
            </div>

            <div>
              <label className="label" htmlFor="password">
                Passwort
              </label>
              <input
                id="password"
                type="password"
                className="input"
                autoComplete="new-password"
                required
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
                placeholder="Mindestens 8 Zeichen"
              />
              {fields.password && <p className="field-error">{fields.password}</p>}
            </div>

            <div>
              <label className="label" htmlFor="passwordConfirm">
                Passwort bestätigen
              </label>
              <input
                id="passwordConfirm"
                type="password"
                className="input"
                autoComplete="new-password"
                required
                value={form.passwordConfirm}
                onChange={(e) => update("passwordConfirm", e.target.value)}
              />
              {fields.passwordConfirm && <p className="field-error">{fields.passwordConfirm}</p>}
            </div>

            {/* Optional - mit Code tritt man einer bestehenden Gruppe bei. */}
            <div>
              <label className="label" htmlFor="groupInviteCode">
                Einladungscode <span className="font-normal muted">(optional)</span>
              </label>
              <input
                id="groupInviteCode"
                className="input"
                value={form.groupInviteCode}
                onChange={(e) => update("groupInviteCode", e.target.value)}
              />
              <p className="mt-1 text-xs muted">
                Falls du einer bestehenden Gruppe beitreten möchtest. Ohne Code bekommst du automatisch eine eigene
                neue Gruppe.
              </p>
              {fields.groupInviteCode && <p className="field-error">{fields.groupInviteCode}</p>}
            </div>

            <Button type="submit" loading={submitting} className="w-full">
              Registrieren
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm muted">
          Schon ein Konto?{" "}
          <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Anmelden
          </Link>
        </p>
      </div>
    </div>
  );
}
