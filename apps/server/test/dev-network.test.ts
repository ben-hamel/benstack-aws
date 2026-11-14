import { expect, test } from "bun:test";
import { developmentNetworking } from "@benstack-aws/config/dev-network";

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
