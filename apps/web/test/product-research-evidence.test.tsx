import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResearchEvidence } from "../src/components/product-research-evidence";
import type { ResearchResult } from "@benstack-aws/product-research/contracts";

const source: ResearchResult["sources"][number] = { id: "fixture", url: "https://www.costco.ca/fixture.html", sku: "123",
  kind: "direct_page", exactSku: true, observedAt: "2026-11-07T12:00:00Z", quotes: { name: '<script>alert("page injection")</script>' } };

test("evidence is rendered as escaped text, never source HTML", () => {
  const html = renderToStaticMarkup(<ResearchEvidence sources={[source]} />);
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain('href="https://www.costco.ca/fixture.html"');
});

test("demo source references are visibly synthetic and never external links", () => {
  const html = renderToStaticMarkup(<ResearchEvidence sources={[source]} demo />);
  expect(html).toContain("Synthetic source, not fetched");
  expect(html).not.toContain("href=");
});

test("unsupported and executable URLs are withheld even if UI data bypasses contract validation", () => {
  for (const url of ["javascript:alert(1)", "https://attacker.invalid/page", "http://costco.ca/page", "https://user:password@costco.ca/page"]) {
    const html = renderToStaticMarkup(<ResearchEvidence sources={[{ ...source, url }]} />);
    expect(html).toContain("Unsupported source link withheld");
    expect(html).not.toContain("href=");
  }
});
