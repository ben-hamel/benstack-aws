import dotenv from "dotenv";

dotenv.config({ path: "../../apps/server/.env" });

import { drizzle } from "drizzle-orm/node-postgres";
import {
  costcoItemCategoryMap,
  spendingCategories,
} from "../src/schema/categories";
import { categoriesSeed, mappingsSeed } from "./categories";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const db = drizzle(url);

console.log("Seeding spending categories...");
await db
  .insert(spendingCategories)
  .values(categoriesSeed)
  .onConflictDoUpdate({
    target: spendingCategories.id,
    set: { name: spendingCategories.name, parentId: spendingCategories.parentId },
  });

console.log("Seeding Costco item category mappings...");
await db
  .insert(costcoItemCategoryMap)
  .values(mappingsSeed)
  .onConflictDoUpdate({
    target: costcoItemCategoryMap.itemNumber,
    set: { categoryId: costcoItemCategoryMap.categoryId },
  });

console.log("Seed complete.");
process.exit(0);
