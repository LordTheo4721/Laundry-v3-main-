import { getDatabaseConfig } from "./config";
import { createDatabase } from "./connection";
import type { Database, DatabaseConfig } from "./types";

export const dbConfig: DatabaseConfig = getDatabaseConfig();
export const db: Database = createDatabase(dbConfig);

export function getEngine(): string {
  return db.engine;
}

export function isSqlite(): boolean {
  return db.isSqlite();
}

export function isMysql(): boolean {
  return db.isMysql();
}

export { getDatabaseConfig } from "./config";
export { createDatabase, createConnection } from "./connection";
export * from "./types";
export * from "./sql";

export default db;