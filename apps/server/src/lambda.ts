const SSM_PARAMS: Record<string, string> = {
  DATABASE_URL: "/benstack/neon-database-url",
  BETTER_AUTH_SECRET: "/benstack/better-auth-secret",
  BETTER_AUTH_URL: "/benstack/better-auth-url",
  CORS_ORIGIN: "/benstack/cors-origin",
  ALLOWED_EMAILS: "/benstack/allowed-emails",
  S3_RECEIPTS_BUCKET: "/benstack/s3-receipts-bucket",
  ANTHROPIC_API_KEY: "/benstack/anthropic-api-key",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let resolvedHandler: ((event: any, context: any) => Promise<any>) | undefined;

async function init() {
  const sessionToken = process.env.AWS_SESSION_TOKEN;

  for (const [envKey, paramName] of Object.entries(SSM_PARAMS)) {
    const res = await fetch(
      `http://localhost:2773/systemsmanager/parameters/get?name=${encodeURIComponent(paramName)}&withDecryption=true`,
      { headers: { "X-Aws-Parameters-Secrets-Token": sessionToken! } },
    );
    if (!res.ok) throw new Error(`SSM fetch failed for ${paramName}: ${res.status} ${await res.text()}`);
    const { Parameter } = (await res.json()) as { Parameter: { Value: string } };
    process.env[envKey] = Parameter.Value;
  }

  const [{ handle }, { app, setupPromise }] = await Promise.all([
    import("hono/aws-lambda"),
    import("./index"),
  ]);

  await setupPromise;
  return handle(app);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler = async (event: any, context: any) => {
  if (!resolvedHandler) {
    resolvedHandler = await init();
  }
  return resolvedHandler(event, context);
};
