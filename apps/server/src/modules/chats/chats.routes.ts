import { toUIMessageStream } from "@ai-sdk/langchain";
import { db, and, desc, eq } from "@benstack-aws/db";
import { chats } from "@benstack-aws/db/schema/chats";
import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { Hono } from "hono";
import { authMiddleware, orgMiddleware } from "../../middleware/auth";
import type { AppEnv } from "../../types/hono";
import { checkpointer, createChatStream } from "./chats.service";

const chatsRoutes = new Hono<AppEnv>();

chatsRoutes.use("*", authMiddleware);
chatsRoutes.use("*", orgMiddleware);

chatsRoutes.get("/", async (c) => {
  const user = c.get("user");
  const orgId = c.get("orgId");

  if (!user) return c.json({ error: "Unauthorized" }, { status: 401 });
  if (!orgId) return c.json({ error: "No active organization" }, { status: 403 });

  const userChats = await db
    .select({ id: chats.id, title: chats.title, createdAt: chats.createdAt, updatedAt: chats.updatedAt })
    .from(chats)
    .where(and(eq(chats.userId, user.id), eq(chats.organizationId, orgId)))
    .orderBy(desc(chats.updatedAt));

  return c.json({ chats: userChats });
});

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

chatsRoutes.get("/:id/messages", async (c) => {
  const user = c.get("user");
  const chatId = c.req.param("id");

  if (!user) return c.json({ error: "Unauthorized" }, { status: 401 });

  const chat = await db.query.chats.findFirst({ where: eq(chats.id, chatId) });
  if (!chat) return c.json({ error: "Chat not found" }, { status: 404 });
  if (chat.userId !== user.id) return c.json({ error: "Forbidden" }, { status: 403 });

  const tuple = await checkpointer.getTuple({
    configurable: { thread_id: chat.threadId },
  });

  const raw = (tuple?.checkpoint?.channel_values?.messages ?? []) as Array<{
    _getType?: () => string;
    getType?: () => string;
    content: unknown;
  }>;

  const messages = raw
    .map((m) => {
      const type = m._getType?.() ?? m.getType?.();
      if (type !== "human" && type !== "ai") return null;
      let text: string;
      if (typeof m.content === "string") {
        text = m.content;
      } else if (Array.isArray(m.content)) {
        text = (m.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n");
      } else {
        text = "";
      }
      if (!text) return null;
      return { role: type === "human" ? "user" : "assistant", content: text };
    })
    .filter(Boolean);

  return c.json({ messages });
});

chatsRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const chatId = c.req.param("id");

  if (!user) return c.json({ error: "Unauthorized" }, { status: 401 });

  const chat = await db.query.chats.findFirst({ where: eq(chats.id, chatId) });
  if (!chat) return c.json({ error: "Chat not found" }, { status: 404 });
  if (chat.userId !== user.id) return c.json({ error: "Forbidden" }, { status: 403 });

  await Promise.all([
    db.delete(chats).where(eq(chats.id, chatId)),
    checkpointer.deleteThread(chat.threadId),
  ]);

  return c.json({ success: true });
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

  await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chatId));

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
