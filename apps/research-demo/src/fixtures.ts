import { isDeepStrictEqual } from "node:util";
import sample from "../fixtures/demo-receipts.json";
import { resultSchema, type ResearchResult } from "@benstack-aws/product-research/contracts";

export const DEMO_ORG = "research-demo-org";
export const DEMO_USER = "research-demo-owner";
export const DEMO_SESSION = "research-demo-session";
export const sampleReceipts = sample;
export const demoPolicy = {
  enabled: true, organizationIds: [DEMO_ORG], globalDailyLimit: 20, organizationDailyLimit: 20,
  globalPendingLimit: 100, organizationPendingLimit: 100,
};

export class DemoInputError extends Error {}
export function onlyFixture(input: unknown) {
  const receipts = input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === 1 && "receipts" in input ? input.receipts : input;
  if (!isDeepStrictEqual(receipts, sampleReceipts)) throw new DemoInputError("Only the bundled demo-receipts.json is accepted. Real receipt data is disabled.");
  return structuredClone(sampleReceipts);
}

export function simulatedResult(sku: string): ResearchResult {
  const name = sku === "900000000001" ? "DEMO Maple Pantry Oats" : sku === "900000000002" ? "DEMO Unscented Laundry Liquid" : null;
  if (!name) throw new Error("Unknown fixture SKU");
  const sizeText = sku === "900000000001" ? "DEMO 1 kg" : "DEMO 2 L";
  const at = new Date().toISOString();
  return resultSchema.parse({ schemaVersion: 1, sku, merchant: "costco", market: "CA", outcome: "proposed", answerId: 1,
    model: "offline/static-demo-fixture", observedAt: at, evidenceStatus: "direct_sku_match",
    flags: ["DEMO ONLY: all product details and source quotes are fictional. No page was fetched.", "This simulates evidence-backed research; it is not real Costco evidence."],
    fields: { name: { value: name, sourceIds: ["demo"] }, sizeText: { value: sizeText, sourceIds: ["demo"] } },
    sources: [{ id: "demo", url: `https://www.costco.ca/benstack-demo-${sku}.html`, sku, exactSku: true, kind: "direct_page", observedAt: at, quotes: { name, sizeText } }],
  });
}
