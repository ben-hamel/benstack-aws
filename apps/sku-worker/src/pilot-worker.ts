import { parseArgs } from "node:util";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { executeManualJob, pilotJobDirectory, savedPilotResult } from "./manual-job.ts";
import { discoverPlanModels, selectPlanModel, workerModels } from "./models.ts";
import { openOpenAIResearchWeb } from "./openai-search.ts";
import { lockState, stateDirectory, UserError, WorkerCredentials } from "./state.ts";
import { validateSku } from "./web.ts";

async function main() {
  process.umask(0o077);
  const { values } = parseArgs({ options: { request: { type: "string" }, organization: { type: "string" }, sku: { type: "string" }, model: { type: "string" }, "allow-live": { type: "boolean" } }, strict: true });
  if (!values["allow-live"] || !values.request || !values.organization || !values.sku) throw new UserError("Explicit single-job pilot consent and identity required.");
  const claim = { requestId: values.request, organizationId: values.organization, sku: validateSku(values.sku) };
  const directory = stateDirectory(), jobDirectory = pilotJobDirectory(directory, claim.requestId);
  const controller = new AbortController(), stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const release = await lockState(directory);
  try {
    if (await savedPilotResult(directory, claim)) { console.log("Saved pilot evidence available; no inference repeated."); return; }
    // Fail before credential access/discovery if interrupted work already exists.
    let exists = false;
    try { await access(join(jobDirectory, "session.sqlite")); exists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (exists) throw new UserError("Existing transcript needs operator recovery; no inference restarted.");
    const credentials = new WorkerCredentials(directory), models = workerModels(credentials);
    if (!await credentials.read("openai")) throw new UserError("Run bun run sku login first.");
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]);
    const available = await discoverPlanModels(models, AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
    const known = models.getModels("openai").map((model) => model.id);
    const modelId = selectPlanModel(available, known, values.model), searchModel = selectPlanModel(available, known);
    const web = openOpenAIResearchWeb(directory, models, searchModel);
    try {
      console.log(`Research Worker: SKU ${claim.sku}; reasoning ${modelId}; hosted search ${searchModel}. Uses ChatGPT plan allowance.`);
      await executeManualJob({ directory, claim, models, web, model: { provider: "openai", modelId }, signal });
      console.log("Structured evidence saved; human review still required.");
    } finally { await web.close(); }
  } finally { await release(); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
main().catch((error: unknown) => { console.error(error instanceof UserError ? error.message : "Research Worker failed; raw diagnostics withheld. Saved state was not deleted."); process.exitCode = 1; });
