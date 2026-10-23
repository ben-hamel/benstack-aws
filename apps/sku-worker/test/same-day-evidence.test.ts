import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { extractProductEvidence } from "../src/product-evidence.ts";

const chickenUrl = "https://sameday.costco.ca/store/costco-canada/products/30358078-kirkland-signature-halal-whole-chicken-fryer-each";
const strawberriesUrl = "https://sameday.costco.ca/store/costco-canada/products/16502205-strawberries-package-per-lb";
const fixture = (name: string) => readFile(new URL(`fixtures/sameday-${name}.html`, import.meta.url), "utf8");
function evidence(html: string, url = chickenUrl, sku = "55505") {
  const output = extractProductEvidence(html, url, sku);
  assert.ok(output.length <= 16_000);
  return JSON.parse(output.slice(output.indexOf("\n") + 1));
}
function product(value: object) {
  return `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
}
function unresolved(html: string, url = chickenUrl, sku = "55505") {
  const result = evidence(html, url, sku);
  assert.equal(result.sameDayProduct, null);
  assert.equal(result.structuredProduct, null);
  assert.equal(result.productDetails, null);
}

test("Same-Day chicken retains header identity, pack details and an estimated-weight quote", async () => {
  const result = evidence(await fixture("chicken"));
  assert.match(result.identity, /exact Same-Day item-header SKU match/);
  assert.equal(result.sameDayProduct.sku, "55505");
  assert.equal(result.sameDayProduct.name, "Kirkland Signature Whole Chicken");
  assert.equal(result.structuredProduct.sku, undefined, "never fabricate a structured SKU");
  assert.equal(result.structuredProduct.brand, "Kirkland Signature");
  assert.equal(result.structuredProduct.size, "1 each");
  assert.match(result.sameDayProduct.displayedSizeText, /About 4.85 kg \/ package/);
  assert.match(result.sameDayProduct.details, /3 whole chickens.*Halal.*Keep refrigerated/);
  assert.doesNotMatch(JSON.stringify(result), /Image carousel|Read more/);
});

test("Same-Day strawberries preserve disagreeing sizes without guessing brand or pack count", async () => {
  const result = evidence(await fixture("strawberries"), strawberriesUrl, "27003");
  assert.equal(result.sameDayProduct.displayedSizeText, "908 g");
  assert.equal(result.structuredProduct.size, "1 lb container");
  assert.equal(result.structuredProduct.brand, undefined);
  assert.ok(result.missingEvidence.includes("brand"));
  assert.ok(result.warnings.some((warning: string) => /Report both verbatim/.test(warning)));
  assert.equal(result.sameDayProduct.packCount, undefined);
});

test("Same-Day identity requires a unique scoped header, exact item, matching name and matching page URL", async () => {
  const html = await fixture("chicken");
  for (const modified of [
    html.replace('id="item_details"', 'id="unrelated"'),
    html.replace("Item: 55505", "Item: 999"),
    html.replace("Item: 55505", "Item: 30358078"),
    html.replace("Item: 55505", "Not an item"),
    html.replace("Item: 55505", "Item: 555050"),
    html.replace('<h1 class="e-1uk1gs8">', '<h1>Other product</h1><h1 class="e-1uk1gs8">'),
    html.replace("<body>", '<body><div id="item_details">duplicate</div>'),
    html.replace("Item: 55505", "Item: 55505</div><div>Item: 999"),
    html.replace('"name":"Kirkland Signature Whole Chicken"', '"name":"Other product"'),
    html.replace('"url":"' + chickenUrl + '"', '"url":"https://sameday.costco.ca/store/costco-canada/products/999-other"'),
    html.replace('"url":"' + chickenUrl + '"', '"url":"https://attacker.example/product"'),
    html.replace('"url":"' + chickenUrl + '"', '"url":"/relative-path"'),
  ]) unresolved(modified);
  unresolved(html, chickenUrl, "999");
  unresolved(html, "https://costco.ca/product.html");
  unresolved(html, "https://sameday.costco.ca.attacker.example/product");
});

test("recommendations, ambiguous Products and conflicting structured SKUs cannot establish Same-Day identity", async () => {
  const html = await fixture("chicken");
  unresolved(html.replace('"@type":"Product"', '"@type":"Product","sku":"999"'));
  unresolved(html.replace('"@type":"Product"', '"@type":"Product","sku":999'));
  unresolved(html.replace('"@type":"Product"', '"@type":"Product","sku":"55505-extra"'));
  unresolved(html.replace('"@type":"Product"', '"@type":"Product","url":"https://sameday.costco.ca/other"'));
  unresolved(html + product({ "@type": "Product", name: "Different product", offers: { url: chickenUrl } }));
  const recommendation = product({ "@type": "Product", sku: "55505", name: "Recommendation", offers: { url: "https://sameday.costco.ca/other" } });
  unresolved(html.replace("Item: 55505", "Item: 999") + recommendation);
  unresolved(html.replace('"url":"' + chickenUrl + '"', '"url":"https://sameday.costco.ca/other"') + recommendation);
  const result = evidence(html + recommendation);
  assert.equal(result.sameDayProduct.name, "Kirkland Signature Whole Chicken");
  assert.doesNotMatch(JSON.stringify(result), /Recommendation/);
  const exact = evidence(html.replace('"@type":"Product"', '"@type":"Product","sku":"55505"'));
  assert.match(exact.identity, /exact structured SKU match/);
});

test("Same-Day extraction limits and unrelated sections cannot become evidence", async () => {
  const html = await fixture("chicken");
  unresolved(html + '<script type="application/ld+json">{broken</script>');
  unresolved(html + product({ "@type": "Thing" }).repeat(65));
  let deep: object = { "@type": "Product", name: "Uninspected product" };
  for (let i = 0; i < 25; i++) deep = { nested: deep };
  unresolved(html + product(deep));
  unresolved(html.replace('Item: 55505', `${'<div>unrelated</div>'.repeat(1_001)}Item: 55505`));
  unresolved('<html><body>Redirecting to storefront. Choose a delivery location.</body></html>');
  const result = evidence(html + '<div>Item: 999</div><div id="product-details-summary">UNRELATED_DETAILS</div>'
    + '<table id="ProductSpecifications"><tr><th>Wrong</th><td>UNRELATED_SPEC</td></tr></table>');
  assert.equal(result.sameDayProduct.sku, "55505");
  assert.doesNotMatch(JSON.stringify(result), /UNRELATED_DETAILS|UNRELATED_SPEC/);
});

test("large Same-Day fields remain bounded valid JSON with optional sections omitted", () => {
  const name = '"'.repeat(2_000);
  const html = product({ "@type": "Product", name, description: '"'.repeat(3_000), brand: '"'.repeat(300), size: '"'.repeat(300), offers: { url: chickenUrl } })
    + `<div id="item_details"><div><h1>${'&quot;'.repeat(2_000)}</h1><div><div>Item: 55505</div><div>${'&quot;'.repeat(500)}</div></div>`
    + `<div><div>Details</div></div><div><p>${'&quot;'.repeat(6_000)}</p></div></div></div>`;
  const result = evidence(html);
  assert.equal(result.sameDayProduct.sku, "55505");
  assert.equal(result.sameDayProduct.details, null);
  assert.equal(result.structuredProduct.description, undefined);
  assert.match(result.warnings.at(-1), /omitted to fit/);
});

test("missing sizes stay missing; scripts and embedded guest state are never used as identity evidence", async () => {
  const html = await fixture("chicken");
  const result = evidence(html.replace('$7.93 / kg (About 4.85 kg / package)', '')
    .replace('"size":"1 each",', '')
    .replace('Features:', 'Features:<script>throw Error("SCRIPT_EXECUTED")</script><style>SECRET_CSS</style>'));
  assert.equal(result.sameDayProduct.displayedSizeText, null);
  assert.equal(result.structuredProduct.size, undefined);
  assert.doesNotMatch(JSON.stringify(result), /SCRIPT_EXECUTED|SECRET_CSS/);
  unresolved(html.replace("Item: 55505", "No item")
    + '<script id="node-apollo-state" type="application/json">%7B%22sku%22%3A%2255505%22%7D</script>');
});
