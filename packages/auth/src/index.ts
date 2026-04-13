import { db } from "@benstack-aws/db";
import * as schema from "@benstack-aws/db/schema/auth";
import { env } from "@benstack-aws/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization } from "better-auth/plugins";

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
    user: {
      create: {
        before: async (user) => {
          const allowed = env.ALLOWED_EMAILS.split(",").map((e) => e.trim().toLowerCase());
          if (!allowed.includes(user.email.toLowerCase())) {
            return false;
          }
          return { data: user };
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
