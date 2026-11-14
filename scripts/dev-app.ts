import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { developmentPlan } from "@benstack-aws/config/dev-launch";

const args = process.argv.slice(2).filter((value) => value !== "--");
if (args.length !== 1 || !["--local", "--network"].includes(args[0]!)) {
  console.log("Usage: bun run dev:local | bun run dev:network");
  process.exit(args.includes("--help") ? 0 : 1);
}
const mode = args[0] === "--network" ? "network" : "local";
let host = "127.0.0.1";
if (mode === "network") {
  const address = Bun.spawnSync(["tailscale", "ip", "-4"], { stdout: "pipe", stderr: "pipe" });
  if (address.exitCode !== 0) throw new Error("Connect Tailscale first, or use bun run dev:local");
  host = new TextDecoder().decode(address.stdout).trim();
}
const plan = developmentPlan(mode, host, process.env);
const root = fileURLToPath(new URL("../", import.meta.url));
const apiDir = join(root, "apps/server");
const webDir = join(root, "apps/web");

async function checkPort(hostname: string, port: number) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", () => reject(new Error(`${hostname}:${port} unavailable. Stop the existing dev server first.`)));
    server.listen(port, hostname, () => server.close((error) => error ? reject(error) : resolve()));
  });
}
await checkPort("127.0.0.1", 3000);
await checkPort(host, 3001);
const build = Bun.spawn([process.execPath, "--no-env-file", "scripts/build-web-function.ts"], {
  cwd: apiDir, stdin: "inherit", stdout: "inherit", stderr: "inherit",
});
if (await build.exited !== 0) throw new Error("API build failed; no dev servers started");
const vitePackage = Bun.resolveSync("vite/package.json", webDir);
const children = [
  Bun.spawn([process.execPath, "--no-env-file", "scripts/dev-web-function.ts"], {
    cwd: apiDir, env: plan.apiEnv, stdin: "inherit", stdout: "inherit", stderr: "inherit",
  }),
  Bun.spawn(["node", join(dirname(vitePackage), "bin/vite.js"), "--strictPort"], {
    cwd: webDir, env: plan.webEnv, stdin: "inherit", stdout: "inherit", stderr: "inherit",
  }),
];
console.log(`\nStarting full development app: ${plan.frontendOrigin}`);
console.log(`API: ${plan.apiOrigin} (private loopback; browser uses /api through Vite)`);
console.log(mode === "network" ? "Requires Tailscale on the browsing device." : "Local machine only.");
console.log("No deployment. Uses your existing dev database/config; real uploads or AI requests can incur their usual costs.");
console.log("Ctrl+C stops both servers. Restart after API code edits.\n");
const stop = () => { for (const child of children) { try { child.kill("SIGTERM"); } catch {} } };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const result = await Promise.race(children.map((child) => child.exited));
stop();
await Promise.all(children.map((child) => child.exited));
process.exitCode = result;
