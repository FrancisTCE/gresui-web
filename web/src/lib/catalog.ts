// Every relation the connection can reach, in one list.
//
// Two places need this: the command palette (jump to a table) and the MCP
// table picker (choose what a key may read). They have to agree — a table you
// can jump to is a table you can grant — so the crawl lives here rather than
// in either component.

import { call, getBindings } from "@/lib/rpc.ts";
import type { RelationInfo } from "../../../shared/types.ts";

export interface CatalogTable {
  database: string;
  schema: string;
  table: string;
  kind: RelationInfo["kind"];
  rowEstimate: RelationInfo["rowEstimate"];
  /** "schema.table" — what a search box matches against. */
  search: string;
}

/** Crawl databases → schemas → relations. Never rejects: a schema the user
 * cannot read simply contributes nothing, because a half-listed catalog is
 * still worth showing. */
export async function crawlCatalog(): Promise<CatalogTable[]> {
  const b = getBindings();
  const out: CatalogTable[] = [];
  let dbs: string[];
  try {
    dbs = await call(b.listDatabases());
  } catch {
    return out; // not connected
  }
  // Databases in parallel, and schemas within a database in parallel: on a
  // server with a dozen schemas this is the difference between the palette
  // being usable on the first keystroke and not.
  await Promise.all(
    dbs.map(async (database) => {
      const schemas = await call(b.listSchemas(database)).catch(() => []);
      await Promise.all(
        schemas.map(async (schema) => {
          const rels = await call(b.listRelations(database, schema)).catch(
            () => [],
          );
          for (const r of rels) {
            out.push({
              database,
              schema,
              table: r.name,
              kind: r.kind,
              rowEstimate: r.rowEstimate,
              search: `${schema}.${r.name}`,
            });
          }
        }),
      );
    }),
  );
  return out.toSorted((a, b2) => a.search.localeCompare(b2.search));
}
