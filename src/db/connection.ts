// Database connection factory. Creates the MySQL/MariaDB adapter and fails loudly
// if the database cannot be reached (no fallback engine).

import type { Database, DatabaseConfig } from "./types";
import { getDatabaseConfig } from "./config";
import { createMysqlAdapter } from "./mysql";

/**
 * Create a MySQL database connection from an optional config.
 * Throws if the health check fails so startup errors are visible.
 */
export function createConnection(config?: DatabaseConfig): Database {
  const cfg = config ?? getDatabaseConfig();
  console.log("[DB] Connecting to MySQL | host:", cfg.host, "| port:", cfg.port, "| database:", cfg.database);
  const db = createMysqlAdapter(cfg);
  if (!db.healthCheck()) {
    throw new Error(`MySQL health check failed (${cfg.host}:${cfg.port}/${cfg.database}). Check DB_* settings and that MySQL is running.`);
  }
  console.log("[DB] MySQL connection OK");
  return db;
}

/**
 * Alias for createConnection; returns a Database adapter.
 */
export function createDatabase(config?: DatabaseConfig): Database {
  return createConnection(config);
}

export default createDatabase;
