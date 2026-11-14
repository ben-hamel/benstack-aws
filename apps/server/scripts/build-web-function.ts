import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const outdir = root + "dist/web-function";
await mkdir(outdir, { recursive: true });
const result = await Bun.build({
  entrypoints: [root + "src/web-function.ts"],
  outdir,
  naming: "index.js",
  target: "node",
  format: "esm",
  packages: "bundle",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
await writeFile(outdir + "/package.json", JSON.stringify({ type: "module" }) + "\n");
console.log("Local artifact only: apps/server/dist/web-function/{index.js,package.json}");
