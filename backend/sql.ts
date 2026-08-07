// SQL editor execution: runSql, cancel, history recording.

import type { QueryResult } from "../../shared/types.ts";
import { pushHistory } from "./config.ts";
import type { PgSession, QueryOutcome } from "./pg.ts";

async function record(text: string, durationMs: number): Promise<void> {
  try {
    await pushHistory({ text, ts: new Date().toISOString(), durationMs });
  } catch {
    // history persistence must never break query execution
  }
}

export async function runSql(
  s: PgSession,
  text: string,
  opts?: { explain?: boolean },
): Promise<QueryResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Query is empty");
  if (trimmed.startsWith("\\")) {
    throw new Error("psql meta-commands not supported");
  }

  const start = performance.now();
  try {
    if (opts?.explain) {
      // EXPLAIN (ANALYZE) EXECUTES the statement — for DML that would mutate
      // real data. Run it inside a transaction and roll back so the plan is
      // measured but nothing persists, even on failure.
      // A user-supplied COMMIT/ROLLBACK/BEGIN would end the wrapper transaction
      // and defeat the rollback guarantee, so transaction-control statements
      // (at statement start, or after a `;`) are rejected outright.
      if (
        /(^|;)\s*(BEGIN|START|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|END)\b/i
          .test(trimmed)
      ) {
        throw new Error(
          "EXPLAIN mode does not support transaction control statements",
        );
      }
      let res: QueryOutcome[];
      try {
        res = await s.queryAll(
          `BEGIN;\nEXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${trimmed};\nROLLBACK;`,
        );
      } catch (err) {
        // a failed explain can leave the transaction open — close it so the
        // session stays usable
        await s.query("ROLLBACK").catch(() => {});
        throw err;
      }
      const explain = res.find((r) => r.columns.length > 0);
      if (!explain) throw new Error("EXPLAIN returned no plan");
      const durationMs = Math.round(performance.now() - start);
      await record(trimmed, durationMs);
      return {
        columns: explain.columns,
        rows: explain.rows,
        rowCount: explain.rows.length,
        durationMs,
        command: "EXPLAIN",
      };
    }
    const res = await s.query(trimmed);
    const durationMs = Math.round(performance.now() - start);
    await record(trimmed, durationMs);
    return {
      columns: res.columns,
      rows: res.rows,
      rowCount: res.rowCount,
      durationMs,
      command: res.command,
    };
  } catch (err) {
    // failures are recorded too — the user wants to retry them
    await record(trimmed, Math.round(performance.now() - start));
    throw err;
  }
}

export async function cancelQuery(s: PgSession): Promise<void> {
  await s.cancel();
}
