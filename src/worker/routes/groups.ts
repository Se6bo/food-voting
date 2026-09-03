import { Hono } from "hono";
import type { MyGroup } from "../../shared/types";
import type { Env } from "../lib/env";
import type { AppVariables } from "../lib/auth";
import { currentUser, requireAuth, requireGroupId } from "../lib/auth";

const groups = new Hono<{ Bindings: Env; Variables: AppVariables }>();

groups.use("*", requireAuth);

/**
 * Eigene Gruppe des angemeldeten Benutzers. Der Einladungscode ist bewusst
 * nur hier (und in der Admin-Übersicht) abrufbar - er steckt nicht im
 * PublicUser, damit er nicht bei jedem API-Aufruf mitwandert.
 *
 * `inviteUrl` wird aus der Origin des Requests gebaut, damit der Link auch
 * in lokalen Testumgebungen funktioniert.
 */
groups.get("/me", async (c) => {
  const user = currentUser(c);
  const groupId = requireGroupId(user);

  const group = await c.env.DB.prepare(
    "SELECT id, name, invite_code, created_at FROM groups WHERE id = ?",
  )
    .bind(groupId)
    .first<{ id: string; name: string; invite_code: string; created_at: string }>();
  if (!group) {
    return c.json({ error: "Deine Gruppe existiert nicht mehr." }, 404);
  }

  const { results: members } = await c.env.DB.prepare(
    "SELECT id, name, email FROM users WHERE group_id = ? ORDER BY created_at ASC",
  )
    .bind(groupId)
    .all<{ id: string; name: string; email: string }>();

  const origin = new URL(c.req.url).origin;
  const result: MyGroup = {
    id: group.id,
    name: group.name,
    inviteCode: group.invite_code,
    inviteUrl: `${origin}/registrieren?einladung=${encodeURIComponent(group.invite_code)}`,
    memberCount: members.length,
    members,
  };
  return c.json({ group: result });
});

export { groups };
