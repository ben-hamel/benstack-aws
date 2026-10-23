import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import { DEFAULT_MODEL, discoverPlanModels, selectPlanModel, workerModels } from "./models.ts";
import { installationId, lockState, stateDirectory, UserError, WorkerCredentials } from "./state.ts";
import { COSTCO_SITES, validateSku } from "./web.ts";
import { openOpenAIResearchWeb } from "./openai-search.ts";
import { openJob, validateTaskId } from "./worker.ts";
import { watchProgress } from "./progress.ts";

const HELP = `Local Costco Canada research prototype (Node.js 22.19+)

From the repo root:
  bun run sku login
  bun run sku status
  bun run sku models
  bun run sku search-test 1572430
  bun run sku research 1572430 [--model ${DEFAULT_MODEL}]
  bun run sku resume <job-id>
  bun run sku retry <job-id> <task-id>
  bun run sku logout

Login is separate from Pi/Codex. Uses ChatGPT plan consent, never an ambient API key.
Search uses OpenAI hosted web search through your ChatGPT plan, separately from reasoning.
Page fetches are limited to supported Costco Canada sites.
Ctrl+C pauses research; resume the printed job ID. No Benstack database access.
Retry explicitly unparks one crash-loop task and may consume model/search allowance.
Private state: SKU_WORKER_STATE_DIR or ~/.local/state/benstack-sku-worker
`;

function loginInteraction(signal: AbortSignal): { interaction: AuthInteraction; close: () => void } {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const input = createInterface({ input: process.stdin, output, terminal: true });
  input.on("SIGINT", () => process.emit("SIGINT"));
  return {
    interaction: {
      signal,
      notify(event) {
        if (event.type === "auth_url") {
          console.log(`\nOpen this link in your browser:\n${event.url}\n${event.instructions ?? ""}`);
        } else if (event.type === "device_code") {
          console.log(`Open ${event.verificationUri} and enter the code shown here: ${event.userCode}`);
        } else {
          console.log(event.message);
        }
      },
      async prompt(prompt) {
        if (prompt.type === "select") throw new UserError("Unexpected login selection; use this worker's OpenAI login only.");
        const hide = prompt.type === "manual_code" || prompt.type === "secret";
        const pending = input.question(`${prompt.message}${hide ? " (input hidden)" : ""}\n> `, {
          signal: prompt.signal ?? signal,
        });
        muted = hide;
        try { return await pending; }
        finally { muted = false; if (hide) console.log(); }
      },
    },
    close: () => input.close(),
  };
}

