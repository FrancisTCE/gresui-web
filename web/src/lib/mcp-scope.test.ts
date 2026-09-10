// Run with: npm test   (node --test, no test framework needed)
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { McpKeyInfo } from "../../../shared/types.ts";
import {
  canonicalTable,
  keyCoverage,
  lensFor,
  lensRestricts,
  tableEntry,
  withoutTable,
  withTable,
} from "./mcp-scope.ts";

const ANCHOR = "shop";
const USERS = { database: "shop", schema: "public", table: "users" };
const ORDERS = { database: "analytics", schema: "public", table: "orders" };

function key(tables: string[]): McpKeyInfo {
  return {
    id: "k1",
    name: "claude",
    key: "gres_x",
    scopes: ["get_rows"],
    tables,
    lenses: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: null,
  };
}

describe("canonicalTable", () => {
  test("unqualified entries take the anchor database", () => {
    assert.equal(canonicalTable("public.users", ANCHOR), "shop.public.users");
  });

  test("qualified entries are left alone", () => {
    assert.equal(
      canonicalTable("analytics.public.orders", ANCHOR),
      "analytics.public.orders",
    );
  });
});

describe("keyCoverage", () => {
  test("an empty allowlist covers every table", () => {
    assert.equal(keyCoverage(key([]), USERS, ANCHOR), "all");
    assert.equal(keyCoverage(key([]), ORDERS, ANCHOR), "all");
  });

  test("a listed table is explicit, in either written form", () => {
    assert.equal(keyCoverage(key(["public.users"]), USERS, ANCHOR), "explicit");
    assert.equal(
      keyCoverage(key(["shop.public.users"]), USERS, ANCHOR),
      "explicit",
    );
  });

  test("a non-anchor database needs the qualified form", () => {
    assert.equal(
      keyCoverage(key(["analytics.public.orders"]), ORDERS, ANCHOR),
      "explicit",
    );
    // same schema.table, different database — not the same relation
    assert.equal(keyCoverage(key(["public.orders"]), ORDERS, ANCHOR), null);
  });

  test("an unlisted table is not covered", () => {
    assert.equal(keyCoverage(key(["public.orders"]), USERS, ANCHOR), null);
  });

  test("schema is part of the identity", () => {
    assert.equal(keyCoverage(key(["billing.users"]), USERS, ANCHOR), null);
  });
});

describe("tableEntry", () => {
  test("anchor tables are written unqualified", () => {
    assert.equal(tableEntry(USERS, ANCHOR), "public.users");
  });

  test("other databases keep their prefix", () => {
    assert.equal(tableEntry(ORDERS, ANCHOR), "analytics.public.orders");
  });
});

describe("withTable / withoutTable", () => {
  test("adding is a no-op when already covered in the other form", () => {
    const k = key(["shop.public.users"]);
    assert.deepEqual(withTable(k, USERS, ANCHOR), ["shop.public.users"]);
  });

  test("adding appends the canonical entry", () => {
    assert.deepEqual(withTable(key(["public.orders"]), USERS, ANCHOR), [
      "public.orders",
      "public.users",
    ]);
  });

  test("removing matches whichever form was written", () => {
    assert.deepEqual(
      withoutTable(key(["shop.public.users", "public.orders"]), USERS, ANCHOR),
      ["public.orders"],
    );
  });

  test("removing the last entry does not silently open the key up", () => {
    // [] means "all tables" — the caller has to handle the empty result.
    assert.deepEqual(withoutTable(key(["public.users"]), USERS, ANCHOR), []);
  });
});

describe("lensFor", () => {
  test("matches a lens written unqualified against a qualified relation", () => {
    const k = {
      ...key([]),
      lenses: [
        { table: "public.users", hiddenColumns: ["email"], rowFilter: "" },
      ],
    };
    assert.deepEqual(lensFor(k, USERS, ANCHOR)?.hiddenColumns, ["email"]);
  });

  test("does not leak a lens across databases", () => {
    const k = {
      ...key([]),
      lenses: [
        { table: "public.orders", hiddenColumns: ["total"], rowFilter: "" },
      ],
    };
    // Same schema.table spelling, different database: not the same relation.
    assert.equal(lensFor(k, ORDERS, ANCHOR), null);
  });

  test("no lens means the whole row", () => {
    assert.equal(lensFor(key([]), USERS, ANCHOR), null);
  });
});

describe("lensRestricts", () => {
  test("a lens that hides nothing and filters nothing restricts nothing", () => {
    assert.equal(
      lensRestricts({
        table: "public.users",
        hiddenColumns: [],
        rowFilter: "  ",
      }),
      false,
    );
  });

  test("a row filter alone is a restriction", () => {
    assert.equal(
      lensRestricts({
        table: "public.users",
        hiddenColumns: [],
        rowFilter: "id > 5",
      }),
      true,
    );
  });
});
