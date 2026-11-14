import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("../../fixtures/demo-receipts.json", import.meta.url));
const external = new Map<Page, string[]>(), errors = new Map<Page, string[]>();

test.beforeEach(async ({ page, request, baseURL }) => {
  expect((await request.post("/api/demo/reset", { headers: { origin: baseURL! } })).ok()).toBe(true);
  external.set(page, []); errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== baseURL) { external.get(page)!.push(url.origin); await route.abort(); }
    else await route.continue();
  });
  await page.goto("/receipts");
  await expect(page.getByRole("heading", { name: "Receipts", exact: true })).toBeVisible();
  await expect(page.getByLabel("Disposable demo")).toContainText("FICTIONAL DATA ONLY");
});
test.afterEach(async ({ page }) => {
  expect(external.get(page)).toEqual([]);
  expect(errors.get(page)).toEqual([]);
});

test("upload -> proposal -> approve/reject -> approved display without changing receipt facts", async ({ page, request }, testInfo) => {
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.getByText(/1 receipt imported/)).toBeVisible();
  await expect.poll(async () => {
    const data = await (await request.get("/api/demo/state")).json();
    return data.requests.filter((row: { state: string }) => row.state === "awaiting_review").length;
  }).toBe(2);
  const before = await (await request.get("/api/demo/state")).json();
  expect(before.products).toHaveLength(0);
  await expect(page.getByRole("link", { name: "Product research (2)", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Product research/ }).click();
  await page.getByRole("button", { name: /SKU 900000000001/ }).click();
  await expect(page.getByText("Synthetic source, not fetched:", { exact: false })).toBeVisible();
  await expect(page.locator('a[href^="https://www.costco.ca"]')).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Approve Brand", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Approve selected fields" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Approve Product name", exact: true }).check();
  await page.getByRole("checkbox", { name: "Approve Size (quoted)", exact: true }).check();
  await page.screenshot({ path: testInfo.outputPath("inbox-proposal.png"), fullPage: true });
  await page.getByRole("button", { name: "Approve selected fields" }).click();
  await expect(page.getByText(/^Status: approved$/)).toBeVisible();
  await page.getByRole("button", { name: /SKU 900000000002/ }).click();
  await page.getByLabel("Reason for rejection").fill("DEMO rejection: leave the original description unchanged.");
  await page.getByRole("button", { name: "Reject proposal", exact: true }).click();
  await expect(page.getByText(/^Status: rejected/)).toBeVisible();
  await page.getByRole("link", { name: "Receipts", exact: true }).click();
  await page.getByRole("button", { name: /DEMO Warehouse/ }).click();
  await expect(page.getByText("DEMO Maple Pantry Oats", { exact: true })).toBeVisible();
  await expect(page.getByText(/Approved metadata · Receipt: DEMO OATS/)).toBeVisible();
  await expect(page.getByText("DEMO LAUNDRY", { exact: true })).toBeVisible();
  await expect(page.getByText("DEMO Unscented Laundry Liquid", { exact: true })).toHaveCount(0);
  const after = await (await request.get("/api/demo/state")).json();
  expect(after.products).toHaveLength(1); expect(after.decisions).toHaveLength(2);
  expect(after.items).toEqual(before.items); expect(after.receipts).toEqual(before.receipts);
  expect(after.receipts[0].total).toBe("25.00");
  await page.screenshot({ path: testInfo.outputPath("approved-and-rejected-receipt.png"), fullPage: true });
});

test("real or modified receipt data is refused before persistence", async ({ page, request }) => {
  await page.locator('input[type="file"]').setInputFiles({ name: "not-the-demo.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify([{ membershipNumber: "real-data-must-be-refused" }])) });
  await expect(page.getByText("Only the bundled demo-receipts.json is accepted. Real receipt data is disabled.")).toBeVisible();
  const state = await (await request.get("/api/demo/state")).json();
  expect(state.receipts).toEqual([]); expect(state.requests).toEqual([]);
});

test("sample download and reset make the demo repeatable", async ({ page, request }) => {
  const downloaded = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download demo receipt" }).click();
  expect((await downloaded).suggestedFilename()).toBe("demo-receipts.json");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.getByText(/1 receipt imported/)).toBeVisible();
  await page.getByRole("button", { name: "Reset demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Receipts", exact: true })).toBeVisible();
  await expect.poll(async () => (await (await request.get("/api/demo/state")).json()).receipts.length).toBe(0);
  await expect(page.getByRole("button", { name: /DEMO Warehouse/ })).toHaveCount(0);
});
