import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiRequestError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { useToast } from "../lib/toast";
import { Alert, Button, PageLoader } from "../components/ui";

export function LoginPage() {
  const { user, loading, login, appName, registrationOpen } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <PageLoader />;
  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      toast.success("Willkommen zurueck!");
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Anmeldung fehlgeschlagen. Bitte versuche es noch einmal.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col justify-center px-4 py-10 sm:px-6">
      <button
        type="button"
        onClick={toggle}
        aria-label={theme === "dark" ? "Zum hellen Design wechseln" : "Zum dunklen Design wechseln"}
        className="absolute right-4 top-4 rounded-xl p-2.5 text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        {theme === "dark" ? "☀️" : "🌙"}
      </button>

      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl shadow-card dark:bg-brand-500" aria-hidden="true">
            🍲
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Willkommen bei {appName}</h1>
          <p className="mt-2 text-sm muted">Plant gemeinsam, was auf den Tisch kommt.</p>
        </div>

        <div className="card p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {error && <Alert kind="error">{error}</Alert>}

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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="du@beispiel.de"
              />
            </div>

            <div>
              <label className="label" htmlFor="password">
                Passwort
              </label>
              <input
                id="password"
                type="password"
                className="input"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <Button type="submit" loading={submitting} className="w-full">
              Anmelden
            </Button>
          </form>
        </div>

        {registrationOpen && (
          <p className="mt-6 text-center text-sm muted">
            Noch kein Konto?{" "}
            <Link to="/registrieren" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
              Jetzt registrieren
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
