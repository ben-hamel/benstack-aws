import assert from "node:assert/strict";
import { test } from "node:test";
import type { Models } from "@earendil-works/pi-ai/models";
import { openOpenAIResearchWeb, readHostedSearch } from "../src/openai-search.ts";

const url = "https://www.costcobusinesscentre.ca/p/-/green-onions-907-g/2001177256";
const search = { type: "web_search_call", id: "search-1", status: "completed" };
const message = { type: "message", content: [{ type: "output_text", text: "Item 3028018: Green onions, 907 g.", annotations: [
  { type: "url_citation", url },
] }] };
function sse(events: unknown[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}
function completed() {
  return sse([
    { type: "response.output_text.delta", delta: "Item 3028018: Green onions, 907 g." },
    { type: "response.output_item.done", item: search },
    { type: "response.output_item.done", item: message },
    { type: "response.completed", response: { output: [search, message] } },
  ]);
}

test("hosted-search stream requires completion, real search calls and Costco citations", async () => {
  const result = await readHostedSearch(completed());
  assert.match(result, /model-generated, not a direct page extract/);
  assert.match(result, /Hosted search calls: 1/);
  assert.match(result, /3028018/);
  assert.match(result, /Green onions, 907 g/);
  assert.ok(result.includes(url));
  await assert.rejects(readHostedSearch(sse([{ type: "response.completed", response: { output: [message] } }])), /No hosted web-search/);
  await assert.rejects(readHostedSearch(sse([{ type: "response.completed", response: { output: [search] } }])), /no supported Costco/);
});

test("partial output and streaming usage-limit errors are never accepted as success", async () => {
  await assert.rejects(readHostedSearch(sse([
    { type: "response.output_text.delta", delta: "Partial plausible answer" },
    { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } },
  ])), /did not complete/);
  await assert.rejects(readHostedSearch(sse([{ type: "response.output_item.done", item: search }])), /did not complete/);
  await assert.rejects(readHostedSearch(new Response("private diagnostic not to expose", { status: 400 })), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /HTTP 400/);
    assert.doesNotMatch(error.message, /private diagnostic/);
    return true;
  });
});

test("hosted-search parser handles split SSE frames and UTF-8 chunks", async () => {
  const original = `data: ${JSON.stringify({ type: "response.completed", response: { output: [search, {
    ...message, content: [{ type: "output_text", text: "Oignons verts — 907 g", annotations: [{ type: "url_citation", url }] }],
  }] } })}\r\n\r\n`;
  const bytes = new TextEncoder().encode(original);
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  } });
  assert.match(await readHostedSearch(new Response(stream)), /Oignons verts — 907 g/);
});

test("OpenAI search is independent of the reasoning model and sends only approved request fields", async () => {
  const models: Pick<Models, "getAuth"> = {
    getAuth: async () => ({ auth: { apiKey: "test-access-not-a-real-token" } }),
  };
  let calls = 0;
  let openedPages = 0;
  let closedPages = 0;
  const request: typeof fetch = async (endpoint, options) => {
    calls++;
    assert.equal(endpoint, "https://api.openai.com/v1/responses");
    assert.equal(options?.redirect, "error");
    assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer test-access-not-a-real-token");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, "gpt-6.1-sol");
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    assert.equal(body.tool_choice, "required");
    assert.deepEqual(body.tools, [{ type: "web_search", filters: { allowed_domains: ["costcobusinesscentre.ca"] } }]);
    assert.ok(body.input[0].content.includes("3028018"));
    for (const key of ["max_output_tokens", "temperature", "metadata", "previous_response_id"]) assert.equal(body[key], undefined);
    return completed();
  };
  const web = openOpenAIResearchWeb("unused-private-path", models, "gpt-6.1-sol", request, async () => {
    openedPages++;
    return {
      search: async () => { throw new Error("Exa must not be called"); },
      fetchPage: async (_url, _signal, sku) => { assert.equal(sku, "3028018"); return "page evidence"; },
      close: async () => { closedPages++; },
    };
  });
  try {
    assert.match(await web.search("3028018", "costcobusinesscentre.ca"), /Green onions/);
    assert.equal(openedPages, 0, "hosted search needs no MCP process");
    assert.equal(await web.fetchPage(url, undefined, "3028018"), "page evidence");
    assert.equal(openedPages, 1);
    assert.equal(closedPages, 1, "release raw body memory immediately after each page");
    assert.equal(calls, 1);
    await assert.rejects(web.search("bad sku", "costco.ca"));
    assert.throws(() => web.fetchPage("https://attacker.example/"));
    assert.equal(calls, 1);
  } finally { await web.close(); }
});
