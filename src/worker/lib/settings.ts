import type { AppSettings } from "../../shared/types";
import type { Env } from "./env";

const DEFAULTS: AppSettings = {
  appName: "Essensplan",
  planningDaysAhead: 14,
  registrationOpen: true,
  voteDeadlineHour: 23,
};

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export async function getSettings(env: Env): Promise<AppSettings> {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all<{
    key: string;
    value: string;
  }>();
  const map = new Map(results.map((row) => [row.key, row.value]));
  return {
    appName: map.get("app_name")?.trim() || DEFAULTS.appName,
    planningDaysAhead: clampInt(map.get("planning_days_ahead"), DEFAULTS.planningDaysAhead, 1, 60),
    registrationOpen: (map.get("registration_open") ?? "true") === "true",
    voteDeadlineHour: clampInt(map.get("vote_deadline_hour"), DEFAULTS.voteDeadlineHour, 0, 23),
  };
}

export async function updateSettings(env: Env, patch: Partial<AppSettings>): Promise<void> {
  const entries: Array<[string, string]> = [];
  if (patch.appName !== undefined) entries.push(["app_name", patch.appName]);
  if (patch.planningDaysAhead !== undefined)
    entries.push(["planning_days_ahead", String(patch.planningDaysAhead)]);
  if (patch.registrationOpen !== undefined)
    entries.push(["registration_open", patch.registrationOpen ? "true" : "false"]);
  if (patch.voteDeadlineHour !== undefined)
    entries.push(["vote_deadline_hour", String(patch.voteDeadlineHour)]);
  if (entries.length === 0) return;

  await env.DB.batch(
    entries.map(([key, value]) =>
      env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      ).bind(key, value),
    ),
  );
}
