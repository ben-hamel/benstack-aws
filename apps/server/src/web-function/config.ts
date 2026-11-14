export type ConfigurationSource = "environment" | "ssm";

export function parseConfigurationSource(value = "ssm"): ConfigurationSource {
  if (value !== "environment" && value !== "ssm") {
    throw new Error("WEB_FUNCTION_CONFIG must be environment or ssm");
  }
  return value;
}

export async function prepareApplicationConfiguration(
  source: ConfigurationSource,
  loadSSM: () => Promise<void> = loadStagingConfiguration,
) {
  // Local Node --env-file has already populated process.env. The existing app
  // validates it on import, exactly as in normal development. No SSM fallback.
  if (source === "ssm") await loadSSM();
}

const PARAMETER_KEYS = {
  DATABASE_URL: "neon-database-url",
  BETTER_AUTH_SECRET: "better-auth-secret",
  BETTER_AUTH_URL: "better-auth-url",
  CORS_ORIGIN: "cors-origin",
  ALLOWED_EMAILS: "allowed-emails",
  S3_RECEIPTS_BUCKET: "s3-receipts-bucket",
  ANTHROPIC_API_KEY: "anthropic-api-key",
} as const;

export function parameterNames(prefix: string | undefined) {
  // Never silently reuse the existing production /benstack/ namespace.
  if (!prefix || !/^\/benstack-staging\/(?:[a-zA-Z0-9_-]+\/)*$/.test(prefix)) {
    throw new Error("WEB_FUNCTION_SSM_PREFIX must be /benstack-staging/ or a child path ending in /");
  }
  return Object.fromEntries(
    Object.entries(PARAMETER_KEYS).map(([key, suffix]) => [key, prefix + suffix]),
  );
}

export function decodeParameters(
  names: Record<string, string>,
  parameters: { Name?: string; Value?: string }[],
  invalid: string[] = [],
): Record<string, string> {
  const values = new Map(parameters.map((p) => [p.Name, p.Value]));
  const result: Record<string, string> = {};
  for (const [key, name] of Object.entries(names)) {
    const value = values.get(name);
    if (invalid.includes(name) || !value) {
      throw new Error("Missing staging configuration parameter");
    }
    result[key] = value;
  }
  return result;
}

export async function loadStagingConfiguration() {
  const names = parameterNames(process.env.WEB_FUNCTION_SSM_PREFIX);
  // Dynamic import: smoke mode does not even construct an AWS client.
  const { SSMClient, GetParametersCommand } = await import("@aws-sdk/client-ssm");
  const client = new SSMClient({ region: process.env.AWS_REGION, maxAttempts: 2 });
  try {
    const response = await client.send(new GetParametersCommand({
      Names: Object.values(names),
      WithDecryption: true,
    }), { abortSignal: AbortSignal.timeout(8_000) });
    const values = decodeParameters(names, response.Parameters ?? [], response.InvalidParameters);
    // Apply only after every required value exists, before importing the app.
    Object.assign(process.env, values);
  } finally {
    client.destroy();
  }
}
