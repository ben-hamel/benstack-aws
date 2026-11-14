import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Models } from "@earendil-works/pi-ai/models";
import { resultSchema, type Claim, type ResearchResult } from "@benstack-aws/product-research/contracts";
import { openJob } from "./worker.ts";
import { privateDirectory, readJson, UserError, writeJson } from "./state.ts";
import type { ResearchWeb } from "./web.ts";

export function pilotJobDirectory(directory: string, requestId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new UserError("Invalid pilot request ID.");
  return join(directory, "pilot-jobs", requestId);
}

export async function savedPilotResult(directory: string, claim: Pick<Claim, "requestId" | "organizationId" | "sku">): Promise<ResearchResult | undefined> {
  const saved = await readJson(join(pilotJobDirectory(directory, claim.requestId), "result.json"));
  if (saved === undefined) return undefined;
  if (!saved || typeof saved !== "object" || !("requestId" in saved) || saved.requestId !== claim.requestId
    || !("organizationId" in saved) || saved.organizationId !== claim.organizationId || !("result" in saved)) throw new UserError("Saved pilot identity mismatch.");
  const result = resultSchema.parse(saved.result);
  if (result.sku !== claim.sku) throw new UserError("Saved pilot SKU mismatch.");
  return result;
}

/** Caller holds the worker state lock. No DB access, approval or credential fallback. */
export async function executeManualJob(options: {
  directory: string; claim: Pick<Claim, "requestId" | "organizationId" | "sku">; models: Models; web: ResearchWeb;
  model: { provider: string; modelId: string }; signal: AbortSignal;
}) {
  options.signal.throwIfAborted();
  const saved = await savedPilotResult(options.directory, options.claim);
  if (saved) return saved;
  const directory = pilotJobDirectory(options.directory, options.claim.requestId);
  await privateDirectory(directory);
  let exists = false;
  try { await access(join(directory, "session.sqlite")); exists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (exists) throw new UserError("Existing pilot transcript requires operator inspection; no inference restarted.");
  const job = await openJob({ directory, models: options.models, web: options.web, initial: { sku: options.claim.sku, model: options.model }, maxTurns: 8 });
  let onAbort: (() => void) | undefined;
  let running: Promise<string> | undefined;
  try {
    options.signal.throwIfAborted();
    const stopped = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new UserError("Pilot interrupted; saved state retained."));
      if (options.signal.aborted) onAbort(); else options.signal.addEventListener("abort", onAbort, { once: true });
    });
    running = job.run();
    await Promise.race([running, stopped]);
    options.signal.throwIfAborted();
    const result = await job.result();
    await writeJson(join(directory, "result.json"), { requestId: options.claim.requestId, organizationId: options.claim.organizationId, result });
    return result;
  } finally {
    if (onAbort) options.signal.removeEventListener("abort", onAbort);
    try { await job.close(); } finally { await running?.catch(() => undefined); }
  }
}
