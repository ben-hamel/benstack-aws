import { expect, test } from "bun:test";
import { developmentNetworking } from "@benstack-aws/config/dev-network";
import { developmentPlan } from "@benstack-aws/config/dev-launch";

test("proxy is opt-in; ordinary dev preserves its existing backend URL", () => {
  const config = developmentNetworking({});
  expect(config.server.host).toBe("127.0.0.1");
  expect(config.server.strictPort).toBe(true);
  expect(config.server.proxy).toBeUndefined();
  expect(config.define).toEqual({});
  expect(() => developmentNetworking({ DEV_API_PROXY: "true" })).toThrow();
});

test("same-origin proxy preserves host, auth paths, cookies and streaming", () => {
  const config = developmentNetworking({ DEV_API_PROXY: "1" });
  const rule = config.server.proxy!["^/api(?:/|$)"]!;
  expect(rule).toEqual({ target: "http://127.0.0.1:3000", changeOrigin: false, proxyTimeout: 0 });
  expect(config.define["import.meta.env.VITE_SERVER_URL"]).toBe("window.location.origin");
  const paths = new RegExp(Object.keys(config.server.proxy!)[0]!);
  expect(paths.test("/api/auth/get-session")).toBe(true);
  expect(paths.test("/api/receipts")).toBe(true);
  expect(paths.test("/apiculture")).toBe(false);
});

test("proxy rejects non-loopback targets and URL credentials/rewrites", () => {
  for (const target of ["https://example.com", "http://100.67.130.3:3000", "http://user:pass@127.0.0.1:3000", "http://127.0.0.1:3000/api", "http://127.0.0.1:3000/?key=value"]) {
    expect(() => developmentNetworking({ DEV_API_PROXY: "1", DEV_API_PROXY_TARGET: target })).toThrow();
  }
});

test("network launcher keeps API on loopback and aligns public auth/frontend URLs", () => {
  const plan = developmentPlan("network", "100.67.130.3", { DATABASE_URL: "fixture-not-connected", VITE_SERVER_URL: "https://old.example", WEB_FUNCTION_LOCAL_ENDPOINT: "0.0.0.0:3000" });
  expect(plan.frontendOrigin).toBe("http://100.67.130.3:3001");
  expect(plan.apiEnv.WEB_FUNCTION_LOCAL_ENDPOINT).toBe("127.0.0.1:3000");
  expect(plan.apiEnv.BETTER_AUTH_URL).toBe(plan.frontendOrigin);
  expect(plan.apiEnv.CORS_ORIGIN).toBe(plan.frontendOrigin);
  expect(plan.apiEnv.DATABASE_URL).toBe("fixture-not-connected");
  expect(plan.webEnv.DEV_SERVER_HOST).toBe("100.67.130.3");
  expect(plan.webEnv.DEV_API_PROXY).toBe("1");
  expect(plan.webEnv.VITE_SERVER_URL).toBe(plan.frontendOrigin);
  expect(plan.webEnv.VITE_RESEARCH_DEMO).toBe("false");
});

test("launcher refuses public/all-interface binds", () => {
  for (const host of ["0.0.0.0", "192.168.1.5", "example.com", "100.128.0.1", "100.67.999.1"]) {
    expect(() => developmentPlan("network", host)).toThrow();
  }
  expect(developmentPlan("local", "127.0.0.1").frontendOrigin).toBe("http://127.0.0.1:3001");
  expect(() => developmentPlan("local", "100.67.130.3")).toThrow();
});
