import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { ConversationView } from "@earendil-works/pi-durable";
import { createProgressReporter, watchProgress } from "../src/progress.ts";
import { openJob } from "../src/worker.ts";

const secret = "untrusted-text-token-DO-NOT-PRINT";

test("progress projects fixed labels from views, folds completions, and suppresses payloads", () => {
  const view = (live: object, entries: object[] = []) => ({ docs: { "pi.live": live }, entries }) as unknown as ConversationView;
  const messages: string[] = [];
  const render = createProgressReporter(view({}), (message) => messages.push(message));
  render(view({ run: { taskId: 1 }, generation: { attempt: 0, message: { content: secret }, retry: { at: 1, error: secret } },
    tools: [{ taskId: 2, name: secret, status: "running", output: secret, details: secret }] }));
  const completed = view({ runFailure: { taskId: 1, detail: secret } }, [
    { id: 3, kind: "pi.tool-result", byTaskId: 2, model: [{ role: "toolResult", toolName: secret, content: secret }] },
    { id: 4, kind: "pi.tool-result", byTaskId: 5, model: [{ role: "toolResult", toolName: "fetch_costco_page", content: secret }] },
  ]);
  render(completed);
  const count = messages.length;
  render(completed);
  assert.equal(messages.length, count, "unchanged views must not repeat status");
  assert.deepEqual(messages, [
    "[progress] Saved job loaded.", "[progress] Research started.", "[progress] Model turn started.",
    "[progress] Model retry scheduled.", "[progress] Tool started.", "[progress] Model turn finished.",
    "[progress] Tool finished.", "[progress] Costco page reader started.", "[progress] Costco page reader finished.",
    "[progress] A research run failed; details withheld.", "[progress] Research run ended.",
  ]);
  assert.doesNotMatch(messages.join("\n"), new RegExp(secret));
});

test("conversation-view progress covers tool execution, detaches, and does not replay a completed job", { timeout: 5_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-progress-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("search_costco", { site: "costco.ca" })], { stopReason: "toolUse" }),
    fauxAssistantMessage("Proposed match for review."),
  ]);
  let searches = 0;
  const web = {
    search: async () => { searches++; return secret; },
    fetchPage: async () => { throw new Error("Unexpected fetch"); },
    close: async () => undefined,
  };
  const first = await openJob({ directory, models, web, initial: { sku: "27003", model: { provider: "faux", modelId: "faux-1" } } });
  const messages: string[] = [];
  let ended!: () => void;
  const end = new Promise<void>((resolve) => { ended = resolve; });
  const progress = await watchProgress(first.harness, first.root.id, (message) => {
    messages.push(message);
    if (message === "[progress] Research run ended.") ended();
  });
  try {
    assert.equal(await first.run(), "Proposed match for review.");
    await end;
    assert.ok(messages.includes("[progress] Model turn started."));
    assert.equal(messages.filter((message) => message === "[progress] Costco search started.").length, 1);
    assert.equal(messages.filter((message) => message === "[progress] Costco search finished.").length, 1);
    assert.doesNotMatch(messages.join("\n"), /untrusted-text|Proposed match/);
    await progress.stop();
    const count = messages.length;
    await first.root.submit({ type: "write", entry: { kind: "test.note", data: secret } }, BACKGROUND_CONTEXT);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(messages.length, count, "a stopped watcher must not receive later commits");
  } finally { await progress.stop(); await first.close(); }

  const second = await openJob({ directory, models, web });
  const resumed: string[] = [];
  const observer = await watchProgress(second.harness, second.root.id, (message) => resumed.push(message));
  try {
    assert.equal(await second.run(), "Proposed match for review.");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(resumed, ["[progress] Saved job loaded."]);
    assert.equal(searches, 1);
    assert.equal(faux.state.callCount, 2);
  } finally { await observer.stop(); await second.close(); }
});
