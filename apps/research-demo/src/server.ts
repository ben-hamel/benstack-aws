import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { createDemoApi } from "./api";
import { demoHost } from "./host";

const { values } = parseArgs({ args: process.argv.slice(2), options: { port: { type: "string", default: "4173" }, host: { type: "string", default: "127.0.0.1" } }, strict: true });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local demo port");
const host = demoHost(values.host!);
const origin = `http://${host}:${port}`;
const webRoot = fileURLToPath(new URL("../../web/", import.meta.url));
const repositoryRoot = path.resolve(webRoot, "../..");

// Defense in depth for fetch-based clients: fixture execution must never contact
// providers or external pages. The app API/proxy is loopback; PGlite assets are local.
const originalFetch = globalThis.fetch;
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const target = new URL(input instanceof Request ? input.url : String(input));
  if (!["file:", "data:"].includes(target.protocol) && !(target.protocol === "http:" && target.hostname === "127.0.0.1")) {
    throw new Error("External fetch is disabled in the disposable research demo.");
  }
  return originalFetch(input, init);
}) as typeof fetch;

const demo = await createDemoApi(origin);
const backend = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: demo.app.fetch });
let vite: Awaited<ReturnType<typeof createServer>> | undefined;
let closing: Promise<void> | undefined;
function close() {
  return closing ??= (async () => { await vite?.close(); backend.stop(true); await demo.close(); })();
}
try {
  vite = await createServer({
    configFile: false, envFile: false, root: webRoot, mode: "research-demo",
    cacheDir: path.join(repositoryRoot, "node_modules/.cache/research-demo-vite", String(port)),
    plugins: [tailwindcss(), tanstackRouter({ routesDirectory: path.join(webRoot, "src/routes"), generatedRouteTree: path.join(webRoot, "src/routeTree.gen.ts") }), react(), {
      name: "research-demo-home", configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url === "/" && request.method === "GET") { response.statusCode = 302; response.setHeader("Location", "/receipts"); response.end(); }
          else next();
        });
      },
    }],
    resolve: { alias: { "@": path.join(webRoot, "src") } },
    define: { "import.meta.env.VITE_SERVER_URL": JSON.stringify(origin), "import.meta.env.VITE_RESEARCH_DEMO": JSON.stringify("true") },
    server: { host, port, strictPort: true, allowedHosts: [host],
      proxy: { "/api": { target: `http://127.0.0.1:${backend.port}`, changeOrigin: false } },
      fs: { allow: [repositoryRoot], deny: [".env", ".env.*", "*.{crt,pem,key}", "**/.git/**", "**/*.tfvars", "**/.terraform/**"] },
    },
  });
  await vite.listen();
  console.log(`\nDisposable research demo: ${origin}/receipts`);
  console.log("Fictional data only. In-memory DB. No AWS, real login, paid AI, or external page fetching.");
  console.log("Download the sample using the demo banner, then upload it. Ctrl+C deletes this in-memory session.\n");
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void close().then(() => process.exit(0)); });
} catch (error) { await close(); throw error; }
