// MySQL/MariaDB adapter implementing the Database interface.
// Wraps mysql2 pool with synchronous helpers via deasync.

import mysql from "mysql2/promise";
import deasync from "deasync";
import type { Database as DbIface, Statement, DatabaseConfig } from "./types";
import { translateSql } from "./sql";

function sync<T>(promise: Promise<T>, timeoutMs = 15000): T {
  let result: T | undefined;
  let error: any;
  let done = false;
  const timer = setTimeout(() => {
    if (!done) {
      error = new Error(`Database operation timed out after ${timeoutMs}ms`);
      done = true;
    }
  }, timeoutMs);
  promise.then((r) => { result = r; done = true; }).catch((e) => { error = e; done = true; });
  deasync.loopWhile(() => !done);
  clearTimeout(timer);
  if (error) throw error;
  return result as T;
}

/**
 * Create a MySQL/MariaDB adapter implementing the Database interface.
 * @param config Resolved database configuration.
 */
/**
 * Diagnostic: open one plain mysql2 connection with a short timeout and log the
 * real error code (ETIMEDOUT, ECONNREFUSED, ER_ACCESS_DENIED_ERROR, ...). Never logs the password.
 */
function diagnoseConnection(config: DatabaseConfig): void {
  const started = Date.now();
  const attempt = mysql
    .createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectTimeout: 5000,
    })
    .then(async (conn) => {
      try {
        await conn.query("SELECT 1");
      } finally {
        await conn.end().catch(() => {});
      }
      return "ok";
    });
  try {
    sync(attempt, 8000);
    console.log(`[DB] Diagnostic connect OK in ${Date.now() - started}ms`);
  } catch (e) {
    const err = e as { code?: string; errno?: number; sqlState?: string; message?: string };
    console.error(
      `[DB] Diagnostic connect failed after ${Date.now() - started}ms: code=${err?.code ?? "UNKNOWN"} errno=${err?.errno ?? "n/a"} sqlState=${err?.sqlState ?? "n/a"} message=${String(err?.message ?? "").slice(0, 160)}`
    );
  }
}

export function createMysqlAdapter(config: DatabaseConfig): DbIface {
  diagnoseConnection(config);
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    connectionLimit: config.connectionLimit,
    waitForConnections: true,
    queueLimit: typeof config.queueLimit === "number" ? config.queueLimit : 100,
    connectTimeout: typeof config.connectTimeout === "number" ? config.connectTimeout : 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    multipleStatements: true,
    dateStrings: true,
    charset: "utf8mb4",
    timezone: "Z",
  });

  // Ensure database exists? Assume provisioned. Try to create if missing (best effort).
  try {
    const adminPool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      multipleStatements: true,
      dateStrings: true,
    });
    sync(adminPool.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`));
    adminPool.end().catch(() => {});
  } catch { /* ignore */ }

  const adapter: DbIface = {
    engine: "mysql",
    prepare(sql: string): Statement {
      const translated = translateSql(sql, "mysql");
      return {
        get(...params: any[]) {
          const p = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
          const [rows] = sync(pool.query(translated, p));
          const arr = rows as any[];
          return arr && arr.length ? arr[0] : undefined;
        },
        all(...params: any[]) {
          const p = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
          const [rows] = sync(pool.query(translated, p));
          return (rows as any[]) || [];
        },
        run(...params: any[]) {
          const p = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
          const [result] = sync(pool.query(translated, p));
          const r: any = result;
          return { changes: r?.affectedRows ?? 0, lastInsertRowid: r?.insertId ?? 0 };
        },
      };
    },
    exec(sql: string) {
      const translated = translateSql(sql, "mysql");
      if (!translated.trim()) return;
      sync(pool.query(translated));
    },
    transaction<T = any>(fn: () => T): () => T {
      return () => {
        sync(pool.query("START TRANSACTION"));
        try {
          const res = fn();
          sync(pool.query("COMMIT"));
          return res;
        } catch (e) {
          try { sync(pool.query("ROLLBACK")); } catch { /* ignore */ }
          throw e;
        }
      };
    },
    pragma(statement: string) {
      // Map SQLite pragma to MySQL equivalent
      if (/foreign_keys/i.test(statement)) {
        try { sync(pool.query("SET FOREIGN_KEY_CHECKS = 1")); } catch { /* ignore */ }
      }
    },
    close() {
      try { sync(pool.end()); } catch { /* ignore */ }
    },
    healthCheck() {
      try { sync(pool.query("SELECT 1")); return true; } catch (e) {
        const err = e as { code?: string; errno?: number; sqlState?: string };
        // Log only the error code (never the password or SQL) so connection problems are diagnosable.
        console.error(`[DB] MySQL health check error: code=${err?.code ?? "UNKNOWN"} errno=${err?.errno ?? "n/a"} sqlState=${err?.sqlState ?? "n/a"}`);
        return false;
      }
    },
    isMysql() { return true; },
  };
  return adapter;
}

export default createMysqlAdapter;