async function main() {
  process.umask(0o077);
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--")),
    options: { model: { type: "string" }, help: { type: "boolean", short: "h" } },
    allowPositionals: true,
    strict: true,
  });
  const [command, argument, taskId] = positionals;
  if (values.help || !command || command === "help") { console.log(HELP); return; }
  if (!["login", "logout", "status", "models", "search-test", "research", "resume", "retry"].includes(command)
    || positionals.length !== (command === "retry" ? 3 : ["search-test", "research", "resume"].includes(command) ? 2 : 1)
    || (values.model && command !== "research")) {
    throw new UserError("Invalid arguments. Run the worker with --help for usage.");
  }
  if (["search-test", "research"].includes(command)) validateSku(argument!);
  if (["resume", "retry"].includes(command) && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(argument!)) {
    throw new UserError("Use the job UUID printed by a previous research command.");
  }

  if (command === "retry") validateTaskId(taskId!);

  const directory = stateDirectory();
  const release = await lockState(directory);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const credentials = new WorkerCredentials(directory);
    const models = workerModels(credentials);
    if (command === "login") {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new UserError("Run login in an interactive terminal, not a redirected command.");
      console.log("Connect your own ChatGPT plan to the local Benstack SKU worker. Approve plan usage in the browser.");
      console.log("Over SSH, the browser may stop at a localhost error. Paste that FULL final redirect URL into this terminal only, not chat.");
      const id = await installationId(directory);
      const login = loginInteraction(controller.signal);
      try {
        await models.login("openai", "oauth", login.interaction, { getDeviceId: () => id, agentName: "Benstack SKU Worker" });
        console.log("ChatGPT plan consent saved privately for this worker. Next: research 1572430");
      } finally { login.close(); }
      return;
    }
    if (command === "logout") {
      await models.logout("openai");
      console.log("Local worker credentials removed. This does not revoke access at OpenAI; use your account controls for revocation.");
      return;
    }
    if (command === "status") {
      const credential = await credentials.read("openai");
      console.log(credential ? "ChatGPT plan grant saved (network access not checked; refresh happens at use)." : "Not signed in. Run the worker login.");
      console.log(`Private state: ${directory}`);
      return;
    }
    if (command === "models") {
      console.log("Models exposed by your signed-in ChatGPT plan:");
      for (const model of await discoverPlanModels(models, AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]))) {
        console.log(`${model.id} - ${model.name}${models.getModel("openai", model.id) ? "" : " (not yet in Pi's catalog)"}`);
      }
      return;
    }
    if (!(await credentials.read("openai"))) throw new UserError("Run the worker login first. Your existing Pi/Codex login is intentionally not reused.");
    const available = await discoverPlanModels(models, AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]));
    const known = models.getModels("openai").map((model) => model.id);
    // Independent of --model: changing the reasoning model does not replace its search service.
    const searchModel = selectPlanModel(available, known);
    if (command === "search-test") {
      const web = openOpenAIResearchWeb(directory, models, searchModel);
      try {
        console.log(`OpenAI hosted search with ${searchModel}; uses ChatGPT plan allowance. SKU ${argument}`);
        console.log(await web.search(argument!, COSTCO_SITES[0], controller.signal));
      } finally { await web.close(); }
      return;
    }
    const modelId = command === "research" ? selectPlanModel(available, known, values.model) : DEFAULT_MODEL;
    const jobId = command === "research" ? randomUUID() : argument!;
    const jobDirectory = join(directory, "jobs", jobId);
    if (command !== "research") {
      try { await access(join(jobDirectory, "session.sqlite")); }
      catch { throw new UserError("No saved job with that ID exists in this worker's state directory."); }
    }
    console.log(`Job ID: ${jobId}`);
    console.log(`Resume: bun run sku resume ${jobId}`);
    console.log(`Search backend: OpenAI hosted search (${searchModel}); independent of reasoning model.`);
    const web = openOpenAIResearchWeb(directory, models, searchModel);
    let job: Awaited<ReturnType<typeof openJob>> | undefined;
    let progress: Awaited<ReturnType<typeof watchProgress>> | undefined;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]);
    let onAbort: (() => void) | undefined;
    try {
      job = await openJob({
        directory: jobDirectory,
        models,
        web,
        initial: command === "research" ? { sku: argument!, model: { provider: "openai", modelId } } : undefined,
        log: (message) => console.error(message),
      });
      console.log(`Researching SKU ${job.job.sku} with ${job.job.model.modelId}. Ctrl+C pauses; five-minute limit per run.`);
      progress = await watchProgress(job.harness, job.root.id, (message) => console.error(message));
      if (signal.aborted) throw new UserError(`Paused. Resume the saved job: ${jobId}`);
      const stopped = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new UserError(`Paused. Resume the saved job: ${jobId}`));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
      if (command === "retry") console.error(`Explicit retry of task ${taskId}; interrupted requests may repeat and consume allowance.`);
      const answer = await Promise.race([job.run(command === "retry" ? { retryTaskId: taskId! } : undefined), stopped]);
      // Allow the last committed event batch to reach the listener, as in the
      // upstream JSON example. The answer itself is printed only once, below.
      await new Promise<void>((resolve) => setImmediate(resolve));
      await progress.stop();
      progress = undefined;
      console.log(`\nPROPOSED MATCH - REVIEW REQUIRED\n\n${answer}`);
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
      // Close preserves unfinished work. Do not call abort(), which cancels it permanently.
      try { await progress?.stop(); }
      finally { try { await job?.close(); } finally { await web.close(); } }
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await release();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof UserError ? error.message : "Worker command failed. Raw diagnostics were withheld to avoid exposing authentication data. Check login, network and model availability.");
  process.exitCode = 1;
});
