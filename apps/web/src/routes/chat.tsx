import { env } from "@benstack-aws/env/web";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoaderCircleIcon, MessageSquareIcon, PlusIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@benstack-aws/ui/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@benstack-aws/ui/components/ai-elements/message";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@benstack-aws/ui/components/ai-elements/tool";

const TOOL_TITLES: Record<string, string> = {
  get_spending_summary: "Spending Summary",
  search_items:         "Search Items",
  get_top_items:        "Top Items",
  get_recent_receipts:  "Recent Receipts",
  get_first_receipt:    "First Receipt",
};

export const Route = createFileRoute("/chat")({
  component: RouteComponent,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
  },
});

const SERVER_URL = env.VITE_SERVER_URL;

type ChatRecord = { id: string; title: string | null; createdAt: string; updatedAt: string };
type MessageRecord = { role: "user" | "assistant"; content: string };

function toUIMessages(records: MessageRecord[]): UIMessage[] {
  return records.map((m) => ({
    id: crypto.randomUUID(),
    role: m.role,
    parts: [{ type: "text" as const, text: m.content }],
  }));
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, { credentials: "include", ...init });
  if (!res.ok) throw new Error(`Request failed: ${path}`);
  return res.json() as Promise<T>;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function RouteComponent() {
  const [chats, setChats] = useState<ChatRecord[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ chats: ChatRecord[] }>("/api/chats")
      .then(({ chats }) => setChats(chats))
      .catch(console.error);
  }, []);

  async function openChat(chat: ChatRecord) {
    if (chat.id === activeChatId) return;
    setLoadingMessages(true);
    setActiveChatId(chat.id);
    setInitialMessages([]);
    try {
      const { messages } = await apiFetch<{ messages: MessageRecord[] }>(
        `/api/chats/${chat.id}/messages`,
      );
      setInitialMessages(toUIMessages(messages));
    } catch {
      // show empty chat if messages fail to load
    } finally {
      setLoadingMessages(false);
    }
  }

  async function newChat() {
    setCreating(true);
    try {
      const chat = await apiFetch<ChatRecord>("/api/chats", { method: "POST" });
      setChats((prev) => [chat, ...prev]);
      setActiveChatId(chat.id);
      setInitialMessages([]);
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  }

  async function deleteChat(chat: ChatRecord) {
    if (!window.confirm(`Delete "${chat.title ?? "New conversation"}"? This cannot be undone.`)) return;
    setDeletingId(chat.id);
    try {
      await apiFetch(`/api/chats/${chat.id}`, { method: "DELETE" });
      setChats((prev) => prev.filter((c) => c.id !== chat.id));
      if (activeChatId === chat.id) {
        setActiveChatId(null);
        setInitialMessages([]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingId(null);
    }
  }

  function onMessageSent(chatId: string) {
    setChats((prev) =>
      [...prev]
        .map((c) => (c.id === chatId ? { ...c, updatedAt: new Date().toISOString() } : c))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    );
  }

  const activeChat = chats.find((c) => c.id === activeChatId);

  return (
    <div className="grid h-full grid-cols-[260px_1fr] overflow-hidden">
      {/* Sidebar */}
      <aside className="flex flex-col gap-2 overflow-hidden border-r bg-card px-2 py-3">
        <button
          type="button"
          onClick={() => void newChat()}
          disabled={creating}
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          {creating ? (
            <LoaderCircleIcon className="h-4 w-4 animate-spin" />
          ) : (
            <PlusIcon className="h-4 w-4" />
          )}
          New Chat
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {chats.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">No chats yet</p>
          ) : (
            <ul className="space-y-0.5">
              {chats.map((chat) => (
                <li key={chat.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => void openChat(chat)}
                    className={`w-full rounded-md px-3 py-2 pr-8 text-left text-sm hover:bg-accent ${
                      chat.id === activeChatId ? "bg-accent font-medium" : ""
                    }`}
                  >
                    <div className="truncate">{chat.title ?? "New conversation"}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(chat.updatedAt)}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteChat(chat)}
                    disabled={deletingId === chat.id}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 disabled:opacity-50"
                    aria-label="Delete chat"
                  >
                    {deletingId === chat.id ? (
                      <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2Icon className="h-3.5 w-3.5" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Main area */}
      <main className="flex min-h-0 flex-col overflow-hidden">
        <div className="border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <MessageSquareIcon className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-sm font-semibold">
              {activeChat?.title ?? (activeChatId ? "New conversation" : "Receipt Chat")}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Ask about spending, receipts, and purchased items.
          </p>
        </div>

        <div className="flex-1 overflow-hidden">
          {!activeChatId ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a chat or start a new one
            </div>
          ) : loadingMessages ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <LoaderCircleIcon className="mr-2 h-4 w-4 animate-spin" />
              Loading messages...
            </div>
          ) : (
            <ChatSession
              key={activeChatId}
              chatId={activeChatId}
              initialMessages={initialMessages}
              onMessageSent={onMessageSent}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function ChatSession({
  chatId,
  initialMessages,
  onMessageSent,
}: {
  chatId: string;
  initialMessages: UIMessage[];
  onMessageSent: (chatId: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const { messages, sendMessage, status, error } = useChat({
    id: chatId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: `${SERVER_URL}/api/chats/${chatId}/messages`,
      credentials: "include",
    }),
  });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || status !== "ready") return;
    setDraft("");
    onMessageSent(chatId);
    await sendMessage({ text });
  }

  return (
    <div className="grid h-full grid-rows-[1fr_auto]">
      <Conversation>
        <ConversationContent>
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error.message}
            </div>
          )}

          {messages.length === 0 ? (
            <ConversationEmptyState
              title="Ask about your receipts"
              description='Try "How much did I spend this month?"'
            />
          ) : (
            messages.map((message) => (
              <div key={message.id} className="space-y-2">
                {message.parts.map((part, index) => {
                  if (part.type === "text") {
                    return (
                      <Message key={`${message.id}-${index}`} from={message.role}>
                        <MessageContent>
                          <MessageResponse>{part.text}</MessageResponse>
                        </MessageContent>
                      </Message>
                    );
                  }

                  if (part.type === "dynamic-tool") {
                    return (
                      <Tool
                        key={`${message.id}-${index}`}
                        defaultOpen={part.state === "output-available" || part.state === "output-error"}
                      >
                        <ToolHeader
                          type="dynamic-tool"
                          state={part.state}
                          toolName={part.toolName}
                          title={TOOL_TITLES[part.toolName] ?? part.toolName}
                        />
                        <ToolContent>
                          <ToolInput input={part.input} />
                          <ToolOutput output={part.output} errorText={part.errorText} />
                        </ToolContent>
                      </Tool>
                    );
                  }

                  return null;
                })}
              </div>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <form className="border-t px-4 py-3" onSubmit={handleSubmit}>
        <div className="flex items-end gap-2 rounded-lg border bg-card p-3">
          <textarea
            className="min-h-20 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            name="message"
            placeholder="Ask about your receipts..."
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={status !== "ready"}
          />
          <button
            type="submit"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border disabled:opacity-50"
            disabled={!draft.trim() || status !== "ready"}
          >
            {status === "submitted" || status === "streaming" ? (
              <LoaderCircleIcon className="h-4 w-4 animate-spin" />
            ) : (
              <SendIcon className="h-4 w-4" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
