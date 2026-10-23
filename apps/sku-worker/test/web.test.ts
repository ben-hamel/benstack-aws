import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { openResearchWeb, researchWebFromClient } from "../src/web.ts";

const url = "https://www.costco.ca/product.html";
const html = '<script type="application/ld+json">{"@type":"Product","sku":"1572430","name":"Bounce"}</script>';
function rawResult() {
  // Actual pi-web-access 0.41.0 MCP results have content only, no structuredContent.
  return { content: [
    { type: "text" as const, text: html },
    { type: "text" as const, text: '\n---\nFull content is stored as responseId "safe-id". Use get_search_content({ responseId: "safe-id", urlIndex: 0, offset: 0 }) to retrieve it.' },
  ] };
}

test("MCP adapter extracts raw product evidence using the real text-only wire contract", async () => {
  const requests: unknown[] = [];
  const client = new Client({ name: "offline-test", version: "1" });
  client.callTool = async (request) => {
    requests.push(request);
    return request.name === "fetch_content" ? rawResult() : { content: [{ type: "text", text: "public product evidence" }] };
  };
  const web = researchWebFromClient(client);
  assert.equal(await web.search("1572430", "costco.ca"), "public product evidence");
  const output = await web.fetchPage(url, undefined, "1572430");
  assert.match(output, /exact structured SKU match/);
  assert.match(output, /Bounce/);
  assert.doesNotMatch(output, /<script/);
  assert.deepEqual(requests, [
    { name: "web_search", arguments: {
      query: 'site:costco.ca "1572430"', provider: "exa", domainFilter: ["costco.ca"], numResults: 5, includeContent: false,
    } },
    { name: "fetch_content", arguments: { url, mode: "raw" } },
  ]);
  assert.throws(() => web.fetchPage("https://attacker.example/"));
  assert.throws(() => web.fetchPage(url, undefined, "not-a-sku"));
  assert.equal(requests.length, 2);
});

test("malformed contracts, tool errors, and cancellation cannot become evidence", async () => {
  const client = new Client({ name: "offline-test", version: "1" });
  const web = researchWebFromClient(client);
  client.callTool = async () => ({ content: [{ type: "text", text: html }] });
  await assert.rejects(web.fetchPage(url), /unresolved/);
  client.callTool = async () => ({ ...rawResult(), isError: true });
  await assert.rejects(web.fetchPage(url), /unresolved/);
  const controller = new AbortController();
  client.callTool = async () => { controller.abort(); return rawResult(); };
  await assert.rejects(web.fetchPage(url, controller.signal), /interrupted/);
});

test("MCP errors cannot be confused with missing products, and search output is bounded", async () => {
  const client = new Client({ name: "offline-test", version: "1" });
  const web = researchWebFromClient(client);
  client.callTool = async () => ({ content: [{ type: "text", text: "quota exceeded" }], isError: true });
  await assert.rejects(web.search("1572430", "costco.ca"), /quota exceeded/);
  client.callTool = async () => ({ content: [{ type: "text", text: "x".repeat(20_000) }] });
  assert.equal((await web.search("1572430", "costco.ca")).length, 16_000);
});

test("standalone MCP starts offline with locked-down raw fetch configuration", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-web-contract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = join(directory, "search/web-search-cache");
  await mkdir(cache, { recursive: true });
  await writeFile(join(cache, "crash-leftover.json"), "old raw HTML");
  const web = await openResearchWeb(directory);
  try {
    await assert.rejects(readFile(join(cache, "crash-leftover.json")), /ENOENT/);
    const config = JSON.parse(await readFile(join(directory, "search/web-search.json"), "utf8"));
    assert.equal(config.provider, "exa");
    assert.deepEqual(config.webSearch.allowedProviders, ["exa"]);
    assert.equal(config.allowBrowserCookies, false);
    assert.equal(config.fetchContent.redirects, "same-origin");
    assert.deepEqual(config.fetchRouting.providers, ["http"]);
    assert.equal(config.fetchRouting.allowRemoteHostedProviders, false);
    assert.deepEqual(config.fetch, { timeout: 20, defaultMode: "raw", allowedModes: ["raw"] });
    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, "leftover.json"), "raw HTML");
  } finally { await web.close(); }
  await assert.rejects(readFile(join(cache, "leftover.json")), /ENOENT/);
});
