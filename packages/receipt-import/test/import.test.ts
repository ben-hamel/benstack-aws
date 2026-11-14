import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { and, count, eq } from "drizzle-orm";
import { user, organization, member } from "@benstack-aws/db/schema/auth";
import { costcoItemCategoryMap } from "@benstack-aws/db/schema/categories";
import { receiptItems, receiptJobs, receiptTaxes, receiptTenders, receipts } from "@benstack-aws/db/schema/receipts";
import {
  approvedProducts, productIdentities, productResearchDailyUsage, productResearchRequests, receiptItemResearch,
} from "@benstack-aws/db/schema/product-research";
import { importReceipts, admissionPolicy, parseReceiptUpload, type AdmissionPolicy } from "../src";
import { processUpload, parseUploadKey } from "../../../apps/receipt-processor/src/processor";
import { migration, testDatabase } from "./database";

let backend: Awaited<ReturnType<typeof testDatabase>>;
const now = new Date("2026-11-07T12:00:00Z");
const policy: AdmissionPolicy = { ...admissionPolicy(), enabled: true, organizationIds: ["org-a", "org-b"] };
const item = (sku: string | null = "001572430") => ({
  itemActualName: "Receipt abbreviation", itemDescription01: "BOUNCE", itemNumber: sku,
  itemDepartmentNumber: 13, itemUnitPriceAmount: 0, unit: 1, amount: 0, taxFlag: "Y", fuelGradeCode: null,
  fuelUnitQuantity: null, fuelUomCode: null,
});
const receipt = (barcode = crypto.randomUUID()) => ({
  documentType: "RECEIPT", receiptType: "Warehouse", transactionDate: "2026-11-07",
  transactionDateTime: "2026-11-07T12:00:00", transactionDateISO: "2026-11-07T15:30:00Z", transactionBarcode: barcode,
  subTotal: 0, taxes: 0, total: 0, instantSavings: 0, warehouseName: "St John's", warehouseNumber: 100,
  warehouseCity: "St John's", warehouseState: "NL", membershipNumber: "fixture-only",
  itemArray: [item()], tenderArray: [{ tenderDescription: "Fixture card", tenderTypeCode: "VISA", amountTender: 0, displayAccountNumber: "0000" }],
  subTaxes: { aTaxLegend: "HST", aTaxPercent: 15, aTaxAmount: 0 },
});
const run = (input: unknown, org = "org-a", config = policy) => importReceipts(backend.db, input, org, "uploader", { policy: config, now });
async function counts() {
  const tables = { receipts, receiptItems, receiptTenders, receiptTaxes, productIdentities, productResearchRequests, receiptItemResearch, productResearchDailyUsage };
  const rows: Record<string, number> = {};
  for (const [name, table] of Object.entries(tables)) rows[name] = Number((await backend.db.select({ count: count() }).from(table))[0]?.count);
  return rows;
}

beforeAll(async () => { backend = await testDatabase(); }, 30_000);
afterAll(async () => { await backend?.close(); });
beforeEach(async () => {
  await backend.exec('TRUNCATE "organization", "user", product_research_daily_usage CASCADE');
  await backend.db.insert(user).values({ id: "uploader", name: "Fixture user", email: "fixture@example.invalid" });
  await backend.db.insert(organization).values(["org-a", "org-b"].map((id) => ({ id, name: id, slug: id, createdAt: now })));
  await backend.db.insert(member).values(["org-a", "org-b"].map((organizationId) => ({ id: crypto.randomUUID(), organizationId, userId: "uploader", role: "owner", createdAt: now })));
});

