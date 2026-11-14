import { getToolName, isToolUIPart, type DynamicToolUIPart, type ToolUIPart, type UIMessage } from "ai";
import { BrainIcon, LoaderCircleIcon, WrenchIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Bubble, BubbleContent } from "@benstack-aws/ui/components/bubble";
import { Button } from "@benstack-aws/ui/components/button";
import { CodeBlock, CodeBlockContent } from "@benstack-aws/ui/components/code-block";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@benstack-aws/ui/components/hover-card";
import { Message, MessageContent } from "@benstack-aws/ui/components/message";
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger,
  TraceIcon, TraceLine, TraceTitle,
} from "@benstack-aws/ui/components/trace";
import { Markdown } from "./markdown";

const toolTitles: Record<string, string> = {
  get_spending_summary: "Spending Summary",
  search_items: "Search Items",
  get_top_items: "Top Items",
  get_receipts: "Receipts",
};

type ToolPart = ToolUIPart | DynamicToolUIPart;
const toolLabels: Record<ToolPart["state"], string> = {
  "input-streaming": "Preparing",
  "input-available": "Running",
  "output-available": "Ran",
  "output-error": "Failed to run",
  "output-denied": "Denied",
  "approval-requested": "Awaiting approval for",
  "approval-responded": "Responded to",
};

// One UI Message per SDK message. The app decides alignment and how its tool
// results become receipt actions; shadcn provides the presentation primitives.
export function ChatMessage({ message, streaming = false, renderReceipts }: {
  message: UIMessage;
  streaming?: boolean;
  renderReceipts: (output: unknown) => ReactNode;
}) {
  const user = message.role === "user";
  return (
    <Message align={user ? "end" : "start"}>
      <MessageContent className="gap-3 text-sm">
        {message.parts.map((part, index) => {
          if (part.type === "text") {
            const text = <Markdown isAnimating={streaming}>{part.text}</Markdown>;
            return user ? (
              <Bubble key={index} align="end" variant="muted">
                <BubbleContent className="text-sm">{text}</BubbleContent>
              </Bubble>
            ) : <div key={index}>{text}</div>;
          }
          if (isToolUIPart(part)) {
            return (
              <div key={part.toolCallId} className="space-y-2">
                <ToolActivity part={part} />
                {getToolName(part) === "get_receipts" && part.state === "output-available"
                  ? renderReceipts(part.output) : null}
              </div>
            );
          }
          if (part.type === "reasoning") {
            return <ReasoningActivity key={index} text={part.text} running={streaming && part.state === "streaming"} />;
          }
          if (part.type === "source-url") {
            return <SourceCitation key={part.sourceId} title={part.title} url={part.url} />;
          }
          return null;
        })}
      </MessageContent>
    </Message>
  );
}

function ToolActivity({ part }: { part: ToolPart }) {
  const [expanded, setExpanded] = useState<boolean>();
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error";
  const pending = part.state === "approval-requested";
  const name = getToolName(part);
  return (
    <Trace>
      <TraceCollapsible open={expanded ?? (running || failed)} onOpenChange={setExpanded}>
        <TraceCollapsibleTrigger>
          <TraceLine status={running ? "running" : failed ? "error" : pending ? "pending" : undefined}>
            <TraceIcon>{running ? <LoaderCircleIcon className="animate-spin" /> : <WrenchIcon />}</TraceIcon>
            <TraceTitle>{toolLabels[part.state]} {toolTitles[name] ?? name}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="space-y-3">
          {part.input !== undefined && (
            <div className="space-y-1">
              <h4 className="text-xs font-medium">Parameters</h4>
              <CodeBlock size="sm"><CodeBlockContent wrap>{JSON.stringify(part.input, null, 2)}</CodeBlockContent></CodeBlock>
            </div>
          )}
          {failed ? (
            <CodeBlock size="sm" variant="destructive"><CodeBlockContent wrap>{part.errorText}</CodeBlockContent></CodeBlock>
          ) : part.state === "output-available" ? (
            <div className="space-y-1">
              <h4 className="text-xs font-medium">Result</h4>
              <CodeBlock size="sm"><CodeBlockContent wrap>{typeof part.output === "string" ? part.output : JSON.stringify(part.output, null, 2) ?? "null"}</CodeBlockContent></CodeBlock>
            </div>
          ) : null}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function ReasoningActivity({ text, running }: { text: string; running: boolean }) {
  const [expanded, setExpanded] = useState<boolean>();
  return (
    <Trace>
      <TraceCollapsible open={expanded ?? running} onOpenChange={setExpanded}>
        <TraceCollapsibleTrigger>
          <TraceLine status={running ? "running" : undefined}>
            <TraceIcon><BrainIcon /></TraceIcon>
            <TraceTitle>{running ? "Thinking" : "Thought"}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent><Markdown isAnimating={running}>{text}</Markdown></TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function SourceCitation({ title, url }: { title?: string; url: string }) {
  let href: string | undefined;
  let hostname = title ?? "Source";
  try {
    const parsed = new URL(url);
    if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) {
      href = parsed.href;
      hostname = parsed.hostname;
    }
  } catch { /* Invalid sources never become active links. */ }
  if (!href) return <span className="text-xs text-muted-foreground">{title ?? url}</span>;
  return (
    <HoverCard>
      <HoverCardTrigger delay={10} closeDelay={100} render={<Button type="button" variant="secondary" size="xs" />}>
        {hostname}
      </HoverCardTrigger>
      <HoverCardContent className="flex w-64 flex-col gap-1">
        {title && <div className="font-medium">{title}</div>}
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs underline-offset-4 hover:underline">
          {hostname}<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </HoverCardContent>
    </HoverCard>
  );
}
