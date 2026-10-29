import type { Database, DatabaseConfig } from "./types";
import { getDatabaseConfig } from "./config";
import { createSqliteAdapter } from "./sqlite";
import { createMysqlAdapter } from "./mysql";

export function createConnection(config?: DatabaseConfig): Database {
  const cfg = config ?? getDatabaseConfig();
  if (cfg.engine === "mysql") {
    try {
      const db = createMysqlAdapter(cfg);
      if (db.healthCheck()) return db;
      throw new Error("MySQL health check failed");
    } catch (err) {
      if (cfg.fallbackToSqlite) {
        console.warn("[DB] MySQL unavailable, falling back to SQLite:", (err as Error)?.message);
        return createSqliteAdapter(cfg.sqlitePath);
      }
      throw err;
    }
  }
  return createSqliteAdapter(cfg.sqlitePath);
}

export function createDatabase(config?: DatabaseConfig): Database {
  return createConnection(config);
}

export default createDatabase;