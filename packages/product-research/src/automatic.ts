import { setTimeout as delay } from "node:timers/promises";
import { runNext, type RunnerPolicy } from "./queue";
import type { OfflineExecutor } from "./contracts";
import { ResearchError, type ResearchDatabase } from "./database";

export type AutomaticOfflineOptions = {
  /** Re-read between jobs/polls. Missing policy means disabled, not ambient env. */
  policy?: () => RunnerPolicy | Promise<RunnerPolicy>;
  maxJobs?: number;
  pollMs?: number;
  stopWhenIdle?: boolean;
  signal?: AbortSignal;
};
export type AutomaticOfflineReport = {
  attempted: number; published: number;
  reason: "disabled" | "job_limit" | "idle" | "aborted" | "execution_failed";
};

/** The offline entrypoint continues to reject every live executor. */
export async function runAutomaticOffline(db: ResearchDatabase, executor: OfflineExecutor, options: AutomaticOfflineOptions = {}): Promise<AutomaticOfflineReport> {
  if (executor.mode !== "offline") throw new ResearchError(403, "Automatic live execution is not enabled.");
  return pollAutomatic(options, (policy, attempted) => runNext(db, policy, { mode: "offline", execute: (claim, signal) => {
    attempted(); return executor.execute(claim, signal);
  } }, options.signal, { publicationAttempts: 3, publicationRetryMs: 100 }));
}

/** Provider-neutral polling mechanics. The supplied next function owns execution
 * authorization; this function contains no providers, credentials or claim logic.
 */
export async function pollAutomatic(options: AutomaticOfflineOptions,
  next: (policy: RunnerPolicy, attempted: () => void) => ReturnType<typeof runNext>): Promise<AutomaticOfflineReport> {
  const maxJobs = options.maxJobs ?? 1, pollMs = options.pollMs ?? 1_000;
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 100 || !Number.isInteger(pollMs) || pollMs < 10 || pollMs > 60_000) throw new ResearchError(400, "Choose 1-100 jobs and a bounded polling interval.");
  const report = { attempted: 0, published: 0 };
  while (true) {
    if (options.signal?.aborted) return { ...report, reason: "aborted" };
    const policy = await options.policy?.() ?? { enabled: false, organizationIds: [] };
    if (!policy.enabled || !policy.organizationIds.length) return { ...report, reason: "disabled" };
    if (report.attempted >= maxJobs) return { ...report, reason: "job_limit" };
    let outcome: Awaited<ReturnType<typeof runNext>>;
    try { outcome = await next(policy, () => { report.attempted++; }); }
    catch (error) {
      if (options.signal?.aborted) return { ...report, reason: "aborted" };
      // Stop after uncertain publication/DB failure; never drain the next job.
      throw error;
    }
    if (outcome?.state === "failed") return { ...report, reason: options.signal?.aborted ? "aborted" : "execution_failed" };
    if (outcome) { report.published++; continue; }
    if (options.stopWhenIdle) return { ...report, reason: "idle" };
    try { await delay(pollMs, undefined, { signal: options.signal }); }
    catch (error) { if (options.signal?.aborted) return { ...report, reason: "aborted" }; throw error; }
  }
}
