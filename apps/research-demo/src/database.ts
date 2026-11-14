import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@benstack-aws/db/schema";
import { DEMO_ORG, DEMO_USER } from "./fixtures";

/** Always a brand-new in-memory database. No URL, path, existing DB client,
 * credential store or environment-based adapter is accepted by this constructor.
 */
export async function createDemoDatabase() {
  const client = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(client, { schema });
  async function reset() {
    await client.exec('TRUNCATE "organization", "user", product_research_daily_usage CASCADE');
    await db.insert(schema.user).values({ id: DEMO_USER, name: "Demo Owner (fictional)", email: "demo@example.invalid", emailVerified: true });
    await db.insert(schema.organization).values({ id: DEMO_ORG, name: "Disposable research demo", slug: "research-demo", createdAt: new Date() });
    await db.insert(schema.member).values({ id: "demo-membership", organizationId: DEMO_ORG, userId: DEMO_USER, role: "owner", createdAt: new Date() });
  }
  try {
    const directory = new URL("../../../packages/db/src/migrations/", import.meta.url);
    const journal = JSON.parse(await readFile(new URL("meta/_journal.json", directory), "utf8")) as { entries: { tag: string }[] };
    for (const entry of journal.entries) await client.exec(await readFile(new URL(`${entry.tag}.sql`, directory), "utf8"));
    await reset();
    return { db, reset, close: () => client.close() };
  } catch (error) { await client.close(); throw error; }
}
