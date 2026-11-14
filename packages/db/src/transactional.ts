import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/** Interactive transactions for imports in both RDS and Neon modes. Neon accepts
 * PostgreSQL/TCP connections; its HTTP adapter cannot run callback transactions.
 * No env import here: Lambda supplies the URL obtained from its secret store.
 */
export function createTransactionalDb(connectionString: string) {
  const pool = new Pool({
    connectionString, max: 3, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000,
    application_name: "benstack-receipt-import",
  });
  pool.on("error", () => console.error("An idle receipt-import database connection failed; diagnostics withheld."));
  return drizzle(pool, { schema });
}
