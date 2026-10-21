import assert from "node:assert/strict";
import { test } from "node:test";
import type { Models } from "@earendil-works/pi-ai/models";
import { DEFAULT_MODEL, discoverPlanModels, parsePlanModels, selectPlanModel } from "../src/models.ts";

const catalog = { models: [
  { slug: "hidden-model", display_name: "Hidden", visibility: "hide" },
  { slug: "gpt-6-luna", display_name: "GPT-6 Luna", visibility: "list" },
  { slug: "gpt-6.1-sol", display_name: "GPT-6.1 Sol", visibility: "list" },
  { slug: "bad\nmodel", visibility: "list" },
  { slug: "gpt-6.1-sol", visibility: "list" },
] };

test("ChatGPT catalog uses visible models[].slug, not API-key data[].id", () => {
  assert.deepEqual(parsePlanModels(catalog), [
    { id: "gpt-6-luna", name: "GPT-6 Luna" },
    { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" },
  ]);
  assert.throws(() => parsePlanModels({ data: [{ id: "gpt-5.4" }] }), /unexpected/);
});

test("default selection and explicit overrides must be in both catalogs", () => {
  const available = parsePlanModels(catalog);
  const known = ["gpt-5.4", "gpt-6-luna", "gpt-6.1-sol"];
  assert.equal(selectPlanModel(available, known), DEFAULT_MODEL);
  assert.equal(selectPlanModel(available, ["gpt-6-luna"]), "gpt-6-luna");
  assert.equal(selectPlanModel(available, known, "gpt-6-luna"), "gpt-6-luna");
  assert.throws(() => selectPlanModel(available, known, "gpt-5.4"), /not in both/);
  assert.throws(() => selectPlanModel(available, ["gpt-6-luna"], "gpt-6.1-sol"), /not in both/);
  assert.throws(() => selectPlanModel([], known), /No ChatGPT plan models/);
});

test("discovery uses the public endpoint and worker token, refuses redirects, and makes no inference", async () => {
  const models: Pick<Models, "getAuth"> = {
    getAuth: async () => ({ auth: { apiKey: "test-access-not-a-real-token" } }),
  };
  let calls = 0;
  const request: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/models");
    assert.equal(options?.redirect, "error");
    assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer test-access-not-a-real-token");
    return Response.json(catalog);
  };
  assert.deepEqual(await discoverPlanModels(models, new AbortController().signal, request), parsePlanModels(catalog));
  assert.equal(calls, 1);
  await assert.rejects(discoverPlanModels(models, undefined, async () => new Response("private error details", { status: 401 })), /HTTP 401/);
});
