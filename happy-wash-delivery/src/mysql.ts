// Synchronous MySQL adapter for the delivery service (mysql2 wrapped with deasync,
// the same approach the main app uses). SQL is written in MySQL syntax directly.

import mysql from 'mysql2/promise';
import deasync from 'deasync';

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface Statement {
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
  run(...params: unknown[]): RunResult;
}

export interface MysqlDatabase {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

export interface MysqlOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function sync<T>(promise: Promise<T>, timeoutMs = 15000): T {
  let result: T | undefined;
  let error: unknown;
  let done = false;
  const timer = setTimeout(() => {
    if (!done) {
      error = new Error(`Database operation timed out after ${timeoutMs}ms`);
      done = true;
    }
  }, timeoutMs);
  promise
    .then((r) => { result = r; done = true; })
    .catch((e) => { error = e; done = true; });
  deasync.loopWhile(() => !done);
  clearTimeout(timer);
  if (error) throw error;
  return result as T;
}

export function createMysqlDatabase(opts: MysqlOptions): MysqlDatabase {
  const base = {
    host: opts.host,
    port: opts.port,
    user: opts.user,
    password: opts.password,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
    multipleStatements: true,
  };

  // Create the database if it does not exist yet (best effort).
  const admin = mysql.createPool({ ...base, connectionLimit: 1 });
  try {
    sync(admin.query(`CREATE DATABASE IF NOT EXISTS \`${opts.database}\` CHARACTER SET utf8mb4`));
  } finally {
    admin.end().catch(() => {});
  }

  const pool = mysql.createPool({ ...base, database: opts.database, connectionLimit: 5, waitForConnections: true });

  const normalise = (params: unknown[]): unknown[] =>
    params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;

  const adapter: MysqlDatabase = {
    prepare(sql: string): Statement {
      return {
        get(...params: unknown[]) {
          const [rows] = sync(pool.query(sql, normalise(params)));
          const arr = rows as any[];
          return arr && arr.length ? arr[0] : undefined;
        },
        all(...params: unknown[]) {
          const [rows] = sync(pool.query(sql, normalise(params)));
          return (rows as any[]) || [];
        },
        run(...params: unknown[]) {
          const [result] = sync(pool.query(sql, normalise(params)));
          const r = result as { affectedRows?: number; insertId?: number };
          return { changes: r?.affectedRows ?? 0, lastInsertRowid: r?.insertId ?? 0 };
        },
      };
    },
    exec(sql: string) {
      if (!sql.trim()) return;
      sync(pool.query(sql));
    },
    transaction<T>(fn: () => T): () => T {
      return () => {
        sync(pool.query('START TRANSACTION'));
        try {
          const res = fn();
          sync(pool.query('COMMIT'));
          return res;
        } catch (e) {
          try { sync(pool.query('ROLLBACK')); } catch { /* ignore */ }
          throw e;
        }
      };
    },
    close() {
      try { sync(pool.end()); } catch { /* ignore */ }
    },
  };
  return adapter;
}
