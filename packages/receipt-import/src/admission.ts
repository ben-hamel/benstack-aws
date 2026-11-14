import { and, desc, eq, sql } from "drizzle-orm";
import { reserveAdmission } from "./reservation";
import {
  activeResearchStates, approvedProducts, productIdentities,
  productResearchRequests, receiptItemResearch,
} from "@benstack-aws/db/schema/product-research";
import type { ImportTransaction } from "./database";
import type { AdmissionPolicy } from "./policy";
import { researchExclusion, type CostcoReceipt } from "./validation";

export interface AdmissionDecision {
  identityId?: string;
  requestId?: string;
  reason: string;
}

/** Caller owns a per-receipt transaction. All import admission, including daily
 * counters, is serialized by this transaction lock (small, single-worker pilot).
 * Future decision/re-research services must take the same identity-row lock.
 */
export async function admitResearch(
  tx: ImportTransaction,
  receipt: CostcoReceipt,
  lines: { id: string; index: number }[],
  organizationId: string,
  policy: AdmissionPolicy,
  now: Date,
): Promise<AdmissionDecision[]> {
  const decisions: AdmissionDecision[] = [];
  const groups = new Map<string, string[]>();
  for (const line of lines) {
    const item = receipt.itemArray[line.index]!;
    const reason = researchExclusion(receipt, item);
    if (reason) {
      await tx.insert(receiptItemResearch).values({ receiptItemId: line.id, reason });
      decisions.push({ reason });
    } else {
      const ids = groups.get(item.itemNumber!) ?? [];
      ids.push(line.id);
      groups.set(item.itemNumber!, ids);
    }
  }
  if (!groups.size) return decisions;
  // PostgreSQL advisory locks are connection/transaction scoped, not an app-only
  // mutex. This prevents concurrent imports from oversubscribing global quotas.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(72419721)`);
  for (const [sku, itemIds] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    await tx.insert(productIdentities).values({ organizationId, sku }).onConflictDoNothing();
    const [identity] = await tx.select().from(productIdentities).where(and(
      eq(productIdentities.organizationId, organizationId), eq(productIdentities.merchant, "costco"),
      eq(productIdentities.market, "CA"), eq(productIdentities.sku, sku),
    )).for("update");
    if (!identity) throw new Error("Product identity admission failed");
    const identityId = identity.id;
    let decision: AdmissionDecision;
    const [approved] = await tx.select({ id: approvedProducts.identityId }).from(approvedProducts)
      .where(eq(approvedProducts.identityId, identityId));
    const [latest] = await tx.select().from(productResearchRequests)
      .where(eq(productResearchRequests.identityId, identityId)).orderBy(desc(productResearchRequests.generation)).limit(1);
    if (approved) {
      decision = { identityId, reason: "approved_product" };
    } else if (latest && activeResearchStates.some((state) => state === latest.state)) {
      decision = { identityId, requestId: latest.id, reason: "existing_request" };
    } else if (latest && ["rejected", "unresolved", "failed"].includes(latest.state)
      && (latest.cooldownUntil ?? new Date(latest.updatedAt.getTime() + 30 * 86_400_000)) > now) {
      decision = { identityId, requestId: latest.id, reason: "cooldown" };
    } else {
      const reason = await reserveAdmission(tx, organizationId, policy, now);
      if (reason === "queue_full") {
        // Persist the admission decision on receipt lines, not another paused
        // request: otherwise the queue cap would itself create unbounded jobs.
        decision = { identityId, reason: "queue_full" };
      } else {
        const state = reason ? "paused" : "queued";
        const [request] = await tx.insert(productResearchRequests).values({
          identityId, generation: (latest?.generation ?? 0) + 1, state, reason,
          createdAt: now, updatedAt: now,
        }).returning({ id: productResearchRequests.id });
        if (!request) throw new Error("Research request admission failed");
        decision = { identityId, requestId: request.id, reason: state === "queued" ? "queued" : "paused" };
      }
    }
    await tx.insert(receiptItemResearch).values(itemIds.map((receiptItemId) => ({
      receiptItemId, identityId, requestId: decision.requestId ?? null, reason: decision.reason,
    })));
    decisions.push(decision);
  }
  return decisions;
}
