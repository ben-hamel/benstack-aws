import { db, desc, eq } from "@benstack-aws/db";
import { receiptItems, receipts } from "@benstack-aws/db/schema/receipts";
import { env } from "@benstack-aws/env/server";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
import { ChatAnthropic } from "@langchain/anthropic";
import { and, count, gte, ilike, lte, sql, sum } from "drizzle-orm";
import { createAgent, tool, type ToolRuntime } from "langchain";
import { z } from "zod";

const model = new ChatAnthropic({ model: "claude-haiku-4-5-20251001" });

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
    async ({ query, startDate, endDate, limit }, runtime: ToolRuntime<unknown, ChatContext>) => {
      const { orgId } = runtime.context;
      const conditions = [
        eq(receipts.organizationId, orgId),
        ilike(receiptItems.description, `%${query}%`),
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
        "Search receipt line items by description keyword. Returns matching items with date, store, and amount.",
      schema: z.object({
        query: z.string().describe("Keyword to search in item descriptions"),
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

  return [spendingSummary, searchItems, topItems, recentReceipts, firstReceipt];
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
