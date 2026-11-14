"use client";

import { Badge } from "@benstack-aws/ui/components/badge";
import { CodeBlock, CodeBlockContent } from "@benstack-aws/ui/components/code-block";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@benstack-aws/ui/components/trace";
import { cn } from "@benstack-aws/ui/lib/utils";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { CheckCircleIcon, CircleIcon, ClockIcon, WrenchIcon, XCircleIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";

// Preserve the public wrapper names while following shadcn's Trace pattern.
export type ToolProps = ComponentProps<typeof TraceCollapsible>;
export const Tool = ({ className, ...props }: ToolProps) => (
  <Trace className={cn("not-prose mb-4", className)}>
    <TraceCollapsible {...props} />
  </Trace>
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;
export type ToolHeaderProps = {
  title?: string;
  className?: string;
} & (
  | { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
  | { type: DynamicToolUIPart["type"]; state: DynamicToolUIPart["state"]; toolName: string }
);

const statusLabels: Record<ToolPart["state"], string> = {
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error",
};
const statusIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
  "approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-4" />,
  "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
  "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
  "output-error": <XCircleIcon className="size-4 text-red-600" />,
};
export const getStatusBadge = (state: ToolPart["state"]) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[state]}{statusLabels[state]}
  </Badge>
);

export const ToolHeader = ({ className, title, type, state, toolName }: ToolHeaderProps) => {
  const name = title ?? (type === "dynamic-tool" ? toolName : type.slice("tool-".length));
  const running = state === "input-streaming" || state === "input-available";
  const verb = running ? "Running" : state === "output-available" ? "Ran"
    : state === "output-error" ? "Failed to run" : state === "output-denied" ? "Denied"
    : state === "approval-requested" ? "Awaiting approval for" : "Responded to";
  return (
    <TraceCollapsibleTrigger className={className}>
      <TraceLine status={running ? "running" : state === "output-error" ? "error" : state === "approval-requested" ? "pending" : undefined}>
        <TraceIcon><WrenchIcon /></TraceIcon>
        <TraceTitle>{verb} {name}</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof TraceCollapsibleContent>;
export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <TraceCollapsibleContent className={cn("space-y-3", className)} {...props} />
);

export type ToolInputProps = ComponentProps<"div"> & { input: ToolPart["input"] };
export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2", className)} {...props}>
    <h4 className="text-xs font-medium">Parameters</h4>
    <CodeBlock size="sm"><CodeBlockContent wrap>{JSON.stringify(input, null, 2) ?? "null"}</CodeBlockContent></CodeBlock>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];
};
export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  if (output === undefined && !errorText) return null;
  const text = errorText || (isValidElement(output) ? "" : typeof output === "string" ? output : JSON.stringify(output, null, 2) ?? "null");
  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="text-xs font-medium">{errorText ? "Error" : "Result"}</h4>
      {isValidElement(output) && !errorText ? output : (
        <CodeBlock size="sm" variant={errorText ? "destructive" : "default"}>
          <CodeBlockContent wrap>{text}</CodeBlockContent>
        </CodeBlock>
      )}
    </div>
  );
};
