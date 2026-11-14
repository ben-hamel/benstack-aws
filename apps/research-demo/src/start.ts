import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { demoHost } from "./host";

// This launcher imports no application/env/db modules. The child receives only
// basic OS settings; Bun and Vite are both told not to load environment files.
export function cleanDemoEnvironment(source: Record<string, string | undefined>) {
  return Object.fromEntries(["PATH", "HOME", "LANG", "TERM"].flatMap((key) => source[key] === undefined ? [] : [[key, source[key]!]]));
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"));
  const { values } = parseArgs({ args, options: { port: { type: "string", default: "4173" }, host: { type: "string", default: "127.0.0.1" } }, strict: true });
  const host = demoHost(values.host!);
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Choose a local demo port from 1024 to 65535.");
  const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./server.ts", import.meta.url)), "--port", String(port), "--host", host], {
    cwd: fileURLToPath(new URL("../../web/", import.meta.url)), env: cleanDemoEnvironment(process.env), stdin: "inherit", stdout: "inherit", stderr: "inherit",
  });
  const stop = () => { try { child.kill("SIGTERM"); } catch { /* Already stopped. */ } };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  process.exitCode = await child.exited;
  process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
}
