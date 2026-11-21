import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

export type WebMode = "smoke" | "application";
type FetchApp = { fetch: (request: Request) => Response | Promise<Response> };

export function parseMode(value = "smoke"): WebMode {
  if (value !== "smoke" && value !== "application") {
    throw new Error("WEB_FUNCTION_MODE must be smoke or application");
  }
  return value;
}

export function parseEndpoint(value = "127.0.0.1:3100") {
  const match = /^(\[[^\]]+\]|[^:\s]+):(\d+)$/.exec(value);
  const port = Number(match?.[2]);
  if (!match || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("AWS_LAMBDA_HTTP_ENDPOINT must be host:port with port 1-65535");
  }
  return { hostname: match[1]!.replace(/^\[|\]$/g, ""), port };
}

// Initialization is request-triggered, shared by concurrent requests, and never
// retried in this process after failure. Listening does not touch a database.
export function createWebRuntime(mode: WebMode, initialize: () => Promise<FetchApp>) {
  const app = new Hono();
  let initialization: Promise<FetchApp> | undefined;
  let state: "idle" | "initializing" | "ready" | "failed" = "idle";

  app.get("/health", (c) => c.json({ status: "listening", mode }));
  app.get("/ready", (c) => {
    const ready = mode === "smoke" || state === "ready";
    return c.json({ status: ready ? "ready" : state, mode }, ready ? 200 : 503);
  });

  if (mode === "smoke") {
    app.get("/__smoke/stream", (c) => streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: "message", data: "first" });
      await stream.sleep(50);
      await stream.writeSSE({ event: "message", data: "second" });
    }));
    app.all("*", (c) => c.json({ error: "Application routes disabled in smoke mode" }, 503));
  } else {
    app.all("*", async (c) => {
      if (!initialization) {
        state = "initializing";
        initialization = Promise.resolve().then(initialize).then((initialized) => {
          state = "ready";
          return initialized;
        }).catch(() => {
          state = "failed";
          // Do not log SDK/DB error messages: they can contain credentials.
          console.error("Web Function application initialization failed");
          throw new Error("Application unavailable");
        });
      }
      let initialized: FetchApp;
      try {
        initialized = await initialization;
      } catch {
        return c.json({ error: "Application unavailable" }, 503);
      }
      return initialized.fetch(c.req.raw);
    });
  }
  return app;
}
