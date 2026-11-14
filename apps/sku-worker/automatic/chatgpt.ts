import { parseArgs } from "node:util";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { createTransactionalDb } from "@benstack-aws/db/transactional";
import { pilotOperators } from "@benstack-aws/product-research/manual-pilot";
import { runAutomaticChatGPT } from "@benstack-aws/product-research/automatic-chatgpt";
import { ResearchError } from "@benstack-aws/product-research/database";
import { chatGPTSubprocess } from "../pilot/subprocess.ts";
import { validatePilotTarget } from "../src/pilot-config.ts";
import { lockState, stateDirectory, UserError } from "../src/state.ts";

async function main() {
  process.umask(0o077);
  const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"));
  const { values } = parseArgs({ args, strict: true, options: { "allow-live": { type: "boolean" }, organization: { type: "string" }, model: { type: "string" }, "max-jobs": { type: "string", default: "1" }, "poll-ms": { type: "string", default: "1000" }, drain: { type: "boolean" }, help: { type: "boolean" } } });
  if (values.help || !values["allow-live"]) {
    console.log("Automatic ChatGPT Research Worker is disabled without --allow-live.\nUsage: bun run sku:auto -- --allow-live [--max-jobs 1] [--organization <id>] [--drain]\nben-local ONLY. Uses the separate worker ChatGPT plan login, never API keys. Admission must be enabled for the chosen organization. Old paused work stays paused. Ctrl+C cancels; PAUSED file stops new claims. No automatic inference retry or auto-approval.");
    return;
  }
  const maxJobs = Number(values["max-jobs"]), pollMs = Number(values["poll-ms"]);
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 100 || !Number.isInteger(pollMs) || pollMs < 10 || pollMs > 60_000) throw new UserError("Choose 1-100 jobs and 10-60000ms polling.");
  const connection = validatePilotTarget(process.env.DATABASE_URL);
  const allowed = (process.env.ALLOWED_EMAILS ?? "").split(",").map((email) => email.trim()).filter(Boolean);
  if (!allowed.length) throw new UserError("ALLOWED_EMAILS must identify the operator.");
  const db = createTransactionalDb(connection);
  const controller = new AbortController(), stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  let release: (() => Promise<void>) | undefined;
  try {
    const operators = (await pilotOperators(db, allowed)).filter((actor) => !values.organization || actor.organizationId === values.organization);
    if (operators.length !== 1) throw new UserError("Choose one owner/admin organization with --organization.");
    const actor = operators[0]!;
    const allowlist = (process.env.PRODUCT_RESEARCH_ORGANIZATION_IDS ?? "").split(",").map((id) => id.trim());
    if (process.env.PRODUCT_RESEARCH_ADMISSION_ENABLED !== "true" || !allowlist.includes(actor.organizationId)) throw new UserError("Enable development admission for this organization first; no request was changed.");
    const directory = stateDirectory(), coordinator = join(directory, "auto-coordinator"), pausePath = join(coordinator, "PAUSED");
    await access(join(directory, "chatgpt-auth.json")).catch(() => { throw new UserError("Run bun run sku login first; no request was claimed."); });
    const node = Bun.which("node");
    if (!node) throw new UserError("Node.js 22.19+ is required.");
    release = await lockState(coordinator);
    const executor = chatGPTSubprocess({ node, directory, model: values.model });
    console.log(`Research Worker watching ben-local, organization ${actor.organizationId}; max ${maxJobs} jobs this start. Uses ChatGPT plan allowance. Old paused requests will not start automatically.`);
    console.log(`Pause new claims: create ${pausePath}. Ctrl+C cancels current work. Job failure stops this worker.`);
    const report = await runAutomaticChatGPT(db, actor, { ...executor, execute: async (claim, signal) => {
      console.log(`Research Worker starting SKU ${claim.sku}, request ${claim.requestId}.`);
      const result = await executor.execute(claim, signal);
      console.log(`Evidence saved for SKU ${claim.sku}; publishing for human review.`);
      return result;
    } }, { allowLive: true, maxJobs, pollMs, stopWhenIdle: values.drain, signal: controller.signal, policy: async () => {
      let paused = false;
      try { await access(pausePath); paused = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      return { enabled: !paused, organizationIds: [actor.organizationId] };
    } });
    console.log(`Research Worker stopped: ${report.reason}; attempted ${report.attempted}, published ${report.published}. No product fields approved.`);
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); await db.$client.end(); await release?.(); }
}
main().catch((error: unknown) => { console.error(error instanceof UserError || error instanceof ResearchError ? error.message : "Automatic ChatGPT worker stopped; diagnostics withheld. Inspect running claims and saved evidence before retrying. No inference was automatically restarted."); process.exitCode = 1; });
