import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer as reserveServer } from "node:net";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { createAuthClient } from "better-auth/react";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, getTableColumns, is, Table } from "drizzle-orm";
import { getSchema } from "better-auth/db";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuth, type AuthDatabase } from "@benstack-aws/auth/factory";
import * as schema from "@benstack-aws/db/schema/auth";
import { createAuthMiddlewares } from "../src/middleware/auth-factory";
import type { AppEnv } from "../src/types/hono";

declare const window: { testAuth: ReturnType<typeof createAuthClient> };

async function freePort() {
  const socket = reserveServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const address = socket.address();
  if (!address || typeof address === "string") throw new Error("No loopback port");
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

// In-memory PostgreSQL only. Never imports the normal DB/env singleton, reads
// app .env files, accepts DATABASE_URL, or runs a provider/worker. Schema comes
// from today's Drizzle definitions, not the historical migration ledger.
describe("real Better Auth integration (disposable PostgreSQL + Chromium)", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let backend: Server;
  let vite: ViteDevServer;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let frontendURL: string;
  let apiURL: string;
  let auth: ReturnType<typeof createAuth>;
  const password = "fixture-only-password-2026";

  beforeAll(async () => {
    client = new PGlite();
    database = drizzle(client, { schema });
    const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
    for (const statement of statements) await client.exec(statement);
    const apiPort = await freePort();
    const webPort = await freePort();
    apiURL = `http://127.0.0.1:${apiPort}`;
    frontendURL = `http://127.0.0.1:${webPort}`;
    auth = createAuth(database as unknown as AuthDatabase, {
      BETTER_AUTH_URL: apiURL,
      BETTER_AUTH_SECRET: "fixture-only-secret-at-least-thirty-two-characters",
      CORS_ORIGIN: frontendURL,
      ALLOWED_EMAILS: "alice@example.test,bob@example.test",
    });
    const app = new Hono<AppEnv>();
    app.use("*", cors({ origin: frontendURL, credentials: true }));
    app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
    const { authMiddleware, orgMiddleware } = createAuthMiddlewares(auth, database as unknown as AuthDatabase);
    app.get("/api/test/protected", authMiddleware, orgMiddleware, (c) => c.json({ userId: c.get("user")!.id, orgId: c.get("orgId") }));
    backend = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: apiPort }) as Server;

    vite = await createServer({
      configFile: false, envFile: false,
      root: fileURLToPath(new URL("../../web", import.meta.url)),
      cacheDir: fileURLToPath(new URL("../dist/auth-test-vite-cache", import.meta.url)),
      optimizeDeps: { noDiscovery: true, include: ["better-auth/react", "zod"] },
      define: { "import.meta.env.VITE_SERVER_URL": JSON.stringify(apiURL) },
      server: { host: "127.0.0.1", port: webPort, strictPort: true, fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] } },
      plugins: [{
        name: "disposable-auth-fixture",
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url !== "/__auth_test") return next();
            res.setHeader("Content-Type", "text/html");
            res.end('<!doctype html><html><body>Disposable auth integration fixture<script type="module">import { authClient } from "/src/lib/auth-client.ts"; window.testAuth = authClient;</script></body></html>');
          });
        },
      }],
    });
    await vite.listen();
    const browserEnv: Record<string, string> = { PATH: process.env.PATH!, HOME: homedir() };
    const libraries = process.env.AUTH_TEST_BROWSER_LIB_DIR ?? join(homedir(), ".cache/benstack-browser-libs/root/usr/lib64");
    if (existsSync(libraries)) browserEnv.LD_LIBRARY_PATH = libraries;
    const fonts = join(homedir(), ".cache/benstack-browser-libs/fonts.conf");
    if (existsSync(fonts)) browserEnv.FONTCONFIG_FILE = fonts;
    browser = await chromium.launch({ headless: true, env: browserEnv });
    context = await browser.newContext();
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
    });
    page = await context.newPage();
    await page.goto(frontendURL + "/__auth_test");
    await page.waitForFunction(() => !!window.testAuth);
  }, 60_000);

  afterAll(async () => {
    await context?.close();
    await browser?.close();
    await vite?.close();
    if (backend) await new Promise<void>((resolve) => { backend.closeAllConnections(); backend.close(() => resolve()); });
    await client?.close();
  });

  async function requestProtected() {
    return page.evaluate(async (url) => {
      const response = await fetch(url + "/api/test/protected", { credentials: "include" });
      return { status: response.status, data: await response.json() as { userId?: string; orgId?: string } };
    }, apiURL);
  }

  test("configured auth models fit the current Drizzle schema without persistent DDL", () => {
    const tables = Object.fromEntries(Object.entries(schema).filter(([, value]) => is(value, Table)));
    for (const [name, definition] of Object.entries(getSchema(auth.options))) {
      const table = tables[name];
      expect(table, `Missing auth table: ${name}`).toBeDefined();
      if (!table) continue;
      const columns = getTableColumns(table as Table);
      for (const field of Object.keys(definition.fields)) {
        expect(columns[field], `Missing auth field: ${name}.${field}`).toBeDefined();
      }
    }
  });

  test("unauthenticated protected requests are rejected", async () => {
    expect((await requestProtected()).status).toBe(401);
  });

  test("allowed registration creates an organization; existing-user login selects it", async () => {
    const registered = await page.evaluate(async ({ password }) => window.testAuth.signUp.email({ email: "alice@example.test", name: "Alice Fixture", password }), { password });
    expect(registered.error).toBeNull();
    const userId = registered.data!.user.id;
    const memberships = await database.select().from(schema.member).where(eq(schema.member.userId, userId));
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.role).toBe("owner");
    await page.evaluate(() => window.testAuth.signOut());
    const login = await page.evaluate(async ({ password }) => window.testAuth.signIn.email({ email: "alice@example.test", password }), { password });
    expect(login.error).toBeNull();
    const session = await page.evaluate(() => window.testAuth.getSession());
    expect(session.data!.user.id).toBe(userId);
    const protectedResponse = await requestProtected();
    expect(protectedResponse.status).toBe(200);
    expect(protectedResponse.data.orgId).toBe(memberships[0]!.organizationId);
    const cookies = await context.cookies();
    const sessionCookie = cookies.find((cookie) => cookie.name.endsWith("session_token"));
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe("Lax");
  });

  test("session survives a browser reload", async () => {
    await page.reload();
    await page.waitForFunction(() => !!window.testAuth);
    const session = await page.evaluate(() => window.testAuth.getSession());
    expect(session.data?.user.email).toBe("alice@example.test");
    expect((await requestProtected()).status).toBe(200);
  });

  test("untrusted mutation origins and redirect targets are rejected", async () => {
    const cookie = (await context.cookies()).filter((value) => value.name.includes("session_token")).map((value) => `${value.name}=${value.value}`).join("; ");
    const response = await fetch(apiURL + "/api/auth/sign-in/email", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://untrusted.example", Cookie: cookie },
      body: JSON.stringify({ email: "alice@example.test", password }),
    });
    expect(response.status).toBe(403);
    const redirected = await page.evaluate(async ({ password }) => window.testAuth.signIn.email({ email: "alice@example.test", password, callbackURL: "https://untrusted.example/steal" }), { password });
    expect(redirected.error).not.toBeNull();
  });

  test("a session cannot select another tenant or retain access after membership removal", async () => {
    const alice = (await database.select().from(schema.user).where(eq(schema.user.email, "alice@example.test")))[0]!;
    const ownMembership = (await database.select().from(schema.member).where(eq(schema.member.userId, alice.id)))[0]!;
    const otherOrgId = crypto.randomUUID();
    await database.insert(schema.organization).values({ id: otherOrgId, name: "Other tenant", slug: "other-tenant", createdAt: new Date() });
    const cookie = (await context.cookies()).filter((value) => value.name.includes("session_token")).map((value) => `${value.name}=${value.value}`).join("; ");
    const switched = await fetch(apiURL + "/api/auth/organization/set-active", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: frontendURL, Cookie: cookie },
      body: JSON.stringify({ organizationId: otherOrgId }),
    });
    expect(switched.status).toBe(403);
    expect((await requestProtected()).data.orgId).toBe(ownMembership.organizationId);
    await database.update(schema.session).set({ activeOrganizationId: otherOrgId }).where(eq(schema.session.userId, alice.id));
    expect((await requestProtected()).status).toBe(403);
    await database.update(schema.session).set({ activeOrganizationId: ownMembership.organizationId }).where(eq(schema.session.userId, alice.id));
    await database.delete(schema.member).where(and(eq(schema.member.userId, alice.id), eq(schema.member.organizationId, ownMembership.organizationId)));
    expect((await requestProtected()).status).toBe(403);
    await database.insert(schema.member).values(ownMembership);
  });

  test("logout revokes the session, including replay of its old cookie", async () => {
    const oldCookie = (await context.cookies()).filter((value) => value.name.includes("session_token")).map((value) => `${value.name}=${value.value}`).join("; ");
    const result = await page.evaluate(() => window.testAuth.signOut());
    expect(result.error).toBeNull();
    expect((await requestProtected()).status).toBe(401);
    expect((await page.evaluate(() => window.testAuth.getSession())).data).toBeNull();
    const replay = await fetch(apiURL + "/api/test/protected", { headers: { Cookie: oldCookie } });
    expect(replay.status).toBe(401);
  });

  test("an existing 1.5.5 password hash still signs in after the upgrade", async () => {
    // Generated and verified with better-auth@1.5.5 for this synthetic password.
    // This is fixture data, never copied from a real account.
    const hash = "8b87446bb465cc86108fab168180055a:69ffeb7c16d0cc1efd8f9f8eb288af0bc4f8fab49fe5088307329a83385c2dc5a857e9d53386a6a9e85836ca36d40ae98e024ef13a66f4dbe7aee36edd06aac2";
    const id = crypto.randomUUID();
    await database.insert(schema.user).values({ id, name: "Legacy Fixture", email: "bob@example.test" });
    await database.insert(schema.account).values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: hash, createdAt: new Date(), updatedAt: new Date() });
    const result = await page.evaluate(async ({ password }) => window.testAuth.signIn.email({ email: "bob@example.test", password }), { password });
    expect(result.error).toBeNull();
    expect((await page.evaluate(() => window.testAuth.getSession())).data?.user.id).toBe(id);
    await page.evaluate(() => window.testAuth.signOut());
  });

  test("invalid credentials and non-allowlisted registration fail", async () => {
    const invalid = await page.evaluate(() => window.testAuth.signIn.email({ email: "alice@example.test", password: "wrong-password" }));
    expect(invalid.error?.status).toBe(401);
    const outsider = await page.evaluate(async ({ password }) => window.testAuth.signUp.email({ email: "outsider@example.test", password, name: "Outsider" }), { password });
    expect(outsider.error).not.toBeNull();
    expect(await database.select().from(schema.user).where(eq(schema.user.email, "outsider@example.test"))).toHaveLength(0);
  });
});
