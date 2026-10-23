import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  applySqliteMigrations, SQLITE_MIGRATIONS,
} from "@earendil-works/pi-durable/storage/sqlite";
import {
  openNodeSqliteDatabase, openNodeSqliteStorage,
} from "@earendil-works/pi-durable/storage/sqlite/node";

test("the legacy SQLite schema migrates to v2 without losing task rows or indexes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-migration-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "session.sqlite");
  const legacy = await openNodeSqliteDatabase(path);
  const records = ["pending", "running", "waiting", "completing", "terminal"].map((status, index) => ({
    id: index + 2, conversationId: 1, kind: "migration-test", state: { status },
  }));
  try {
    // Upstream retains the immutable v1 schema used by Pi Durable 1.3.0.
    await applySqliteMigrations(legacy, SQLITE_MIGRATIONS.filter(({ version }) => version === 1));
    assert.equal((await legacy.get<{ version: number }>("SELECT version FROM durable_schema"))?.version, 1);
    for (const record of records) {
      await legacy.run(
        "INSERT INTO tasks (id, conversation_id, kind, status, abort_requested, background, record) VALUES (?, 1, 'migration-test', ?, 0, 0, ?)",
        record.id, record.state.status, JSON.stringify(record),
      );
    }
  } finally { await legacy.close(); }

  // The public storage opener performs the same automatic migration as openJob.
  const storage = await openNodeSqliteStorage(path);
  await storage.close(BACKGROUND_CONTEXT);
  const migrated = await openNodeSqliteDatabase(path);
  try {
    assert.equal((await migrated.get<{ version: number }>("SELECT version FROM durable_schema"))?.version, 2);
    const rows = await migrated.all<{ record: string }>("SELECT record FROM tasks ORDER BY id");
    assert.deepEqual(rows.map((row) => JSON.parse(String(row.record))), records);
    assert.equal((await migrated.all("PRAGMA index_list(tasks)")).length, 5);
    assert.match(String((await migrated.get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'tasks'"))?.sql), /'sleeping'/);
    assert.equal((await migrated.get<{ integrity_check: string }>("PRAGMA integrity_check"))?.integrity_check, "ok");
  } finally { await migrated.close(); }
  const reopened = await openNodeSqliteStorage(path);
  await reopened.close(BACKGROUND_CONTEXT);
});
