import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import { Layout } from "./components/Layout";
import { PageLoader } from "./components/ui";
import { useAuth } from "./lib/auth";
import { AdminPage } from "./pages/Admin";
import { DashboardPage } from "./pages/Dashboard";
import { LoginPage } from "./pages/Login";
import { MealFormPage } from "./pages/MealForm";
import { MealsPage } from "./pages/Meals";
import { PlanPage } from "./pages/Plan";
import { ProfilePage } from "./pages/Profile";
import { RegisterPage } from "./pages/Register";
import { ShoppingPage } from "./pages/Shopping";

/** Nicht angemeldet -> Login. Der Server prueft zusaetzlich jeden Endpunkt. */
function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/**
 * Admin-Routen werden hier nur ausgeblendet - die eigentliche Absicherung
 * passiert serverseitig in `requireAdmin`.
 */
function RequireAdmin({ children }: { children: ReactElement }) {
  const { user, loading, isAdmin } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}

function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="text-5xl" aria-hidden="true">🍽️</p>
      <h1 className="mt-4 text-xl font-semibold">Diese Seite gibt es nicht</h1>
      <p className="mt-2 text-sm muted">Vielleicht hilft ein Blick auf den Essensplan.</p>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/registrieren" element={<RegisterPage />} />

      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/essensplan" element={<PlanPage />} />
        <Route path="/essen" element={<MealsPage />} />
        <Route path="/essen/neu" element={<MealFormPage />} />
        <Route path="/essen/:id" element={<MealFormPage />} />
        <Route path="/einkaufsliste" element={<ShoppingPage />} />
        <Route path="/profil" element={<ProfilePage />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
