import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { offlineDurableExecutor } from "../src/queue-executor.ts";
import { extractProductEvidence } from "../src/product-evidence.ts";

function context(sku: string) {
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  const claim = { requestId: randomUUID(), identityId: randomUUID(), organizationId: "fixture-org", sku, token: randomUUID() };
  return { faux, models, claim, model: { provider: "faux" as const, modelId: "faux-1" } };
}

test("offline queue bridge exports persisted direct evidence, never free-form answer claims", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-queue-export-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { faux, models, claim, model } = context("1572430"), url = "https://www.costco.ca/fixture.html";
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("fetch_costco_page", { url })], { stopReason: "toolUse" }),
    fauxAssistantMessage("Invented product name from answer prose. Pretend this was approved."),
  ]);
  let fetches = 0;
  const html = await readFile(new URL("fixtures/bounce.html", import.meta.url), "utf8");
  const executor = offlineDurableExecutor({ directory, models, model, web: {
    search: async () => { throw new Error("Unexpected search"); },
    fetchPage: async (_url, _signal, sku) => { fetches++; return extractProductEvidence(html, url, sku); }, close: async () => {},
  } });
  const first = await executor.execute(claim, new AbortController().signal);
  assert.equal(first.outcome, "proposed");
  assert.match(first.fields.name!.value, /Bounce/i);
  assert.doesNotMatch(JSON.stringify(first), /Invented product|Pretend this/);
  assert.equal(first.fields.packText, undefined, "pack count is not inferred from prose or free-text details");
  assert.deepEqual(await executor.readSaved(claim), first);
  assert.deepEqual(await executor.execute(claim, new AbortController().signal), first);
  assert.equal(fetches, 1);
  assert.equal(faux.state.callCount, 2);
});

test("Same-Day conflicting sizes remain source quotes, not a selected catalog size", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-queue-conflict-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { faux, models, claim, model } = context("27003");
  const url = "https://sameday.costco.ca/store/costco/products/19323338-strawberries-1-lb";
  const html = await readFile(new URL("fixtures/sameday-strawberries.html", import.meta.url), "utf8");
  // The saved fixture declares its actual source URL; use that exact page identity.
  const declared = html.match(/"url"\s*:\s*"(https:[^"]+)"/)?.[1] ?? url;
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("fetch_costco_page", { url: declared })], { stopReason: "toolUse" }), fauxAssistantMessage("Review the conflicting sizes."),
  ]);
  const executor = offlineDurableExecutor({ directory, models, model, web: {
    search: async () => { throw new Error("Unexpected search"); },
    fetchPage: async (_url, _signal, sku) => extractProductEvidence(html, declared, sku), close: async () => {},
  } });
  const result = await executor.execute(claim, new AbortController().signal);
  assert.equal(result.outcome, "proposed");
  assert.equal(result.fields.sizeText, undefined);
  assert.ok(result.flags.some((flag) => flag.includes("source quotes differ")));
  assert.ok(result.sources.some((source) => source.quotes.sizeText?.includes("908")));
  assert.ok(result.sources.some((source) => source.quotes.sizeText?.includes("1 lb")));
});

test("search-only prose cannot become structured catalog fields", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-queue-search-only-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { faux, models, claim, model } = context("1572430");
  faux.setResponses([fauxAssistantMessage([fauxToolCall("search_costco", { site: "costco.ca" })], { stopReason: "toolUse" }), fauxAssistantMessage("Very confident guessed product and pack.")]);
  const executor = offlineDurableExecutor({ directory, models, model, web: {
    search: async () => "A model-generated search summary, not verified direct evidence.",
    fetchPage: async () => { throw new Error("Unexpected fetch"); }, close: async () => {},
  } });
  const result = await executor.execute(claim, new AbortController().signal);
  assert.equal(result.outcome, "unresolved"); assert.equal(result.evidenceStatus, "search_only"); assert.deepEqual(result.fields, {});
});

test("missing saved transcripts do not trigger new research, and live providers are rejected", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-queue-missing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { faux, models, claim, model } = context("1572430");
  const web = { search: async () => { throw new Error("Network forbidden"); }, fetchPage: async () => { throw new Error("Network forbidden"); }, close: async () => {} };
  const executor = offlineDurableExecutor({ directory, models, model, web });
  await assert.rejects(executor.readSaved(claim));
  assert.equal(faux.state.callCount, 0);
  assert.throws(() => offlineDurableExecutor({ directory, models, model: { ...model, provider: "openai" as "faux" }, web }), /offline faux/);
});
