import { describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { createWebRuntime, parseEndpoint, parseMode } from "../src/web-function/runtime";
import { decodeParameters, parameterNames, parseConfigurationSource, prepareApplicationConfiguration } from "../src/web-function/config";
import { localLaunch } from "../scripts/dev-web-function";

describe("Web Function safety and runtime", () => {
  test("defaults to smoke and loopback; invalid modes and addresses fail closed", () => {
    expect(parseMode()).toBe("smoke");
    expect(parseEndpoint()).toEqual({ hostname: "127.0.0.1", port: 3100 });
    expect(parseEndpoint("0.0.0.0:8080")).toEqual({ hostname: "0.0.0.0", port: 8080 });
    expect(parseEndpoint("[::1]:8080")).toEqual({ hostname: "::1", port: 8080 });
    for (const value of ["", "production", "SMOKE"]) expect(() => parseMode(value)).toThrow();
    for (const value of ["localhost", "localhost:0", "localhost:65536", "localhost:abc", ":3000"]) {
      expect(() => parseEndpoint(value)).toThrow();
    }
  });

  test("smoke never initializes the real application, even for API requests", async () => {
    let calls = 0;
    const runtime = createWebRuntime("smoke", async () => {
      calls++;
      throw new Error("Must never run");
    });
    expect((await runtime.request("/health")).status).toBe(200);
    expect((await runtime.request("/ready")).status).toBe(200);
    expect((await runtime.request("/api/auth/session")).status).toBe(503);
    const stream = await runtime.request("/__smoke/stream");
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(await stream.text()).toContain("data: second");
    expect(calls).toBe(0);
  });

  test("bind/readiness does not initialize; concurrent app requests share initialization", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runtime = createWebRuntime("application", async () => {
      calls++;
      await gate;
      return { fetch: (request) => new Response(new URL(request.url).pathname) };
    });
    expect((await runtime.request("/health")).status).toBe(200);
    expect((await runtime.request("/ready")).status).toBe(503);
    expect(calls).toBe(0);
    const requests = [runtime.request("/one"), runtime.request("/two")];
    release();
    const responses = await Promise.all(requests);
    expect(await responses[0]!.text()).toBe("/one");
    expect(await responses[1]!.text()).toBe("/two");
    expect(calls).toBe(1);
    expect((await runtime.request("/ready")).status).toBe(200);
  });

  test("failed initialization stays failed and does not disclose secrets", async () => {
    let calls = 0;
    const runtime = createWebRuntime("application", async () => {
      calls++;
      throw new Error("secret-database-url");
    });
    for (let i = 0; i < 2; i++) {
      const response = await runtime.request("/api/chats");
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("secret-database-url");
    }
    expect(calls).toBe(1);
    expect((await runtime.request("/ready")).status).toBe(503);
  });

  test("local full-app configuration uses existing environment without calling SSM", async () => {
    let ssmCalls = 0;
    const loadSSM = async () => { ssmCalls++; };
    expect(parseConfigurationSource()).toBe("ssm");
    expect(parseConfigurationSource("environment")).toBe("environment");
    for (const value of ["", "auto", "env"]) {
      expect(() => parseConfigurationSource(value)).toThrow();
    }
    await prepareApplicationConfiguration("environment", loadSSM);
    expect(ssmCalls).toBe(0);
    await prepareApplicationConfiguration("ssm", loadSSM);
    expect(ssmCalls).toBe(1);
  });

  test("local command enables the full app, keeps existing config and uses port 3000", () => {
    const options = localLaunch({
      DATABASE_URL: "fixture-not-connected",
      BETTER_AUTH_URL: "http://localhost:3000",
      WEB_FUNCTION_MODE: "smoke",
      WEB_FUNCTION_CONFIG: "ssm",
      AWS_LAMBDA_HTTP_ENDPOINT: "cloud-host:9999",
    });
    expect(options.env.WEB_FUNCTION_MODE).toBe("application");
    expect(options.env.WEB_FUNCTION_CONFIG).toBe("environment");
    expect(options.env.NODE_ENV).toBe("development");
    expect(options.env.AWS_LAMBDA_HTTP_ENDPOINT).toBe("127.0.0.1:3000");
    expect(options.env.DATABASE_URL).toBe("fixture-not-connected");
    expect(options.env.BETTER_AUTH_URL).toBe("http://localhost:3000");
    expect(options.cmd).toContain("--env-file-if-exists=.env.local");
    expect(options.cwd).toMatch(/apps\/server\/$/);
    expect(localLaunch({ WEB_FUNCTION_LOCAL_ENDPOINT: "127.0.0.1:3100" }).env.AWS_LAMBDA_HTTP_ENDPOINT).toBe("127.0.0.1:3100");
  });

  test("SSM configuration cannot select the production namespace", () => {
    for (const value of [undefined, "", "/benstack/", "/benstack-staging", "/benstack-staging/../benstack/"]) {
      expect(() => parameterNames(value)).toThrow();
    }
    const names = parameterNames("/benstack-staging/api/");
    expect(Object.keys(names)).toHaveLength(7);
    expect(names.DATABASE_URL).toBe("/benstack-staging/api/neon-database-url");
    const params = Object.values(names).map((Name) => ({ Name, Value: "fake" }));
    expect(decodeParameters(names, params).DATABASE_URL).toBe("fake");
    expect(() => decodeParameters(names, params.slice(1))).toThrow();
    expect(() => decodeParameters(names, params, [names.DATABASE_URL!])).toThrow();
  });

  test("infrastructure is separate, disabled, single-region and IAM protected", async () => {
    const template = await Bun.file(new URL("../../../infra/web-function-staging/template.json", import.meta.url)).json();
    expect(template.Parameters.EnableResources.Default).toBe("no");
    expect(template.Parameters.RuntimeMode.Default).toBe("smoke");
    for (const resource of Object.values(template.Resources) as { Condition: string }[]) {
      expect(resource.Condition).toBe("ResourcesApproved");
    }
    const endpoint = template.Resources.Endpoint.Properties;
    expect(endpoint.AuthType).toBe("IamAuth");
    expect(endpoint.EndpointType).toBe("HomeRegion");
    expect(endpoint.ThrottleConfig.RateLimit).toBe(0);
    expect(endpoint.ScalingConfig.MaxEnvironments).toBe(2);
    expect(template.Resources.Revision.Properties.BuildConfig.RuntimeConfig.Runtime).toBe("nodejs24.x");
  });

  test("bundled server runs on Node and sends the first SSE chunk before the last", async () => {
    // Reserve a loopback port; no AWS credentials or app env enter the subprocess.
    const reservation = createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const address = reservation.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const port = address.port;
    await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
    const bundle = fileURLToPath(new URL("../dist/web-function/index.js", import.meta.url));
    const child = Bun.spawn(["node", bundle], {
      env: { PATH: process.env.PATH!, WEB_FUNCTION_MODE: "smoke", AWS_LAMBDA_HTTP_ENDPOINT: `127.0.0.1:${port}` },
      stdout: "pipe", stderr: "pipe",
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      let listening = false;
      for (let i = 0; i < 100; i++) {
        try {
          listening = (await fetch(base + "/health")).ok;
          if (listening) break;
        } catch {}
        await Bun.sleep(25);
      }
      expect(listening).toBe(true);
      const response = await fetch(base + "/__smoke/stream");
      const reader = response.body!.getReader();
      const first = await reader.read();
      const chunk = new TextDecoder().decode(first.value);
      expect(chunk).toContain("data: first");
      expect(chunk).not.toContain("data: second");
      let rest = "";
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        rest += new TextDecoder().decode(next.value);
      }
      expect(rest).toContain("data: second");
      expect((await fetch(base + "/api/chats")).status).toBe(503);
    } finally {
      child.kill("SIGTERM");
      await child.exited;
    }
  }, 10_000);
});
