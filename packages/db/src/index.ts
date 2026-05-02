import { env } from "@benstack-aws/env/server";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

type Schema = typeof schema;

export function createDb(): NeonHttpDatabase<Schema> {
  if (env.DATABASE_URL.includes(".neon.tech")) {
    return drizzleNeon(neon(env.DATABASE_URL), { schema });
  }
  return drizzlePg(env.DATABASE_URL, { schema }) as unknown as NeonHttpDatabase<Schema>;
}

export const db = createDb();

export { count, desc, eq } from "drizzle-orm";
