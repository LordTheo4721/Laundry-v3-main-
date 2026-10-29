// Database configuration resolution for the dual-database architecture.
// Supports SQLite (default/fallback) and MySQL (primary) via environment variables.

import type { DatabaseConfig, DatabaseEngine } from "./types";

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === null || v === "") return fallback ?? "";
  return v;
}

function toBool(v: string, fallback = false): boolean {
  if (v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

function toInt(v: string, fallback: number): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function resolveEngine(raw?: string): DatabaseEngine {
  const v = (raw ?? env("DB_ENGINE", env("DB_TYPE", env("DATABASE_ENGINE", env("DB_DRIVER", ""))))).toLowerCase().trim();
  if (v === "mysql" || v === "mariadb") return "mysql";
  if (v === "sqlite" || v === "sqlite3" || v === "") return "sqlite";
  // Heuristic: if MySQL host is provided, prefer MySQL
  if (env("DB_HOST") || env("MYSQL_HOST")) return "mysql";
  return "sqlite";
}

export function getDatabaseConfig(overrides: Partial<DatabaseConfig> = {}): DatabaseConfig {
  const engine = overrides.engine ?? resolveEngine();
  const cfg: DatabaseConfig = {
    engine,
    sqlitePath: overrides.sqlitePath ?? env("SQLITE_PATH", env("DB_NAME", "laundry.db")),
    host: overrides.host ?? env("DB_HOST", env("MYSQL_HOST", "127.0.0.1")),
    port: overrides.port ?? toInt(env("DB_PORT", env("MYSQL_PORT", "3306")), 3306),
    user: overrides.user ?? env("DB_USER", env("MYSQL_USER", "root")),
    password: overrides.password ?? env("DB_PASSWORD", env("MYSQL_PASSWORD", "")),
    database: overrides.database ?? env("DB_DATABASE", env("MYSQL_DATABASE", env("MYSQL_DB", "laundry"))),
    ssl: overrides.ssl ?? toBool(env("DB_SSL", env("MYSQL_SSL", "false")), false),
    connectionLimit: overrides.connectionLimit ?? toInt(env("DB_POOL_SIZE", env("MYSQL_POOL_SIZE", "10")), 10),
    fallbackToSqlite: overrides.fallbackToSqlite ?? toBool(env("DB_FALLBACK_TO_SQLITE", "true"), true),
  };
  return { ...cfg, ...overrides };
}

export function isSqliteConfig(cfg: DatabaseConfig): boolean {
  return cfg.engine === "sqlite";
}

export function isMysqlConfig(cfg: DatabaseConfig): boolean {
  return cfg.engine === "mysql";
}

export const DEFAULT_SQLITE_PATH = "laundry.db";

export default getDatabaseConfig;