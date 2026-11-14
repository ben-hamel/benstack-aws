import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  activeResearchStates, approvedProducts, productIdentities, productResearchAdmissionActions, productResearchDecisions, productResearchProposals, productResearchRequests, receiptItemResearch,
} from "@benstack-aws/db/schema/product-research";
import { receiptItems, receipts } from "@benstack-aws/db/schema/receipts";
import { admissionPolicy, type AdmissionPolicy } from "@benstack-aws/receipt-import/policy";
import { reserveAdmission } from "@benstack-aws/receipt-import/reservation";
import {
  approveSchema, rejectSchema, researchAgainSchema, resultSchema, productFields, requestStates,
  type InboxDetail, type InboxItem, type InboxPage, type ProductValues, type Reviewer,
} from "./contracts";
import { authorize, digest, guard, ResearchError, scopedRequest, type ResearchDatabase, type Tx } from "./database";
export { ResearchError } from "./database";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ResearchError(400, "Invalid research action or query.");
  return parsed.data;
}
const querySchema = z.object({ state: z.enum(requestStates).optional(), cursor: z.string().max(500).optional() }).strict();
const cursorSchema = z.object({ id: z.uuid(), at: z.iso.datetime() });
const values = (product: typeof approvedProducts.$inferSelect | undefined): ProductValues | null => product ? Object.fromEntries(productFields.map((field) => [field, product[field]])) as ProductValues : null;

export async function researchContext(db: ResearchDatabase, actor: Reviewer) {
  return db.transaction(async (tx) => ({ ...actor, canDecide: await authorize(tx, actor) }));
}

