import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { decideResearch, getResearch, listResearch, researchAgain, researchContext, ResearchError } from "@benstack-aws/product-research";
import type { ResearchDatabase } from "@benstack-aws/product-research/database";
import type { AppEnv } from "../../types/hono";
import type { AdmissionPolicy } from "@benstack-aws/receipt-import/policy";

export function createResearchRoutes(options: { db: ResearchDatabase; origin: string; middleware: MiddlewareHandler<AppEnv>[]; admissionPolicy?: AdmissionPolicy }) {
  const app = new Hono<AppEnv>();
  for (const middleware of options.middleware) app.use("*", middleware);
  app.use("*", bodyLimit({ maxSize: 16_384 }));
  app.use("*", async (c, next) => {
    if (!c.get("user") || !c.get("orgId")) return c.json({ error: "Authentication and current organization required." }, 401);
    if (c.req.method === "POST" && c.req.header("origin") !== options.origin) return c.json({ error: "Trusted browser origin required." }, 403);
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof ResearchError) return c.json({ error: error.message }, error.status);
    if ((error instanceof HTTPException && error.status === 413) || error.name === "BodyLimitError") return c.json({ error: "Action payload too large." }, 413);
    if (error instanceof SyntaxError) return c.json({ error: "Invalid JSON action." }, 400);
    console.error("Product research operation failed; diagnostics withheld.");
    return c.json({ error: "Research operation failed. Refresh and try again." }, 500);
  });
  app.get("/", async (c) => c.json(await listResearch(options.db, { userId: c.get("user")!.id, organizationId: c.get("orgId")! }, c.req.query())));
  app.get("/context", async (c) => c.json(await researchContext(options.db, { userId: c.get("user")!.id, organizationId: c.get("orgId")! })));
  app.get("/:id", async (c) => {
    if (!z.uuid().safeParse(c.req.param("id")).success) throw new ResearchError(400, "Invalid request ID.");
    return c.json(await getResearch(options.db, { userId: c.get("user")!.id, organizationId: c.get("orgId")! }, c.req.param("id")));
  });
  for (const action of ["approve", "reject", "research-again"] as const) app.post(`/:id/${action}`, async (c) => {
    if (!z.uuid().safeParse(c.req.param("id")).success) throw new ResearchError(400, "Invalid request ID.");
    const actor = { userId: c.get("user")!.id, organizationId: c.get("orgId")! }, input: unknown = await c.req.json();
    return c.json(action === "research-again" ? await researchAgain(options.db, actor, c.req.param("id"), input, options.admissionPolicy)
      : await decideResearch(options.db, actor, c.req.param("id"), action, input));
  });
  return app;
}
