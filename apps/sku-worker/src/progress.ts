import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { watchEvents, type AgentEvent, type ConversationId, type Harness } from "@earendil-works/pi-durable";

// Only fixed labels reach the terminal. Events also contain untrusted page/model
// content, tool arguments, thinking, and provider diagnostics: never serialize them.
export function progressMessage(event: AgentEvent): string | undefined {
  switch (event.type) {
    case "snapshot":
      return event.run ? "Saved research is in progress." : "Saved job loaded.";
    case "run_start": return "Research started.";
    case "run_end": return "Research run ended.";
    case "turn_start": return "Model turn started.";
    case "turn_end": return "Model turn finished.";
    case "tool_execution_start":
    case "tool_execution_end": {
      const tool = event.toolName === "search_costco" ? "Costco search"
        : event.toolName === "fetch_costco_page" ? "Costco page reader" : "Tool";
      return `${tool} ${event.type === "tool_execution_start" ? "started" : "finished"}.`;
    }
    case "auto_retry_start": return "Model retry scheduled.";
    case "deferred_poll": return "Waiting for the model response.";
    case "task_failed": return "A research task failed; details withheld.";
    default: return undefined;
  }
}

export async function watchProgress(
  harness: Harness,
  conversationId: ConversationId,
  write: (message: string) => void,
) {
  const stream = await watchEvents(harness, conversationId, BACKGROUND_CONTEXT);
  const render = (event: AgentEvent) => {
    const message = progressMessage(event);
    if (message) write(`[progress] ${message}`);
  };
  // Attach before run()/submit() so no initial tool events are missed.
  render(stream.snapshot);
  stream.start(async (events) => { for (const event of events) render(event); });
  return { stop: () => stream.stop() };
}