export async function listResearch(db: ResearchDatabase, actor: Reviewer, input: unknown = {}): Promise<InboxPage> {
  const query = parse(querySchema, input);
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (query.cursor) {
    try { cursor = parse(cursorSchema, JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"))); }
    catch { throw new ResearchError(400, "Invalid research cursor."); }
  }
  return db.transaction(async (tx) => {
    await authorize(tx, actor);
    const rows = await tx.select({ request: productResearchRequests, sku: productIdentities.sku, proposal: productResearchProposals.result,
      cursorAt: sql<string>`to_char(${productResearchRequests.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` }).from(productResearchRequests)
      .innerJoin(productIdentities, eq(productIdentities.id, productResearchRequests.identityId))
      .leftJoin(productResearchProposals, eq(productResearchProposals.requestId, productResearchRequests.id))
      .where(and(eq(productIdentities.organizationId, actor.organizationId), query.state ? eq(productResearchRequests.state, query.state) : undefined,
        cursor ? sql`(${productResearchRequests.createdAt}, ${productResearchRequests.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : undefined))
      .orderBy(desc(productResearchRequests.createdAt), desc(productResearchRequests.id)).limit(21);
    const totals = await tx.select({ state: productResearchRequests.state, count: count() }).from(productResearchRequests)
      .innerJoin(productIdentities, eq(productIdentities.id, productResearchRequests.identityId)).where(eq(productIdentities.organizationId, actor.organizationId)).groupBy(productResearchRequests.state);
    const items: InboxItem[] = rows.slice(0, 20).map(({ request, sku, proposal }) => ({
      id: request.id, sku, state: request.state, reason: request.reason, generation: request.generation, createdAt: request.createdAt.toISOString(),
      name: proposal ? resultSchema.parse(proposal).fields.name?.value ?? null : null,
    }));
    const last = items.at(-1);
    return { items, counts: Object.fromEntries(totals.map((row) => [row.state, Number(row.count)])),
      nextCursor: rows.length > 20 && last ? Buffer.from(JSON.stringify({ id: last.id, at: rows[19]!.cursorAt })).toString("base64url") : null };
  });
}
export async function getResearch(db: ResearchDatabase, actor: Reviewer, id: string): Promise<InboxDetail> {
  return db.transaction(async (tx) => {
    const canDecide = await authorize(tx, actor);
    const { request, identity } = await scopedRequest(tx, actor, id);
    const [proposal] = await tx.select().from(productResearchProposals).where(eq(productResearchProposals.requestId, id));
    const [current] = await tx.select().from(approvedProducts).where(eq(approvedProducts.identityId, identity.id));
    const links = await tx.select({ receiptId: receipts.id, description: receiptItems.description }).from(receiptItemResearch)
      .innerJoin(receiptItems, eq(receiptItems.id, receiptItemResearch.receiptItemId)).innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
      .where(and(eq(receiptItemResearch.identityId, identity.id), eq(receipts.organizationId, actor.organizationId))).limit(20);
    const decisions = await tx.select().from(productResearchDecisions).where(eq(productResearchDecisions.requestId, id));
    const result = proposal ? resultSchema.parse(proposal.result) : null;
    return { id, sku: identity.sku, state: request.state, reason: request.reason, generation: request.generation,
      createdAt: request.createdAt.toISOString(), name: result?.fields.name?.value ?? null, canDecide,
      revision: proposal?.revision ?? null, expectedProductVersion: current?.version ?? 0, proposalProductVersion: request.baseProductVersion,
      current: current ? { ...values(current)!, version: current.version } : null, result, receipts: links,
      decisions: decisions.map((decision) => ({ action: decision.action, actorUserId: decision.actorUserId, createdAt: decision.createdAt.toISOString(), selectedFields: decision.selectedFields, reason: decision.reason })) };
  });
}

export async function decideResearch(db: ResearchDatabase, actor: Reviewer, id: string, action: "approve" | "reject", input: unknown) {
  const body = action === "approve" ? parse(approveSchema, input) : parse(rejectSchema, input);
  if ("fields" in body) body.fields.sort();
  const hash = digest({ action, body });
  return db.transaction(async (tx) => {
    await authorize(tx, actor, true); await guard(tx);
    const { request, identity } = await scopedRequest(tx, actor, id);
    const [previous] = await tx.select().from(productResearchDecisions).where(and(eq(productResearchDecisions.requestId, id), eq(productResearchDecisions.idempotencyKey, body.idempotencyKey)));
    if (previous) {
      if (previous.actorUserId !== actor.userId || previous.payloadHash !== hash) throw new ResearchError(409, "Decision key was used for another action.");
      return { requestId: id, state: previous.action === "approve" ? "approved" : "rejected" };
    }
    const [latest] = await tx.select({ id: productResearchRequests.id }).from(productResearchRequests).where(eq(productResearchRequests.identityId, identity.id)).orderBy(desc(productResearchRequests.generation)).limit(1);
    const [proposal] = await tx.select().from(productResearchProposals).where(eq(productResearchProposals.requestId, id));
    const [current] = await tx.select().from(approvedProducts).where(eq(approvedProducts.identityId, identity.id));
    if (request.state !== "awaiting_review" || latest?.id !== id || !proposal || proposal.revision !== body.revision
      || (action === "approve" && body.expectedProductVersion !== request.baseProductVersion) || (current?.version ?? 0) !== body.expectedProductVersion) {
      throw new ResearchError(409, "Proposal or product changed. Refresh before deciding.");
    }
    let after: unknown = null;
    const result = resultSchema.parse(proposal.result);
    if (action === "approve" && "fields" in body) {
      if (result.outcome !== "proposed") throw new ResearchError(409, "This result has no approvable product identity.");
      if (result.evidenceStatus !== "direct_sku_match" && !body.acknowledgeWeakEvidence) throw new ResearchError(400, "Explicit weak-evidence acknowledgment is required.");
      const selected = { ...(values(current) ?? { name: null, brand: null, variant: null, sizeText: null, packText: null }) };
      for (const field of body.fields) {
        const candidate = result.fields[field];
        if (!candidate) throw new ResearchError(400, "Selected field has no supported proposal value.");
        selected[field] = candidate.value;
      }
      if (!selected.name) throw new ResearchError(400, "Select the supported product name when creating a product.");
      const product = { identityId: identity.id, ...selected, name: selected.name, version: (current?.version ?? 0) + 1, updatedAt: new Date() };
      await tx.insert(approvedProducts).values(product).onConflictDoUpdate({ target: approvedProducts.identityId, set: product });
      after = { ...selected, version: product.version };
    }
    await tx.insert(productResearchDecisions).values({ requestId: id, actorUserId: actor.userId, action,
      idempotencyKey: body.idempotencyKey, payloadHash: hash, selectedFields: "fields" in body ? body.fields : [],
      reason: "reason" in body ? body.reason : null, before: current ? { ...values(current), version: current.version } : null,
      after, weakEvidenceAcknowledged: "acknowledgeWeakEvidence" in body ? body.acknowledgeWeakEvidence : false });
    const state = action === "approve" ? "approved" : "rejected";
    await tx.update(productResearchRequests).set({ state, reason: action === "reject" ? "reviewer_rejected" : null,
      cooldownUntil: action === "reject" ? new Date(Date.now() + 30 * 86_400_000) : null, updatedAt: new Date() }).where(eq(productResearchRequests.id, id));
    return { requestId: id, state };
  });
}

export async function researchAgain(db: ResearchDatabase, actor: Reviewer, id: string, input: unknown, policy: AdmissionPolicy = admissionPolicy()) {
  const body = parse(researchAgainSchema, input), now = new Date();
  return db.transaction(async (tx) => {
    await authorize(tx, actor, true); await guard(tx);
    const { request, identity } = await scopedRequest(tx, actor, id);
    const [existing] = await tx.select().from(productResearchAdmissionActions).where(and(eq(productResearchAdmissionActions.identityId, identity.id), eq(productResearchAdmissionActions.idempotencyKey, body.idempotencyKey)));
    if (existing) {
      if (existing.actorUserId !== actor.userId || existing.sourceRequestId !== id) throw new ResearchError(409, "Research key was used for another action.");
      const [saved] = await tx.select().from(productResearchRequests).where(eq(productResearchRequests.id, existing.resultRequestId));
      return { requestId: existing.resultRequestId, state: saved!.state };
    }
    const [latest] = await tx.select().from(productResearchRequests).where(eq(productResearchRequests.identityId, identity.id)).orderBy(desc(productResearchRequests.generation)).limit(1);
    if (latest?.id !== request.id || ["queued", "running", "awaiting_review"].includes(request.state)) throw new ResearchError(409, "Refresh the current request; research or review is already active.");
    const reason = await reserveAdmission(tx, actor.organizationId, policy, now, request.state === "paused");
    if (reason === "queue_full") throw new ResearchError(409, "Research backlog is full. Try again later.");
    const state = reason ? "paused" : "queued";
    let resultRequestId = id;
    if (request.state === "paused") {
      await tx.update(productResearchRequests).set({ state, reason, manual: true, requestedBy: actor.userId, updatedAt: now }).where(eq(productResearchRequests.id, id));
    } else {
      const [next] = await tx.insert(productResearchRequests).values({ identityId: identity.id, generation: request.generation + 1, state, reason,
        manual: true, requestedBy: actor.userId, admissionKey: body.idempotencyKey }).returning({ id: productResearchRequests.id });
      resultRequestId = next!.id;
    }
    await tx.insert(productResearchAdmissionActions).values({ identityId: identity.id, sourceRequestId: id, resultRequestId, actorUserId: actor.userId, idempotencyKey: body.idempotencyKey });
    return { requestId: resultRequestId, state };
  });
}

export async function deleteOrganizationReceipts(db: ResearchDatabase, actor: Reviewer) {
  return db.transaction(async (tx) => {
    await authorize(tx, actor); await guard(tx);
    const removed = await tx.delete(receipts).where(eq(receipts.organizationId, actor.organizationId)).returning({ id: receipts.id });
    const identities = tx.select({ id: productIdentities.id }).from(productIdentities).where(eq(productIdentities.organizationId, actor.organizationId));
    await tx.update(productResearchRequests).set({ state: "cancelled", reason: "receipts_deleted", claimToken: null, leaseUntil: null, updatedAt: new Date() }).where(and(
      inArray(productResearchRequests.identityId, identities), inArray(productResearchRequests.state, [...activeResearchStates]), eq(productResearchRequests.manual, false),
      sql`NOT EXISTS (SELECT 1 FROM ${receiptItemResearch} WHERE ${receiptItemResearch.requestId} = ${productResearchRequests.id})`,
    ));
    return { deleted: removed.length };
  });
}

export async function receiptEnrichment(tx: Tx | ResearchDatabase, org: string, lines: { id: string; type: string; itemNumber: string | null }[], canadianWarehouse: boolean) {
  const result = new Map<string, { product: (ProductValues & { version: number }) | null; research: { requestId: string; state: string; reason: string | null } | null }>();
  const eligible = lines.filter((line) => canadianWarehouse && line.type === "item" && line.itemNumber);
  if (!eligible.length) return result;
  // Use the admission identity, not SKU alone: a foreign/unsupported receipt can
  // contain the same digits as an approved Canadian product. Legacy lines without
  // a verified admission association are deliberately not silently backfilled.
  const links = await tx.selectDistinctOn([receiptItemResearch.receiptItemId], { itemId: receiptItemResearch.receiptItemId, identity: productIdentities, product: approvedProducts, request: productResearchRequests }).from(receiptItemResearch)
    .innerJoin(productIdentities, eq(productIdentities.id, receiptItemResearch.identityId))
    .leftJoin(approvedProducts, eq(approvedProducts.identityId, productIdentities.id))
    .leftJoin(productResearchRequests, eq(productResearchRequests.identityId, productIdentities.id))
    .where(and(inArray(receiptItemResearch.receiptItemId, eligible.map((line) => line.id)), eq(productIdentities.organizationId, org)))
    .orderBy(receiptItemResearch.receiptItemId, desc(productResearchRequests.generation));
  for (const line of eligible) {
    const link = links.find((row) => row.itemId === line.id && row.identity.sku === line.itemNumber);
    if (!link) continue;
    const { product, request } = link;
    result.set(line.id, { product: product ? { ...values(product)!, version: product.version } : null,
      research: request ? { requestId: request.id, state: request.state, reason: request.reason } : null });
  }
  return result;
}
