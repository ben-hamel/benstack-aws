import dotenv from "dotenv";

dotenv.config({ path: "../../apps/server/.env" });

import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const db = drizzle(url);

console.log("Setting up pg_trgm extension...");
await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

console.log("Setup complete.");
process.exit(0);
