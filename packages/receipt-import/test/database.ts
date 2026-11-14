import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { createTransactionalDb } from "@benstack-aws/db/transactional";
import * as schema from "@benstack-aws/db/schema";
import type { ImportDatabase } from "../src/database";

const journal = JSON.parse(await readFile(new URL("../../db/src/migrations/meta/_journal.json", import.meta.url), "utf8")) as { entries: { tag: string }[] };
export const migrationFiles = journal.entries.map((entry) => `${entry.tag}.sql`);
export async function migration(name: string) {
  return readFile(new URL(`../../db/src/migrations/${name}`, import.meta.url), "utf8");
}

export async function testDatabase(): Promise<{ db: ImportDatabase; exec: (query: string) => Promise<void>; close: () => Promise<void> }> {
  // Never read DATABASE_URL or app .env files. Explicit test URLs may point only
  // to a disposable local database with this name prefix; setup is destructive.
  const url = process.env.RECEIPT_IMPORT_TEST_DATABASE_URL;
  let backend: { db: ImportDatabase; exec: (query: string) => Promise<void>; close: () => Promise<void> };
  if (url) {
    const parsed = new URL(url);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !parsed.pathname.startsWith("/receipt_import_test")) {
      throw new Error("Use a disposable local receipt_import_test database only");
    }
    const database = createTransactionalDb(url);
    const pool = database.$client;
    backend = { db: database, exec: async (query) => { await pool.query(query); }, close: () => pool.end() };
    await backend.exec("DROP SCHEMA IF EXISTS reference CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  } else {
    const client = new PGlite({ extensions: { pg_trgm } });
    backend = { db: drizzlePglite(client, { schema }), exec: async (query) => { await client.exec(query); }, close: () => client.close() };
  }
  try {
    for (const name of migrationFiles) await backend.exec(await migration(name));
    return backend;
  } catch (error) { await backend.close(); throw error; }
}
