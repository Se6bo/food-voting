import type { ApiError } from "../../shared/types";

/**
 * Fehler mit den Feldfehlern des Servers - Formulare koennen sie direkt
 * an den passenden Eingabefeldern anzeigen.
 */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        // Markiert die Anfrage als echten fetch-Aufruf (CSRF-Schutz im Worker).
        "X-Requested-With": "fetch",
        ...init.headers,
      },
    });
  } catch {
    throw new ApiRequestError(
      "Keine Verbindung zum Server. Bitte pruefe deine Internetverbindung.",
      0,
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const error = (data ?? {}) as ApiError;
    throw new ApiRequestError(
      error.error ?? "Da ist etwas schiefgelaufen. Bitte versuche es noch einmal.",
      response.status,
      error.fields ?? {},
    );
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
