import { defineDoc, type EntryRecord } from "@earendil-works/pi-durable";
import { validateProductUrl } from "./web.ts";

type EvidenceStatus = "direct_sku_match" | "search_only" | "unresolved";
type ReviewFlag = "no_direct_match" | "page_failed" | "page_unverified" | "brand_missing"
  | "size_quotes_differ" | "estimated_size" | "history_incomplete" | "pack_count_not_assessed";
export type EvidenceReview = {
  rulesVersion: 1;
  answerId: number;
  status: EvidenceStatus;
  flags: ReviewFlag[];
  counts: { searchResults: number; pageResults: number; directSkuMatches: number; pageFailures: number };
};

// Only new jobs opt in. Absence on an older job means not assessed, never passed.
export const EvidenceReviewDoc = defineDoc<{ summary: EvidenceReview | null }>({
  kind: "benstack.sku-evidence-review", version: 1, scope: "conversation",
  history: "latest", fork: "initial", initial: () => ({ summary: null }), checkpointWhen: () => false,
});

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Assess only committed tool evidence, never the model's prose or confidence. */
export function assessEvidence(entries: readonly EntryRecord[], sku: string, answerId: number, complete = true): EvidenceReview {
  const flags = new Set<ReviewFlag>();
  const counts = { searchResults: 0, pageResults: 0, directSkuMatches: 0, pageFailures: 0 };
  for (const entry of entries) {
    if (entry.kind !== "pi.tool-result") continue;
    for (const message of entry.model ?? []) {
      if (message.role !== "toolResult") continue;
      const text = message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
      if (message.toolName === "search_costco") {
        if (!message.isError && text.trim()) counts.searchResults++;
        continue;
      }
      if (message.toolName !== "fetch_costco_page") continue;
      counts.pageResults++;
      if (message.isError) { counts.pageFailures++; flags.add("page_failed"); continue; }
      let evidence: unknown;
      try {
        if (text.length > 16_000 || !text.startsWith("Direct page evidence (")) throw Error();
        evidence = JSON.parse(text.slice(text.indexOf("\n") + 1));
        if (!object(evidence) || !nonempty(evidence.sourceUrl)) throw Error();
        validateProductUrl(evidence.sourceUrl);
      } catch { flags.add("page_unverified"); continue; }
      if (!object(evidence) || evidence.requestedSku !== sku || !object(evidence.structuredProduct)) {
        flags.add("page_unverified"); continue;
      }
      const product = evidence.structuredProduct;
      const header = object(evidence.sameDayProduct) ? evidence.sameDayProduct : null;
      const structuredMatch = evidence.identity === "exact structured SKU match" && product.sku === sku && nonempty(product.name);
      const sameDayMatch = header?.sku === sku && header.name === product.name && nonempty(product.name)
        && typeof evidence.identity === "string"
        && ["exact Same-Day item-header SKU match; JSON-LD name and page URL agree", "exact structured SKU match; Same-Day item header agrees"].includes(evidence.identity)
        && ["sameday.costco.ca", "www.sameday.costco.ca"].includes(new URL(String(evidence.sourceUrl)).hostname)
        && (product.sku === undefined || product.sku === sku);
      if (!structuredMatch && !sameDayMatch) { flags.add("page_unverified"); continue; }
      counts.directSkuMatches++;
      if (!nonempty(product.brand)) flags.add("brand_missing");
      if (sameDayMatch) {
        const displayed = header!.displayedSizeText;
        if (nonempty(product.size) && nonempty(displayed)
          && product.size.trim().toLowerCase() !== displayed.trim().toLowerCase()) flags.add("size_quotes_differ");
        if (nonempty(displayed) && /\b(about|estimated|approximately|approx)\b/i.test(displayed)) flags.add("estimated_size");
      }
    }
  }
  if (!counts.directSkuMatches) flags.add("no_direct_match");
  if (!complete) flags.add("history_incomplete");
  // The extractor does not yet expose a normalized, validated pack-count field.
  // Do not guess whether count/size mentioned in free text is actually supported.
  flags.add("pack_count_not_assessed");
  return {
    rulesVersion: 1, answerId,
    status: !complete ? "unresolved" : counts.directSkuMatches ? "direct_sku_match" : counts.searchResults ? "search_only" : "unresolved",
    flags: [...flags].sort(), counts,
  };
}

const LABELS: Record<ReviewFlag, string> = {
  no_direct_match: "No verified direct-page SKU match.",
  page_failed: "A page-fetch tool returned an error (not proof that the product is unavailable).",
  page_unverified: "A page result did not establish a verified SKU match.",
  brand_missing: "Brand missing from at least one matched page extract.",
  size_quotes_differ: "JSON-LD and displayed size text differ; compare the quotes manually.",
  estimated_size: "Displayed size/weight includes an approximation or estimate.",
  history_incomplete: "History scan limit reached; evidence assessment is incomplete.",
  pack_count_not_assessed: "Pack count and final-answer claims are not automatically checked.",
};
export function formatEvidenceReview(summary: EvidenceReview | null): string {
  if (!summary) return "Job: done\nEvidence: not assessed (no saved assessment)\nHuman review required.";
  const status = { direct_sku_match: "direct SKU match", search_only: "search-only", unresolved: "unresolved" }[summary.status];
  return ["Job: done", `Evidence: ${status}`, "Review flags:", ...summary.flags.map((flag) => `- ${LABELS[flag]}`),
    "Human review required. This checks evidence coverage, not identification correctness."].join("\n");
}
