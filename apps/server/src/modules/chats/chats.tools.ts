import { db, desc, eq } from "@benstack-aws/db";
import { costcoItemCategoryMap, spendingCategories } from "@benstack-aws/db/schema/categories";
import { receiptItems, receipts } from "@benstack-aws/db/schema/receipts";
import { and, count, gte, ilike, lte, or, sql, sum } from "drizzle-orm";
import { tool, type ToolRuntime } from "langchain";
import { z } from "zod";

export const contextSchema = z.object({
  userId: z.string(),
  orgId: z.string(),
});

type ChatContext = z.infer<typeof contextSchema>;

export function buildTools() {
  const spendingSummary = tool(
    async ({ startDate, endDate }, runtime: ToolRuntime<unknown, ChatContext>) => {
      const { orgId } = runtime.context;
      const conditions = [eq(receipts.organizationId, orgId)];
      if (startDate) conditions.push(gte(receipts.transactionDate, startDate));
      if (endDate) conditions.push(lte(receipts.transactionDate, endDate));

      const [result] = await db
        .select({
          totalSpend: sum(receipts.total),
          totalSavings: sum(receipts.instantSavings),
          receiptCount: count(),
        })
        .from(receipts)
        .where(and(...conditions));

      return JSON.stringify(result ?? {});
    },
    {
      name: "get_spending_summary",
      description:
        "Get total spending, instant savings, and receipt count over an optional date range.",
      schema: z.object({
        startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
        endDate: z.string().optional().describe("End date YYYY-MM-DD"),
      }),
    },
  );

  const listCategories = tool(
    async () => {
      const categories = await db
        .select({
          id: spendingCategories.id,
          name: spendingCategories.name,
          parentId: spendingCategories.parentId,
        })
        .from(spendingCategories)
        .orderBy(spendingCategories.parentId, spendingCategories.name);

      return JSON.stringify(categories);
    },
    {
      name: "list_categories",
      description:
        "Returns all spending categories with their IDs and parent relationships. Call this first when the user asks about categories or when you need category IDs for get_items filters.",
      schema: z.object({}),
    },
  );

  const getItems = tool(
    async ({ keywords, includeCategoryIds, excludeCategoryIds, startDate, endDate, limit }, runtime: ToolRuntime<unknown, ChatContext>) => {
      const { orgId } = runtime.context;

      const conditions: ReturnType<typeof eq>[] = [
        eq(receipts.organizationId, orgId),
        eq(receiptItems.type, "item"),
      ];

      if (keywords && keywords.length > 0) {
        conditions.push(
          or(...keywords.map((kw: string) =>
            sql`word_similarity(${kw}, ${receiptItems.description}) > 0.3`,
          )) as ReturnType<typeof eq>,
        );
      }

      if (startDate) conditions.push(gte(receipts.transactionDate, startDate) as ReturnType<typeof eq>);
      if (endDate) conditions.push(lte(receipts.transactionDate, endDate) as ReturnType<typeof eq>);

      if (includeCategoryIds && includeCategoryIds.length > 0) {
        const mappedItems = await db
          .select({ itemNumber: costcoItemCategoryMap.itemNumber })
          .from(costcoItemCategoryMap)
          .where(or(...includeCategoryIds.map((id: number) => eq(costcoItemCategoryMap.categoryId, id))));
        const itemNumbers = mappedItems.map((i) => i.itemNumber);
        if (itemNumbers.length > 0) {
          conditions.push(or(...itemNumbers.map((n) => eq(receiptItems.itemNumber, n))) as ReturnType<typeof eq>);
        } else {
          return JSON.stringify([]);
        }
      }

      if (excludeCategoryIds && excludeCategoryIds.length > 0) {
        const mappedItems = await db
          .select({ itemNumber: costcoItemCategoryMap.itemNumber })
          .from(costcoItemCategoryMap)
          .where(or(...excludeCategoryIds.map((id: number) => eq(costcoItemCategoryMap.categoryId, id))));
        const itemNumbers = mappedItems.map((i) => i.itemNumber);
        if (itemNumbers.length > 0) {
          conditions.push(
            sql`(${receiptItems.itemNumber} IS NULL OR ${receiptItems.itemNumber} NOT IN (${sql.join(itemNumbers.map((n) => sql`${n}`), sql`, `)}))` as ReturnType<typeof eq>,
          );
        }
      }

      const rows = await db
        .select({
          description: receiptItems.description,
          itemNumber: receiptItems.itemNumber,
          amount: receiptItems.amount,
          quantity: receiptItems.quantity,
          date: receipts.transactionDate,
          store: receipts.storeName,
        })
        .from(receiptItems)
        .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
        .where(and(...conditions))
        .orderBy(desc(receipts.transactionDate))
        .limit(limit ?? 50);

      return JSON.stringify(rows);
    },
    {
      name: "get_items",
      description:
        "Flexible receipt line item search. Supports fuzzy keyword matching (handles Costco abbreviations like 'MATTRS' when searching 'mattress'), category include/exclude filters, and date ranges. Use list_categories first to get category IDs. Pass excludeCategoryIds with all Grocery subcategory IDs to get non-grocery items. No filters returns all items.",
      schema: z.object({
        keywords: z.array(z.string()).optional().describe("Fuzzy keywords to match against item descriptions. Handles abbreviations automatically."),
        includeCategoryIds: z.array(z.number()).optional().describe("Only return items belonging to these category IDs."),
        excludeCategoryIds: z.array(z.number()).optional().describe("Exclude items belonging to these category IDs. Items with no category mapping are always included."),
        startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
        endDate: z.string().optional().describe("End date YYYY-MM-DD"),
        limit: z.number().optional().describe("Max results, default 50"),
      }),
    },
  );

  const topItems = tool(
    async ({ startDate, endDate, by, limit }, runtime: ToolRuntime<unknown, ChatContext>) => {
      const { orgId } = runtime.context;
      const conditions = [
        eq(receipts.organizationId, orgId),
        eq(receiptItems.type, "item"),
      ];
      if (startDate) conditions.push(gte(receipts.transactionDate, startDate));
      if (endDate) conditions.push(lte(receipts.transactionDate, endDate));

      const rankBy =
        (by ?? "spend") === "frequency"
          ? desc(sql`count(*)`)
          : desc(sql`sum(${receiptItems.amount})`);

      const rows = await db
        .select({
          description: receiptItems.description,
          totalSpend: sql<string>`sum(${receiptItems.amount})`,
          timesPurchased: sql<number>`count(*)`,
        })
        .from(receiptItems)
        .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
        .where(and(...conditions))
        .groupBy(receiptItems.description)
        .orderBy(rankBy)
        .limit(limit ?? 10);

      return JSON.stringify(rows);
    },
    {
      name: "get_top_items",
      description:
        "Get top purchased items ranked by total spend or purchase frequency.",
      schema: z.object({
        startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
        endDate: z.string().optional().describe("End date YYYY-MM-DD"),
        by: z
          .enum(["spend", "frequency"])
          .optional()
          .describe("Rank by spend (default) or frequency"),
        limit: z
          .number()
          .optional()
          .describe("Number of items to return, default 10"),
      }),
    },
  );

  const getReceipts = tool(
    async ({ sortBy, sortOrder, limit, startDate, endDate }, runtime: ToolRuntime<unknown, ChatContext>) => {
      const { orgId } = runtime.context;
      const conditions = [eq(receipts.organizationId, orgId)];
      if (startDate) conditions.push(gte(receipts.transactionDate, startDate));
      if (endDate) conditions.push(lte(receipts.transactionDate, endDate));

      const orderCol = sortBy === "total" ? receipts.total : receipts.transactionDate;
      const order = sortOrder === "asc" ? orderCol : desc(orderCol);

      const rows = await db
        .select({
          id: receipts.id,
          date: receipts.transactionDate,
          store: receipts.storeName,
          city: receipts.storeCity,
          total: receipts.total,
          savings: receipts.instantSavings,
        })
        .from(receipts)
        .where(and(...conditions))
        .orderBy(order)
        .limit(limit ?? 10);

      return JSON.stringify(rows);
    },
    {
      name: "get_receipts",
      description:
        "Get receipts with flexible sorting and filtering. Use sortBy='total' desc for most expensive, sortBy='date' desc for most recent, sortBy='date' asc for earliest. Supports optional date range filtering.",
      schema: z.object({
        sortBy: z.enum(["date", "total"]).optional().describe("Sort by date (default) or total amount"),
        sortOrder: z.enum(["asc", "desc"]).optional().describe("Sort direction, default desc"),
        limit: z.number().optional().describe("Number of receipts to return, default 10"),
        startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
        endDate: z.string().optional().describe("End date YYYY-MM-DD"),
      }),
    },
  );

  const spendingByCategory = tool(
    async ({ categoryName, startDate, endDate }, runtime: ToolRuntime<unknown, ChatContext>) => {
      const { orgId } = runtime.context;

      const matchedCategories = await db
        .select({ id: spendingCategories.id, name: spendingCategories.name, parentId: spendingCategories.parentId })
        .from(spendingCategories)
        .where(ilike(spendingCategories.name, `%${categoryName}%`));

      if (matchedCategories.length === 0) {
        return JSON.stringify({ error: `No category found matching "${categoryName}"` });
      }

      const matchedIds = matchedCategories.map((c) => c.id);
      const children = await db
        .select({ id: spendingCategories.id })
        .from(spendingCategories)
        .where(or(...matchedIds.map((id) => eq(spendingCategories.parentId, id))));
      const allCategoryIds = [...new Set([...matchedIds, ...children.map((c) => c.id)])];

      const mappedItems = await db
        .select({ itemNumber: costcoItemCategoryMap.itemNumber })
        .from(costcoItemCategoryMap)
        .where(or(...allCategoryIds.map((id) => eq(costcoItemCategoryMap.categoryId, id))));

      if (mappedItems.length === 0) {
        return JSON.stringify({
          categories: matchedCategories.map((c) => c.name),
          message: "No item mappings found for this category yet.",
        });
      }

      const itemNumbers = mappedItems.map((i) => i.itemNumber);
      const conditions = [
        eq(receipts.organizationId, orgId),
        or(...itemNumbers.map((n) => eq(receiptItems.itemNumber, n))),
      ];
      if (startDate) conditions.push(gte(receipts.transactionDate, startDate));
      if (endDate) conditions.push(lte(receipts.transactionDate, endDate));

      const [summary] = await db
        .select({
          totalSpend: sum(receiptItems.amount),
          totalItems: count(),
        })
        .from(receiptItems)
        .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
        .where(and(...conditions));

      const topItems = await db
        .select({
          description: receiptItems.description,
          totalSpend: sql<string>`sum(${receiptItems.amount})`,
          timesPurchased: sql<number>`count(*)`,
        })
        .from(receiptItems)
        .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
        .where(and(...conditions))
        .groupBy(receiptItems.description)
        .orderBy(desc(sql`sum(${receiptItems.amount})`))
        .limit(10);

      return JSON.stringify({
        categories: matchedCategories.map((c) => c.name),
        totalSpend: summary?.totalSpend ?? "0",
        totalItems: summary?.totalItems ?? 0,
        topItems,
      });
    },
    {
      name: "get_spending_by_category",
      description:
        "Get spending totals and top items for a named category (e.g. 'Beverages', 'Meat & Seafood', 'Snacks', 'Electronics'). Uses Costco item number mappings so it works even when product names don't contain the category word. Prefer this over search_items for broad category questions.",
      schema: z.object({
        categoryName: z.string().describe("Category name to look up, e.g. 'Beverages', 'Grocery', 'Snacks'"),
        startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
        endDate: z.string().optional().describe("End date YYYY-MM-DD"),
      }),
    },
  );

  const spendingOverTime = tool(
    async ({ period, startDate, endDate }, runtime: ToolRuntime<unknown, ChatContext>) => {
      const { orgId } = runtime.context;
      const conditions = [eq(receipts.organizationId, orgId)];
      if (startDate) conditions.push(gte(receipts.transactionDate, startDate));
      if (endDate) conditions.push(lte(receipts.transactionDate, endDate));

      const truncExpr = {
        day: sql`date_trunc('day', ${receipts.transactionDate}::timestamp)`,
        week: sql`date_trunc('week', ${receipts.transactionDate}::timestamp)`,
        month: sql`date_trunc('month', ${receipts.transactionDate}::timestamp)`,
        year: sql`date_trunc('year', ${receipts.transactionDate}::timestamp)`,
      }[period ?? "month"];

      const rows = await db
        .select({
          period: sql<string>`${truncExpr}`,
          totalSpend: sql<string>`sum(${receipts.total})`,
          receiptCount: sql<number>`count(*)`,
        })
        .from(receipts)
        .where(and(...conditions))
        .groupBy(truncExpr)
        .orderBy(truncExpr);

      return JSON.stringify(rows);
    },
    {
      name: "get_spending_over_time",
      description:
        "Get spending totals grouped by time period (day, week, month, or year). Use for trend questions like 'how much did I spend each month this year?' or 'show me my spending over time'.",
      schema: z.object({
        period: z.enum(["day", "week", "month", "year"]).optional().describe("Time bucket size, default month"),
        startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
        endDate: z.string().optional().describe("End date YYYY-MM-DD"),
      }),
    },
  );

  const compareSpendingPeriods = tool(
    async ({ periodAStart, periodAEnd, periodBStart, periodBEnd }, runtime: ToolRuntime<unknown, ChatContext>) => {
      const { orgId } = runtime.context;

      const query = (start: string, end: string) =>
        db
          .select({
            totalSpend: sql<string>`sum(${receipts.total})`,
            totalSavings: sql<string>`sum(${receipts.instantSavings})`,
            receiptCount: sql<number>`count(*)`,
          })
          .from(receipts)
          .where(and(eq(receipts.organizationId, orgId), gte(receipts.transactionDate, start), lte(receipts.transactionDate, end)));

      const [[periodA], [periodB]] = await Promise.all([query(periodAStart, periodAEnd), query(periodBStart, periodBEnd)]);

      return JSON.stringify({
        periodA: { start: periodAStart, end: periodAEnd, ...periodA },
        periodB: { start: periodBStart, end: periodBEnd, ...periodB },
      });
    },
    {
      name: "compare_spending_periods",
      description:
        "Compare total spending between two date ranges. Use for questions like 'did I spend more this year vs last year?' or 'how does my Q1 spending compare to Q2?'",
      schema: z.object({
        periodAStart: z.string().describe("Start date of first period YYYY-MM-DD"),
        periodAEnd: z.string().describe("End date of first period YYYY-MM-DD"),
        periodBStart: z.string().describe("Start date of second period YYYY-MM-DD"),
        periodBEnd: z.string().describe("End date of second period YYYY-MM-DD"),
      }),
    },
  );

  const getMostExpensiveItems = tool(
    async ({ startDate, endDate, limit }, runtime: ToolRuntime<unknown, ChatContext>) => {
      const { orgId } = runtime.context;
      const conditions = [
        eq(receipts.organizationId, orgId),
        eq(receiptItems.type, "item"),
      ];
      if (startDate) conditions.push(gte(receipts.transactionDate, startDate));
      if (endDate) conditions.push(lte(receipts.transactionDate, endDate));

      const rows = await db
        .select({
          description: receiptItems.description,
          amount: receiptItems.amount,
          quantity: receiptItems.quantity,
          date: receipts.transactionDate,
          store: receipts.storeName,
        })
        .from(receiptItems)
        .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
        .where(and(...conditions))
        .orderBy(desc(receiptItems.amount))
        .limit(limit ?? 10);

      return JSON.stringify(rows);
    },
    {
      name: "get_most_expensive_items",
      description:
        "Get the most expensive individual line items by unit price. Use for questions like 'what's the most expensive thing I've ever bought?' or 'what were my biggest single purchases?'",
      schema: z.object({
        startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
        endDate: z.string().optional().describe("End date YYYY-MM-DD"),
        limit: z.number().optional().describe("Number of items to return, default 10"),
      }),
    },
  );

  return [spendingSummary, listCategories, getItems, spendingByCategory, topItems, getReceipts, spendingOverTime, compareSpendingPeriods, getMostExpensiveItems];
}
