import { and, count, eq, inArray, sql } from "drizzle-orm";
import { activeResearchStates, productIdentities, productResearchDailyUsage, productResearchRequests } from "@benstack-aws/db/schema/product-research";
import type { ImportTransaction } from "./database";
import type { AdmissionPolicy } from "./policy";

/** Caller holds admission advisory lock 72419721. Reservations roll back with
 * request creation. Promotion of a paused request already occupies a queue slot.
 */
export async function reserveAdmission(tx: ImportTransaction, org: string, policy: AdmissionPolicy, now: Date, heldSlot = false) {
  if (!heldSlot) {
    const [global] = await tx.select({ count: count() }).from(productResearchRequests).where(inArray(productResearchRequests.state, [...activeResearchStates]));
    const [local] = await tx.select({ count: count() }).from(productResearchRequests)
      .innerJoin(productIdentities, eq(productIdentities.id, productResearchRequests.identityId))
      .where(and(eq(productIdentities.organizationId, org), inArray(productResearchRequests.state, [...activeResearchStates])));
    if (Number(global?.count) >= policy.globalPendingLimit || Number(local?.count) >= policy.organizationPendingLimit) return "queue_full";
  }
  if (!policy.enabled) return "feature_disabled";
  if (!policy.organizationIds.includes(org)) return "organization_not_allowlisted";
  const day = now.toISOString().slice(0, 10), scopes = ["global", `org:${org}`];
  await tx.insert(productResearchDailyUsage).values(scopes.map((scopeKey) => ({ scopeKey, day, organizationId: scopeKey === "global" ? null : org }))).onConflictDoNothing();
  const usage = await tx.select().from(productResearchDailyUsage).where(and(eq(productResearchDailyUsage.day, day), inArray(productResearchDailyUsage.scopeKey, scopes)));
  if (usage.some((row) => row.admittedJobs >= (row.scopeKey === "global" ? policy.globalDailyLimit : policy.organizationDailyLimit))) return "daily_limit";
  await tx.update(productResearchDailyUsage).set({ admittedJobs: sql`${productResearchDailyUsage.admittedJobs} + 1` })
    .where(and(eq(productResearchDailyUsage.day, day), inArray(productResearchDailyUsage.scopeKey, scopes)));
  return null;
}
