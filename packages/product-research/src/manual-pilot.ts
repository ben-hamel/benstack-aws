import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { member, user } from "@benstack-aws/db/schema/auth";
import { productIdentities, productResearchRequests } from "@benstack-aws/db/schema/product-research";
import { admissionPolicy } from "@benstack-aws/receipt-import/policy";
import { getResearch, researchAgain } from "./service";
import { claimSelected, failClaim, publishResult, renewClaim } from "./queue";
import { ResearchError, type ResearchDatabase } from "./database";
import { resultSchema, type Claim, type Reviewer } from "./contracts";

/** Resolve local operator identity without selecting or promoting any requests. */
export async function pilotOperators(db: ResearchDatabase, allowedEmails: readonly string[]) {
  const rows = await db.select({ organizationId: member.organizationId, userId: user.id, role: member.role })
    .from(member).innerJoin(user, eq(user.id, member.userId))
    .where(inArray(sql`lower(${user.email})`, allowedEmails.map((email) => email.trim().toLowerCase())));
  return rows.filter((row) => row.role.split(",").some((role) => ["owner", "admin"].includes(role.trim())));
}

/** Local operator tooling, not an HTTP endpoint or an automatic production runner. */
export async function pilotRequests(db: ResearchDatabase, allowedEmails: readonly string[], requestId?: string) {
  const rows = await db.select({ requestId: productResearchRequests.id, sku: productIdentities.sku,
    state: productResearchRequests.state, organizationId: productIdentities.organizationId, userId: user.id, role: member.role })
    .from(productResearchRequests)
    .innerJoin(productIdentities, eq(productIdentities.id, productResearchRequests.identityId))
    .innerJoin(member, eq(member.organizationId, productIdentities.organizationId))
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(inArray(sql`lower(${user.email})`, allowedEmails.map((email) => email.trim().toLowerCase())), requestId ? eq(productResearchRequests.id, requestId) : undefined))
    .orderBy(productResearchRequests.createdAt, productResearchRequests.id).limit(100);
  return rows.filter((row) => row.role.split(",").some((role) => ["owner", "admin"].includes(role.trim())));
}

export interface ManualPilotExecutor {
  mode: "manual-live-pilot";
  execute(claim: Claim, signal: AbortSignal): Promise<unknown>;
}

export async function runSelectedPilot(db: ResearchDatabase, actor: Reviewer, requestId: string,
  executor: ManualPilotExecutor, options: { allowLive: boolean; signal?: AbortSignal }) {
  if (!options.allowLive || executor.mode !== "manual-live-pilot") throw new ResearchError(403, "Explicit live pilot consent required.");
  options.signal?.throwIfAborted();
  const detail = await getResearch(db, actor, requestId);
  if (!detail.canDecide) throw new ResearchError(403, "Owner or admin permission required.");
  if (!["paused", "queued"].includes(detail.state)) throw new ResearchError(409, "Select a paused or queued request; do not restart terminal or running work.");
  if (detail.state === "paused") {
    const admission = await researchAgain(db, actor, requestId, { idempotencyKey: randomUUID(), acknowledgeCost: true },
      { ...admissionPolicy({}), enabled: true, organizationIds: [actor.organizationId] });
    if (admission.state !== "queued") throw new ResearchError(409, "Admission limits prevent this pilot; no provider was called.");
  }
  options.signal?.throwIfAborted();
  const claim = await claimSelected(db, { enabled: true, organizationIds: [actor.organizationId] }, actor, requestId);
  if (!claim) throw new ResearchError(409, "Selected request cannot be claimed; another job may be running. No provider was called.");
  const lost = new AbortController();
  const signal = AbortSignal.any([lost.signal, AbortSignal.timeout(300_000), ...(options.signal ? [options.signal] : [])]);
  let renewing = false;
  let pending: Promise<void> = Promise.resolve();
  const heartbeat = setInterval(() => {
    if (renewing) return;
    renewing = true;
    pending = renewClaim(db, claim).then((ok) => { if (!ok) lost.abort(); }).catch(() => lost.abort()).finally(() => { renewing = false; });
  }, 10_000);
  try {
    let result: unknown;
    try {
      signal.throwIfAborted();
      result = await executor.execute(claim, signal);
      signal.throwIfAborted();
      if (JSON.stringify(result ?? null).length > 100_000 || !resultSchema.safeParse(result).success) throw new Error("Invalid structured result");
    } catch {
      // Never retry inference or implicitly start a new generation. Saved SQLite
      // remains available for explicit operator recovery outside this first pilot.
      await failClaim(db, claim);
      throw new ResearchError(409, "Pilot stopped or failed; saved worker state retained. Inspect before starting any new research.");
    }
    // Saved evidence exists before publication. A DB error leaves the fenced
    // running claim untouched, not failed/requeued and not permission to infer again.
    return await publishResult(db, claim, result);
  } finally { clearInterval(heartbeat); await pending; }
}
