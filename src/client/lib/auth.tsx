import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { PublicUser } from "../../shared/types";
import { api } from "./api";

interface SessionInfo {
  user: PublicUser | null;
  settings: { appName: string; registrationOpen: boolean };
  today: string;
  timezone: string;
}

interface AuthContextValue {
  user: PublicUser | null;
  appName: string;
  registrationOpen: boolean;
  today: string;
  loading: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    name: string;
    email: string;
    password: string;
    passwordConfirm: string;
    groupInviteCode?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: PublicUser) => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSession(await api.get<SessionInfo>("/me"));
    } catch {
      // Ohne Sitzung ist das der Normalfall - wir zeigen dann den Login.
      setSession({
        user: null,
        settings: { appName: "Essensplan", registrationOpen: true },
        today: new Date().toISOString().slice(0, 10),
        timezone: "Europe/Berlin",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      await api.post<{ user: PublicUser }>("/auth/login", { email, password });
      await refresh();
    },
    [refresh],
  );

  const register = useCallback(
    async (data: {
      name: string;
      email: string;
      password: string;
      passwordConfirm: string;
      groupInviteCode?: string;
    }) => {
      await api.post<{ user: PublicUser }>("/auth/register", data);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      // Auch wenn der Request scheitert: lokal abmelden.
      setSession((prev) => (prev ? { ...prev, user: null } : prev));
    }
  }, []);

  const setUser = useCallback((user: PublicUser) => {
    setSession((prev) => (prev ? { ...prev, user } : prev));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      appName: session?.settings.appName ?? "Essensplan",
      registrationOpen: session?.settings.registrationOpen ?? true,
      today: session?.today ?? new Date().toISOString().slice(0, 10),
      loading,
      // Die Rolle kommt immer vom Server; das hier steuert nur die Anzeige.
      isAdmin: session?.user?.role === "admin",
      login,
      register,
      logout,
      setUser,
      refresh,
    }),
    [session, loading, login, register, logout, setUser, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth muss innerhalb von AuthProvider verwendet werden");
  return context;
}
