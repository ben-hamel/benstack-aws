import assert from "node:assert/strict";
import { test } from "node:test";
import { readMcpPage } from "../src/mcp-page.ts";

const head = 'abc\n\n---\nShowing 3 of 9 chars, 3 of 9 bytes, and 1 of 1 lines. Use get_search_content({ responseId: "safe-id", urlIndex: 0, offset: 3 }) for the next slice.';

test("MCP continuation reconstruction preserves the exact body across local-memory pages", async () => {
  const calls: unknown[] = [];
  const html = await readMcpPage([head], async (args) => {
    calls.push(args);
    return args.offset === 3
      ? '# title\n\ndef\n\n---\nShowing chars 3-6 of 9. Use get_search_content({ responseId: "safe-id", urlIndex: 0, offset: 6, limit: 200000 }) for the next slice.'
      : '# title\n\nghi\n\n---\nShowing chars 6-9 of 9.';
  });
  assert.equal(html, "abcdefghi");
  assert.deepEqual(calls, [3, 6].map((offset) => ({ responseId: "safe-id", urlIndex: 0, offset, limit: 200000 })));
});

test("missing chunks, inconsistent lengths, wrong IDs, and changed wire formats fail closed", async () => {
  for (const page of [
    '# title\n\ndef\n\n---\nShowing chars 4-7 of 9.',
    '# title\n\ndef\n\n---\nShowing chars 3-9 of 9.',
    '# title\n\ndef\n\n---\nShowing chars 3-6 of 9. Use get_search_content({ responseId: "wrong", urlIndex: 0, offset: 6, limit: 200000 }) for the next slice.',
    '# title\n\nError: response no longer available',
  ]) await assert.rejects(readMcpPage([head], async () => page), /unresolved/);
  await assert.rejects(readMcpPage([head.replace('of 9 chars', 'of 999999999 chars')], async () => ''), /unresolved/);
});
