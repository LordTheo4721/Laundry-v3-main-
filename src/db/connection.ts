// Database connection factory for the dual-database architecture.
// Selects MySQL or SQLite based on config, with optional SQLite fallback.

import type { Database, DatabaseConfig } from "./types";
import { getDatabaseConfig } from "./config";
import { createSqliteAdapter } from "./sqlite";
import { createMysqlAdapter } from "./mysql";

/**
 * Create a database connection from an optional config.
 * Tries MySQL first when configured; falls back to SQLite on failure if enabled.
 */
export function createConnection(config?: DatabaseConfig): Database {
  const cfg = config ?? getDatabaseConfig();
  console.log("[DB] Resolved engine:", cfg.engine, "| host:", cfg.host, "| database:", cfg.database, "| fallbackToSqlite:", cfg.fallbackToSqlite, "| sqlitePath:", cfg.sqlitePath);
  if (cfg.engine === "mysql") {
    try {
      const db = createMysqlAdapter(cfg);
      if (db.healthCheck()) {
        console.log("[DB] MySQL connection OK");
        return db;
      }
      throw new Error("MySQL health check failed");
    } catch (err) {
      console.error("[DB] MySQL connection failed:", (err as Error)?.message);
      if (cfg.fallbackToSqlite) {
        console.warn("[DB] Falling back to SQLite:", cfg.sqlitePath);
        return createSqliteAdapter(cfg.sqlitePath);
      }
      throw err;
    }
  }
  console.log("[DB] Using SQLite:", cfg.sqlitePath);
  return createSqliteAdapter(cfg.sqlitePath);
}

/**
 * Alias for createConnection; returns a Database adapter.
 */
export function createDatabase(config?: DatabaseConfig): Database {
  return createConnection(config);
}

export default createDatabase;