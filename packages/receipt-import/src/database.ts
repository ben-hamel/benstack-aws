import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@benstack-aws/db/schema";

// Common transaction API used by node-postgres in RDS/Neon TCP modes and by the
// isolated PostgreSQL/WASM test backend. No driver casts or HTTP pseudo-transactions.
export type ImportDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
export type ImportTransaction = Parameters<Parameters<ImportDatabase["transaction"]>[0]>[0];
