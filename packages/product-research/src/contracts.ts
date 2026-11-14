import { z } from "zod";

export const productFields = ["name", "brand", "variant", "sizeText", "packText"] as const;
export type ProductField = typeof productFields[number];
export const requestStates = ["queued", "paused", "running", "awaiting_review", "approved", "rejected", "unresolved", "failed", "cancelled"] as const;
const hosts = new Set(["costco.ca", "www.costco.ca", "sameday.costco.ca", "www.sameday.costco.ca", "costcobusinesscentre.ca", "www.costcobusinesscentre.ca"]);
export function safeSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return value.length <= 2_048 && url.protocol === "https:" && hosts.has(url.hostname)
      && !url.username && !url.password && (!url.port || url.port === "443");
  } catch { return false; }
}
const fieldText = z.string().trim().min(1).max(2_000);
const quotedFields = z.object({ name: fieldText.optional(), brand: fieldText.optional(), variant: fieldText.optional(), sizeText: fieldText.optional(), packText: fieldText.optional() }).strict();
const candidate = z.object({ value: fieldText, sourceIds: z.array(z.string().max(80)).min(1).max(10) }).strict();
export const resultSchema = z.object({
  schemaVersion: z.literal(1), sku: z.string().regex(/^[0-9]{1,12}$/), merchant: z.literal("costco"), market: z.literal("CA"),
  outcome: z.enum(["proposed", "unresolved"]), answerId: z.number().int().positive(),
  model: z.string().min(1).max(200), observedAt: z.iso.datetime(),
  evidenceStatus: z.enum(["direct_sku_match", "search_only", "unresolved"]),
  flags: z.array(z.string().min(1).max(200)).max(30),
  fields: z.object({ name: candidate.optional(), brand: candidate.optional(), variant: candidate.optional(), sizeText: candidate.optional(), packText: candidate.optional() }).strict(),
  sources: z.array(z.object({
    id: z.string().min(1).max(80), url: z.string().refine(safeSourceUrl), observedAt: z.iso.datetime(),
    kind: z.enum(["direct_page", "hosted_search"]), sku: z.string().regex(/^[0-9]{1,12}$/),
    exactSku: z.boolean(), quotes: quotedFields,
  }).strict()).max(24),
}).strict().superRefine((result, context) => {
  const sources = new Map(result.sources.map((source) => [source.id, source]));
  if (sources.size !== result.sources.length) context.addIssue({ code: "custom", message: "Duplicate source identifiers" });
  if (result.sources.some((source) => source.sku !== result.sku)) context.addIssue({ code: "custom", message: "Foreign SKU source in result" });
  for (const field of productFields) {
    const value = result.fields[field];
    if (!value) continue;
    for (const id of value.sourceIds) {
      const source = sources.get(id);
      if (!source || source.sku !== result.sku || !source.exactSku || source.quotes[field] !== value.value) {
        context.addIssue({ code: "custom", message: "Candidate lacks matching exact-SKU field evidence" });
      }
    }
  }
  const hasDirect = result.sources.some((s) => s.kind === "direct_page" && s.exactSku && s.sku === result.sku);
  if (result.evidenceStatus === "direct_sku_match" && !hasDirect) context.addIssue({ code: "custom", message: "Missing direct SKU evidence" });
  if (result.outcome === "proposed" && !result.fields.name) context.addIssue({ code: "custom", message: "Proposal requires an evidenced name" });
  if (result.outcome === "unresolved" && Object.keys(result.fields).length) context.addIssue({ code: "custom", message: "Unresolved results cannot propose fields" });
});
export type ResearchResult = z.infer<typeof resultSchema>;
export type ProductValues = { [K in ProductField]: string | null };
export const approveSchema = z.object({
  revision: z.number().int().positive(), expectedProductVersion: z.number().int().min(0),
  fields: z.array(z.enum(productFields)).min(1).max(5).refine((fields) => new Set(fields).size === fields.length),
  idempotencyKey: z.uuid(), acknowledgeWeakEvidence: z.boolean().default(false),
}).strict();
export const rejectSchema = z.object({
  revision: z.number().int().positive(), expectedProductVersion: z.number().int().min(0),
  idempotencyKey: z.uuid(), reason: z.string().trim().min(1).max(500),
}).strict();
export const researchAgainSchema = z.object({ idempotencyKey: z.uuid(), acknowledgeCost: z.literal(true) }).strict();
export type Claim = { requestId: string; identityId: string; organizationId: string; sku: string; token: string };
export interface OfflineExecutor { mode: "offline"; execute: (claim: Claim, signal: AbortSignal) => Promise<unknown> }
export type Reviewer = { organizationId: string; userId: string };
export type InboxItem = {
  id: string; sku: string; state: typeof requestStates[number]; reason: string | null;
  generation: number; createdAt: string; name: string | null;
};
export type InboxDetail = InboxItem & {
  canDecide: boolean; revision: number | null; expectedProductVersion: number; proposalProductVersion: number;
  current: (ProductValues & { version: number }) | null; result: ResearchResult | null;
  receipts: { receiptId: string; description: string }[];
  decisions: { action: string; actorUserId: string | null; createdAt: string; selectedFields: string[]; reason: string | null }[];
};
export type InboxPage = { items: InboxItem[]; nextCursor: string | null; counts: Partial<Record<typeof requestStates[number], number>> };
