// Run with: npm test   (node --test, no test framework needed)
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { rowKey } from "../../../shared/row-key.ts";
import type { McpUsageEntry } from "../../../shared/types.ts";
import {
  argWhere,
  describeResult,
  forKey,
  forTarget,
  mergeActivity,
  relTime,
} from "./mcp-activity.ts";

function entry(over: Partial<McpUsageEntry> = {}): McpUsageEntry {
  return {
    id: 1,
    ts: "2026-01-01T00:00:00.000Z",
    keyId: "k1",
    keyName: "claude",
    tool: "get_rows",
    ok: true,
    durationMs: 4,
    target: "shop.public.users",
    args: null,
    rowCount: null,
    rowKeys: null,
    lens: null,
    error: null,
    ...over,
  };
}

describe("mergeActivity", () => {
  test("newest first, by id", () => {
    const merged = mergeActivity([], [entry({ id: 2 }), entry({ id: 7 })]);
    assert.deepEqual(
      merged.map((e) => e.id),
      [7, 2],
    );
  });

  test("an entry that arrives live and in history appears once", () => {
    const merged = mergeActivity(
      [entry({ id: 5 })],
      [entry({ id: 5 }), entry({ id: 4 })],
    );
    assert.deepEqual(
      merged.map((e) => e.id),
      [5, 4],
    );
  });

  test("the live copy wins the tie", () => {
    const merged = mergeActivity(
      [entry({ id: 5, rowCount: 12 })],
      [entry({ id: 5, rowCount: null })],
    );
    assert.equal(merged[0]?.rowCount, 12);
  });

  test("history not loaded yet still yields the live tail", () => {
    assert.deepEqual(
      mergeActivity([entry({ id: 3 })], null).map((e) => e.id),
      [3],
    );
  });
});

describe("forTarget / forKey", () => {
  const all = [
    entry({ id: 1, target: "shop.public.users" }),
    entry({ id: 2, target: "shop.public.orders", keyId: "k2" }),
    entry({ id: 3, target: null, tool: "list_schemas" }),
  ];

  test("filters by relation", () => {
    assert.deepEqual(
      forTarget(all, "shop.public.users").map((e) => e.id),
      [1],
    );
  });

  test("calls that took no relation belong to no relation", () => {
    assert.deepEqual(forTarget(all, "shop.public.foo"), []);
  });

  test("filters by key", () => {
    assert.deepEqual(
      forKey(all, "k2").map((e) => e.id),
      [2],
    );
  });
});

describe("relTime", () => {
  const now = new Date("2026-01-01T12:00:00.000Z").getTime();
  const at = (iso: string) => relTime(iso, now);

  test("seconds", () =>
    assert.equal(at("2026-01-01T11:59:30.000Z"), "30s ago"));
  test("just now", () =>
    assert.equal(at("2026-01-01T11:59:59.000Z"), "just now"));
  test("minutes", () =>
    assert.equal(at("2026-01-01T11:20:00.000Z"), "40m ago"));
  test("hours", () => assert.equal(at("2026-01-01T04:00:00.000Z"), "8h ago"));

  test("a clock skewed into the future does not read as negative", () => {
    assert.equal(at("2026-01-01T12:00:05.000Z"), "just now");
  });
});

describe("describeResult", () => {
  test("a failure reads as its error", () => {
    assert.equal(
      describeResult(entry({ ok: false, error: "table not allowed" })),
      "table not allowed",
    );
  });

  test("row counts are pluralized", () => {
    assert.equal(describeResult(entry({ rowCount: 1 })), "1 row");
    assert.equal(describeResult(entry({ rowCount: 2 })), "2 rows");
  });

  test("row_count counted rather than returned them", () => {
    assert.equal(
      describeResult(entry({ tool: "row_count", rowCount: 4210 })),
      "counted 4,210",
    );
  });
});

describe("argWhere", () => {
  test("returns the filter the agent sent", () => {
    assert.equal(argWhere(entry({ args: { where: "id > 10" } })), "id > 10");
  });

  test("blank and missing filters are both absent", () => {
    assert.equal(argWhere(entry({ args: { where: "   " } })), null);
    assert.equal(argWhere(entry({ args: {} })), null);
    assert.equal(argWhere(entry()), null);
  });
});

describe("rowKey", () => {
  test("a single-column key round-trips as itself", () => {
    assert.equal(rowKey([7]), rowKey(["7"]));
  });

  test("composite keys do not collide by concatenation", () => {
    // "ab" + "c" and "a" + "bc" must not produce the same identity.
    assert.notEqual(rowKey(["ab", "c"]), rowKey(["a", "bc"]));
  });

  test("null is distinct from the string 'null'", () => {
    assert.notEqual(rowKey([null]), rowKey(["null"]));
  });

  test("column order matters", () => {
    assert.notEqual(rowKey(["a", "b"]), rowKey(["b", "a"]));
  });
});
