import { db, desc, eq } from "@benstack-aws/db";
import { costcoItemCategoryMap, spendingCategories } from "@benstack-aws/db/schema/categories";
import { receiptItems, receipts } from "@benstack-aws/db/schema/receipts";
import { env } from "@benstack-aws/env/server";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
import { ChatAnthropic } from "@langchain/anthropic";
import { and, count, gte, ilike, lte, or, sql, sum } from "drizzle-orm";
import { createAgent, tool, type ToolRuntime } from "langchain";
import { z } from "zod";

const model = new ChatAnthropic({ model: "claude-haiku-4-5-20251001" });
const titleModel = new ChatAnthropic({ model: "claude-haiku-4-5-20251001", maxTokens: 20 });

export const store = PostgresStore.fromConnString(env.DATABASE_URL, {
  schema: "langgraph",
});

export const checkpointer = PostgresSaver.fromConnString(env.DATABASE_URL, {
  schema: "langgraph",
});

export const contextSchema = z.object({
  userId: z.string(),
  orgId: z.string(),
});

type ChatContext = z.infer<typeof contextSchema>;

function buildTools() {
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

  const searchItems = tool(
    async ({ keywords, startDate, endDate, limit }, runtime: ToolRuntime<unknown, ChatContext>) => {
      const { orgId } = runtime.context;
      const keywordConditions = keywords.map((kw: string) =>
        ilike(receiptItems.description, `%${kw}%`),
      );
      const conditions = [
        eq(receipts.organizationId, orgId),
        or(...keywordConditions),
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
        .orderBy(desc(receipts.transactionDate))
        .limit(limit ?? 20);

      return JSON.stringify(rows);
    },
    {
      name: "search_items",
      description:
        "Search receipt line items by one or more description keywords (OR'd together). Think of all synonyms and related product name fragments the user might mean and pass them all. For example, for 'beverages' pass ['water', 'juice', 'soda', 'coffee', 'tea', 'drink']. Returns matching items with date, store, and amount.",
      schema: z.object({
        keywords: z
          .array(z.string())
          .describe("One or more keywords to search in item descriptions (OR'd). Include synonyms and related terms."),
        startDate: z.string().optional().describe("Start date YYYY-MM-DD"),
        endDate: z.string().optional().describe("End date YYYY-MM-DD"),
        limit: z.number().optional().describe("Max results, default 20"),
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

  const recentReceipts = tool(
    async ({ limit }, runtime: ToolRuntime<unknown, ChatContext>) => {
      const { orgId } = runtime.context;
      const rows = await db
        .select({
          date: receipts.transactionDate,
          store: receipts.storeName,
          city: receipts.storeCity,
          total: receipts.total,
          savings: receipts.instantSavings,
        })
        .from(receipts)
        .where(eq(receipts.organizationId, orgId))
        .orderBy(desc(receipts.transactionDate))
        .limit(limit ?? 10);

      return JSON.stringify(rows);
    },
    {
      name: "get_recent_receipts",
      description:
        "Get the most recent receipts with date, store, city, total, and savings.",
      schema: z.object({
        limit: z
          .number()
          .optional()
          .describe("Number of receipts to return, default 10"),
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

  const firstReceipt = tool(
    async (_args, runtime: ToolRuntime<unknown, ChatContext>) => {
      const { orgId } = runtime.context;
      const [row] = await db
        .select({
          date: receipts.transactionDate,
          store: receipts.storeName,
          city: receipts.storeCity,
          total: receipts.total,
          savings: receipts.instantSavings,
        })
        .from(receipts)
        .where(eq(receipts.organizationId, orgId))
        .orderBy(receipts.transactionDate)
        .limit(1);

      return JSON.stringify(row ?? {});
    },
    {
      name: "get_first_receipt",
      description:
        "Get the earliest recorded receipt with date, store, city, total, and savings.",
      schema: z.object({}),
    },
  );

  return [spendingSummary, searchItems, spendingByCategory, topItems, recentReceipts, firstReceipt];
}

export async function createChatStream(
  userId: string,
  orgId: string,
  threadId: string,
  message: string,
  // biome-ignore lint/suspicious/noExplicitAny: LangGraph stream type varies by streamMode
): Promise<AsyncIterable<any>> {
  const today = new Date().toISOString().split("T")[0];

  const agent = createAgent({
    model,
    tools: buildTools(),
    contextSchema,
    store,
    checkpointer,
    systemPrompt: `You are a helpful assistant that answers questions about Costco receipt and purchase data.
You have access to tools that query receipts, line items, spending totals, and purchase history.
Always answer clearly and concisely. Format dollar amounts with a $ sign and 2 decimal places.
Use human-readable dates like "March 15, 2024". Never mention tool names, function calls, internal system behavior, or backend limitations to the user.
If you cannot answer from the available records, say so plainly and ask a natural follow-up only if it helps.
Today's date is ${today}.`,
  });

  return agent.stream(
    { messages: [{ role: "user", content: message }] },
    {
      streamMode: ["values", "messages"],
      context: { userId, orgId },
      configurable: { thread_id: threadId },
    },
  );
}

export async function generateChatTitle(firstMessage: string): Promise<string> {
  const result = await titleModel.invoke([
    {
      role: "user",
      content: `Generate a short title (3-6 words) for a chat that starts with this message. Return only the title — no quotes, punctuation, or explanation.

Message: ${firstMessage}`,
    },
  ]);

  const text =
    typeof result.content === "string"
      ? result.content
      : (result.content as Array<{ type: string; text?: string }>)
        .find((b) => b.type === "text")
        ?.text ?? "";

  return text.trim().slice(0, 100) || "New conversation";
}