test("validated Costco JSON imports all receipt rows and one queued product atomically", async () => {
  const result = await run({ receipts: [receipt()] });
  expect(result).toEqual({ imported: 1, skipped: 0, total: 1,
    research: { queued: 1, paused: 0, reused: 0, approved: 0, excluded: 0, cooldown: 0, capacityBlocked: 0 } });
  expect(await counts()).toMatchObject({ receipts: 1, receiptItems: 1, receiptTenders: 1, receiptTaxes: 1,
    productResearchRequests: 1, receiptItemResearch: 1, productResearchDailyUsage: 2 });
  expect((await backend.db.select().from(productIdentities))[0]?.sku).toBe("001572430");
  expect((await backend.db.select().from(receiptItems))[0]?.unitPrice).toBe("0.00");
  expect((await backend.db.select().from(receipts))[0]?.instantSavings).toBe("0.00");
});

test("child insert failure leaves no header and a retry imports the whole receipt", async () => {
  const input = [receipt()];
  await backend.exec("ALTER TABLE receipt_tender ADD CONSTRAINT injected_tender_failure CHECK (false)");
  try {
    await expect(run(input)).rejects.toThrow();
    expect(await counts()).toMatchObject({ receipts: 0, receiptItems: 0, receiptTenders: 0, receiptTaxes: 0, productResearchRequests: 0 });
  } finally { await backend.exec("ALTER TABLE receipt_tender DROP CONSTRAINT injected_tender_failure"); }
  expect((await run(input)).imported).toBe(1);
});

test("a later receipt failure preserves earlier complete receipts and retry fills only the failed one", async () => {
  const first = receipt(), second = receipt();
  second.itemArray[0]!.itemDescription01 = "FAIL_CHILD";
  await backend.exec("ALTER TABLE receipt_item ADD CONSTRAINT injected_late_failure CHECK (description <> 'FAIL_CHILD')");
  try {
    await expect(run([first, second])).rejects.toThrow();
    expect(await counts()).toMatchObject({ receipts: 1, receiptItems: 1, productResearchRequests: 1 });
  } finally { await backend.exec("ALTER TABLE receipt_item DROP CONSTRAINT injected_late_failure"); }
  expect(await run([first, second])).toMatchObject({ imported: 1, skipped: 1, total: 2, research: { reused: 1, queued: 0 } });
  expect(await counts()).toMatchObject({ receipts: 2, receiptItems: 2, productResearchRequests: 1 });
});

test("failure after admission rolls back financial rows, request, identity, and daily counters", async () => {
  const input = [receipt()];
  await backend.exec("ALTER TABLE product_research_receipt_item ADD CONSTRAINT injected_admission_failure CHECK (false)");
  try {
    await expect(run(input)).rejects.toThrow();
    for (const value of Object.values(await counts())) expect(value).toBe(0);
  } finally { await backend.exec("ALTER TABLE product_research_receipt_item DROP CONSTRAINT injected_admission_failure"); }
  expect((await run(input)).research.queued).toBe(1);
});

test("duplicates, repeated lines and concurrent uploads reuse one scoped request", async () => {
  const first = receipt();
  first.itemArray.push(item());
  expect((await run([first, receipt()])).research).toMatchObject({ queued: 1, reused: 0 });
  expect((await run([first])).skipped).toBe(1);
  const results = await Promise.all([run([receipt()]), run([receipt()])]);
  expect(results.map((result) => result.research.reused)).toEqual([1, 1]);
  expect(await counts()).toMatchObject({ receipts: 4, receiptItems: 5, productResearchRequests: 1, receiptItemResearch: 5 });
  expect((await backend.db.select().from(productResearchDailyUsage)).map((row) => row.admittedJobs)).toEqual([1, 1]);
});

test("approved identity suppresses research, but does not affect another organization", async () => {
  await run([receipt()]);
  const identity = (await backend.db.select().from(productIdentities))[0]!;
  await backend.db.insert(approvedProducts).values({ identityId: identity.id, name: "Approved name" });
  expect((await run([receipt()])).research.approved).toBe(1);
  expect((await run([receipt()], "org-b")).research.queued).toBe(1);
  expect((await backend.db.select().from(productIdentities)).length).toBe(2);
  expect((await backend.db.select().from(approvedProducts))[0]?.name).toBe("Approved name");
  expect((await backend.db.select().from(receiptItems)).every((line) => line.description === "BOUNCE")).toBe(true);
});

