import { env } from "@benstack-aws/env/server";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
import { ChatAnthropic } from "@langchain/anthropic";
import { createAgent } from "langchain";
import { buildTools, contextSchema } from "./chats.tools";

const model = new ChatAnthropic({ model: "claude-sonnet-4-6" });
const titleModel = new ChatAnthropic({ model: "claude-haiku-4-5-20251001", maxTokens: 20 });

export const store = PostgresStore.fromConnString(env.DATABASE_URL, {
  schema: "langgraph",
});

export const checkpointer = PostgresSaver.fromConnString(env.DATABASE_URL, {
  schema: "langgraph",
});

export { contextSchema };

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
Today's date is ${today}.

When searching for items by keyword, Costco receipt descriptions are often abbreviated or use model numbers rather than full product names. Always expand your keyword list to cover likely variants:
- Gaming consoles: "PlayStation" → also try "PS5", "PS4", "PS3"; "Xbox" → also "XBX", "Series X"; "Nintendo Switch" → also "NSW", "SWITCH"
- Brands are often truncated: "mattress" → also "MATTRS"; "television" → also "TV", "TVSN"
- Use both the full name and the abbreviation/model number in the same keywords array so a single tool call covers all variants.
If a search returns no results, reason about alternative abbreviations or model numbers and retry before concluding the item was never purchased.`,
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
