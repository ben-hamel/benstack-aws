import { auth } from "@benstack-aws/auth";
import { env } from "@benstack-aws/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import receiptsRoutes from "./modules/receipts/receipts.routes";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
app.route("/api/receipts", receiptsRoutes);

app.get("/", (c) => {
  return c.text("OK");
});

app.get("/health", (c) => {
  return c.text("healthy");
});

export default app;
