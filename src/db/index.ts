// Central database module entry point.
// Exposes the configured db adapter and helper accessors.

import { getDatabaseConfig } from "./config";
import { createDatabase } from "./connection";
import type { Database, DatabaseConfig } from "./types";

export const dbConfig: DatabaseConfig = getDatabaseConfig();
export const db: Database = createDatabase(dbConfig);

/** Return the active database engine name. */
export function getEngine(): string {
  return db.engine;
}

/** True when the active adapter is SQLite. */
export function isSqlite(): boolean {
  return db.isSqlite();
}

/** True when the active adapter is MySQL/MariaDB. */
export function isMysql(): boolean {
  return db.isMysql();
}

export { getDatabaseConfig } from "./config";
export { createDatabase, createConnection } from "./connection";
export * from "./types";
export * from "./sql";

export default db;