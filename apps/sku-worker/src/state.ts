import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";

export class UserError extends Error {}

export function stateDirectory(): string {
  return resolve(process.env.SKU_WORKER_STATE_DIR ?? join(homedir(), ".local/state/benstack-sku-worker"));
}

export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

export async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new UserError("A worker state file could not be read. Its contents have not been printed.");
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** One owner for this prototype's credentials and SQLite files, with crash-stale recovery. */
export async function lockState(directory: string): Promise<() => Promise<void>> {
  await privateDirectory(directory);
  try {
    return await lockfile.lock(directory, {
      lockfilePath: join(directory, "worker.lock"),
      realpath: false,
      stale: 10_000,
      update: 2_000,
      retries: { retries: 12, minTimeout: 1_000, maxTimeout: 1_000 },
    });
  } catch {
    throw new UserError("Another worker command owns this state directory. Close it and retry (a crash lock expires after 10 seconds).");
  }
}

/** Caller holds lockState across the whole command; this queue also serializes in-process refreshes. */
export class WorkerCredentials implements CredentialStore {
  readonly path: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(directory: string) {
    this.path = join(directory, "chatgpt-auth.json");
  }

  async read(providerId: string): Promise<Credential | undefined> {
    if (providerId !== "openai") return undefined;
    const value = await readJson(this.path);
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || !("type" in value) || value.type !== "oauth"
      || !("access" in value) || typeof value.access !== "string"
      || !("refresh" in value) || typeof value.refresh !== "string"
      || !("expires" in value) || typeof value.expires !== "number"
      || !("clientId" in value) || typeof value.clientId !== "string"
      || !("scopes" in value) || !Array.isArray(value.scopes)
      || !value.scopes.includes("chatgpt.tokens.use.direct")) {
      throw new UserError("Worker credentials are not a ChatGPT plan-use grant. Run the worker login again.");
    }
    await chmod(this.path, 0o600);
    return value as Credential;
  }

  async list() {
    return (await this.read("openai")) ? [{ providerId: "openai", type: "oauth" as const }] : [];
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>) {
    return this.serialize(async () => {
      if (providerId !== "openai") throw new UserError("Only the worker's OpenAI subscription login is supported.");
      const current = await this.read(providerId);
      const next = await fn(current);
      if (next !== undefined) {
        if (next.type !== "oauth") throw new UserError("This prototype does not accept API-key credentials.");
        await writeJson(this.path, next);
      }
      return next ?? current;
    });
  }

  delete(providerId: string): Promise<void> {
    return this.serialize(async () => {
      if (providerId === "openai") await rm(this.path, { force: true });
    });
  }
}

export async function installationId(directory: string): Promise<string> {
  const path = join(directory, "host.json");
  const saved = await readJson(path);
  if (saved !== undefined) {
    if (typeof saved !== "object" || saved === null || !("id" in saved)
      || typeof saved.id !== "string" || !/^[0-9a-f-]{36}$/i.test(saved.id)) {
      throw new UserError("Invalid worker host ID file. Do not copy another installation's host ID.");
    }
    return saved.id;
  }
  const id = randomUUID();
  await writeJson(path, { id });
  return id;
}
