import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { approvedProducts, productIdentities, productResearchProposals, productResearchRequests, receiptItemResearch } from "@benstack-aws/db/schema/product-research";
import { receiptItems, receipts } from "@benstack-aws/db/schema/receipts";
import { member } from "@benstack-aws/db/schema/auth";
import { resultSchema, type Claim, type OfflineExecutor, type Reviewer } from "./contracts";
export type { Claim, OfflineExecutor } from "./contracts";
import { authorize, digest, guard, ResearchError, type ResearchDatabase, type Tx } from "./database";

export type RunnerPolicy = { enabled: boolean; organizationIds: readonly string[] };
export async function hasReceipt(tx: Tx, requestId: string, org: string) {
  const [link] = await tx.select({ id: receiptItems.id }).from(receiptItemResearch)
    .innerJoin(receiptItems, eq(receiptItems.id, receiptItemResearch.receiptItemId))
    .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
    .where(and(eq(receiptItemResearch.requestId, requestId), eq(receipts.organizationId, org))).limit(1);
  return Boolean(link);
}
async function hasOwner(tx: Tx, request: typeof productResearchRequests.$inferSelect, org: string) {
  if (await hasReceipt(tx, request.id, org)) return true;
  if (!request.manual || !request.requestedBy) return false;
  const [membership] = await tx.select({ id: member.id }).from(member)
    .where(and(eq(member.organizationId, org), eq(member.userId, request.requestedBy))).limit(1);
  return Boolean(membership);
}

// Expired running leases are deliberately NOT reclaimed. Their previous host must
// be fenced and its persisted transcript inspected before operator recovery.
export async function claimNext(db: ResearchDatabase, policy: RunnerPolicy, now = new Date()): Promise<Claim | null> {
  return claimQueued(db, policy, now);
}

/** Explicit operator pilot only: never select a different request or tenant. */
export async function claimSelected(db: ResearchDatabase, policy: RunnerPolicy, actor: Reviewer, requestId: string, now = new Date()): Promise<Claim | null> {
  if (!policy.organizationIds.includes(actor.organizationId)) return null;
  return claimQueued(db, policy, now, { actor, requestId });
}

/** Automatic dev execution remains scoped to a currently authorized owner/admin. */
export async function claimForOperator(db: ResearchDatabase, policy: RunnerPolicy, actor: Reviewer): Promise<Claim | null> {
  if (!policy.organizationIds.includes(actor.organizationId)) return null;
  return claimQueued(db, policy, new Date(), { actor });
}

async function claimQueued(db: ResearchDatabase, policy: RunnerPolicy, now: Date, selected?: { actor: Reviewer; requestId?: string }): Promise<Claim | null> {
  if (!policy.enabled || !policy.organizationIds.length) return null;
  return db.transaction(async (tx) => {
    if (selected) await authorize(tx, selected.actor, true);
    await guard(tx);
    const [running] = await tx.select({ id: productResearchRequests.id }).from(productResearchRequests).where(eq(productResearchRequests.state, "running")).limit(1);
    if (running) return null;
    const queued = await tx.select({ request: productResearchRequests, identity: productIdentities }).from(productResearchRequests)
      .innerJoin(productIdentities, eq(productIdentities.id, productResearchRequests.identityId))
      .where(and(eq(productResearchRequests.state, "queued"), inArray(productIdentities.organizationId, [...policy.organizationIds]),
        selected?.requestId ? eq(productResearchRequests.id, selected.requestId) : undefined,
        selected ? eq(productIdentities.organizationId, selected.actor.organizationId) : undefined))
      .orderBy(asc(productResearchRequests.createdAt), asc(productResearchRequests.id)).limit(100);
    for (const { request, identity } of queued) {
      if (!await hasOwner(tx, request, identity.organizationId)) {
        await tx.update(productResearchRequests).set({ state: "cancelled", reason: "receipts_deleted", updatedAt: now }).where(eq(productResearchRequests.id, request.id));
        continue;
      }
      const [current] = await tx.select().from(approvedProducts).where(eq(approvedProducts.identityId, identity.id));
      if (current && !request.manual) {
        await tx.update(productResearchRequests).set({ state: "cancelled", reason: "already_approved", updatedAt: now }).where(eq(productResearchRequests.id, request.id));
        continue;
      }
      const token = randomUUID();
      await tx.update(productResearchRequests).set({ state: "running", claimToken: token, leaseUntil: new Date(now.getTime() + 60_000), baseProductVersion: current?.version ?? 0, updatedAt: now })
        .where(eq(productResearchRequests.id, request.id));
      return { requestId: request.id, identityId: identity.id, organizationId: identity.organizationId, sku: identity.sku, token };
    }
    return null;
  });
}
export async function renewClaim(db: ResearchDatabase, claim: Claim, now = new Date()) {
  const rows = await db.update(productResearchRequests).set({ leaseUntil: new Date(now.getTime() + 60_000), updatedAt: now }).where(and(
    eq(productResearchRequests.id, claim.requestId), eq(productResearchRequests.claimToken, claim.token),
    eq(productResearchRequests.state, "running"), gt(productResearchRequests.leaseUntil, now),
  )).returning({ id: productResearchRequests.id });
  return rows.length === 1;
}

