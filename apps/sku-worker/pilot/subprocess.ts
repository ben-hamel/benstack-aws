import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resultSchema, type Claim } from "@benstack-aws/product-research/contracts";
import { pilotChildEnvironment } from "../src/pilot-config.ts";
import { UserError } from "../src/state.ts";

type WorkerProcess = { exited: Promise<number | null>; kill(signal: "SIGTERM" | "SIGKILL"): void };
type SpawnWorker = (command: string[], env: Record<string, string>) => WorkerProcess;
const spawnWorker: SpawnWorker = (command, env) => {
  const child = spawn(command[0]!, command.slice(1), { env, cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: ["ignore", "inherit", "inherit"] });
  return { exited: new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); }), kill: (signal) => { child.kill(signal); } };
};

/** Shared by explicit manual and automatic dev commands; no DB or ambient keys
 * enter the Node worker. Test injection substitutes the process, never providers.
 */
export function chatGPTSubprocess(options: { node: string; directory: string; model?: string; env?: Record<string, string | undefined>; spawnWorker?: SpawnWorker }) {
  return { mode: "chatgpt-plan" as const, async execute(claim: Claim, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claim.requestId)) throw new UserError("Invalid request ID.");
    const env = pilotChildEnvironment(options.env ?? process.env);
    // Bind state explicitly, even if the parent had no SKU_WORKER_STATE_DIR.
    env.SKU_WORKER_STATE_DIR = options.directory;
    const child = (options.spawnWorker ?? spawnWorker)([options.node, fileURLToPath(new URL("../src/pilot-worker.ts", import.meta.url)), "--request", claim.requestId,
      "--organization", claim.organizationId, "--sku", claim.sku, "--allow-live", ...(options.model ? ["--model", options.model] : [])], env);
    let hardStop: ReturnType<typeof setTimeout> | undefined, stopping = false;
    const abort = () => {
      if (stopping) return; stopping = true;
      try { child.kill("SIGTERM"); } catch { /* Already exited. */ }
      hardStop = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* Already exited. */ } }, 10_000);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) abort();
      const exit = await child.exited;
      signal.throwIfAborted();
      if (exit !== 0) throw new UserError("Research worker did not complete; inspect saved state before restarting.");
      const path = join(options.directory, "pilot-jobs", claim.requestId, "result.json");
      if ((await stat(path)).size > 100_000) throw new UserError("Saved result exceeds the limit.");
      const saved = JSON.parse(await readFile(path, "utf8"));
      if (saved.requestId !== claim.requestId || saved.organizationId !== claim.organizationId || saved.result?.sku !== claim.sku) throw new UserError("Saved result identity mismatch.");
      return resultSchema.parse(saved.result);
    } finally { signal.removeEventListener("abort", abort); if (hardStop) clearTimeout(hardStop); }
  } };
}
