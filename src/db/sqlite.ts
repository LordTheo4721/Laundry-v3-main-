import Database from "better-sqlite3";
import type { Database as DbIface, Statement, RunResult } from "./types";
import { translateSql } from "./sql";

export function createSqliteAdapter(dbPath: string): DbIface {
  const db = new Database(dbPath);
  try { db.pragma("foreign_keys = ON"); } catch { /* ignore */ }

  const adapter: DbIface = {
    engine: "sqlite",
    prepare(sql: string): Statement {
      const stmt = db.prepare(sql);
      return {
        get(...params: any[]) {
          const p = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
          return stmt.get(...(p as any));
        },
        all(...params: any[]) {
          const p = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
          return stmt.all(...(p as any)) as any[];
        },
        run(...params: any[]) {
          const p = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
          const info = stmt.run(...(p as any));
          return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
        },
      };
    },
    exec(sql: string) {
      const translated = translateSql(sql, "sqlite");
      if (!translated.trim()) return;
      db.exec(translated);
    },
    transaction<T = any>(fn: () => T): () => T {
      const t = db.transaction(fn);
      return () => t() as T;
    },
    pragma(statement: string) {
      try { db.pragma(statement); } catch { /* ignore */ }
    },
    close() {
      try { db.close(); } catch { /* ignore */ }
    },
    healthCheck() {
      try { db.prepare("SELECT 1").get(); return true; } catch { return false; }
    },
    isSqlite() { return true; },
    isMysql() { return false; },
  };
  return adapter;
}

export default createSqliteAdapter;