import { serve } from "@hono/node-server";
import { createWebRuntime, parseEndpoint, parseMode } from "./web-function/runtime";
import { parseConfigurationSource, prepareApplicationConfiguration } from "./web-function/config";

const mode = parseMode(process.env.WEB_FUNCTION_MODE);
const endpoint = parseEndpoint(process.env.AWS_LAMBDA_HTTP_ENDPOINT);
const source = parseConfigurationSource(process.env.WEB_FUNCTION_CONFIG);

const runtime = createWebRuntime(mode, async () => {
  await prepareApplicationConfiguration(source);
  // index.ts performs DB setup. Keep it out of both startup and smoke mode.
  const { app } = await import("./index");
  return app;
});

const server = serve({ fetch: runtime.fetch, ...endpoint }, () => {
  console.log(`Web Function listening (mode=${mode})`);
});

process.on("SIGTERM", () => {
  server.close();
  setTimeout(() => process.exit(0), 900).unref();
});
