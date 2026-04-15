import { db } from "@benstack-aws/db";
import * as schema from "@benstack-aws/db/schema/auth";
import { env } from "@benstack-aws/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: schema,
  }),
  trustedOrigins: [env.CORS_ORIGIN],
  emailAndPassword: {
    enabled: true,
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const [membership] = await db
            .select({ organizationId: schema.member.organizationId })
            .from(schema.member)
            .where(eq(schema.member.userId, session.userId))
            .limit(1);

          return {
            data: {
              ...session,
              activeOrganizationId: membership?.organizationId ?? null,
            },
          };
        },
      },
    },
    user: {
      create: {
        before: async (user) => {
          const allowed = env.ALLOWED_EMAILS.split(",").map((e) => e.trim().toLowerCase());
          if (!allowed.includes(user.email.toLowerCase())) {
            return false;
          }
          return { data: user };
        },
        after: async (user) => {
          const slug = `${toSlug(user.name)}-${crypto.randomUUID().slice(0, 8)}`;
          const orgId = crypto.randomUUID();

          await db.insert(schema.organization).values({
            id: orgId,
            name: `${user.name}'s org`,
            slug,
            createdAt: new Date(),
          });

          await db.insert(schema.member).values({
            id: crypto.randomUUID(),
            organizationId: orgId,
            userId: user.id,
            role: "owner",
            createdAt: new Date(),
          });
        },
      },
    },
  },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
      httpOnly: true,
    },
  },
  plugins: [organization(), admin()],
});
