import { parseArgs } from "node:util";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { createTransactionalDb } from "@benstack-aws/db/transactional";
import { getResearch } from "@benstack-aws/product-research";
import { pilotRequests, runSelectedPilot } from "@benstack-aws/product-research/manual-pilot";
import { ResearchError } from "@benstack-aws/product-research/database";
import { validatePilotTarget } from "../src/pilot-config.ts";
import { chatGPTSubprocess } from "./subprocess.ts";
import { stateDirectory, UserError } from "../src/state.ts";

async function main() {
  process.umask(0o077);
  const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"));
  const { values } = parseArgs({ args, options: { request: { type: "string" }, model: { type: "string" }, "allow-live": { type: "boolean" }, help: { type: "boolean" } }, strict: true });
  if (values.help) {
    console.log("Dev-only one-request pilot (ben-local only).\n  bun run sku:pilot                         # read-only request list\n  bun run sku:pilot -- --request <UUID>      # read-only inspection\n  bun run sku:pilot -- --request <UUID> --allow-live [--model <ID>]\nLive execution uses the separate worker ChatGPT login and plan allowance. No API-key fallback. Other requests remain paused. No daemon, auto-approval or schema push.");
    return;
  }
  if ((values.request && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values.request))
    || (values["allow-live"] && !values.request) || (values.model && !values["allow-live"])) throw new UserError("Choose one request UUID; --model requires --allow-live.");
  const connection = validatePilotTarget(process.env.DATABASE_URL);
  const allowed = (process.env.ALLOWED_EMAILS ?? "").split(",").map((email) => email.trim()).filter(Boolean);
  if (!allowed.length) throw new UserError("ALLOWED_EMAILS must identify the local operator account.");
  const db = createTransactionalDb(connection);
  const controller = new AbortController(), stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const rows = await pilotRequests(db, allowed, values.request);
    if (!values.request) {
      console.log("ben-local requests (read-only; no worker credentials accessed):");
      for (const row of rows) console.log(`${row.requestId}  SKU ${row.sku}  ${row.state}`);
      if (!rows.length) console.log("No matching owner/admin requests.");
      return;
    }
    if (rows.length !== 1) throw new UserError("Expected one owner/admin account for this request; check ALLOWED_EMAILS and membership.");
    const selected = rows[0]!;
    const actor = { userId: selected.userId, organizationId: selected.organizationId };
    const detail = await getResearch(db, actor, selected.requestId);
    console.log(`ben-local: request ${detail.id}, SKU ${detail.sku}, state ${detail.state}.`);
    if (!values["allow-live"]) { console.log("Inspection only. Add --allow-live to consume ChatGPT plan allowance for this request only."); return; }
    const directory = stateDirectory();
    await access(join(directory, "chatgpt-auth.json")).catch(() => { throw new UserError("Run bun run sku login first; request was not promoted."); });
    const node = Bun.which("node");
    if (!node) throw new UserError("Node.js 22.19+ is required for the durable worker.");
    const executor = chatGPTSubprocess({ node, directory, model: values.model });
    const outcome = await runSelectedPilot(db, actor, selected.requestId, {
      ...executor, mode: "manual-live-pilot",
    }, { allowLive: true, signal: controller.signal });
    console.log(`Pilot published: ${outcome.state}. Open Product research in the app. No fields were approved.`);
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); await db.$client.end(); }
}
main().catch((error: unknown) => { console.error(error instanceof UserError || error instanceof ResearchError ? error.message : "Pilot command failed; raw diagnostics withheld. Inspect saved state before retrying; no automatic inference retry."); process.exitCode = 1; });
