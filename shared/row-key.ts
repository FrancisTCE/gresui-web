// One row's identity, spelled the same way on both sides of the wire.
//
// The backend stamps the primary-key values of every row it hands an MCP
// client; the grid flashes the rows whose keys come back. If the two ever
// formatted a key differently the highlight would silently never match, so
// there is exactly one implementation and both realms import it.

import type { CellValue } from "./types.ts";

/** NUL — cannot occur inside a Postgres text value, so it is safe as the
 * separator no matter what the columns hold. */
const SEP = String.fromCodePoint(0);

/** Every part carries the separator plus a null/scalar tag, so a real NULL
 * and the literal text "null" cannot produce the same key. */
export function rowKey(values: CellValue[]): string {
  return values
    .map((v) => (v === null ? `${SEP}n` : `${SEP}s${String(v)}`))
    .join("");
}
