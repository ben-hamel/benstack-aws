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

  const activeOrgId = session.activeOrganizationId;
  const isUserMember = eq(schema.member.userId, user.id);
  const [membership] = await db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(
      activeOrgId == null
        ? isUserMember
        : and(isUserMember, eq(schema.member.organizationId, activeOrgId)),
    )
    .limit(1);

  if (!membership) {
    return c.json({ error: "No active organization" }, { status: 403 });
  }

  c.set("orgId", membership.organizationId);
  await next();
});
