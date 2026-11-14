import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { count } from "drizzle-orm";
import { member, organization, user } from "@benstack-aws/db/schema/auth";
import { receipts } from "@benstack-aws/db/schema/receipts";
import { productResearchRequests } from "@benstack-aws/db/schema/product-research";
import { admissionPolicy, importReceipts, MAX_UPLOAD_BYTES } from "../src";
import { testDatabase } from "./database";

let backend: Awaited<ReturnType<typeof testDatabase>>;
// Inject identity and the shared importer at the HTTP boundary. No app env files,
// authentication providers, S3, remote databases or personal credentials are loaded.
mock.module(new URL("../../../apps/server/src/middleware/auth.ts", import.meta.url).pathname, () => ({
  authMiddleware: async (c: { set: (name: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set("user", { id: "http-user" }); await next();
  },
  orgMiddleware: async (c: { set: (name: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set("orgId", "http-org"); await next();
  },
}));
const unused = () => { throw new Error("Unexpected HTTP operation in receipt import test"); };
mock.module(new URL("../../../apps/server/src/modules/receipts/receipts.service.ts", import.meta.url).pathname, () => ({
  insertReceipts: (input: unknown, org: string, userId: string) => importReceipts(backend.db, input, org, userId, { policy: admissionPolicy({}) }),
  createJob: unused, deleteAllReceipts: unused, getJob: unused, getReceiptDetail: unused, getReceipts: unused,
}));
const { default: routes } = await import("../../../apps/server/src/modules/receipts/receipts.routes");
const fixture = () => [{
  documentType: "RECEIPT", receiptType: "Warehouse", transactionDate: "2026-11-07", transactionBarcode: crypto.randomUUID(),
  subTotal: 1, taxes: 0, total: 1, warehouseName: "Fixture", warehouseNumber: 1, warehouseCity: "St John's", warehouseState: "NL", membershipNumber: "fixture",
  itemArray: [{ itemDescription01: "Item", itemNumber: "12345", unit: 1, amount: 1 }], tenderArray: [],
}];

beforeAll(async () => { backend = await testDatabase(); }, 30_000);
afterAll(async () => { await backend?.close(); });
beforeEach(async () => {
  await backend.exec('TRUNCATE "organization", "user", product_research_daily_usage CASCADE');
  await backend.db.insert(user).values({ id: "http-user", name: "Fixture", email: "http@example.invalid" });
  await backend.db.insert(organization).values({ id: "http-org", name: "Fixture", slug: "http-org", createdAt: new Date() });
  await backend.db.insert(member).values({ id: "http-member", userId: "http-user", organizationId: "http-org", role: "owner", createdAt: new Date() });
});

test("direct JSON and multipart HTTP uploads both use atomic import and default-paused admission", async () => {
  const request = (body: string | FormData) => routes.request("/upload", {
    method: "POST", body, headers: typeof body === "string" ? { "content-type": "application/json" } : undefined,
  });
  const first = await request(JSON.stringify({ receipts: fixture() }));
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ imported: 1, research: { paused: 1, queued: 0 } });
  const form = new FormData(); form.append("file", new File([JSON.stringify(fixture())], "receipts.json"));
  const second = await request(form);
  expect(second.status).toBe(200);
  expect(await second.json()).toMatchObject({ imported: 1, research: { reused: 1, queued: 0 } });
  expect(Number((await backend.db.select({ count: count() }).from(productResearchRequests))[0]?.count)).toBe(1);
});

test("invalid and oversized HTTP payloads get 400/413, not a partial import", async () => {
  for (const body of ["{", "null", "[]", JSON.stringify([{ ...fixture()[0], total: "invalid" }])]) {
    const response = await routes.request("/upload", { method: "POST", body, headers: { "content-type": "application/json" } });
    expect(response.status).toBe(400);
  }
  const malformedForm = await routes.request("/upload", { method: "POST", body: "not multipart", headers: { "content-type": "multipart/form-data" } });
  expect(malformedForm.status).toBe(400);
  const response = await routes.request("/upload", { method: "POST", body: "x".repeat(MAX_UPLOAD_BYTES + 1), headers: { "content-type": "application/json" } });
  expect(response.status).toBe(413);
  expect(Number((await backend.db.select({ count: count() }).from(receipts))[0]?.count)).toBe(0);
});

test("database failures return retryable 500 without exposing SQL or leaving a header", async () => {
  await backend.exec("ALTER TABLE receipt_item ADD CONSTRAINT private_failure_marker CHECK (false)");
  try {
    const response = await routes.request("/upload", { method: "POST", body: JSON.stringify(fixture()), headers: { "content-type": "application/json" } });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private_failure_marker");
    expect(Number((await backend.db.select({ count: count() }).from(receipts))[0]?.count)).toBe(0);
  } finally { await backend.exec("ALTER TABLE receipt_item DROP CONSTRAINT private_failure_marker"); }
});

test("stale membership cannot import even if middleware selected that organization", async () => {
  await backend.db.delete(member);
  const response = await routes.request("/upload", { method: "POST", body: JSON.stringify(fixture()), headers: { "content-type": "application/json" } });
  expect(response.status).toBe(403);
});
