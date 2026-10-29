import mysql from "mysql2/promise";
import deasync from "deasync";
import type { Database as DbIface, Statement, RunResult, DatabaseConfig } from "./types";
import { translateSql } from "./sql";

function sync<T>(promise: Promise<T>): T {
  let result: T | undefined;
  let error: any;
  let done = false;
  promise.then((r) => { result = r; done = true; }).catch((e) => { error = e; done = true; });
  deasync.loopWhile(() => !done);
  if (error) throw error;
  return result as T;
}

export function createMysqlAdapter(config: DatabaseConfig): DbIface {
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    connectionLimit: config.connectionLimit,
    waitForConnections: true,
    queueLimit: 0,
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
      try { sync(pool.query("SELECT 1")); return true; } catch { return false; }
    },
    isSqlite() { return false; },
    isMysql() { return true; },
  };
  return adapter;
}

export default createMysqlAdapter;