test("a shared category map is not approved product identity and is never modified", async () => {
  await backend.exec("INSERT INTO reference.spending_category (id, name) VALUES (98765, 'Fixture') ON CONFLICT DO NOTHING; INSERT INTO reference.costco_item_category_map VALUES ('001572430', 98765) ON CONFLICT DO NOTHING");
  expect((await run([receipt()])).research.queued).toBe(1);
  const [row] = await backend.db.select().from(costcoItemCategoryMap).where(eq(costcoItemCategoryMap.itemNumber, "001572430"));
  expect(row?.categoryId).toBe(98765);
});

test("default-off and non-allowlisted admission pause without reserving paid work", async () => {
  expect((await run([receipt()], "org-a", admissionPolicy({}))).research.paused).toBe(1);
  expect((await backend.db.select().from(productResearchRequests))[0]?.reason).toBe("feature_disabled");
  expect((await run([receipt()], "org-b", { ...policy, organizationIds: [] })).research.paused).toBe(1);
  expect((await backend.db.select().from(productResearchDailyUsage)).length).toBe(0);
});

test("eligibility excludes adjustments, missing/invalid SKUs, foreign markets and fuel", async () => {
  const input = receipt();
  input.itemArray = [item("123"), { ...item("456"), itemDescription01: "TPD/456" },
    { ...item("789"), itemDescription01: "  deposit/789" }, item(null), item("123 OR 1=1")];
  const foreign = { ...receipt(), warehouseState: "NY" };
  const fuel = { ...receipt(), receiptType: "Gas Station" };
  const contradictory = { ...receipt(), countryCode: "US" };
  const unknownType = { ...receipt(), receiptType: "Other merchant" };
  const result = await run([input, foreign, fuel, contradictory, unknownType]);
  expect(result.research).toMatchObject({ queued: 1, excluded: 8 });
  expect((await backend.db.select().from(receiptItemResearch)).map((row) => row.reason)).toEqual(expect.arrayContaining([
    "queued", "non_merchandise", "missing_sku", "invalid_sku", "unsupported_market", "fuel_receipt", "unsupported_receipt_type",
  ]));
});

test("cooldown suppresses uploads until expiry; new generation preserves old outcome", async () => {
  await run([receipt()]);
  const request = (await backend.db.select().from(productResearchRequests))[0]!;
  await backend.db.update(productResearchRequests).set({ state: "failed", updatedAt: now, cooldownUntil: new Date("2026-12-07T12:00:00Z") }).where(eq(productResearchRequests.id, request.id));
  expect((await run([receipt()])).research.cooldown).toBe(1);
  expect((await importReceipts(backend.db, [receipt()], "org-a", "uploader", { policy, now: new Date("2026-12-08T12:00:00Z") })).research.queued).toBe(1);
  expect((await backend.db.select().from(productResearchRequests)).map((row) => row.generation).sort()).toEqual([1, 2]);
});

test("concurrent quotas cannot oversubscribe, and backlog capacity doesn't create extra paused jobs", async () => {
  const capped = { ...policy, globalDailyLimit: 1, organizationDailyLimit: 1 };
  const a = receipt(), b = receipt(); b.itemArray = [item("2")];
  const results = await Promise.all([run([a], "org-a", capped), run([b], "org-b", capped)]);
  expect(results.reduce((sum, result) => sum + result.research.queued, 0)).toBe(1);
  expect(results.reduce((sum, result) => sum + result.research.paused, 0)).toBe(1);
  expect((await backend.db.select().from(productResearchRequests)).find((row) => row.state === "paused")?.reason).toBe("daily_limit");
  const third = receipt(); third.itemArray = [item("3")];
  expect((await run([third], "org-a", { ...policy, globalPendingLimit: 2 })).research.capacityBlocked).toBe(1);
  expect((await backend.db.select().from(productResearchRequests)).length).toBe(2);
});

