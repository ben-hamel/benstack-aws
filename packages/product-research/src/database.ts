import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { member } from "@benstack-aws/db/schema/auth";
import { productIdentities, productResearchRequests } from "@benstack-aws/db/schema/product-research";
import type { ImportDatabase, ImportTransaction } from "@benstack-aws/receipt-import/database";
import type { Reviewer } from "./contracts";
export type ResearchDatabase = ImportDatabase;
export type Tx = ImportTransaction;
export class ResearchError extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 409, message: string) { super(message); }
}
export async function guard(tx: Tx) {
  await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(72419721)`);
}
export async function authorize(tx: Tx, actor: Reviewer, decision = false) {
  await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
  const [membership] = await tx.select().from(member).where(and(eq(member.userId, actor.userId), eq(member.organizationId, actor.organizationId))).for("share");
  if (!membership) throw new ResearchError(403, "Current organization membership required.");
  const canDecide = membership.role.split(",").some((role) => ["owner", "admin"].includes(role.trim()));
  if (decision && !canDecide) throw new ResearchError(403, "Organization owner or admin permission required.");
  return canDecide;
}
export async function scopedRequest(tx: Tx, actor: Reviewer, id: string) {
  const [row] = await tx.select({ request: productResearchRequests, identity: productIdentities }).from(productResearchRequests)
    .innerJoin(productIdentities, eq(productIdentities.id, productResearchRequests.identityId))
    .where(and(eq(productResearchRequests.id, id), eq(productIdentities.organizationId, actor.organizationId)));
  if (!row) throw new ResearchError(404, "Research request not found.");
  return row;
}
export function digest(value: unknown): string {
  const canonical = (input: unknown): unknown => Array.isArray(input) ? input.map(canonical)
    : input && typeof input === "object" ? Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : input;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
