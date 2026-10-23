import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { AgentEvent } from "@earendil-works/pi-durable";
import { progressMessage, watchProgress } from "../src/progress.ts";
import { openJob } from "../src/worker.ts";

const secret = "untrusted-text-token-DO-NOT-PRINT";

test("progress uses fixed labels and never prints event payloads or diagnostics", () => {
  const events = [
    { type: "tool_execution_start", toolName: secret, args: { url: secret } },
    { type: "tool_execution_end", toolName: "fetch_costco_page", result: { isError: true, details: secret } },
    { type: "task_failed", message: secret },
    { type: "auto_retry_start", errorMessage: secret },
    { type: "message_update", changes: [{ type: "thinking_delta", delta: secret }] },
    { type: "message_start", message: { content: secret } },
    { type: "tool_execution_update", output: { append: secret } },
  ] as unknown as AgentEvent[];
  const messages = events.map(progressMessage).filter((message) => message !== undefined);
  assert.deepEqual(messages, [
    "Tool started.", "Costco page reader finished.",
    "A research task failed; details withheld.", "Model retry scheduled.",
  ]);
  assert.doesNotMatch(messages.join("\n"), new RegExp(secret));
});

test("committed progress covers tool execution, detaches, and does not replay a completed job", { timeout: 5_000 }, async (t) => {
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
    assert.ok(messages.includes("[progress] Costco search started."));
    assert.ok(messages.includes("[progress] Costco search finished."));
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