test("partial unique active-request index is enforced by PostgreSQL, not just importer code", async () => {
  await run([receipt()]);
  const request = (await backend.db.select().from(productResearchRequests))[0]!;
  await expect(Promise.resolve(backend.db.insert(productResearchRequests).values({ identityId: request.identityId, generation: 2, state: "queued" }))).rejects.toThrow();
  expect((await backend.db.select().from(productResearchRequests)).length).toBe(1);
});

test("invalid JSON contracts and stale/nonmember organization selection cannot write receipts", async () => {
  for (const bad of [null, [], { receipts: [] }, [{ ...receipt(), total: "0" }], [{ ...receipt(), transactionDate: "2026-02-30" }]]) {
    expect(() => parseReceiptUpload(bad)).toThrow();
  }
  await expect(run([receipt(), { ...receipt(), total: "invalid" }])).rejects.toThrow();
  await backend.db.delete(member).where(and(eq(member.organizationId, "org-b"), eq(member.userId, "uploader")));
  await expect(run([receipt()], "org-b")).rejects.toThrow("not a current member");
  for (const value of Object.values(await counts())) expect(value).toBe(0);
});

test("baseline can adopt existing tables without rewriting receipt/category data", async () => {
  await run([receipt()]);
  const before = await backend.db.select().from(receiptItems);
  await backend.exec(await migration("0001_receipt_import_baseline.sql"));
  expect(await backend.db.select().from(receiptItems)).toEqual(before);
});

test("S3 processing validates bucket/key/job/tenant before fetching and is redelivery-safe", async () => {
  const id = crypto.randomUUID(), key = `uploads/org-a/${id}/receipts.json`;
  await backend.db.insert(receiptJobs).values({ id, organizationId: "org-a", uploadedBy: "uploader", s3Key: key });
  let reads = 0;
  const options = { db: backend.db, bucket: "fixture-bucket", expectedBucket: "fixture-bucket", encodedKey: key, policy,
    readUpload: async () => { reads++; return JSON.stringify([receipt()]); } };
  await expect(processUpload({ ...options, bucket: "other-bucket" })).rejects.toThrow();
  await expect(processUpload({ ...options, encodedKey: key.replace("org-a", "org-b") })).rejects.toThrow();
  expect(reads).toBe(0);
  expect((await processUpload(options))?.research.queued).toBe(1);
  expect(await processUpload(options)).toBeUndefined();
  expect(reads).toBe(1);
  expect((await backend.db.select().from(receiptJobs))[0]?.status).toBe("done");
  for (const value of ["uploads/org-a/not-a-uuid/receipts.json", "uploads/org-a/../receipts.json", `${key}/extra`, "%ZZ"]) {
    expect(() => parseUploadKey(value)).toThrow();
  }
});

test("S3 failure is visible and retry imports completely through the shared transaction path", async () => {
  const id = crypto.randomUUID(), key = `uploads/org-a/${id}/receipts.json`;
  await backend.db.insert(receiptJobs).values({ id, organizationId: "org-a", uploadedBy: "uploader", s3Key: key });
  const input = [receipt()];
  const options = { db: backend.db, bucket: "fixture-bucket", expectedBucket: "fixture-bucket", encodedKey: key, policy,
    readUpload: async () => JSON.stringify(input) };
  await backend.exec("ALTER TABLE receipt_tax ADD CONSTRAINT injected_s3_failure CHECK (false)");
  try {
    await expect(processUpload(options)).rejects.toThrow();
    expect((await counts()).receipts).toBe(0);
    expect((await backend.db.select().from(receiptJobs))[0]?.status).toBe("failed");
    expect((await backend.db.select().from(receiptJobs))[0]?.errorMessage).not.toContain("injected_s3_failure");
  } finally { await backend.exec("ALTER TABLE receipt_tax DROP CONSTRAINT injected_s3_failure"); }
  expect((await processUpload(options))?.imported).toBe(1);
  expect((await counts()).productResearchRequests).toBe(1);
});
