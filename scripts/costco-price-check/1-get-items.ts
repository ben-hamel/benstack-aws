import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, gte, isNotNull, eq } from "drizzle-orm";
import { receipts, receiptItems } from "../../packages/db/src/schema/receipts";
import { costcoItemCategoryMap } from "../../packages/db/src/schema/categories";

config({ path: "../../apps/server/.env" });

const db = drizzle(process.env.DATABASE_URL!);

export type ReceiptItem = {
  itemNumber: string;
  description: string;
  unitPrice: string;
  quantity: number;
  transactionDate: string;
  samedayProductId: string | null;
};

export async function getRecentItems(since: string): Promise<ReceiptItem[]> {
  const rows = await db
    .select({
      itemNumber: receiptItems.itemNumber,
      description: receiptItems.description,
      unitPrice: receiptItems.unitPrice,
      quantity: receiptItems.quantity,
      transactionDate: receipts.transactionDate,
      samedayProductId: costcoItemCategoryMap.samedayProductId,
    })
    .from(receiptItems)
    .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
    .leftJoin(costcoItemCategoryMap, eq(receiptItems.itemNumber, costcoItemCategoryMap.itemNumber))
    .where(
      and(
        gte(receipts.transactionDate, since),
        eq(receiptItems.type, "item"),
        isNotNull(receiptItems.itemNumber),
        isNotNull(receiptItems.unitPrice),
      )
    )
    .orderBy(receipts.transactionDate);

  return rows as ReceiptItem[];
}

// Standalone run
if (import.meta.main) {
  const items = await getRecentItems("2026-01-01");
  console.log(`Found ${items.length} items since 2026-01-01:\n`);
  console.table(items);
}
