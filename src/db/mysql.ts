// MySQL/MariaDB adapter implementing the Database interface.
// The async mysql2 driver runs in a worker thread (mysql-worker.mjs); calls are made
// synchronously through synckit so the rest of the app can keep using db.prepare().get/all/run.

import { fileURLToPath } from "url";
import { createSyncFn } from "synckit";
import type { Database as DbIface, Statement, DatabaseConfig } from "./types";
import { translateSql } from "./sql";

const WORKER_PATH = fileURLToPath(new URL("./mysql-worker.mjs", import.meta.url));

interface WorkerResult {
  rows?: any[];
  affectedRows?: number;
  insertId?: number;
  __error?: boolean;
  code?: string;
  message?: string;
}

/**
 * Create a MySQL/MariaDB adapter implementing the Database interface.
 * @param config Resolved database configuration.
 */
export function createMysqlAdapter(config: DatabaseConfig): DbIface {
  const callWorker = createSyncFn<(action: string, payload?: unknown) => WorkerResult>(WORKER_PATH);

  // Run one worker action; a worker-side error becomes a thrown Error that keeps the MySQL code.
  const call = (action: string, payload?: unknown): WorkerResult => {
    const res = callWorker(action, payload);
    if (res && res.__error) {
      const err = new Error(res.message ?? "MySQL error") as Error & { code?: string };
      err.code = res.code;
      throw err;
    }
    return res;
  };

  call("init", {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl,
    connectionLimit: config.connectionLimit,
    queueLimit: typeof config.queueLimit === "number" ? config.queueLimit : 100,
    connectTimeout: typeof config.connectTimeout === "number" ? config.connectTimeout : 10000,
  });

  const query = (sql: string, params: unknown[]): WorkerResult => call("query", { sql, params });

  const normalise = (params: unknown[]): unknown[] =>
    params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;

  const adapter: DbIface = {
    engine: "mysql",
    prepare(sql: string): Statement {
      const translated = translateSql(sql, "mysql");
      return {
        get(...params: any[]) {
          const rows = query(translated, normalise(params)).rows ?? [];
          return rows.length ? rows[0] : undefined;
        },
        all(...params: any[]) {
          return query(translated, normalise(params)).rows ?? [];
        },
        run(...params: any[]) {
          const r = query(translated, normalise(params));
          return { changes: r.affectedRows ?? 0, lastInsertRowid: r.insertId ?? 0 };
        },
      };
    },
    exec(sql: string) {
      const translated = translateSql(sql, "mysql");
      if (!translated.trim()) return;
      query(translated, []);
    },
    transaction<T = any>(fn: () => T): () => T {
      return () => {
        call("begin");
        try {
          const res = fn();
          call("commit");
          return res;
        } catch (e) {
          try { call("rollback"); } catch { /* ignore */ }
          throw e;
        }
      };
    },
    pragma(statement: string) {
      // SQLite pragmas have no MySQL equivalent; foreign key checks are on by default.
      void statement;
    },
    close() {
      try { call("close"); } catch { /* ignore */ }
    },
    healthCheck() {
      try {
        call("ping");
        return true;
      } catch (e) {
        const err = e as { code?: string };
        console.error(`[DB] MySQL health check error: code=${err?.code ?? "UNKNOWN"}`);
        return false;
      }
    },
    isMysql() { return true; },
  };
  return adapter;
}

export default createMysqlAdapter;
