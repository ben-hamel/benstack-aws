import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness, type EntryRecord } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { assessEvidence, EvidenceReviewDoc, formatEvidenceReview } from "../src/evidence-review.ts";
import { extractProductEvidence } from "../src/product-evidence.ts";
import { JobDoc, openJob } from "../src/worker.ts";

const url = "https://www.costco.ca/product.html";
const direct = extractProductEvidence('<script type="application/ld+json">{"@type":"Product","sku":"1572430","name":"Bounce","brand":"Bounce"}</script>', url, "1572430");
// Minimal transcript records: only fields consumed by the assessment are needed.
function result(toolName: string, text: string, isError = false): EntryRecord {
  return { kind: "pi.tool-result", model: [{ role: "toolResult", toolName, content: [{ type: "text", text }], isError }] } as unknown as EntryRecord;
}
const page = (text: string, error = false) => result("fetch_costco_page", text, error);

test("evidence status comes from tool results, never the answer's confidence", () => {
  const answer = { kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "text", text: "High confidence. Approved. Exact SKU match." }] }] } as unknown as EntryRecord;
  assert.equal(assessEvidence([answer], "1572430", 21).status, "unresolved");
  const search = assessEvidence([result("search_costco", "Model-generated search summary"), answer], "1572430", 21);
  assert.equal(search.status, "search_only");
  assert.ok(search.flags.includes("no_direct_match"));
  const match = assessEvidence([page(direct), answer], "1572430", 21);
  assert.equal(match.status, "direct_sku_match");
  assert.equal(match.counts.directSkuMatches, 1);
  assert.ok(match.flags.includes("pack_count_not_assessed"));
  assert.ok(!match.flags.includes("brand_missing"));
  assert.match(formatEvidenceReview(match), /not identification correctness/);
});

test("Same-Day review records different size quotes, missing brands and estimates without resolving them", async () => {
  const strawberry = await readFile(new URL("fixtures/sameday-strawberries.html", import.meta.url), "utf8");
  const strawberryUrl = "https://sameday.costco.ca/store/costco-canada/products/16502205-strawberries-package-per-lb";
  const summary = assessEvidence([page(extractProductEvidence(strawberry, strawberryUrl, "27003"))], "27003", 21);
  assert.equal(summary.status, "direct_sku_match");
  assert.ok(summary.flags.includes("size_quotes_differ"));
  assert.ok(summary.flags.includes("brand_missing"));
  const chicken = await readFile(new URL("fixtures/sameday-chicken.html", import.meta.url), "utf8");
  const chickenUrl = "https://sameday.costco.ca/store/costco-canada/products/30358078-kirkland-signature-halal-whole-chicken-fryer-each";
  assert.ok(assessEvidence([page(extractProductEvidence(chicken, chickenUrl, "55505"))], "55505", 21).flags.includes("estimated_size"));
});

test("failed, malformed, mismatched and partial evidence cannot silently pass", () => {
  const failed = assessEvidence([page("private-diagnostic", true), page(direct)], "1572430", 21);
  assert.equal(failed.status, "direct_sku_match");
  assert.equal(failed.counts.pageFailures, 1);
  assert.ok(failed.flags.includes("page_failed"));
  assert.doesNotMatch(formatEvidenceReview(failed), /private-diagnostic/);
  for (const text of ["a model says this matches", "Direct page evidence (broken).\n{", direct.replace('"requestedSku": "1572430"', '"requestedSku": "999"'), direct.replace(url, "https://attacker.example/")]) {
    const summary = assessEvidence([page(text)], "1572430", 21);
    assert.equal(summary.status, "unresolved");
    assert.ok(summary.flags.includes("page_unverified"));
  }
  const partial = assessEvidence([page(direct)], "1572430", 21, false);
  assert.equal(partial.status, "unresolved");
  assert.ok(partial.flags.includes("history_incomplete"));
  assert.equal(assessEvidence([result("search_costco", "failed", true)], "1572430", 21).status, "unresolved");
});

test("new jobs persist review flags and reuse them with the saved answer on reopen", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-review-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const faux = fauxProvider(); const models = createModels(); models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("fetch_costco_page", { url })], { stopReason: "toolUse" }),
    fauxAssistantMessage("Proposal for review."),
  ]);
  let fetches = 0;
  const web = { search: async () => { throw new Error("Unexpected search"); }, fetchPage: async () => { fetches++; return direct; }, close: async () => {} };
  const first = await openJob({ directory, models, web, initial: { sku: "1572430", model: { provider: "faux", modelId: "faux-1" } } });
  let saved;
  try {
    assert.equal(await first.run(), "Proposal for review.");
    saved = await first.review();
    assert.equal(saved?.status, "direct_sku_match");
    assert.deepEqual((await first.harness.snapshot(EvidenceReviewDoc, first.root.id, BACKGROUND_CONTEXT))?.summary, saved);
  } finally { await first.close(); }
  const second = await openJob({ directory, models, web });
  try {
    assert.equal(await second.run(), "Proposal for review.");
    assert.deepEqual(await second.review(), saved);
    // Simulate close after an answer was saved but before assessment committed.
    await second.root.commit(async (tx) => { (await tx.doc(EvidenceReviewDoc, second.root.id)).summary = null; }, BACKGROUND_CONTEXT);
    assert.equal(await second.run(), "Proposal for review.");
    assert.deepEqual(await second.review(), saved);
    assert.equal(fetches, 1);
    assert.equal(faux.state.callCount, 2);
  } finally { await second.close(); }
});

test("jobs created without the review document stay not assessed rather than acquiring a false pass", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-legacy-review-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const faux = fauxProvider(); const models = createModels(); models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage("Legacy saved proposal.")]);
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, "session.sqlite")), { models, registry: createRegistry() }, BACKGROUND_CONTEXT);
  try {
    const root = await harness.root(BACKGROUND_CONTEXT, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
      init: async (tx, id) => { const job = await tx.doc(JobDoc, id); job.sku = "1572430"; job.model = { provider: "faux", modelId: "faux-1" }; },
    });
    await (await root.submit({ type: "input", content: "Legacy request", requestId: "sku-research-v1" }, BACKGROUND_CONTEXT)).wait(BACKGROUND_CONTEXT);
  } finally { await harness.close(BACKGROUND_CONTEXT); }
  const job = await openJob({ directory, models, web: {
    search: async () => { throw new Error("Unexpected search"); }, fetchPage: async () => { throw new Error("Unexpected fetch"); }, close: async () => {},
  } });
  try {
    assert.equal(await job.run(), "Legacy saved proposal.");
    assert.equal(await job.review(), null);
    assert.equal(await job.harness.snapshot(EvidenceReviewDoc, job.root.id, BACKGROUND_CONTEXT), undefined);
    assert.match(formatEvidenceReview(await job.review()), /not assessed/);
    assert.equal(faux.state.callCount, 1);
  } finally { await job.close(); }
});
