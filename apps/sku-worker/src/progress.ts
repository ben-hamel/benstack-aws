import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type ConversationId, type ConversationView, type Harness, type LiveState } from "@earendil-works/pi-durable";

function toolLabel(name: string): string {
  return name === "search_costco" ? "Costco search"
    : name === "fetch_costco_page" ? "Costco page reader" : "Tool";
}

// Project views to fixed labels only. Never serialize untrusted model/page text,
// thinking, tool arguments/results, arbitrary names, or provider diagnostics.
export function createProgressReporter(initial: ConversationView, write: (message: string) => void) {
  let previous = (initial.docs["pi.live"] ?? {}) as LiveState;
  let newest = initial.entries.at(-1)?.id ?? 0;
  const started = new Set<string>();
  const finished = new Set<string>();
  const emit = (message: string) => write(`[progress] ${message}`);
  const key = (id: unknown) => String(id);
  // A late attachment must not replay completed tools in its initial view.
  for (const slot of previous.tools ?? []) {
    if (slot.taskId === undefined || slot.status === "pending") continue;
    started.add(key(slot.taskId));
    if (slot.status === "done") finished.add(key(slot.taskId));
  }
  emit(previous.run ? "Saved research is in progress." : "Saved job loaded.");

  function tool(id: string, name: string, done: boolean) {
    if (!started.has(id)) {
      started.add(id);
      emit(`${toolLabel(name)} started.`);
    }
    if (done && !finished.has(id)) {
      finished.add(id);
      emit(`${toolLabel(name)} finished.`);
    }
  }

  return (view: ConversationView) => {
    const live = (view.docs["pi.live"] ?? {}) as LiveState;
    if (live.run && !previous.run) emit("Research started.");
    if (previous.generation && (!live.generation || live.run?.taskId !== previous.run?.taskId)) emit("Model turn finished.");
    if (live.generation && (!previous.generation || live.run?.taskId !== previous.run?.taskId
      || live.generation.attempt !== previous.generation.attempt)) emit("Model turn started.");
    if (live.generation?.retry && live.generation.retry.at !== previous.generation?.retry?.at) emit("Model retry scheduled.");
    if (live.generation?.deferred && live.generation.deferred.pollAt !== previous.generation?.deferred?.pollAt) emit("Waiting for the model response.");

    // Watches may fold intermediate states. A newly appended tool-result entry
    // still establishes completion even if its live slot has already disappeared.
    for (const entry of view.entries) {
      if (entry.id <= newest || entry.kind !== "pi.tool-result") continue;
      for (const message of entry.model ?? []) {
        if (message.role === "toolResult") tool(key(entry.byTaskId ?? entry.id), message.toolName, true);
      }
    }
    newest = view.entries.at(-1)?.id ?? newest;
    for (const slot of live.tools ?? []) {
      if (slot.taskId !== undefined && slot.status !== "pending") tool(key(slot.taskId), slot.name, slot.status === "done");
    }
    if (live.runFailure && live.runFailure.taskId !== previous.runFailure?.taskId) emit("A research run failed; details withheld.");
    if (previous.run && !live.run) emit("Research run ended.");
    previous = live;
  };
}

export async function watchProgress(
  harness: Harness,
  conversationId: ConversationId,
  write: (message: string) => void,
) {
  const conversation = await harness.conversation(conversationId, BACKGROUND_CONTEXT);
  if (!conversation) throw new Error("Unknown research conversation");
  const watch = await conversation.watch(BACKGROUND_CONTEXT);
  const render = createProgressReporter(watch.value, write);
  // Attach before run()/submit(). Views are bounded state, not an event log;
  // a slow watcher may skip transient model/tool states.
  watch.start(async (call) => { if (call.kind === "value") render(call.value); });
  return { stop: () => watch.stop() };
}
