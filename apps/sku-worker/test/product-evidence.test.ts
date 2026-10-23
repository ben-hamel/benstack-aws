import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { extractProductEvidence, MAX_PAGE_BYTES } from "../src/product-evidence.ts";

const url = "https://www.costco.ca/product.html";
const fixture = (name: string) => readFile(new URL(`fixtures/${name}.html`, import.meta.url), "utf8");
function evidence(html: string, sku = "1572430") {
  const output = extractProductEvidence(html, url, sku);
  return JSON.parse(output.slice(output.indexOf("\n") + 1));
}
function product(value: unknown) {
  return `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
}

test("Costco fixtures retain exact SKU, name, size, pack text, and specification labels", async () => {
  const onions = evidence(await fixture("green-onions"), "3028018");
  assert.equal(onions.identity, "exact structured SKU match");
  assert.equal(onions.structuredProduct.sku, "3028018");
  assert.equal(onions.structuredProduct.name, "Green Onions, 907 g");
  assert.match(onions.productDetails, /907 g \(2 lb\)/);
  assert.deepEqual(onions.specifications[1], { label: "Form", value: "Whole" });
  assert.ok(onions.missingEvidence.includes("brand"));
  assert.doesNotMatch(JSON.stringify(onions), /delivery surcharge/);
  const bounce = evidence(await fixture("bounce"));
  assert.equal(bounce.structuredProduct.brand, "Bounce");
  assert.match(bounce.productDetails, /2 packs of 160 Sheets/);
  assert.ok(bounce.specifications.some((s: { label: string; value: string }) => s.label === "Quantity" && s.value === "320 Count(s)"));
});

test("arrays, @graph, type arrays and recommendations never merge different products", () => {
  const result = evidence(product([{ "@graph": [
    { "@type": "Product", sku: "999", name: "Wrong product", brand: "Other" },
    { "@type": ["Thing", "Product"], sku: "1572430", name: "Requested product" },
  ] }]));
  assert.equal(result.structuredProduct.name, "Requested product");
  assert.equal(result.structuredProduct.brand, undefined);
  assert.doesNotMatch(JSON.stringify(result), /Wrong product|Other/);
});

test("malformed markup, missing data and boilerplate are unresolved, not guessed", () => {
  const result = evidence('<script type="application/ld+json">{invalid</script><h1>Bounce</h1><p>Item 1572430</p><p>Delivery terms only</p>');
  assert.equal(result.structuredProduct, null);
  assert.equal(result.identity, "no structured product found");
  assert.equal(result.productDetails, null);
  assert.ok(result.warnings.some((s: string) => /malformed/.test(s)));
});

test("mismatched SKU, missing SKU, and conflicting exact products fail closed", () => {
  for (const entry of [{ "@type": "Product", sku: "999", name: "Wrong" }, { "@type": "Product", name: "Unknown SKU" }]) {
    const result = evidence(product(entry) + '<div id="product-details-summary">2 packs of 160</div>');
    assert.equal(result.structuredProduct, null);
    assert.equal(result.productDetails, null);
    assert.equal(result.identity, "no structured product matches requested SKU");
  }
  const result = evidence(product([
    { "@type": "Product", sku: "1572430", name: "A" },
    { "@type": "Product", sku: "1572430", name: "B" },
  ]));
  assert.equal(result.identity, "ambiguous structured products");
  assert.equal(result.structuredProduct, null);
});

test("scripts are never executed or retained in product sections", () => {
  const result = evidence(product({ "@type": "Product", sku: "1572430", name: "Bounce" }) + '<div id="product-details-summary">2 packs<script>throw new Error("executed")</script><style>secret-css</style><p>160 sheets</p></div>');
  assert.doesNotMatch(result.productDetails, /executed|secret-css/);
  assert.match(result.productDetails, /160 sheets/);
});

test("oversized pages are rejected and large extracted output remains bounded valid JSON", () => {
  assert.throws(() => evidence("x".repeat(MAX_PAGE_BYTES + 1)), /5 MiB/);
  const html = product({ "@type": "Product", sku: "1572430", name: '"'.repeat(2_000), description: '"'.repeat(3_000) })
    + `<div id="product-details-summary">${'"'.repeat(6_000)}</div>`
    + `<table id="ProductSpecifications">${'<tr><th>label</th><td>value</td></tr>'.repeat(100)}</table>`;
  const output = extractProductEvidence(html, url, "1572430");
  assert.ok(output.length <= 16_000);
  assert.equal(JSON.parse(output.slice(output.indexOf("\n") + 1)).productDetails, null);
});
