import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { privateDirectory, UserError, writeJson } from "./state.ts";

export const COSTCO_SITES = ["costco.ca", "sameday.costco.ca", "costcobusinesscentre.ca"] as const;
export type CostcoSite = typeof COSTCO_SITES[number];

export function validateSku(sku: string): string {
  if (!/^\d{1,12}$/.test(sku)) throw new UserError("Use a numeric Costco item number (1-12 digits).");
  return sku;
}

export function validateProductUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new UserError("Provide a full HTTPS Costco Canada URL."); }
  const host = url.hostname.replace(/^www\./, "");
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || !COSTCO_SITES.some((site) => site === host)) {
    throw new UserError("Only HTTPS pages on the three supported Costco Canada sites are allowed.");
  }
  url.hash = "";
  return url.href;
}

export interface ResearchWeb {
  search(sku: string, site: CostcoSite, signal?: AbortSignal): Promise<string>;
  fetchPage(url: string, signal?: AbortSignal): Promise<string>;
  close(): Promise<void>;
}

/** Deliberately omit parent AWS/OpenAI credentials, project .env, and personal Pi configuration. */
export function searchEnvironment(home: string): Record<string, string> {
  return {
    HOME: home,
    PATH: dirname(process.execPath),
    PI_CODING_AGENT_DIR: home,
    XDG_CONFIG_HOME: home,
    PI_WEB_ACCESS_CACHE_ROOT: home,
    NO_COLOR: "1",
  };
}

export async function openResearchWeb(directory: string): Promise<ResearchWeb> {
  const searchHome = join(directory, "search");
  await privateDirectory(searchHome);
  await writeJson(join(searchHome, "web-search.json"), {
    provider: "exa",
    webSearch: { allowedProviders: ["exa"] },
    workflow: "none",
    maxInlineContentChars: 16_000,
    allowBrowserCookies: false,
    githubClone: { enabled: false },
    githubPrIssue: { enabled: false },
    image: { enabled: false },
    pdf: { enabled: false },
    fetch: { timeout: 20, defaultMode: "readable", allowedModes: ["readable"] },
    fetchRouting: { providers: ["http"], allowRemoteHostedProviders: false },
    fetchContent: { domainPolicy: { allow: [...COSTCO_SITES] }, redirects: "same-origin" },
  });
  const packagePath = import.meta.resolve("pi-web-access/package.json");
  const entry = join(dirname(fileURLToPath(packagePath)), "dist/mcp-cli.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: searchEnvironment(searchHome),
    cwd: searchHome,
    stderr: "ignore",
  });
  const client = new Client({ name: "benstack-sku-worker", version: "0.1.0" });
  try {
    await client.connect(transport, { timeout: 20_000 });
  } catch {
    await client.close().catch(() => undefined);
    throw new UserError("The standalone web-search process could not start.");
  }
  return researchWebFromClient(client);
}

/** Small MCP-to-worker adapter; injectable so tool contracts can be tested offline. */
export function researchWebFromClient(client: Pick<Client, "callTool" | "close">): ResearchWeb {
  async function call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    try {
      const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }, CallToolResultSchema, {
        timeout: 45_000,
        maxTotalTimeout: 45_000,
        signal,
      }));
      const text = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      if (result.isError) throw new UserError(`Search/fetch service error: ${text.slice(0, 500)}`);
      return text.slice(0, 16_000);
    } catch (error) {
      if (signal?.aborted) throw new UserError("Web request interrupted; saved work can be resumed.");
      if (error instanceof UserError) throw error;
      // This process has no credentials and uses only public search/page requests.
      const reason = error instanceof Error ? error.message.slice(0, 500) : "unknown transport error";
      throw new UserError(`Web request failed: ${reason}. This is not evidence that the product does not exist.`);
    }
  }

  return {
    search(sku, site, signal) {
      validateSku(sku);
      if (!COSTCO_SITES.includes(site)) throw new UserError("Unsupported Costco site.");
      return call("web_search", {
        query: `site:${site} "${sku}"`,
        provider: "exa",
        domainFilter: [site],
        numResults: 5,
        includeContent: false,
      }, signal);
    },
    fetchPage(url, signal) {
      // Redirect policy is enforced by the MCP process config, not its per-call schema.
      return call("fetch_content", { url: validateProductUrl(url), mode: "readable" }, signal);
    },
    close: () => client.close(),
  };
}
