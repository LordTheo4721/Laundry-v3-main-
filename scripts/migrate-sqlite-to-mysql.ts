/**
 * SQLite -> MySQL data migration script.
 *
 * Migrates every table and row from an existing SQLite database into a MySQL
 * database, preserving IDs, handling NULLs and SQLite-specific value types,
 * validating row counts, and providing transactional rollback on failure.
 *
 * Usage (Hostinger / local):
 *   # Ensure MySQL env vars are set (DB_ENGINE=mysql, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_DATABASE)
 *   # and SQLite source path (SQLITE_PATH or DB_NAME, default laundry.db)
 *   npx tsx scripts/migrate-sqlite-to-mysql.ts
 *
 * Safety:
 *   - Source SQLite is opened READ-ONLY.
 *   - Target tables are truncated (DELETE) inside a single transaction before insert.
 *   - On any error the transaction is rolled back (data changes revert).
 *   - Foreign key checks are disabled during the load and re-enabled at the end.
 *   - Row counts are compared before/after and a mismatch aborts with non-zero exit.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import mysql from "mysql2/promise";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === null || v === "" ? fallback : v;
}

const SQLITE_PATH_RAW = env("SQLITE_PATH", env("DB_NAME", "laundry.db"));
const SQLITE_PATH = path.isAbsolute(SQLITE_PATH_RAW) ? SQLITE_PATH_RAW : path.resolve(ROOT, SQLITE_PATH_RAW);
const MYSQL_HOST = env("DB_HOST", env("MYSQL_HOST", "127.0.0.1"));
const MYSQL_PORT = parseInt(env("DB_PORT", env("MYSQL_PORT", "3306")), 10) || 3306;
const MYSQL_USER = env("DB_USER", env("MYSQL_USER", "root"));
const MYSQL_PASSWORD = env("DB_PASSWORD", env("MYSQL_PASSWORD", ""));
const MYSQL_DATABASE = env("DB_DATABASE", env("MYSQL_DATABASE", env("MYSQL_DB", "laundry")));

// Tables must be loaded in an order that respects foreign keys (parents first).
// With FK checks disabled this is not strictly required, but keeps things tidy.
const TABLE_ORDER = [
  "transactions",
  "machines",
  "reviews",
  "admin_users",
  "review_replies",
  "queue",
  "transaction_items",
  "email_verifications",
  "pricing",
  "price_history",
  "delivery_origin",
  "delivery_zones",
  "delivery_bands",
  "audit_logs",
];

async function main() {
  console.log("[Migrate] Source SQLite:", SQLITE_PATH);
  console.log("[Migrate] Target MySQL:", `${MYSQL_USER}@${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}`);

  if (!fs.existsSync(SQLITE_PATH)) {
    console.error("[Migrate] SQLite source not found:", SQLITE_PATH);
    process.exit(1);
  }

  // --- Open source (read-only) ---
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  sqlite.pragma("foreign_keys = ON");

  // Discover tables present in SQLite
  const sqliteTables = (sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[]).map((r) => r.name);
  console.log("[Migrate] SQLite tables:", sqliteTables.join(", "));

  // --- Connect to MySQL ---
  const pool = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    multipleStatements: true,
    charset: "utf8mb4",
  });

  // Ensure database exists
  try {
    const adminPool = mysql.createPool({
      host: MYSQL_HOST,
      port: MYSQL_PORT,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      multipleStatements: true,
    });
    await adminPool.query(`CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
    await adminPool.end();
  } catch (e) {
    console.warn("[Migrate] Could not ensure database exists:", (e as Error)?.message);
  }

  const conn = await pool.getConnection();

  try {
    // --- Apply schema (idempotent) ---
    const schemaPath = path.join(ROOT, "docs", "schema.mysql.sql");
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, "utf8");
      await conn.query("SET FOREIGN_KEY_CHECKS = 0");
      await conn.query(schemaSql);
      await conn.query("SET FOREIGN_KEY_CHECKS = 1");
      console.log("[Migrate] Schema applied from docs/schema.mysql.sql");
    } else {
      console.warn("[Migrate] Schema file not found; assuming tables already exist.");
    }

    await conn.query("SET FOREIGN_KEY_CHECKS = 0");

    // Order tables: known order first, then any extras
    const ordered = [
      ...TABLE_ORDER.filter((t) => sqliteTables.includes(t)),
      ...sqliteTables.filter((t) => !TABLE_ORDER.includes(t)),
    ];

    // Collect source row counts
    const sourceCounts: Record<string, number> = {};
    for (const t of ordered) {
      sourceCounts[t] = (sqlite.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c;
    }

    // --- Transactional data load ---
    await conn.beginTransaction();
    try {
      for (const table of ordered) {
        // Truncate target table
        await conn.query(`DELETE FROM \`${table}\``);
        // Reset auto_increment (best effort)
        try { await conn.query(`ALTER TABLE \`${table}\` AUTO_INCREMENT = 1`); } catch { /* ignore */ }

        const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
        if (rows.length === 0) {
          console.log(`[Migrate] ${table}: 0 rows`);
          continue;
        }

        const columns = Object.keys(rows[0]);
        const colList = columns.map((c) => `\`${c}\``).join(", ");
        const placeholders = columns.map(() => "?").join(", ");
        const sql = `INSERT INTO \`${table}\` (${colList}) VALUES (${placeholders})`;

        let inserted = 0;
        for (const row of rows) {
          const values = columns.map((c) => normalizeValue(row[c]));
          await conn.query(sql, values);
          inserted++;
        }
        console.log(`[Migrate] ${table}: ${inserted}/${rows.length} rows inserted`);
      }

      await conn.commit();
      console.log("[Migrate] Transaction committed.");
    } catch (err) {
      await conn.rollback();
      console.error("[Migrate] Transaction rolled back due to error:", (err as Error)?.message);
      throw err;
    }

    // --- Validate row counts ---
    let ok = true;
    for (const table of ordered) {
      const [r] = (await conn.query(`SELECT COUNT(*) AS c FROM \`${table}\``)) as any;
      const targetCount = (Array.isArray(r) ? r[0] : r).c;
      const match = Number(targetCount) === sourceCounts[table];
      if (!match) {
        ok = false;
        console.error(`[Migrate] COUNT MISMATCH ${table}: source=${sourceCounts[table]} target=${targetCount}`);
      } else {
        console.log(`[Migrate] ${table}: OK (${targetCount} rows)`);
      }
    }

    await conn.query("SET FOREIGN_KEY_CHECKS = 1");

    if (!ok) {
      console.error("[Migrate] Validation failed: row count mismatch.");
      process.exit(1);
    }

    console.log("[Migrate] Migration completed successfully.");
  } catch (err) {
    console.error("[Migrate] FAILED:", (err as Error)?.message);
    console.error((err as Error)?.stack);
    try { await conn.query("SET FOREIGN_KEY_CHECKS = 1"); } catch { /* ignore */ }
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
    sqlite.close();
  }
}

/**
 * Normalize SQLite values for MySQL insertion.
 * - null stays null
 * - Buffer (blob) stays Buffer
 * - numbers/strings pass through
 * - SQLite stores booleans as 0/1 (already numbers)
 * - Empty strings for DATETIME columns become null (MySQL rejects '' for DATETIME)
 */
function normalizeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (Buffer.isBuffer(v)) return v;
  if (typeof v === "string") {
    if (v.trim() === "") return null;
    return v;
  }
  return v;
}

main().catch((e) => {
  console.error("[Migrate] Unhandled error:", e);
  process.exit(1);
});
