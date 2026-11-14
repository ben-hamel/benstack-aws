// Shared with the browser integration tests; never reads .env files itself.
export function developmentNetworking(env: Record<string, string | undefined>) {
  const enabled = env.DEV_API_PROXY === "1";
  if (env.DEV_API_PROXY && !["0", "1"].includes(env.DEV_API_PROXY)) {
    throw new Error("DEV_API_PROXY must be 0 or 1");
  }
  const server = {
    host: env.DEV_SERVER_HOST || "127.0.0.1",
    port: 3001,
    strictPort: true,
    allowedHosts: env.DEV_SERVER_ALLOWED_HOSTS
      ? env.DEV_SERVER_ALLOWED_HOSTS.split(",").map((host) => host.trim())
      : undefined,
  };
  const define: Record<string, string> = {};
  let proxy: Record<string, { target: string; changeOrigin: boolean; proxyTimeout: number }> | undefined;
  if (enabled) {
    const target = new URL(env.DEV_API_PROXY_TARGET || "http://127.0.0.1:3000");
    if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
      || target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
      throw new Error("Development API proxy target must be an HTTP loopback origin");
    }
    const apiProxy = {
      target: target.origin,
      changeOrigin: false,
      // Keep paths, Origin/Cookie/Set-Cookie and streaming bodies intact.
      // No forwarded-host trust or cookie-domain rewriting is necessary.
      proxyTimeout: 0,
    };
    proxy = { "^/api(?:/|$)": apiProxy };
    // All existing API consumers, including Better Auth, use the browser-facing
    // origin. This override is returned only for development, never a build.
    define["import.meta.env.VITE_SERVER_URL"] = "window.location.origin";
  }
  return { server: { ...server, proxy }, define };
}
