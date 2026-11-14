import { resultSchema, productFields, safeSourceUrl, type ResearchResult, type ProductField } from "@benstack-aws/product-research/contracts";
import type { EntryRecord } from "@earendil-works/pi-durable";

function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() && value.trim().length <= 2_000 ? value.trim() : undefined; }

/** Deterministic proposal extraction from committed tool evidence, NEVER answer
 * prose. First release proposes direct-page fields only; search-only stays unresolved.
 */
export function resultFromEntries(sku: string, answerId: number, model: string, entries: readonly EntryRecord[], complete: boolean): ResearchResult {
  const sources: ResearchResult["sources"] = [];
  const flags = new Set<string>(["Human review required; pack count and variant are not automatically extracted."]);
  let searched = false;
  for (const entry of entries) for (const message of entry.model ?? []) {
    if (entry.kind !== "pi.tool-result" || message.role !== "toolResult" || message.isError) continue;
    if (message.toolName === "search_costco") { searched = true; continue; }
    if (message.toolName !== "fetch_costco_page") continue;
    const output = message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
    if (output.length > 16_000 || !output.startsWith("Direct page evidence (")) continue;
    let page: unknown;
    try { page = JSON.parse(output.slice(output.indexOf("\n") + 1)); } catch { continue; }
    if (!object(page) || page.requestedSku !== sku || typeof page.sourceUrl !== "string" || !safeSourceUrl(page.sourceUrl) || !object(page.structuredProduct)) continue;
    const product = page.structuredProduct, header = object(page.sameDayProduct) ? page.sameDayProduct : null;
    const structured = product.sku === sku && page.identity === "exact structured SKU match";
    const sameDay = header?.sku === sku && header.name === product.name
      && ["sameday.costco.ca", "www.sameday.costco.ca"].includes(new URL(page.sourceUrl).hostname)
      && (product.sku === undefined || product.sku === sku)
      && ["exact Same-Day item-header SKU match; JSON-LD name and page URL agree", "exact structured SKU match; Same-Day item header agrees"].includes(String(page.identity));
    if ((!structured && !sameDay) || !text(product.name)) continue;
    const timestamp = "timestamp" in message && typeof message.timestamp === "number" && Number.isFinite(message.timestamp) ? message.timestamp : Date.now();
    const observedAt = new Date(timestamp).toISOString();
    const quotes = { name: text(product.name)!, ...(text(product.brand) ? { brand: text(product.brand)! } : {}), ...(text(product.size) ? { sizeText: text(product.size)! } : {}) };
    sources.push({ id: `entry-${entry.id}`, url: page.sourceUrl, observedAt, kind: "direct_page", sku, exactSku: true, quotes });
    if (sameDay && text(header!.displayedSizeText)) sources.push({ id: `entry-${entry.id}-header`, url: page.sourceUrl, observedAt,
      kind: "direct_page", sku, exactSku: true, quotes: { name: text(product.name)!, sizeText: text(header!.displayedSizeText)! } });
    if (!text(product.brand)) flags.add("Brand is missing from at least one matched source.");
  }
  const fields: ResearchResult["fields"] = {};
  if (sources.length > 24) { flags.add("Source inspection limit reached."); complete = false; }
  const bounded = sources.slice(0, 24);
  for (const field of productFields) {
    const quotes = new Map<string, string[]>();
    for (const source of bounded) {
      const value = source.quotes[field as keyof typeof source.quotes];
      if (value) quotes.set(value, [...(quotes.get(value) ?? []), source.id]);
    }
    if (quotes.size > 1) { flags.add(`${field}: source quotes differ; no value was selected.`); continue; }
    const [choice] = quotes;
    if (!choice) continue;
    if (field === "sizeText" && /\b(about|estimated|approximately|approx)\b/i.test(choice[0])) { flags.add("Estimated size was retained as evidence, not a fixed product size."); continue; }
    fields[field as ProductField] = { value: choice[0], sourceIds: choice[1].slice(0, 10) };
  }
  const proposed = complete && Boolean(fields.name);
  if (!complete) flags.add("Evidence history was incomplete.");
  if (!proposed) flags.add("No unambiguous directly evidenced product name; research is unresolved.");
  return resultSchema.parse({ schemaVersion: 1, sku, merchant: "costco", market: "CA", outcome: proposed ? "proposed" : "unresolved",
    answerId, model, observedAt: new Date().toISOString(), evidenceStatus: bounded.length ? "direct_sku_match" : searched ? "search_only" : "unresolved",
    flags: [...flags], fields: proposed ? fields : {}, sources: bounded });
}
