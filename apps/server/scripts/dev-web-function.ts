import { fileURLToPath } from "node:url";

export function localLaunch<T extends NodeJS.ProcessEnv>(environment: T) {
  return {
    cmd: [
      "node",
      "--env-file-if-exists=.env",
      "--env-file-if-exists=.env.development",
      "--env-file-if-exists=.env.local",
      "dist/web-function/index.js",
    ],
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: {
      ...environment,
      NODE_ENV: "development",
      WEB_FUNCTION_MODE: "application",
      WEB_FUNCTION_CONFIG: "environment",
      // Match the existing frontend/auth API URL without changing their config.
      // Use an explicit override rather than accidentally inheriting a cloud bind.
      AWS_LAMBDA_HTTP_ENDPOINT: environment.WEB_FUNCTION_LOCAL_ENDPOINT ?? "127.0.0.1:3000",
    },
  };
}

if (import.meta.main) {
  const child = Bun.spawn({ ...localLaunch(process.env), stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.exit(await child.exited);
}
