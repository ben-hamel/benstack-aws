export function developmentPlan<T extends Record<string, string | undefined> = Record<string, string | undefined>>(
  mode: "local" | "network", host: string, inherited: T = {} as T,
) {
  const octets = host.split(".").map(Number);
  const tailnet = octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    && octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127;
  if ((mode === "local" && host !== "127.0.0.1") || (mode === "network" && !tailnet)) {
    throw new Error("Use loopback for local mode or a Tailscale IPv4 address for network mode");
  }
  const frontendOrigin = `http://${host}:3001`;
  const apiOrigin = "http://127.0.0.1:3000";
  return {
    host, frontendOrigin, apiOrigin,
    apiEnv: {
      ...inherited, NODE_ENV: "development",
      WEB_FUNCTION_LOCAL_ENDPOINT: "127.0.0.1:3000",
      BETTER_AUTH_URL: frontendOrigin, CORS_ORIGIN: frontendOrigin,
    },
    webEnv: {
      ...inherited, NODE_ENV: "development",
      DEV_SERVER_HOST: host, DEV_SERVER_ALLOWED_HOSTS: host,
      DEV_API_PROXY: "1", DEV_API_PROXY_TARGET: apiOrigin,
      VITE_SERVER_URL: frontendOrigin, VITE_RESEARCH_DEMO: "false",
    },
  };
}
