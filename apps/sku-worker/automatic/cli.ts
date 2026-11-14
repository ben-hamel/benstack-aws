import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { access } from "node:fs/promises";
import { createTransactionalDb } from "@benstack-aws/db/transactional";
import { runAutomaticOffline } from "@benstack-aws/product-research/automatic";
import { resultSchema } from "@benstack-aws/product-research/contracts";
import { offlineAutomaticDatabase } from "../src/automatic-config.ts";
import { lockState, privateDirectory, readJson, UserError, writeJson } from "../src/state.ts";

async function main() {
  process.umask(0o077);
  const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"));
  const { values } = parseArgs({ args, strict: true, options: { enabled: { type: "boolean" }, organization: { type: "string" }, "max-jobs": { type: "string", default: "1" }, "poll-ms": { type: "string", default: "1000" }, drain: { type: "boolean" }, help: { type: "boolean" } } });
  if (values.help || !values.enabled) {
    console.log("Automatic worker is OFFLINE ONLY and disabled by default. No database or provider accessed.\nUsage: RECEIPT_IMPORT_TEST_DATABASE_URL=<disposable-local-url> bun run sku:auto:offline -- --enabled --organization <fixture-org> [--max-jobs 1] [--drain]\nNo .env files, app DATABASE_URL, worker login, model/search/page calls, schema setup or paused-job promotion. Exports synthetic UNRESOLVED results only. Ctrl+C stops; create PAUSED in the offline worker state directory to stop new claims.");
    return;
  }
  const connection = offlineAutomaticDatabase(process.env.RECEIPT_IMPORT_TEST_DATABASE_URL);
  const maxJobs = Number(values["max-jobs"]), pollMs = Number(values["poll-ms"]);
  if (!values.organization?.trim() || values.organization.length > 200 || !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 100 || !Number.isInteger(pollMs) || pollMs < 10 || pollMs > 60_000) throw new UserError("Choose a fixture organization, 1-100 jobs, and 10-60000ms polling.");
  const directory = join(homedir(), ".local/state/benstack-sku-auto-offline");
  const release = await lockState(directory);
  const db = createTransactionalDb(connection);
  const controller = new AbortController(), stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    console.log(`OFFLINE ONLY: watching disposable DB for organization ${values.organization}; maximum ${maxJobs} jobs this process. No inference or external page fetching.`);
    const report = await runAutomaticOffline(db, { mode: "offline", execute: async (claim, signal) => {
      signal.throwIfAborted();
      if (!/^[0-9a-f-]{36}$/i.test(claim.requestId)) throw new UserError("Invalid claim ID.");
      const exports = join(directory, "exports"); await privateDirectory(exports);
      const path = join(exports, `${claim.requestId}.json`);
      const saved = await readJson(path);
      if (saved !== undefined) {
        if (!saved || typeof saved !== "object" || !("organizationId" in saved) || saved.organizationId !== claim.organizationId || !("result" in saved)) throw new UserError("Offline export identity mismatch.");
        const result = resultSchema.parse(saved.result);
        if (result.sku !== claim.sku) throw new UserError("Offline export SKU mismatch.");
        return result;
      }
      const result = resultSchema.parse({ schemaVersion: 1, sku: claim.sku, merchant: "costco", market: "CA", outcome: "unresolved", answerId: 1,
        model: "offline/static-queue-fixture", observedAt: new Date().toISOString(), evidenceStatus: "unresolved", fields: {}, sources: [],
        flags: ["OFFLINE TEST ONLY: no research was performed. No model, search or source page was called."] });
      await writeJson(path, { organizationId: claim.organizationId, result });
      console.log(`Offline result saved for request ${claim.requestId}.`);
      return result;
    } }, { maxJobs, pollMs, stopWhenIdle: values.drain, signal: controller.signal, policy: async () => {
      let paused = false;
      try { await access(join(directory, "PAUSED")); paused = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      return { enabled: !paused, organizationIds: [values.organization!] };
    } });
    console.log(`Offline worker stopped: ${report.reason}; attempted ${report.attempted}, published ${report.published}. No product fields approved.`);
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); await db.$client.end(); await release(); }
}
main().catch((error: unknown) => { console.error(error instanceof UserError ? error.message : "Offline automatic worker stopped; diagnostics withheld. Inspect running claims and saved exports before recovery; no execution was retried."); process.exitCode = 1; });
