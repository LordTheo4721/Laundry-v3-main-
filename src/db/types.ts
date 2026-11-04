// Shared database types. The app runs on MySQL/MariaDB only.

export type DatabaseEngine = "mysql";

export interface DatabaseConfig {
  engine: DatabaseEngine;
  // MySQL
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
  connectionLimit: number;
  queueLimit: number;
  connectTimeout: number;
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
  isMysql(): boolean;
}

export interface ConnectionFactoryOptions {
  config?: DatabaseConfig;
}
