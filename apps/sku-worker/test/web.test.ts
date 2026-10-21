import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { openResearchWeb, researchWebFromClient } from "../src/web.ts";

test("MCP adapter sends only supported search and page-fetch arguments", async () => {
  const requests: unknown[] = [];
  const client = new Client({ name: "offline-test", version: "1" });
  client.callTool = async (request) => {
    requests.push(request);
    return { content: [{ type: "text", text: "public product evidence" }] };
  };
  const web = researchWebFromClient(client);
  assert.equal(await web.search("1572430", "costco.ca"), "public product evidence");
  assert.equal(await web.fetchPage("https://www.costco.ca/product.html"), "public product evidence");
  assert.deepEqual(requests, [
    { name: "web_search", arguments: {
      query: 'site:costco.ca "1572430"', provider: "exa", domainFilter: ["costco.ca"], numResults: 5, includeContent: false,
    } },
    { name: "fetch_content", arguments: { url: "https://www.costco.ca/product.html", mode: "readable" } },
  ]);
  assert.throws(() => web.fetchPage("https://attacker.example/"));
  assert.equal(requests.length, 2);
});

test("MCP errors cannot be confused with missing products, and output is bounded", async () => {
  const client = new Client({ name: "offline-test", version: "1" });
  const web = researchWebFromClient(client);
  client.callTool = async () => ({ content: [{ type: "text", text: "quota exceeded" }], isError: true });
  await assert.rejects(web.search("1572430", "costco.ca"), /quota exceeded/);
  client.callTool = async () => ({ content: [{ type: "text", text: "x".repeat(20_000) }] });
  assert.equal((await web.search("1572430", "costco.ca")).length, 16_000);
});

test("standalone MCP starts offline with locked-down fetch configuration", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-web-contract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const web = await openResearchWeb(directory);
  try {
    const config = JSON.parse(await readFile(join(directory, "search/web-search.json"), "utf8"));
    assert.equal(config.provider, "exa");
    assert.deepEqual(config.webSearch.allowedProviders, ["exa"]);
    assert.equal(config.allowBrowserCookies, false);
    assert.equal(config.fetchContent.redirects, "same-origin");
    assert.deepEqual(config.fetchRouting.providers, ["http"]);
    assert.equal(config.fetchRouting.allowRemoteHostedProviders, false);
  } finally { await web.close(); }
});