export async function publishResult(db: ResearchDatabase, claim: Claim, input: unknown, now = new Date()) {
  if (JSON.stringify(input ?? null).length > 100_000) throw new ResearchError(400, "Research result exceeds the storage limit.");
  const parsed = resultSchema.safeParse(input);
  if (!parsed.success || parsed.data.sku !== claim.sku) throw new ResearchError(400, "Invalid structured research result.");
  const result = parsed.data, resultHash = digest(result);
  return db.transaction(async (tx) => {
    await guard(tx);
    const [row] = await tx.select({ request: productResearchRequests, identity: productIdentities }).from(productResearchRequests)
      .innerJoin(productIdentities, eq(productIdentities.id, productResearchRequests.identityId))
      .where(and(eq(productResearchRequests.id, claim.requestId), eq(productIdentities.organizationId, claim.organizationId), eq(productIdentities.id, claim.identityId), eq(productIdentities.sku, claim.sku)));
    if (!row || row.request.claimToken !== claim.token) throw new ResearchError(409, "Research claim is no longer current.");
    const [saved] = await tx.select().from(productResearchProposals).where(eq(productResearchProposals.requestId, claim.requestId));
    if (saved) {
      if (saved.resultHash !== resultHash) throw new ResearchError(409, "A different result was already published.");
      return { requestId: claim.requestId, state: row.request.state };
    }
    if (row.request.state !== "running" || !row.request.leaseUntil || row.request.leaseUntil <= now) throw new ResearchError(409, "Research claim expired or ended.");
    if (!await hasOwner(tx, row.request, claim.organizationId)) throw new ResearchError(409, "Research no longer has a receipt or owner.");
    await tx.insert(productResearchProposals).values({ requestId: claim.requestId, result, resultHash });
    const state = result.outcome === "proposed" ? "awaiting_review" : "unresolved";
    await tx.update(productResearchRequests).set({ state, leaseUntil: null, reason: state === "unresolved" ? "insufficient_evidence" : null,
      cooldownUntil: state === "unresolved" ? new Date(now.getTime() + 30 * 86_400_000) : null, updatedAt: now }).where(eq(productResearchRequests.id, claim.requestId));
    return { requestId: claim.requestId, state };
  });
}
export async function failClaim(db: ResearchDatabase, claim: Claim, now = new Date()) {
  await db.update(productResearchRequests).set({ state: "failed", reason: "execution_failed", leaseUntil: null,
    cooldownUntil: new Date(now.getTime() + 30 * 86_400_000), updatedAt: now }).where(and(
    eq(productResearchRequests.id, claim.requestId), eq(productResearchRequests.state, "running"), eq(productResearchRequests.claimToken, claim.token),
  ));
}

/** No service-provider adapter is installed here. Explicit offline injection is
 * for integration tests and local pilots only; there is no credential fallback.
 */
export type OfflineRunOptions = { publicationAttempts?: number; publicationRetryMs?: number };
function transientPublicationError(error: unknown): boolean {
  for (let depth = 0; error && typeof error === "object" && depth < 5; depth++) {
    if (error instanceof ResearchError) return false;
    const code = "code" in error ? error.code : undefined;
    if (typeof code === "string" && (["40001", "40P01", "57P01", "57P02", "57P03", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE"].includes(code) || code.startsWith("08"))) return true;
    error = "cause" in error ? error.cause : undefined;
  }
  return false;
}

export async function runNext(db: ResearchDatabase, policy: RunnerPolicy, executor: OfflineExecutor, signal?: AbortSignal, options: OfflineRunOptions = {}) {
  if (executor.mode !== "offline") throw new ResearchError(403, "Paid execution is not enabled.");
  validateRunOptions(options);
  signal?.throwIfAborted();
  const claim = await claimNext(db, policy);
  if (!claim) return null;
  return runClaimed(db, claim, executor.execute.bind(executor), signal, options);
}

export function validateRunOptions(options: OfflineRunOptions) {
  const attempts = options.publicationAttempts ?? 1, retryMs = options.publicationRetryMs ?? 100;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3 || !Number.isInteger(retryMs) || retryMs < 0 || retryMs > 10_000) throw new ResearchError(400, "Invalid bounded publication retry policy.");
}

/** Shared claim lifecycle; callers separately gate offline or explicit ChatGPT execution. */
export async function runClaimed(db: ResearchDatabase, claim: Claim, execute: (claim: Claim, signal: AbortSignal) => Promise<unknown>, signal?: AbortSignal, options: OfflineRunOptions = {}) {
  validateRunOptions(options);
  const attempts = options.publicationAttempts ?? 1, retryMs = options.publicationRetryMs ?? 100;
  const lost = new AbortController();
  const combined = AbortSignal.any([lost.signal, AbortSignal.timeout(300_000), ...(signal ? [signal] : [])]);
  let renewing = false;
  let pendingRenewal: Promise<void> = Promise.resolve();
  const heartbeat = setInterval(() => {
    if (renewing) return;
    renewing = true;
    pendingRenewal = renewClaim(db, claim).then((ok) => { if (!ok) lost.abort(); }).catch(() => lost.abort()).finally(() => { renewing = false; });
  }, 10_000);
  let result: unknown;
  try {
    try {
      combined.throwIfAborted();
      result = await execute(claim, combined);
      const parsed = resultSchema.safeParse(result);
      if (JSON.stringify(result ?? null).length > 100_000 || !parsed.success || parsed.data.sku !== claim.sku) throw new Error("Invalid research result");
      result = parsed.data;
      combined.throwIfAborted();
    } catch {
      await failClaim(db, claim);
      return { requestId: claim.requestId, state: "failed" as const };
    }
    // Publication errors must not restart inference or overwrite the saved result.
    // The still-owned claim + durable executor result can be published again.
    for (let attempt = 1; ; attempt++) {
      combined.throwIfAborted();
      try { return await publishResult(db, claim, result); }
      catch (error) {
        if (attempt >= attempts || !transientPublicationError(error)) throw error;
        // Retry only publication of the SAME in-memory/saved result. Never call
        // execute again, reclaim expired work, or restart inference here.
        await delay(retryMs, undefined, { signal: combined });
      }
    }
  } finally { clearInterval(heartbeat); await pendingRenewal; }
}
