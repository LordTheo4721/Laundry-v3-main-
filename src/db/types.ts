// Shared database types for the dual-database (SQLite/MySQL) architecture.

export type DatabaseEngine = "sqlite" | "mysql";

export interface DatabaseConfig {
  engine: DatabaseEngine;
  // SQLite
  sqlitePath: string;
  // MySQL
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
  connectionLimit: number;
  // Behavior
  fallbackToSqlite: boolean;
  // Raw env passthrough
  [key: string]: unknown;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Statement {
  get(...params: any[]): any;
  all(...params: any[]): any[];
  run(...params: any[]): RunResult;
}

export interface Database {
  engine: DatabaseEngine;
  prepare(sql: string): Statement;
  exec(sql: string): void;
  transaction<T = any>(fn: () => T): () => T;
  pragma?(statement: string): void;
  close(): void;
  healthCheck(): boolean;
  isSqlite(): boolean;
  isMysql(): boolean;
}

export interface ConnectionFactoryOptions {
  config?: DatabaseConfig;
  fallback?: boolean;
}