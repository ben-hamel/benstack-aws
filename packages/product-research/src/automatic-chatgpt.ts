import { pollAutomatic, type AutomaticOfflineOptions } from "./automatic";
import { claimForOperator, runClaimed } from "./queue";
import type { Claim, Reviewer } from "./contracts";
import { ResearchError, type ResearchDatabase } from "./database";

export interface ChatGPTPlanExecutor {
  mode: "chatgpt-plan";
  execute(claim: Claim, signal: AbortSignal): Promise<unknown>;
}

/** Explicit local operator consent only. No API keys or automatic auth fallback.
 * Existing paused jobs stay paused; only queued jobs in the operator's org run.
 */
export async function runAutomaticChatGPT(db: ResearchDatabase, actor: Reviewer, executor: ChatGPTPlanExecutor,
  options: AutomaticOfflineOptions & { allowLive: boolean }) {
  if (options.allowLive !== true || executor.mode !== "chatgpt-plan") throw new ResearchError(403, "Explicit ChatGPT plan execution consent required.");
  return pollAutomatic(options, async (policy, attempted) => {
    options.signal?.throwIfAborted();
    // Membership is checked inside the claim transaction on every poll, not just
    // at process startup. This also restricts even a broad policy to one tenant.
    const claim = await claimForOperator(db, policy, actor);
    if (!claim) return null;
    return runClaimed(db, claim, (current, signal) => { attempted(); return executor.execute(current, signal); },
      options.signal, { publicationAttempts: 3, publicationRetryMs: 100 });
  });
}
