import { expect, test } from "bun:test";
import { randomId } from "../src/lib/random-id";

test("UUID fallback works without secure-context randomUUID", () => {
  const source = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) };
  const ids = Array.from({ length: 100 }, () => randomId(source));
  for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(new Set(ids).size).toBe(100);
});

test("uses native UUID when available", () => {
  const id = crypto.randomUUID();
  expect(randomId({ randomUUID: () => id, getRandomValues: crypto.getRandomValues.bind(crypto) })).toBe(id);
});
