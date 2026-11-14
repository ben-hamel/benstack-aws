import { auth } from "@benstack-aws/auth";
import { and, db, eq } from "@benstack-aws/db";
import * as schema from "@benstack-aws/db/schema/auth";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types/hono";

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    c.set("user", null);
    c.set("session", null);
    return c.json({ error: "Unauthorized" }, { status: 401 });
  }

  c.set("user", session.user);
  c.set("session", session.session);

  await next();
});

export const orgMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user");
  const session = c.get("session");

  if (!user || !session) {
    return c.json({ error: "Unauthorized" }, { status: 401 });
  }

  let orgId = session.activeOrganizationId ?? null;

  if (!orgId) {
    const [membership] = await db
      .select({ organizationId: schema.member.organizationId })
      .from(schema.member)
      .where(eq(schema.member.userId, user.id))
      .limit(1);
    orgId = membership?.organizationId ?? null;
  }

  if (!orgId) {
    return c.json({ error: "No active organization" }, { status: 403 });
  }

  // An active organization in the session is a selection, not proof of current
  // membership (it may be stale after removal or an organization switch).
  const [currentMembership] = await db.select({ id: schema.member.id }).from(schema.member)
    .where(and(eq(schema.member.userId, user.id), eq(schema.member.organizationId, orgId))).limit(1);
  if (!currentMembership) return c.json({ error: "No current organization membership" }, { status: 403 });

  c.set("orgId", orgId);
  await next();
});
