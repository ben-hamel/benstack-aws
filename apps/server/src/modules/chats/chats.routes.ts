import { toUIMessageStream } from "@ai-sdk/langchain";
import { db, eq } from "@benstack-aws/db";
import { chats } from "@benstack-aws/db/schema/chats";
import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { Hono } from "hono";
import { authMiddleware, orgMiddleware } from "../../middleware/auth";
import type { AppEnv } from "../../types/hono";
import { createChatStream } from "./chats.service";

const chatsRoutes = new Hono<AppEnv>();

chatsRoutes.use("*", authMiddleware);
chatsRoutes.use("*", orgMiddleware);

chatsRoutes.post("/", async (c) => {
  const user = c.get("user");
  const orgId = c.get("orgId");

  if (!user) return c.json({ error: "Unauthorized" }, { status: 401 });
  if (!orgId) return c.json({ error: "No active organization" }, { status: 403 });

  const [chat] = await db
    .insert(chats)
    .values({ userId: user.id, organizationId: orgId })
    .returning();

  if (!chat) return c.json({ error: "Failed to create chat" }, { status: 500 });

  return c.json({ id: chat.id, threadId: chat.threadId });
});

chatsRoutes.post("/:id/messages", async (c) => {
  const user = c.get("user");
  const orgId = c.get("orgId");
  const chatId = c.req.param("id");

  if (!user) return c.json({ error: "Unauthorized" }, { status: 401 });
  if (!orgId) return c.json({ error: "No active organization" }, { status: 403 });

  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
  });

  if (!chat) return c.json({ error: "Chat not found" }, { status: 404 });
  if (chat.userId !== user.id) return c.json({ error: "Forbidden" }, { status: 403 });

  const { messages } = await c.req.json<{ messages: UIMessage[] }>();
  const lastMessage = messages.findLast((m) => m.role === "user");
  if (!lastMessage) return c.json({ error: "No user message" }, { status: 400 });
  const text = lastMessage.parts.find((p) => p.type === "text")?.text ?? "";

  // biome-ignore lint/suspicious/noExplicitAny: LangGraph stream type varies by streamMode
  let stream: AsyncIterable<any>;
  try {
    stream = await createChatStream(user.id, orgId, chat.threadId, text);
  } catch (err) {
    console.error("[chats] createChatStream error:", err);
    return c.json({ error: "Failed to start chat stream" }, { status: 500 });
  }

  return createUIMessageStreamResponse({
    stream: toUIMessageStream(stream, {
      onError: (err) => {
        console.error("[chats] stream error:", err);
      },
    }),
  });
});

export default chatsRoutes;
