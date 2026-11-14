import { UserError } from "./state.ts";

/** This first automatic executable cannot connect to Neon or any app database. */
export function offlineAutomaticDatabase(value: string | undefined) {
  let url: URL;
  try { url = new URL(value ?? ""); } catch { throw new UserError("Set RECEIPT_IMPORT_TEST_DATABASE_URL to a disposable local receipt_import_test database."); }
  if (url.protocol !== "postgresql:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^\/receipt_import_test(?:_[a-z0-9_]+)?$/.test(url.pathname) || url.search || url.hash) {
    throw new UserError("Automatic offline worker accepts only a disposable local receipt_import_test database, with no URL parameter overrides.");
  }
  return url.toString();
}
