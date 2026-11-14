import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Models } from "@earendil-works/pi-ai/models";
import type { Claim, OfflineExecutor } from "@benstack-aws/product-research/contracts";
import { openJob } from "./worker.ts";
import { lockState } from "./state.ts";
import type { ResearchWeb } from "./web.ts";

/** Offline bridge only. No personal auth store, service credentials, or live
 * provider is constructed. A paid service adapter requires a separate launch gate.
 */
export function offlineDurableExecutor(options: {
  directory: string; models: Models; web: ResearchWeb; model: { provider: "faux"; modelId: string };
}) {
  if (options.model.provider !== "faux") throw new Error("Only the offline faux provider is enabled for queue execution.");
  const directory = (claim: Claim) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claim.requestId)) throw new Error("Invalid durable job ID");
    return join(options.directory, "jobs", claim.requestId);
  };
  const executor = {
    mode: "offline" as const,
    async execute(claim: Claim, signal: AbortSignal) {
      signal.throwIfAborted();
      const release = await lockState(options.directory);
      let job: Awaited<ReturnType<typeof openJob>> | undefined;
      let onAbort: (() => void) | undefined;
      let running: Promise<string> | undefined;
      try {
        job = await openJob({ directory: directory(claim), models: options.models, web: options.web, maxTurns: 8,
          initial: { sku: claim.sku, model: options.model } });
        if (job.job.sku !== claim.sku) throw new Error("Saved job SKU does not match the request");
        const stopped = new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new Error("Offline queue work interrupted"));
          if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
        });
        running = job.run();
        await Promise.race([running, stopped]);
        signal.throwIfAborted();
        return await job.result();
      } finally {
        if (onAbort) signal.removeEventListener("abort", onAbort);
        try { await job?.close(); await running?.catch(() => undefined); } finally { await release(); }
      }
    },
  } satisfies OfflineExecutor;
  return { ...executor,
    async readSaved(claim: Claim) {
      const path = directory(claim);
      // A missing transcript is recovery-needed, not permission to start inference.
      await access(join(path, "session.sqlite"));
      const release = await lockState(options.directory);
      try {
        const job = await openJob({ directory: path, models: options.models, web: options.web });
        try {
          if (job.job.sku !== claim.sku) throw new Error("Saved job SKU mismatch");
          return await job.result();
        } finally { await job.close(); }
      } finally { await release(); }
    },
  };
}
