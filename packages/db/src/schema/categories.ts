import { index, integer, pgSchema, text } from "drizzle-orm/pg-core";

export const referenceSchema = pgSchema("reference");

export const spendingCategories = referenceSchema.table(
  "spending_category",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    parentId: integer("parent_id"),
  },
  (table) => [index("spending_category_parent_id_idx").on(table.parentId)],
);

export const costcoItemCategoryMap = referenceSchema.table(
  "costco_item_category_map",
  {
    itemNumber: text("item_number").primaryKey(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => spendingCategories.id),
  },
);
