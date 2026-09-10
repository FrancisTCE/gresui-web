// Run with: npm test   (node --test, no test framework needed)
//
// definitionMentions is a security predicate: it decides whether an index is
// hidden from a lensed key, and a false negative leaks the existence of a
// column the operator withheld. It earned a test the hard way — the first
// version only looked for the quoted form, and Postgres emits lowercase
// identifiers bare, so `CREATE INDEX customers_ssn_idx ON … (ssn)` sailed
// straight through a lens that hid `ssn`.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { definitionMentions, validateMcpLens } from "./mcp.ts";

describe("definitionMentions", () => {
  const idx = (cols: string) =>
    `CREATE INDEX t_idx ON public.customers USING btree (${cols})`;

  test("finds a bare lowercase column, the form Postgres actually emits", () => {
    assert.equal(definitionMentions(idx("ssn"), "ssn"), true);
  });

  test("finds a quoted column", () => {
    assert.equal(definitionMentions(idx('"SSN"'), "SSN"), true);
  });

  test("finds one column among several", () => {
    assert.equal(definitionMentions(idx("tenant_id, ssn, id"), "ssn"), true);
  });

  test("finds a column inside an expression index", () => {
    assert.equal(definitionMentions(idx("lower(ssn))"), "ssn"), true);
  });

  test("does not mistake a substring of another column for a match", () => {
    // The whole point of the boundary check: hiding `name` must not hide
    // every index on `full_name`.
    assert.equal(definitionMentions(idx("full_name"), "name"), false);
  });

  test("does not match a column named only in the index name", () => {
    assert.equal(
      definitionMentions(
        "CREATE INDEX customers_ssn_idx ON public.customers USING btree (id)",
        "email",
      ),
      false,
    );
  });

  test("an unrelated index stays visible", () => {
    assert.equal(definitionMentions(idx("tenant_id"), "ssn"), false);
  });

  test("regex metacharacters in a column name are literal", () => {
    assert.equal(definitionMentions(idx('"a.b"'), "a.b"), true);
    assert.equal(definitionMentions(idx("axb"), "a.b"), false);
  });
});

describe("validateMcpLens", () => {
  const lens = (over: Record<string, unknown> = {}) => ({
    table: "public.customers",
    hiddenColumns: ["ssn"],
    rowFilter: "tenant_id = 42",
    ...over,
  });

  test("accepts a well-formed lens", () => {
    assert.doesNotThrow(() => validateMcpLens(lens()));
  });

  test("accepts a fully-qualified table", () => {
    assert.doesNotThrow(() =>
      validateMcpLens(lens({ table: "shop.public.customers" })),
    );
  });

  test("rejects a table reference that is not a relation name", () => {
    assert.throws(
      () => validateMcpLens(lens({ table: "customers" })),
      /invalid lens table/,
    );
  });

  test("rejects a statement terminator in the row filter", () => {
    // The filter is spliced into the lens subquery and then applied to every
    // request the key makes, so a stray terminator is a long-lived mistake.
    assert.throws(
      () => validateMcpLens(lens({ rowFilter: "1=1; DROP TABLE customers" })),
      /single boolean expression/,
    );
  });

  test("rejects a non-string hidden column", () => {
    assert.throws(
      () => validateMcpLens(lens({ hiddenColumns: [42] })),
      /non-empty strings/,
    );
  });

  test("rejects hiddenColumns that is not an array", () => {
    assert.throws(
      () => validateMcpLens(lens({ hiddenColumns: "ssn" })),
      /must be an array/,
    );
  });

  test("rejects an absurdly long filter", () => {
    assert.throws(
      () => validateMcpLens(lens({ rowFilter: "a".repeat(4001) })),
      /too long/,
    );
  });

  test("an empty lens is structurally valid — the store turns it into none", () => {
    assert.doesNotThrow(() =>
      validateMcpLens(lens({ hiddenColumns: [], rowFilter: "" })),
    );
  });
});
