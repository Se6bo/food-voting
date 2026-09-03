import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { useToast } from "../lib/toast";

interface NavItem {
  to: string;
  label: string;
  icon: JSX.Element;
  adminOnly?: boolean;
}

const icon = (path: string) => (
  <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
);

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: icon("M3 12l9-9 9 9M5 10v10h14V10") },
  { to: "/essensplan", label: "Essensplan", icon: icon("M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z") },
  { to: "/essen", label: "Essen", icon: icon("M7 2v9a3 3 0 006 0V2M10 2v6M17 2c-1.5 3-1.5 6-1.5 9h3V2M17 11v11") },
  { to: "/einkaufsliste", label: "Einkaufsliste", icon: icon("M9 11l2 2 4-4M6 2l1.5 4h13L19 15H8L6 2zM6 2H3M9 21a1 1 0 100-2 1 1 0 000 2zM18 21a1 1 0 100-2 1 1 0 000 2z") },
  { to: "/profil", label: "Profil", icon: icon("M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z") },
  { to: "/admin", label: "Admin", adminOnly: true, icon: icon("M12 2l8 4v6c0 5-3.4 9-8 10-4.6-1-8-5-8-10V6l8-4z") },
];

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Zum hellen Design wechseln" : "Zum dunklen Design wechseln"}
      title={theme === "dark" ? "Helles Design" : "Dunkles Design"}
      className="rounded-xl p-2.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
    >
      {theme === "dark" ? (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

export function Layout() {
  const { user, appName, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);

  // Beim Seitenwechsel das mobile Menü schließen.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  async function handleLogout() {
    await logout();
    toast.info("Du wurdest abgemeldet.");
    navigate("/login", { replace: true });
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    [
      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
      isActive
        ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
        : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
    ].join(" ");

  return (
    <div className="min-h-full">
      {/* Kopfzeile - auf allen Größen sichtbar */}
      <header className="sticky top-0 z-30 border-b border-white/40 bg-white/55 shadow-sm backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-[#0b0f14]/55">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Menü öffnen"
              aria-expanded={menuOpen}
              className="rounded-xl p-2.5 text-slate-600 transition-colors hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
              </svg>
            </button>
            <NavLink to="/" className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-lg dark:bg-brand-500" aria-hidden="true">
                🍲
              </span>
              <span className="text-base font-semibold tracking-tight">{appName}</span>
            </NavLink>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <span className="hidden text-sm muted sm:block">
              Hallo, <span className="font-medium text-slate-700 dark:text-slate-200">{user?.name}</span>
            </span>
            <ThemeToggle />
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-xl p-2.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label="Abmelden"
              title="Abmelden"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-8 px-4 py-6 sm:px-6 sm:py-8">
        {/* Sidebar ab Desktop */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-24 space-y-1" aria-label="Hauptnavigation">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === "/"} className={linkClass}>
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 animate-fade-in pb-20 lg:pb-0">
          <Outlet />
        </main>
      </div>

      {/* Mobiles Ausklappmenü */}
      {menuOpen && (
        <div className="fixed inset-0 z-20 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <nav
            aria-label="Hauptnavigation"
            className="absolute inset-x-0 top-16 animate-fade-in space-y-1 border-b border-slate-200 bg-white p-4 shadow-lg dark:border-slate-800 dark:bg-[#0b0f14]"
          >
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === "/"} className={linkClass}>
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}

      {/* Tab-Leiste auf Mobile - große Touch-Targets, immer erreichbar */}
      <nav
        aria-label="Schnellnavigation"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-white/40 bg-white/65 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur-xl backdrop-saturate-150 lg:hidden dark:border-white/10 dark:bg-[#0b0f14]/65 dark:shadow-[0_-4px_16px_rgba(0,0,0,0.35)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex">
          {items.slice(0, 4).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                [
                  "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                  isActive ? "text-brand-600 dark:text-brand-400" : "text-slate-500 dark:text-slate-400",
                ].join(" ")
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
