import { UserError } from "./state.ts";

// Deliberately pinned to the development branch confirmed by the operator in
// Neon Console. Changing this target requires a reviewed code change.
export const PILOT_HOST = "ep-bold-frog-amsb7vxz.c-5.us-east-1.aws.neon.tech";
export function validatePilotTarget(value: string | undefined) {
  let url: URL;
  try { url = new URL(value ?? ""); } catch { throw new UserError("Configure the ben-local direct DATABASE_URL in apps/server/.env.local."); }
  if (url.protocol !== "postgresql:" || url.hostname !== PILOT_HOST || url.pathname !== "/neondb"
    || (url.port && url.port !== "5432") || !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")
    || [...url.searchParams.keys()].some((key) => !["sslmode", "channel_binding"].includes(key) || url.searchParams.getAll(key).length !== 1)) {
    throw new UserError("Pilot only permits the verified ben-local direct endpoint with TLS; no database or provider was contacted.");
  }
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

export function pilotChildEnvironment(source: Record<string, string | undefined>) {
  return Object.fromEntries(["PATH", "HOME", "LANG", "TERM", "SKU_WORKER_STATE_DIR"].flatMap((key) => source[key] === undefined ? [] : [[key, source[key]!]]));
}
