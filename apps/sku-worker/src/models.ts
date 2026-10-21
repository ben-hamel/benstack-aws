import type { CredentialStore } from "@earendil-works/pi-ai";
import { createModels, type Models } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { UserError } from "./state.ts";

export const DEFAULT_MODEL = "gpt-6.1-sol";
export type PlanModel = { id: string; name: string };

export function workerModels(credentials: CredentialStore) {
  const models = createModels({
    credentials,
    // No ambient API key or personal Pi/Codex auth: no silent switch to paid API billing.
    authContext: { env: async () => undefined, fileExists: async () => false },
  });
  // Pi omits unsupported subscription fields, including max_output_tokens, on this route.
  models.setProvider(openaiProvider());
  return models;
}

/** SIWC returns models[].slug, not the API-key catalog's data[].id. */
export function parsePlanModels(body: unknown): PlanModel[] {
  if (!body || typeof body !== "object" || !("models" in body) || !Array.isArray(body.models)) {
    throw new UserError("OpenAI returned an unexpected ChatGPT model catalog. No model request was made.");
  }
  const available: PlanModel[] = [];
  for (const item of body.models) {
    if (item && typeof item === "object" && item.visibility === "list"
      && typeof item.slug === "string" && /^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(item.slug)
      && !available.some((model) => model.id === item.slug)) {
      available.push({ id: item.slug, name: typeof item.display_name === "string" ? item.display_name : item.slug });
    }
  }
  return available;
}

export async function discoverPlanModels(
  models: Pick<Models, "getAuth">,
  signal = AbortSignal.timeout(20_000),
  request: typeof fetch = fetch,
): Promise<PlanModel[]> {
  const resolved = await models.getAuth("openai", { signal });
  if (!resolved?.auth.apiKey) throw new UserError("Run the worker login before listing ChatGPT plan models.");
  const response = await request("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${resolved.auth.apiKey}` },
    redirect: "error",
    signal,
  });
  if (!response.ok) throw new UserError(`ChatGPT model discovery failed (HTTP ${response.status}). Check the worker login; no inference request was made.`);
  return parsePlanModels(await response.json());
}

export function selectPlanModel(available: PlanModel[], known: readonly string[], requested?: string): string {
  const usable = available.filter((model) => known.includes(model.id));
  if (requested) {
    if (!usable.some((model) => model.id === requested)) {
      throw new UserError("That model is not in both your ChatGPT plan catalog and Pi's catalog. Run bun run sku models to choose an available model.");
    }
    return requested;
  }
  const chosen = usable.find((model) => model.id === DEFAULT_MODEL) ?? usable[0];
  if (!chosen) throw new UserError("No ChatGPT plan models overlap Pi's bundled catalog. Check plan permissions or update the worker's Pi dependencies.");
  return chosen.id;
}
