import { env } from "@benstack-aws/env/web";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoaderCircleIcon, MessageSquareIcon, RefreshCwIcon, SendIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

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

type ChatRecord = {
  id: string;
  threadId: string;
};

function RouteComponent() {
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isCreatingChat, setIsCreatingChat] = useState(true);

  async function createChat() {
    setIsCreatingChat(true);
    setChatError(null);

    try {
      const res = await fetch(`${SERVER_URL}/api/chats`, {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error("Failed to create chat");
      }

      const data = (await res.json()) as ChatRecord;
      setChatId(data.id);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to create chat");
    } finally {
      setIsCreatingChat(false);
    }
  }

  useEffect(() => {
    void createChat();
  }, []);

  return (
    <div className="mx-auto grid h-full w-full max-w-5xl px-4 py-6">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <MessageSquareIcon className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-sm font-semibold">Receipt Chat</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Ask about spending, receipts, and purchased items.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isCreatingChat ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <LoaderCircleIcon className="mr-2 h-4 w-4 animate-spin" />
              Creating chat...
            </div>
          ) : chatError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-destructive">{chatError}</p>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                onClick={() => void createChat()}
              >
                <RefreshCwIcon className="h-4 w-4" />
                Retry
              </button>
            </div>
          ) : chatId ? (
            <ChatSession key={chatId} chatId={chatId} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Failed to initialize chat.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ChatSession({ chatId }: { chatId: string }) {
  const [draft, setDraft] = useState("");

  const { messages, sendMessage, status, error } = useChat({
    id: chatId,
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
    await sendMessage({ text });
  }

  return (
    <div className="grid h-full w-full grid-rows-[1fr_auto] gap-4">
      <div className="min-h-0 overflow-y-auto px-4 py-4">
        {error ? (
          <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message}
          </div>
        ) : null}

        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Try “How much did I spend this month?”
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div key={message.id} className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {message.role}
                </div>
                <div className="space-y-2">
                  {message.parts.map((part, index) => {
                    if (part.type === "text") {
                      return (
                        <div
                          key={`${message.id}-${index}`}
                          className="whitespace-pre-wrap rounded-md border bg-background px-3 py-2 text-sm"
                        >
                          {part.text}
                        </div>
                      );
                    }

                    return null;
                  })}
                </div>
              </div>
            ))}

            {status === "streaming" ? (
              <div className="text-sm text-muted-foreground">Assistant is responding...</div>
            ) : null}
          </div>
        )}
      </div>

      <form className="grid gap-2 px-4 pb-4" onSubmit={handleSubmit}>
        <div className="flex items-end gap-2 rounded-lg border bg-card p-3">
          <textarea
            className="min-h-24 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
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
