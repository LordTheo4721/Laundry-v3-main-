// Database configuration for the app. Runs on MySQL/MariaDB only (e.g. XAMPP locally,
// Hostinger MySQL in production). Values come from environment variables.

import type { DatabaseConfig } from "./types";

/**
 * Read an environment variable, returning `fallback` when unset/empty.
 * @param name Environment variable name.
 * @param fallback Value returned when the variable is missing or empty.
 */
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

export function getDatabaseConfig(overrides: Partial<DatabaseConfig> = {}): DatabaseConfig {
  const cfg: DatabaseConfig = {
    engine: "mysql",
    host: overrides.host ?? env("DB_HOST", env("MYSQL_HOST", "127.0.0.1")),
    port: overrides.port ?? toInt(env("DB_PORT", env("MYSQL_PORT", "3306")), 3306),
    user: overrides.user ?? env("DB_USER", env("MYSQL_USER", "root")),
    password: overrides.password ?? env("DB_PASSWORD", env("MYSQL_PASSWORD", "")),
    database: overrides.database ?? env("DB_DATABASE", env("MYSQL_DATABASE", env("MYSQL_DB", "laundry"))),
    ssl: overrides.ssl ?? toBool(env("DB_SSL", env("MYSQL_SSL", "false")), false),
    connectionLimit: overrides.connectionLimit ?? toInt(env("DB_POOL_SIZE", env("MYSQL_POOL_SIZE", "10")), 10),
    queueLimit: overrides.queueLimit ?? toInt(env("DB_QUEUE_LIMIT", env("MYSQL_QUEUE_LIMIT", "100")), 100),
    connectTimeout: overrides.connectTimeout ?? toInt(env("DB_CONNECT_TIMEOUT", env("MYSQL_CONNECT_TIMEOUT", "10000")), 10000),
  };
  return { ...cfg, ...overrides, engine: "mysql" };
}

export default getDatabaseConfig;
