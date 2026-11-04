// server.ts
import express from "express";
import path from "path";

// src/db/config.ts
function env(name, fallback) {
  const v = process.env[name];
  if (v === void 0 || v === null || v === "") return fallback ?? "";
  return v;
}
function toBool(v, fallback = false) {
  if (v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}
function toInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
function getDatabaseConfig(overrides = {}) {
  const cfg = {
    engine: "mysql",
    host: overrides.host ?? env("DB_HOST", env("MYSQL_HOST", "127.0.0.1")),
    port: overrides.port ?? toInt(env("DB_PORT", env("MYSQL_PORT", "3306")), 3306),
    user: overrides.user ?? env("DB_USER", env("MYSQL_USER", "root")),
    password: overrides.password ?? env("DB_PASSWORD", env("MYSQL_PASSWORD", "")),
    database: overrides.database ?? env("DB_DATABASE", env("MYSQL_DATABASE", env("MYSQL_DB", "laundry"))),
    ssl: overrides.ssl ?? toBool(env("DB_SSL", env("MYSQL_SSL", "false")), false),
    connectionLimit: overrides.connectionLimit ?? toInt(env("DB_POOL_SIZE", env("MYSQL_POOL_SIZE", "10")), 10),
    queueLimit: overrides.queueLimit ?? toInt(env("DB_QUEUE_LIMIT", env("MYSQL_QUEUE_LIMIT", "100")), 100),
    connectTimeout: overrides.connectTimeout ?? toInt(env("DB_CONNECT_TIMEOUT", env("MYSQL_CONNECT_TIMEOUT", "10000")), 1e4)
  };
  return { ...cfg, ...overrides, engine: "mysql" };
}

// src/db/mysql.ts
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { createSyncFn } from "synckit";

// src/db/sql.ts
function splitArgs(inner) {
  return inner.split(",").map((p) => p.trim()).filter((p) => p !== "");
}
function unquote(v) {
  return v.trim().replace(/^['"]|['"]$/g, "");
}
function parseModifiers(mods) {
  let out = "";
  for (const m of mods) {
    const v = unquote(m);
    const match = v.match(/^([+-])\s*(\d+)\s*(minute|minutes|hour|hours|day|days)$/i);
    if (!match) continue;
    const sign = match[1] === "+" ? " + " : " - ";
    const n = match[2];
    const unitRaw = match[3].toLowerCase().replace(/s$/, "");
    const unit = unitRaw === "minute" ? "MINUTE" : unitRaw === "hour" ? "HOUR" : "DAY";
    out += `${sign} INTERVAL ${n} ${unit}`;
  }
  return out;
}
function translateSql(sql, engine) {
  let s = sql;
  s = s.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, "INT AUTO_INCREMENT PRIMARY KEY");
  s = s.replace(/AUTOINCREMENT/gi, "AUTO_INCREMENT");
  s = s.replace(/\bREAL\b/g, "DOUBLE");
  s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, "INSERT IGNORE INTO");
  s = s.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, "REPLACE INTO");
  if (/^\s*PRAGMA\b/i.test(s)) {
    return "";
  }
  s = s.replace(/datetime\(([^)]*)\)/gi, (_m, inner) => {
    const parts = splitArgs(inner);
    if (parts.length === 0) return "UTC_TIMESTAMP()";
    const base = parts[0].trim();
    const mods = parts.slice(1);
    const baseExpr = base.toLowerCase() === "'now'" ? "UTC_TIMESTAMP()" : base;
    const modExpr = parseModifiers(mods);
    if (!modExpr) return baseExpr;
    return `(${baseExpr}${modExpr})`;
  });
  s = s.replace(/\bdate\(([^)]*)\)/gi, (_m, inner) => {
    const parts = splitArgs(inner);
    if (parts.length === 0) return "CURDATE()";
    const base = parts[0].trim();
    const mods = parts.slice(1);
    const isNow = base.toLowerCase() === "'now'";
    const modExpr = parseModifiers(mods);
    if (isNow && !modExpr) return "CURDATE()";
    const baseExpr = isNow ? "UTC_TIMESTAMP()" : base;
    if (!modExpr) return `DATE(${baseExpr})`;
    return `DATE(${baseExpr}${modExpr})`;
  });
  s = s.replace(/CAST\(strftime\('%H',\s*([^)]+)\)\s*as\s*INTEGER\)/gi, (_m, inner) => {
    const parts = splitArgs(inner);
    const base = (parts[0] || "").trim();
    const mods = parts.slice(1);
    const baseExpr = base.toLowerCase() === "'now'" ? "UTC_TIMESTAMP()" : base;
    const modExpr = parseModifiers(mods);
    if (!modExpr) return `HOUR(${baseExpr})`;
    return `HOUR(${baseExpr}${modExpr})`;
  });
  s = s.replace(/CAST\(strftime\("%H",\s*([^)]+)\)\s*as\s*INTEGER\)/gi, (_m, inner) => {
    const parts = splitArgs(inner);
    const base = (parts[0] || "").trim();
    const mods = parts.slice(1);
    const baseExpr = base.toLowerCase() === "'now'" ? "UTC_TIMESTAMP()" : base;
    const modExpr = parseModifiers(mods);
    if (!modExpr) return `HOUR(${baseExpr})`;
    return `HOUR(${baseExpr}${modExpr})`;
  });
  s = s.replace(/strftime\('%w',\s*([^)]+)\)/gi, (_m, inner) => {
    const parts = splitArgs(inner);
    const base = (parts[0] || "").trim();
    const mods = parts.slice(1);
    const baseExpr = base.toLowerCase() === "'now'" ? "UTC_TIMESTAMP()" : base;
    const modExpr = parseModifiers(mods);
    if (!modExpr) return `(DAYOFWEEK(${baseExpr}) - 1)`;
    return `(DAYOFWEEK(${baseExpr}${modExpr}) - 1)`;
  });
  s = s.replace(/\bMAX\(\s*([^()]+?)\s*,\s*([^()]+?)\s*\)/g, "GREATEST($1, $2)");
  s = s.replace(/\bas\s+INTEGER\s*\)/gi, "AS SIGNED)");
  return s;
}

// src/db/mysql.ts
var WORKER_CANDIDATES = [
  fileURLToPath(new URL("./src/db/mysql-worker.mjs", import.meta.url)),
  fileURLToPath(new URL("./mysql-worker.mjs", import.meta.url))
];
var WORKER_PATH = WORKER_CANDIDATES.find((p) => existsSync(p)) ?? WORKER_CANDIDATES[0];
function createMysqlAdapter(config) {
  const callWorker = createSyncFn(WORKER_PATH);
  const call = (action, payload) => {
    const res = callWorker(action, payload);
    if (res && res.__error) {
      const err = new Error(res.message ?? "MySQL error");
      err.code = res.code;
      throw err;
    }
    return res;
  };
  call("init", {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl,
    connectionLimit: config.connectionLimit,
    queueLimit: typeof config.queueLimit === "number" ? config.queueLimit : 100,
    connectTimeout: typeof config.connectTimeout === "number" ? config.connectTimeout : 1e4
  });
  const query = (sql, params) => call("query", { sql, params });
  const normalise = (params) => params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  const adapter = {
    engine: "mysql",
    prepare(sql) {
      const translated = translateSql(sql, "mysql");
      return {
        get(...params) {
          const rows = query(translated, normalise(params)).rows ?? [];
          return rows.length ? rows[0] : void 0;
        },
        all(...params) {
          return query(translated, normalise(params)).rows ?? [];
        },
        run(...params) {
          const r = query(translated, normalise(params));
          return { changes: r.affectedRows ?? 0, lastInsertRowid: r.insertId ?? 0 };
        }
      };
    },
    exec(sql) {
      const translated = translateSql(sql, "mysql");
      if (!translated.trim()) return;
      query(translated, []);
    },
    transaction(fn) {
      return () => {
        call("begin");
        try {
          const res = fn();
          call("commit");
          return res;
        } catch (e) {
          try {
            call("rollback");
          } catch {
          }
          throw e;
        }
      };
    },
    pragma(statement) {
      void statement;
    },
    close() {
      try {
        call("close");
      } catch {
      }
    },
    healthCheck() {
      try {
        call("ping");
        return true;
      } catch (e) {
        const err = e;
        console.error(`[DB] MySQL health check error: code=${err?.code ?? "UNKNOWN"}`);
        return false;
      }
    },
    isMysql() {
      return true;
    }
  };
  return adapter;
}

// src/db/connection.ts
function createConnection(config) {
  const cfg = config ?? getDatabaseConfig();
  console.log("[DB] Connecting to MySQL | host:", cfg.host, "| port:", cfg.port, "| database:", cfg.database);
  const db3 = createMysqlAdapter(cfg);
  if (!db3.healthCheck()) {
    throw new Error(`MySQL health check failed (${cfg.host}:${cfg.port}/${cfg.database}). Check DB_* settings and that MySQL is running.`);
  }
  console.log("[DB] MySQL connection OK");
  return db3;
}
function createDatabase(config) {
  return createConnection(config);
}

// src/db/index.ts
var dbConfig = getDatabaseConfig();
var db = createDatabase(dbConfig);

// server.ts
import { fileURLToPath as fileURLToPath2 } from "url";
import fs from "fs";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import multer from "multer";
import cookieParser from "cookie-parser";
import helmet from "helmet";

// src/utils/sharedPricing.ts
function calculatePrice(config, quantity) {
  const qty = quantity || 1;
  if (config.pricing_type === "tiered") {
    if (qty <= config.tier_1_limit) return config.tier_1_price;
    else if (qty <= config.tier_2_limit) return config.tier_2_price;
    else if (qty <= config.tier_3_limit) return config.tier_3_price;
    else if (qty <= config.tier_4_limit) return config.tier_4_price;
    else return config.tier_4_price + Math.max(0, qty - config.tier_4_limit) * config.tier_5_price_per_kg;
  } else {
    return config.per_kg_price * qty;
  }
}
function rowToConfig(row) {
  return {
    pricing_type: row.pricing_type,
    base_price: row.base_price,
    tier_1_limit: row.tier_1_limit,
    tier_1_price: row.tier_1_price,
    tier_2_limit: row.tier_2_limit,
    tier_2_price: row.tier_2_price,
    tier_3_limit: row.tier_3_limit,
    tier_3_price: row.tier_3_price,
    tier_4_limit: row.tier_4_limit,
    tier_4_price: row.tier_4_price,
    tier_5_price_per_kg: row.tier_5_price_per_kg,
    per_kg_price: row.per_kg_price,
    is_active: row.is_active,
    delivery_fee: row.delivery_fee
  };
}
var FALLBACK_PRICING = {
  "Wash & Fold (Clothes)": {
    pricing_type: "tiered",
    base_price: 0,
    tier_1_limit: 5,
    tier_1_price: 200,
    // 1-5 kg: ₱200
    tier_2_limit: 7,
    tier_2_price: 250,
    // 6-7 kg: ₱250
    tier_3_limit: 8,
    tier_3_price: 300,
    // 8 kg: ₱300
    tier_4_limit: 9,
    tier_4_price: 350,
    // 9 kg: ₱350
    tier_5_price_per_kg: 50,
    // 10+ kg: ₱50/kg
    per_kg_price: 0,
    is_active: 1,
    delivery_fee: 50
  },
  "Comforter (Small)": {
    pricing_type: "per_kg",
    base_price: 0,
    tier_1_limit: 0,
    tier_1_price: 0,
    tier_2_limit: 0,
    tier_2_price: 0,
    tier_3_limit: 0,
    tier_3_price: 0,
    tier_4_limit: 0,
    tier_4_price: 0,
    tier_5_price_per_kg: 0,
    per_kg_price: 250,
    is_active: 1,
    delivery_fee: 50
  },
  "Comforter (Medium)": {
    pricing_type: "per_kg",
    base_price: 0,
    tier_1_limit: 0,
    tier_1_price: 0,
    tier_2_limit: 0,
    tier_2_price: 0,
    tier_3_limit: 0,
    tier_3_price: 0,
    tier_4_limit: 0,
    tier_4_price: 0,
    tier_5_price_per_kg: 0,
    per_kg_price: 300,
    is_active: 1,
    delivery_fee: 50
  },
  "Comforter (Large)": {
    pricing_type: "per_kg",
    base_price: 0,
    tier_1_limit: 0,
    tier_1_price: 0,
    tier_2_limit: 0,
    tier_2_price: 0,
    tier_3_limit: 0,
    tier_3_price: 0,
    tier_4_limit: 0,
    tier_4_price: 0,
    tier_5_price_per_kg: 0,
    per_kg_price: 350,
    is_active: 1,
    delivery_fee: 50
  },
  "Bedsheet/Curtain/Towel": {
    pricing_type: "per_kg",
    base_price: 0,
    tier_1_limit: 0,
    tier_1_price: 0,
    tier_2_limit: 0,
    tier_2_price: 0,
    tier_3_limit: 0,
    tier_3_price: 0,
    tier_4_limit: 0,
    tier_4_price: 0,
    tier_5_price_per_kg: 0,
    per_kg_price: 50,
    is_active: 1,
    delivery_fee: 50
  },
  "Hand Wash Service": {
    pricing_type: "per_kg",
    base_price: 0,
    tier_1_limit: 0,
    tier_1_price: 0,
    tier_2_limit: 0,
    tier_2_price: 0,
    tier_3_limit: 0,
    tier_3_price: 0,
    tier_4_limit: 0,
    tier_4_price: 0,
    tier_5_price_per_kg: 0,
    per_kg_price: 50,
    is_active: 1,
    delivery_fee: 100
  }
};

// src/utils/reviewPhotoValidation.ts
var ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
var ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
var MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

// server.ts
import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();
var __filename = fileURLToPath2(import.meta.url);
var __dirname = path.dirname(__filename);
var PORT = Number(process.env.PORT) || 3e3;
var ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
var DB_NAME = process.env.DB_DATABASE || "laundry";
var MACHINE_DEFAULT_TIME = parseInt(process.env.MACHINE_DEFAULT_TIME || "2700", 10);
if (!process.env.NODE_ENV) {
  console.warn("[WARN] NODE_ENV is not set. Set NODE_ENV=production on the live server.");
}
var rawJwtSecret = process.env.JWT_SECRET || "";
var isProduction = process.env.NODE_ENV === "production";
if (!rawJwtSecret) {
  if (isProduction) {
    throw new Error("Missing required environment variable: JWT_SECRET");
  }
  console.warn("[WARN] JWT_SECRET is missing \u2014 using a temporary development secret. Set a strong JWT_SECRET in .env.");
} else if (rawJwtSecret.length < 32 || rawJwtSecret.includes("change-in-production") || rawJwtSecret.includes("your-super-secret")) {
  if (isProduction) {
    throw new Error("Invalid environment variable: JWT_SECRET (must be at least 32 characters and not a placeholder)");
  }
  console.warn("[WARN] JWT_SECRET is weak \u2014 using a temporary development secret. Set a strong JWT_SECRET in .env.");
}
var JWT_SECRET = rawJwtSecret && rawJwtSecret.length >= 32 && !rawJwtSecret.includes("change-in-production") && !rawJwtSecret.includes("your-super-secret") ? rawJwtSecret : uuidv4();
if (!ADMIN_PASSWORD) {
  throw new Error("Missing required environment variable: ADMIN_PASSWORD");
}
if (ADMIN_PASSWORD.length < 12) {
  throw new Error("Invalid environment variable: ADMIN_PASSWORD (must be at least 12 characters)");
}
if (ADMIN_PASSWORD.includes("change-me") || ADMIN_PASSWORD.includes("change-me-to")) {
  throw new Error("Invalid environment variable: ADMIN_PASSWORD (placeholder value is not allowed)");
}
var HASHED_ADMIN_PASSWORD = bcrypt.hashSync(ADMIN_PASSWORD, 12);
var db2 = db;
db2.pragma("foreign_keys = ON");
function initializeDatabase() {
  db2.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
       reference_number VARCHAR(64) UNIQUE,
      customer_name TEXT,
       customer_phone VARCHAR(32),
      customer_email TEXT,
      service_type TEXT,
      quantity INTEGER DEFAULT 1,
      special_instructions TEXT,
      weight REAL,
      appointment_date TEXT,
      appointment_time TEXT,
       delivery_method TEXT,
       address TEXT,
       branch TEXT,
       status VARCHAR(32) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'washing', 'drying', 'ready', 'completed', 'declined')),
      total_price REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid')),
      payment_method TEXT DEFAULT 'cash',
      machine_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS machines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      type TEXT,
      capacity INTEGER DEFAULT 10,
       status VARCHAR(32) DEFAULT 'available' CHECK (status IN ('available', 'in-use', 'maintenance')),
      remaining_time INTEGER DEFAULT 0,
      drying_time INTEGER DEFAULT 0
    );
  `);
  db2.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER UNIQUE,
      rating INTEGER CHECK(rating >= 1 AND rating <= 5),
       comment TEXT,
       photos TEXT,
       created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
       FOREIGN KEY (transaction_id) REFERENCES transactions(id)
    );
  `);
  db2.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username VARCHAR(64) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin')),
      last_login DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db2.exec(`
    CREATE TABLE IF NOT EXISTS review_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id INTEGER NOT NULL,
      admin_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
      FOREIGN KEY (admin_id) REFERENCES admin_users(id)
    );
  `);
  db2.exec(`
    CREATE INDEX IF NOT EXISTS idx_review_replies_review_id ON review_replies(review_id);
    CREATE INDEX IF NOT EXISTS idx_review_replies_admin_id ON review_replies(admin_id);
  `);
  db2.exec(`
    CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
    CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_transactions_customer_phone ON transactions(customer_phone);
    CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference_number);
    CREATE INDEX IF NOT EXISTS idx_machines_status ON machines(status);
  `);
  const addColumnIfNotExists = (table, column, defaultVal) => {
    const allowedTables = /* @__PURE__ */ new Set(["transactions", "machines", "reviews", "review_replies", "queue", "transaction_items", "pricing", "price_history", "admin_users", "audit_logs"]);
    const allowedColumns = /* @__PURE__ */ new Set([
      "machine_id",
      "updated_at",
      "handwash_proof_image",
      "customer_email",
      "deleted_at",
      "delivery_fee",
      "payment_method",
      "status",
      "remaining_time",
      "drying_time",
      "capacity",
      "current_transaction_id",
      "is_default",
      "comment",
      "photos",
      "review_id",
      "message",
      "avg_cycle_time",
      "total_jobs_completed",
      "pricing_type",
      "base_price",
      "tier_1_limit",
      "tier_1_price",
      "tier_2_limit",
      "tier_2_price",
      "tier_3_limit",
      "tier_3_price",
      "tier_4_limit",
      "tier_4_price",
      "tier_5_price_per_kg",
      "per_kg_price",
      "is_active",
      "delivery_fee",
      "old_price_data",
      "new_price_data",
      "changed_by",
      "username",
      "password_hash",
      "role",
      "last_login",
      "admin_id",
      "action",
      "details",
      "ip_address",
      "user_agent",
      "branch"
    ]);
    if (!allowedTables.has(table) || !allowedColumns.has(column)) {
      console.warn(`[DB] Blocked attempt to add column ${column} to table ${table} - not in allowlist`);
      return;
    }
    try {
      db2.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${defaultVal}`);
    } catch (e) {
    }
  };
  addColumnIfNotExists("transactions", "machine_id", "INTEGER");
  addColumnIfNotExists("transactions", "updated_at", "DATETIME DEFAULT CURRENT_TIMESTAMP");
  addColumnIfNotExists("transactions", "handwash_proof_image", "TEXT");
  addColumnIfNotExists("transactions", "customer_email", "TEXT");
  addColumnIfNotExists("transactions", "deleted_at", "DATETIME");
  addColumnIfNotExists("transactions", "delivery_fee", "REAL DEFAULT 0");
  addColumnIfNotExists("transactions", "payment_method", "TEXT DEFAULT 'cash'");
  addColumnIfNotExists("transactions", "branch", "TEXT");
  addColumnIfNotExists("machines", "status", "TEXT DEFAULT 'available'");
  addColumnIfNotExists("machines", "remaining_time", "INTEGER DEFAULT 0");
  addColumnIfNotExists("machines", "drying_time", "INTEGER DEFAULT 0");
  addColumnIfNotExists("machines", "capacity", "INTEGER DEFAULT 10");
  addColumnIfNotExists("machines", "current_transaction_id", "INTEGER");
  addColumnIfNotExists("machines", "is_default", "INTEGER DEFAULT 0");
  addColumnIfNotExists("reviews", "comment", "TEXT");
  addColumnIfNotExists("reviews", "photos", "TEXT");
  db2.prepare("UPDATE machines SET is_default = 1 WHERE name IN ('Premium Machine 1', 'Premium Machine 2', 'Premium Machine 3', 'Premium Machine 4')").run();
  try {
    db2.prepare(`
      UPDATE transactions
      SET machine_id = NULL
      WHERE machine_id IS NOT NULL
      AND machine_id NOT IN (SELECT id FROM machines)
    `).run();
    db2.exec(`
      CREATE INDEX IF NOT EXISTS idx_transactions_machine_id ON transactions(machine_id);
    `);
  } catch (e) {
    console.warn("[DB] Could not add FK constraint for machine_id:", e);
  }
  db2.exec(`
    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      estimated_wait_time INTEGER DEFAULT 0,
      estimated_start_time TEXT,
      estimated_end_time TEXT,
       status VARCHAR(32) DEFAULT 'waiting',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
    )
  `);
  db2.exec(`
    CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status);
    CREATE INDEX IF NOT EXISTS idx_queue_transaction ON queue(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_queue_position ON queue(position);
  `);
  db2.exec(`
    CREATE TABLE IF NOT EXISTS transaction_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      unit_price REAL DEFAULT 0,
      total_price REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
    )
  `);
  db2.exec(`
    CREATE INDEX IF NOT EXISTS idx_items_transaction ON transaction_items(transaction_id);
  `);
  db2.exec(`
    CREATE TABLE IF NOT EXISTS email_verifications (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
        email VARCHAR(255) NOT NULL,
       token TEXT NOT NULL,
       expires_at DATETIME NOT NULL,
      verified INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db2.exec(`CREATE INDEX IF NOT EXISTS idx_email_verifications_email ON email_verifications(email);`);
  addColumnIfNotExists("machines", "avg_cycle_time", "INTEGER DEFAULT 2700");
  addColumnIfNotExists("machines", "total_jobs_completed", "INTEGER DEFAULT 0");
  addColumnIfNotExists("pricing", "delivery_fee", "REAL DEFAULT 50");
  db2.exec(`
     CREATE TABLE IF NOT EXISTS pricing (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_type VARCHAR(128) NOT NULL UNIQUE,
       pricing_type TEXT NOT NULL DEFAULT 'tiered', -- 'tiered' or 'per_kg'
       base_price REAL DEFAULT 0,
       tier_1_limit INTEGER DEFAULT 5,
       tier_1_price REAL DEFAULT 0,
       tier_2_limit INTEGER DEFAULT 7,
       tier_2_price REAL DEFAULT 0,
       tier_3_limit INTEGER DEFAULT 8,
       tier_3_price REAL DEFAULT 0,
       tier_4_limit INTEGER DEFAULT 9,
       tier_4_price REAL DEFAULT 0,
       tier_5_price_per_kg REAL DEFAULT 0,
       per_kg_price REAL DEFAULT 0,
       is_active INTEGER DEFAULT 1,
       delivery_fee REAL DEFAULT 50,
       updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
     )
   `);
  db2.exec(`
     CREATE TABLE IF NOT EXISTS price_history (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_type VARCHAR(128) NOT NULL,
        old_price_data TEXT, -- JSON string of old pricing
       new_price_data TEXT, -- JSON string of new pricing
       changed_by TEXT DEFAULT 'admin',
       created_at DATETIME DEFAULT CURRENT_TIMESTAMP
     )
   `);
  db2.exec(`
     CREATE TABLE IF NOT EXISTS delivery_origin (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT NOT NULL DEFAULT 'Laundry Shop',
       address TEXT,
       latitude REAL NOT NULL DEFAULT 0,
       longitude REAL NOT NULL DEFAULT 0,
       updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
     )
   `);
  db2.exec(`
     CREATE TABLE IF NOT EXISTS delivery_zones (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT NOT NULL,
       latitude REAL NOT NULL DEFAULT 0,
       longitude REAL NOT NULL DEFAULT 0,
       is_active INTEGER DEFAULT 1,
       created_at DATETIME DEFAULT CURRENT_TIMESTAMP
     )
   `);
  db2.exec(`
     CREATE TABLE IF NOT EXISTS delivery_bands (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       min_km REAL NOT NULL DEFAULT 0,
       max_km REAL NOT NULL DEFAULT 9999,
       fee REAL NOT NULL DEFAULT 0,
       sort_order INTEGER DEFAULT 0,
       created_at DATETIME DEFAULT CURRENT_TIMESTAMP
     )
   `);
  db2.exec(`
    CREATE INDEX IF NOT EXISTS idx_price_history_service ON price_history(service_type);
    CREATE INDEX IF NOT EXISTS idx_price_history_created ON price_history(created_at);
  `);
  db2.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
       username VARCHAR(64) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin')),
      last_login DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db2.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
       action VARCHAR(32) NOT NULL CHECK (action IN ('login', 'logout', 'password_change', 'username_change', 'failed_login')),
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )
  `);
  db2.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_id ON audit_logs(admin_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
  `);
  const machineCount = db2.prepare("SELECT COUNT(*) as count FROM machines").get();
  if (machineCount.count === 0) {
    const seed = db2.prepare("INSERT INTO machines (name, type, status, remaining_time) VALUES (?, ?, ?, ?)");
    seed.run("Premium Machine 1", "all-in-one", "available", 0);
    seed.run("Premium Machine 2", "all-in-one", "available", 0);
    seed.run("Premium Machine 3", "all-in-one", "available", 0);
    seed.run("Premium Machine 4", "all-in-one", "available", 0);
  }
  const pricingCount = db2.prepare("SELECT COUNT(*) as count FROM pricing").get();
  if (pricingCount.count === 0) {
    const pricingSeed = db2.prepare(`
       INSERT INTO pricing (
         service_type, pricing_type, base_price, tier_1_limit, tier_1_price,
         tier_2_limit, tier_2_price, tier_3_limit, tier_3_price,
         tier_4_limit, tier_4_price, tier_5_price_per_kg, per_kg_price, delivery_fee
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     `);
    pricingSeed.run(
      "Wash & Fold (Clothes)",
      "tiered",
      0,
      5,
      200,
      // 1-5 kg: ₱200
      7,
      250,
      // 6-7 kg: ₱250
      8,
      300,
      // 8 kg: ₱300
      9,
      350,
      // 9 kg: ₱350
      50,
      // 10+ kg: ₱50/kg
      0,
      50
      // delivery_fee
    );
    pricingSeed.run(
      "Comforter (Small)",
      "per_kg",
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      250,
      50
    );
    pricingSeed.run(
      "Comforter (Medium)",
      "per_kg",
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      300,
      50
    );
    pricingSeed.run(
      "Comforter (Large)",
      "per_kg",
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      350,
      50
    );
    pricingSeed.run(
      "Bedsheet/Curtain/Towel",
      "per_kg",
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      50,
      50
    );
    pricingSeed.run(
      "Hand Wash Service",
      "per_kg",
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      50,
      0
    );
  }
  const originCount = db2.prepare("SELECT COUNT(*) as count FROM delivery_origin").get();
  if (originCount.count === 0) {
    db2.prepare("INSERT INTO delivery_origin (name, address, latitude, longitude) VALUES (?, ?, ?, ?)").run("Laundry Shop", "Madayegdeg, San Fernando City, La Union (in front of Robinsons Mall / Place LU, beside Elyu Food Hub)", 16.6159, 120.3167);
  } else {
    db2.prepare("UPDATE delivery_origin SET name = ?, address = ?, latitude = ?, longitude = ?, updated_at = CURRENT_TIMESTAMP WHERE latitude = ? OR address = ? OR address IS NULL").run("Laundry Shop", "Madayegdeg, San Fernando City, La Union (in front of Robinsons Mall / Place LU, beside Elyu Food Hub)", 16.6159, 120.3167, 14.5995, "Main Branch");
  }
  const zoneCount = db2.prepare("SELECT COUNT(*) as count FROM delivery_zones").get();
  if (zoneCount.count === 0) {
    const zoneSeed = db2.prepare("INSERT INTO delivery_zones (name, latitude, longitude, is_active) VALUES (?, ?, ?, 1)");
    zoneSeed.run("Zone A - Nearby", 14.6, 120.985);
    zoneSeed.run("Zone B - Mid", 14.61, 120.99);
    zoneSeed.run("Zone C - Far", 14.62, 121);
  }
  const bandCount = db2.prepare("SELECT COUNT(*) as count FROM delivery_bands").get();
  if (bandCount.count === 0) {
    const bandSeed = db2.prepare("INSERT INTO delivery_bands (min_km, max_km, fee, sort_order) VALUES (?, ?, ?, ?)");
    bandSeed.run(0, 3, 50, 1);
    bandSeed.run(3, 6, 80, 2);
    bandSeed.run(6, 10, 120, 3);
    bandSeed.run(10, 9999, 180, 4);
  }
  const adminCount = db2.prepare("SELECT COUNT(*) as count FROM admin_users").get();
  if (adminCount.count === 0) {
    const defaultAdminPassword = process.env.ADMIN_PASSWORD;
    if (!defaultAdminPassword) {
      throw new Error("ADMIN_PASSWORD must be set in environment variables");
    }
    const hashedPassword = bcrypt.hashSync(defaultAdminPassword, 12);
    const adminSeed = db2.prepare("INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)");
    adminSeed.run("admin", hashedPassword, "super_admin");
    console.log("[DB] Default admin user created");
  }
  console.log("[DB] Database initialized with indexes");
}
try {
  initializeDatabase();
  console.log("[DB] initializeDatabase() completed successfully. Engine:", db2.engine);
} catch (e) {
  console.error("[DB] initializeDatabase() FAILED:", e?.message);
  console.error(e?.stack);
  throw e;
}
var uploadsDir = path.join(__dirname, "uploads", "handwash-proofs");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
var reviewPhotosDir = path.join(__dirname, "uploads", "review-photos");
if (!fs.existsSync(reviewPhotosDir)) {
  fs.mkdirSync(reviewPhotosDir, { recursive: true });
}
var storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  }
});
var upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  // 5MB limit
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error("Only JPEG, PNG, WebP, and GIF images are allowed"));
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(new Error("Invalid file extension"));
    }
    cb(null, true);
  }
});
var reviewPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, reviewPhotosDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
var reviewUpload = multer({
  storage: reviewPhotoStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  // 5MB per file, max 5 files
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error("Only JPEG, PNG, WebP, and GIF images are allowed"));
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(new Error("Invalid file extension"));
    }
    cb(null, true);
  }
});
var validateFileSignature = (filePath, mimetype) => {
  try {
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(12);
    fs.readSync(fd, buffer, 0, 12, 0);
    fs.closeSync(fd);
    const signatures = {
      "image/jpeg": [Buffer.from([255, 216, 255])],
      "image/png": [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
      "image/webp": [Buffer.from([82, 73, 70, 70]), Buffer.from([87, 69, 66, 80])],
      // RIFF....WEBP at offset 8
      "image/gif": [Buffer.from("GIF87a"), Buffer.from("GIF89a")]
    };
    const validSignatures = signatures[mimetype];
    if (!validSignatures) return false;
    if (mimetype === "image/webp") {
      return buffer.subarray(0, 4).equals(Buffer.from([82, 73, 70, 70])) && buffer.subarray(8, 12).equals(Buffer.from([87, 69, 66, 80]));
    }
    return validSignatures.some((sig) => buffer.subarray(0, sig.length).equals(sig));
  } catch {
    return false;
  }
};
var loginSchema = z.object({
  username: z.string().min(1, "Username is required").max(50),
  password: z.string().min(1, "Password is required")
});
var transactionSchema = z.object({
  customer_name: z.string().min(1, "Customer name is required").max(100),
  customer_phone: z.string().min(1, "Customer phone is required").max(20),
  customer_email: z.string().email("Invalid email address").max(100).optional().or(z.literal("")).transform((val) => val === "" ? void 0 : val),
  service_type: z.string().min(1, "Service type is required"),
  quantity: z.number().int().min(1).max(100).optional(),
  special_instructions: z.string().max(500).optional(),
  appointment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
  appointment_time: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format (HH:MM)").optional(),
  delivery_method: z.enum(["pickup", "delivery"]).optional(),
  address: z.string().max(200).optional(),
  branch: z.string().max(100).optional(),
  delivery_zone_id: z.number().int().positive().nullable().optional(),
  payment_status: z.enum(["unpaid", "paid"]).optional(),
  payment_method: z.string().optional(),
  machine_id: z.number().int().positive().nullable().optional(),
  weight: z.number().min(0).nullable().optional(),
  items: z.array(z.object({
    service_type: z.string().min(1, "Service type is required"),
    quantity: z.number().int().min(1).max(100).nullable().optional(),
    unit_price: z.number().min(0).nullable().optional()
  })).min(1, "At least one item is required").optional()
});
var updateTransactionSchema = z.object({
  status: z.enum(["pending", "accepted", "washing", "drying", "ready", "completed", "declined"]).optional(),
  weight: z.number().min(0).nullable().optional(),
  remaining_time: z.number().int().min(0).nullable().optional(),
  drying_time: z.number().int().min(0).optional(),
  payment_status: z.enum(["unpaid", "paid"]).optional(),
  payment_method: z.string().optional(),
  machine_id: z.number().int().positive().nullable().optional(),
  service_type: z.string().optional(),
  appointment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
  appointment_time: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format (HH:MM)").optional()
});
var machineUpdateSchema = z.object({
  status: z.enum(["available", "in-use", "maintenance"]).optional(),
  remaining_time: z.number().int().min(0).optional(),
  drying_time: z.number().int().min(0).optional()
});
function calculatePrice2(serviceType, quantity) {
  const qty = quantity || 1;
  const pricing = db2.prepare("SELECT * FROM pricing WHERE service_type = ? AND is_active = 1").get(serviceType);
  if (pricing) {
    const config = rowToConfig(pricing);
    return calculatePrice(config, qty);
  }
  const fallback = FALLBACK_PRICING[serviceType];
  if (fallback) {
    return calculatePrice(fallback, qty);
  }
  return 0;
}
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function getDeliveryOrigin() {
  const row = db2.prepare("SELECT * FROM delivery_origin ORDER BY id LIMIT 1").get();
  if (row) return row;
  return { id: 0, name: "Laundry Shop", address: null, latitude: 0, longitude: 0 };
}
function getDeliveryZones(activeOnly = true) {
  const sql = activeOnly ? "SELECT * FROM delivery_zones WHERE is_active = 1 ORDER BY name" : "SELECT * FROM delivery_zones ORDER BY name";
  return db2.prepare(sql).all();
}
function getDeliveryBands() {
  return db2.prepare("SELECT * FROM delivery_bands ORDER BY sort_order, min_km").all();
}
function calculateDeliveryFeeByZone(zoneId) {
  const origin = getDeliveryOrigin();
  const zone = db2.prepare("SELECT * FROM delivery_zones WHERE id = ?").get(zoneId);
  if (!zone) return { distance_km: 0, fee: 0, zone: null };
  const distance = haversineKm(origin.latitude, origin.longitude, zone.latitude, zone.longitude);
  const bands = getDeliveryBands();
  let fee = 0;
  for (const band of bands) {
    if (distance >= band.min_km && distance <= band.max_km) {
      fee = band.fee;
      break;
    }
  }
  if (fee === 0 && bands.length > 0) {
    const last = bands[bands.length - 1];
    if (distance > last.max_km) fee = last.fee;
  }
  return { distance_km: Math.round(distance * 100) / 100, fee, zone };
}
function calculateDeliveryFeeByDistance(distanceKm) {
  const bands = getDeliveryBands();
  for (const band of bands) {
    if (distanceKm >= band.min_km && distanceKm <= band.max_km) return band.fee;
  }
  if (bands.length > 0) {
    const last = bands[bands.length - 1];
    if (distanceKm > last.max_km) return last.fee;
  }
  return 0;
}
function getDeliveryFee(serviceType) {
  try {
    const row = db2.prepare("SELECT delivery_fee FROM pricing WHERE service_type = ? AND is_active = 1").get(serviceType);
    return row?.delivery_fee ?? 0;
  } catch {
    return 0;
  }
}
async function geocodeAddress(address) {
  try {
    const q = address.toLowerCase().includes("san fernando") ? address : `${address}, San Fernando City, La Union, Philippines`;
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { "User-Agent": "laundry-app/1.0" }, signal: AbortSignal.timeout(1e4) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}
async function routeDistanceKm(originLat, originLon, destLat, destLon) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${originLon},${originLat};${destLon},${destLat}?overview=false`;
    const res = await fetch(url, { signal: AbortSignal.timeout(1e4) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.routes || !data.routes[0]) return null;
    return data.routes[0].distance / 1e3;
  } catch {
    return null;
  }
}
async function calculateDeliveryFeeByAddress(address) {
  const origin = getDeliveryOrigin();
  let originLat = origin.latitude;
  let originLon = origin.longitude;
  if (!originLat && !originLon && origin.address) {
    const g = await geocodeAddress(origin.address);
    if (g) {
      originLat = g.lat;
      originLon = g.lon;
    }
  }
  const dest = await geocodeAddress(address);
  if (!dest) return { distance_km: 0, fee: 0, destination: null };
  let distance = await routeDistanceKm(originLat, originLon, dest.lat, dest.lon);
  if (distance === null) {
    distance = haversineKm(originLat, originLon, dest.lat, dest.lon);
  }
  const fee = calculateDeliveryFeeByDistance(distance);
  return { distance_km: Math.round(distance * 100) / 100, fee, destination: dest };
}
function generateReferenceNumber() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `LF-${timestamp}-${random}`;
}
function apiResponse(success, data, error, meta) {
  return {
    success,
    ...data !== void 0 && { data },
    ...error && { error },
    ...meta && { meta },
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
}
var loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  // 15 minutes
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || "10", 10),
  message: { error: "Too many login attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false
});
var apiRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1e3,
  // 1 minute
  max: parseInt(process.env.API_RATE_LIMIT_MAX || "1000", 10),
  message: { error: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false
});
var publicRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  // 15 minutes
  max: parseInt(process.env.PUBLIC_RATE_LIMIT_MAX || "120", 10),
  message: { error: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false
});
var requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const cookieToken = req.cookies?.admin_token;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : cookieToken;
  if (!token) {
    return res.status(401).json(apiResponse(false, void 0, "No token provided"));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json(apiResponse(false, void 0, "Invalid or expired token"));
  }
};
async function startServer() {
  let vite;
  if (process.env.NODE_ENV === "development") {
    try {
      const { createServer: createViteServer } = await import("vite");
      vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "custom"
      });
    } catch (err) {
      console.warn("[WARN] vite is not available; running without Vite dev middleware.", err?.message);
    }
  }
  const app = express();
  const trustProxyRaw = process.env.TRUST_PROXY;
  if (trustProxyRaw === "true") {
    app.set("trust proxy", true);
  } else if (trustProxyRaw) {
    const hops = parseInt(trustProxyRaw, 10);
    if (Number.isFinite(hops) && hops > 0) app.set("trust proxy", hops);
  } else {
    app.set("trust proxy", 1);
  }
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "https://nominatim.openstreetmap.org", "https://router.project-osrm.org"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    // Allow embedding for development
    hsts: {
      maxAge: 31536e3,
      includeSubDomains: true,
      preload: true
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    noSniff: true,
    xssFilter: true,
    frameguard: { action: "deny" },
    hidePoweredBy: true,
    ieNoOpen: true,
    dnsPrefetchControl: { allow: false },
    permittedCrossDomainPolicies: { permittedPolicies: "none" }
  }));
  app.use(express.json({ limit: "10kb" }));
  app.use(cookieParser());
  app.use(apiRateLimiter);
  app.use(morgan("short"));
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
  });
  const uploadsPath = path.join(__dirname, "uploads");
  try {
    fs.mkdirSync(uploadsPath, { recursive: true });
  } catch {
  }
  try {
    fs.mkdirSync(path.join(uploadsPath, "review-photos"), { recursive: true });
  } catch {
  }
  app.use("/uploads/review-photos", express.static(path.join(uploadsPath, "review-photos")));
  app.use("/uploads", requireAuth, express.static(uploadsPath));
  app.use((req, res, next) => {
    const allowedOrigins = [
      "http://localhost:8080",
      "https://happywashlaundry.online",
      "https://www.happywashlaundry.online",
      "https://api.happywashlaundry.online",
      "https://happywashlandry.onrender.com",
      // GitHub Codespaces patterns - more specific to prevent subdomain takeover
      /^https:\/\/[a-z0-9-]+\.githubpreview\.dev$/,
      /^https:\/\/[a-z0-9-]+\.github\.dev$/
      // Render domains (explicit production host only)
    ];
    const envOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean).filter((o) => {
      try {
        new URL(o);
        return true;
      } catch {
        return false;
      }
    });
    envOrigins.forEach((o) => allowedOrigins.push(o));
    const origin = req.headers.origin;
    const isAllowed = allowedOrigins.some(
      (o) => typeof o === "string" ? o === origin : o.test(origin || "")
    );
    if (isAllowed && origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
  app.use((req, res, next) => {
    const isCodespaces = !!process.env.CODESPACES;
    const codespaceName = process.env.CODESPACE_NAME;
    const githubUser = process.env.GITHUB_USER;
    const codespaceUrl = codespaceName && githubUser ? `https://${codespaceName}-8080.${githubUser}.githubpreview.dev` : "";
    const renderUrl = "https://happywashlandry.onrender.com";
    const isDev = process.env.NODE_ENV === "development";
    const connectSrc = [`'self'`, renderUrl, "https://nominatim.openstreetmap.org", "https://router.project-osrm.org"].concat(codespaceUrl ? [codespaceUrl] : []).concat(isDev ? ["http://localhost:*", "ws://localhost:*", "ws://127.0.0.1:*"] : []).join(" ");
    const frameAncestors = `'none'`;
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com; connect-src ${connectSrc}; frame-ancestors ${frameAncestors}; base-uri 'self'; form-action 'self'; object-src 'none'; media-src 'self'; worker-src 'self' blob:; frame-src 'self' https://www.openstreetmap.org https://www.google.com https://www.google.com/maps https://maps.google.com`
    );
    next();
  });
  app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  if (vite) {
    app.use(vite.middlewares);
  } else {
    let staticDir = path.join(__dirname, "build");
    if (!fs.existsSync(staticDir)) {
      staticDir = path.join(__dirname, "dist");
    }
    if (process.env.SERVE_FRONTEND !== "false" && fs.existsSync(staticDir)) {
      app.use(express.static(staticDir));
    }
  }
  app.get("*", async (req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    try {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      if (vite) {
        const indexPath = path.join(__dirname, "index.html");
        const html = await vite.transformIndexHtml(req.path, fs.readFileSync(indexPath, "utf-8"));
        res.send(html);
      } else {
        const fsSync = fs;
        let indexPath = path.join(__dirname, "dist", "index.html");
        if (!fsSync.existsSync(indexPath)) {
          indexPath = path.join(__dirname, "build", "index.html");
        }
        if (!fsSync.existsSync(indexPath)) {
          return res.status(404).json(apiResponse(false, void 0, "Not found"));
        }
        res.sendFile(indexPath);
      }
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/health", (req, res) => {
    try {
      db2.prepare("SELECT 1").get();
      const mem = process.memoryUsage();
      res.json(apiResponse(true, {
        status: "ok",
        database: "connected",
        maintenance_mode: process.env.MAINTENANCE_MODE === "true",
        uptime_seconds: Math.round(process.uptime()),
        memory: {
          rss_bytes: mem.rss,
          heap_used_bytes: mem.heapUsed,
          heap_total_bytes: mem.heapTotal
        }
      }));
    } catch (error) {
      res.status(500).json(apiResponse(false, void 0, "Database unavailable"));
    }
  });
  const emailTransporter = (() => {
    const host = process.env.SMTP_HOST;
    if (!host) return null;
    return nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : void 0,
      connectionTimeout: 1e4,
      socketTimeout: 1e4
    });
  })();
  app.post("/api/verify-email/send", (req, res) => {
    try {
      const email = String(req.body?.email || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json(apiResponse(false, void 0, "Invalid email"));
      }
      const recent = db2.prepare("SELECT COUNT(*) as c FROM email_verifications WHERE email = ? AND created_at >= datetime('now', '-10 minutes')").get(email);
      if (recent.c >= 3) {
        return res.status(429).json(apiResponse(false, void 0, "Too many verification requests. Please try again later."));
      }
      const code = String(Math.floor(1e5 + Math.random() * 9e5));
      const codeHash = crypto.createHash("sha256").update(code).digest("hex");
      const expires = new Date(Date.now() + 10 * 60 * 1e3).toISOString();
      db2.prepare("INSERT INTO email_verifications (email, token, expires_at) VALUES (?, ?, ?)").run(email, codeHash, expires);
      if (emailTransporter) {
        emailTransporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: email,
          subject: "Your verification code",
          text: `Your verification code is: ${code}. It expires in 10 minutes.`
        }).catch((e) => console.error("[Email] send failed:", e));
      } else {
        console.log(`[Email] Verification code for ${email}: ${code} (SMTP not configured)`);
      }
      res.json(apiResponse(true, { sent: true }));
    } catch (e) {
      console.error(e);
      res.status(500).json(apiResponse(false, void 0, "Failed to send verification"));
    }
  });
  app.post("/api/verify-email/confirm", (req, res) => {
    try {
      const email = String(req.body?.email || "").trim();
      const code = String(req.body?.code || "").trim();
      const codeHash = crypto.createHash("sha256").update(code).digest("hex");
      const row = db2.prepare("SELECT * FROM email_verifications WHERE email = ? AND token = ? AND verified = 0 ORDER BY id DESC LIMIT 1").get(email, codeHash);
      if (!row) return res.status(400).json(apiResponse(false, void 0, "Invalid code"));
      if (new Date(row.expires_at) < /* @__PURE__ */ new Date()) return res.status(400).json(apiResponse(false, void 0, "Code expired"));
      db2.prepare("UPDATE email_verifications SET verified = 1 WHERE id = ?").run(row.id);
      db2.prepare("UPDATE email_verifications SET verified = 1 WHERE email = ? AND id != ? AND verified = 0").run(email, row.id);
      res.json(apiResponse(true, { verified: true }));
    } catch (e) {
      console.error(e);
      res.status(500).json(apiResponse(false, void 0, "Verification failed"));
    }
  });
  app.get("/api/verify-email/status", (req, res) => {
    try {
      const email = String(req.query.email || "").trim();
      const row = db2.prepare("SELECT verified FROM email_verifications WHERE email = ? ORDER BY id DESC LIMIT 1").get(email);
      res.json(apiResponse(true, { verified: !!row?.verified }));
    } catch (e) {
      res.status(500).json(apiResponse(false, void 0, "Status check failed"));
    }
  });
  const logAudit = (adminId, action, details, req) => {
    try {
      if (!adminId) return;
      const admin = db2.prepare("SELECT id FROM admin_users WHERE id = ?").get(adminId);
      if (!admin) return;
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const userAgent = req.get("user-agent") || "unknown";
      db2.prepare(`
         INSERT INTO audit_logs (admin_id, action, details, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?)
       `).run(adminId, action, details, ip, userAgent);
    } catch (e) {
      console.error("[AUDIT] Failed to log audit event:", e);
    }
  };
  app.post("/api/admin/login", loginRateLimiter, (req, res) => {
    try {
      const result = loginSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json(
          apiResponse(false, void 0, result.error.issues.map((e) => e.message).join(", "))
        );
      }
      const { username, password } = result.data;
      const admin = db2.prepare("SELECT * FROM admin_users WHERE username = ?").get(username);
      if (!admin) {
        logAudit(0, "failed_login", `Failed login attempt for username: ${username}`, req);
        return res.status(401).json(apiResponse(false, void 0, "Invalid username or password"));
      }
      const isValid = bcrypt.compareSync(password, admin.password_hash);
      if (!isValid) {
        logAudit(admin.id, "failed_login", `Failed login attempt for username: ${username}`, req);
        return res.status(401).json(apiResponse(false, void 0, "Invalid username or password"));
      }
      db2.prepare("UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?").run(admin.id);
      const token = jwt.sign(
        { userId: admin.id, username: admin.username, type: "admin", role: admin.role },
        JWT_SECRET,
        { expiresIn: "24h", algorithm: "HS256" }
      );
      const isProduction2 = process.env.NODE_ENV === "production";
      res.cookie("admin_token", token, {
        httpOnly: true,
        secure: isProduction2,
        sameSite: isProduction2 ? "none" : "lax",
        maxAge: 24 * 60 * 60 * 1e3,
        // 24 hours
        path: "/"
      });
      logAudit(admin.id, "login", `Successful login for ${admin.username}`, req);
      return res.json(apiResponse(true, {
        token,
        expiresIn: "24h",
        user: {
          id: admin.id,
          username: admin.username,
          role: admin.role,
          last_login: admin.last_login
        }
      }, void 0));
    } catch (error) {
      console.error("[API] Login error:", error);
      res.status(500).json(apiResponse(false, void 0, "Internal server error"));
    }
  });
  app.post("/api/admin/logout", requireAuth, (req, res) => {
    const user = req.user;
    if (user) {
      logAudit(user.userId, "logout", `Logout for ${user.username}`, req);
    }
    res.clearCookie("admin_token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/"
    });
    res.json(apiResponse(true, void 0, "Logged out successfully"));
  });
  app.get("/api/admin/verify", requireAuth, (req, res) => {
    const user = req.user;
    res.json(apiResponse(true, {
      authenticated: true,
      user: {
        id: user.userId,
        username: user.username,
        role: user.role
      }
    }));
  });
  app.get("/api/admin/profile", requireAuth, (req, res) => {
    const user = req.user;
    const admin = db2.prepare("SELECT id, username, role, last_login, created_at FROM admin_users WHERE id = ?").get(user.userId);
    if (!admin) {
      return res.status(404).json(apiResponse(false, void 0, "Admin user not found"));
    }
    res.json(apiResponse(true, admin));
  });
  const updateUsernameSchema = z.object({
    username: z.string().min(3, "Username must be at least 3 characters").max(50, "Username must be at most 50 characters").regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
    currentPassword: z.string().min(1, "Current password is required")
  });
  app.patch("/api/admin/profile", requireAuth, (req, res) => {
    try {
      const result = updateUsernameSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json(apiResponse(false, void 0, result.error.issues.map((e) => e.message).join(", ")));
      }
      const { username, currentPassword } = result.data;
      const user = req.user;
      const existingAdmin = db2.prepare("SELECT id FROM admin_users WHERE username = ? AND id != ?").get(username, user.userId);
      if (existingAdmin) {
        return res.status(409).json(apiResponse(false, void 0, "Username already taken"));
      }
      const admin = db2.prepare("SELECT password_hash FROM admin_users WHERE id = ?").get(user.userId);
      if (!admin || !bcrypt.compareSync(currentPassword, admin.password_hash)) {
        logAudit(user.userId, "username_change", `Failed username change attempt - invalid password`, req);
        return res.status(401).json(apiResponse(false, void 0, "Current password is incorrect"));
      }
      db2.prepare("UPDATE admin_users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(username, user.userId);
      logAudit(user.userId, "username_change", `Username changed from ${user.username} to ${username}`, req);
      res.json(apiResponse(true, { username }, "Username updated successfully"));
    } catch (error) {
      console.error("[API] Update username error:", error);
      res.status(500).json(apiResponse(false, void 0, "Internal server error"));
    }
  });
  function validatePasswordStrength(password) {
    const errors = [];
    if (password.length < 8) errors.push("Password must be at least 8 characters long");
    if (!/[A-Z]/.test(password)) errors.push("Password must contain at least one uppercase letter");
    if (!/[a-z]/.test(password)) errors.push("Password must contain at least one lowercase letter");
    if (!/[0-9]/.test(password)) errors.push("Password must contain at least one number");
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) errors.push("Password must contain at least one special character");
    return { isValid: errors.length === 0, errors };
  }
  const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(1, "New password is required"),
    confirmPassword: z.string().min(1, "Confirm password is required")
  }).refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"]
  });
  const passwordChangeRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1e3,
    // 1 hour
    max: 5,
    // 5 attempts per hour
    message: { error: "Too many password change attempts. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false
  });
  app.patch("/api/admin/change-password", requireAuth, passwordChangeRateLimiter, (req, res) => {
    try {
      const result = changePasswordSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json(apiResponse(false, void 0, result.error.issues.map((e) => e.message).join(", ")));
      }
      const { currentPassword, newPassword } = result.data;
      const user = req.user;
      const strength = validatePasswordStrength(newPassword);
      if (!strength.isValid) {
        return res.status(400).json(apiResponse(false, void 0, strength.errors.join("; ")));
      }
      const admin = db2.prepare("SELECT password_hash FROM admin_users WHERE id = ?").get(user.userId);
      if (!admin || !bcrypt.compareSync(currentPassword, admin.password_hash)) {
        logAudit(user.userId, "password_change", `Failed password change attempt - invalid current password`, req);
        return res.status(401).json(apiResponse(false, void 0, "Current password is incorrect"));
      }
      const newPasswordHash = bcrypt.hashSync(newPassword, 12);
      db2.prepare("UPDATE admin_users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newPasswordHash, user.userId);
      logAudit(user.userId, "password_change", `Password changed successfully`, req);
      res.json(apiResponse(true, void 0, "Password changed successfully"));
    } catch (error) {
      console.error("[API] Change password error:", error);
      res.status(500).json(apiResponse(false, void 0, "Internal server error"));
    }
  });
  app.get("/api/machines", (req, res) => {
    const machines = db2.prepare("SELECT * FROM machines ORDER BY id").all();
    res.json(apiResponse(true, machines));
  });
  function sanitizeInput(str) {
    if (typeof str !== "string") return "";
    return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
  }
  app.post("/api/transactions", async (req, res) => {
    const result = transactionSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(
        apiResponse(false, void 0, result.error.issues.map((e) => e.message).join(", "))
      );
    }
    const data = result.data;
    const items = data.items || [];
    const sanitizedCustomerName = sanitizeInput(data.customer_name);
    const sanitizedCustomerPhone = sanitizeInput(data.customer_phone);
    const sanitizedEmail = data.customer_email ? sanitizeInput(data.customer_email) : void 0;
    const sanitizedAddress = data.address ? sanitizeInput(data.address) : void 0;
    const sanitizedBranch = data.branch ? sanitizeInput(data.branch) : void 0;
    const sanitizedCombinedAddress = sanitizedAddress && sanitizedBranch ? `${sanitizedAddress}, ${sanitizedBranch}` : sanitizedAddress;
    const sanitizedInstructions = data.special_instructions ? sanitizeInput(data.special_instructions) : void 0;
    if (sanitizedEmail) {
      const verifiedRow = db2.prepare("SELECT id FROM email_verifications WHERE email = ? AND verified = 1 ORDER BY id DESC LIMIT 1").get(sanitizedEmail);
      if (!verifiedRow) {
        return res.status(400).json(apiResponse(false, void 0, "Email not verified"));
      }
    }
    const isHandWash = data.service_type.toLowerCase().includes("hand wash");
    const machineId = isHandWash ? null : data.machine_id || null;
    if (machineId) {
      const machine = db2.prepare("SELECT status FROM machines WHERE id = ?").get(machineId);
      if (!machine) {
        return res.status(400).json(apiResponse(false, void 0, "Machine not found"));
      }
      if (machine.status !== "available") {
        return res.status(400).json(apiResponse(false, void 0, "Machine is not available"));
      }
      const activeTransaction = db2.prepare("SELECT id FROM transactions WHERE machine_id = ? AND status IN ('accepted', 'washing', 'drying', 'ready')").get(machineId);
      if (activeTransaction) {
        return res.status(400).json(apiResponse(false, void 0, "Machine is already in use by another transaction"));
      }
    }
    let resolvedDeliveryFee = 0;
    if (data.delivery_method === "delivery") {
      const firstService = items.length > 0 ? items[0].service_type : data.service_type;
      if (sanitizedCombinedAddress) {
        const quote = await calculateDeliveryFeeByAddress(sanitizedCombinedAddress);
        resolvedDeliveryFee = quote.destination ? quote.fee : getDeliveryFee(firstService);
      } else {
        resolvedDeliveryFee = getDeliveryFee(firstService);
      }
    }
    let transactionId = null;
    let reference_number = "";
    let total_price = 0;
    let newTransaction = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      reference_number = generateReferenceNumber();
      try {
        db2.prepare("BEGIN TRANSACTION").run();
        total_price = 0;
        let delivery_fee = 0;
        const serviceTypePricing = {};
        if (items.length > 0) {
          const itemsByService = {};
          items.forEach((item) => {
            const key = item.service_type;
            itemsByService[key] = (itemsByService[key] || 0) + (item.quantity || 1);
          });
          Object.keys(itemsByService).forEach((serviceType) => {
            const totalQty = itemsByService[serviceType];
            const totalPrice = calculatePrice2(serviceType, totalQty);
            serviceTypePricing[serviceType] = { totalQty, totalPrice };
            total_price += totalPrice;
          });
          delivery_fee = resolvedDeliveryFee;
        } else {
          const qty = data.quantity || 1;
          total_price = calculatePrice2(data.service_type, qty);
          serviceTypePricing[data.service_type] = { totalQty: qty, totalPrice: total_price };
          delivery_fee = resolvedDeliveryFee;
        }
        total_price += delivery_fee;
        const insertResult = db2.prepare(`
            INSERT INTO transactions (
              reference_number, customer_name, customer_phone, customer_email, service_type,
              quantity, special_instructions, appointment_date, appointment_time,
               delivery_method, address, branch, total_price, delivery_fee, machine_id, payment_method, weight
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
          reference_number,
          sanitizedCustomerName,
          sanitizedCustomerPhone,
          sanitizedEmail || null,
          data.service_type,
          items.length > 0 ? items.reduce((sum, item) => sum + (item.quantity || 1), 0) : data.quantity || 1,
          sanitizedInstructions || "",
          data.appointment_date || "",
          data.appointment_time || "",
          data.delivery_method || "",
          sanitizedCombinedAddress || "",
          null,
          total_price,
          delivery_fee,
          machineId,
          data.payment_method || "cash",
          data.weight || null
        );
        transactionId = Number(insertResult.lastInsertRowid);
        if (machineId) {
          db2.prepare("UPDATE machines SET status = 'in-use', current_transaction_id = ? WHERE id = ?").run(transactionId, machineId);
        }
        const itemStmt = db2.prepare(`
          INSERT INTO transaction_items (
            transaction_id, service_type, quantity, unit_price, total_price
          ) VALUES (?, ?, ?, ?, ?)
        `);
        if (items.length > 0) {
          items.forEach((item) => {
            const qty = item.quantity || 1;
            const serviceType = item.service_type;
            const pricing = serviceTypePricing[serviceType];
            let unitPrice;
            let itemTotal;
            if (pricing) {
              itemTotal = pricing.totalPrice / pricing.totalQty * qty;
              unitPrice = itemTotal / qty;
            } else {
              unitPrice = calculatePrice2(serviceType, qty) / qty;
              itemTotal = unitPrice * qty;
            }
            itemStmt.run(transactionId, serviceType, qty, unitPrice, itemTotal);
          });
        } else {
          const qty = data.quantity || 1;
          const unitPrice = calculatePrice2(data.service_type, qty) / qty;
          const itemTotal = unitPrice * qty;
          itemStmt.run(transactionId, data.service_type, qty, unitPrice, itemTotal);
        }
        db2.prepare("COMMIT").run();
        console.log(`[API] Transaction created: ${reference_number} with ${items.length > 0 ? items.length : 1} item(s)`);
        newTransaction = db2.prepare("SELECT * FROM transactions WHERE id = ?").get(transactionId);
        break;
      } catch (error) {
        db2.prepare("ROLLBACK").run();
        const isDupRef = (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062 || /Duplicate entry/i.test(error?.message || "") || /UNIQUE constraint failed/i.test(error?.message || "")) && /reference_number/i.test(error?.message || "");
        if (isDupRef) {
          console.warn(`[API] Reference number collision on attempt ${attempt + 1}, retrying...`);
          if (attempt === 2) {
            console.error("[API] Max retries reached for reference number generation");
            return res.status(500).json(apiResponse(false, void 0, "Failed to generate unique reference number"));
          }
          continue;
        }
        console.error("[API] Transaction creation error:", error);
        return res.status(500).json(apiResponse(false, void 0, "Failed to create transaction"));
      }
    }
    if (!newTransaction) {
      return res.status(500).json(apiResponse(false, void 0, "Failed to create transaction"));
    }
    const transactionItems = db2.prepare(
      "SELECT service_type, quantity, unit_price FROM transaction_items WHERE transaction_id = ?"
    ).all(newTransaction.id);
    res.status(201).json(
      apiResponse(true, { ...newTransaction, branch: newTransaction.branch ?? null, delivery_branch: newTransaction.branch ?? null, items: transactionItems })
    );
  });
  app.post("/api/admin/transactions", requireAuth, async (req, res) => {
    const result = transactionSchema.safeParse(req.body);
    if (!result.success) {
      console.log("[DEBUG] admin transaction validation errors:", JSON.stringify(result.error.issues));
      return res.status(400).json(
        apiResponse(false, void 0, result.error.issues.map((e) => e.message).join(", "))
      );
    }
    const data = result.data;
    const items = data.items || [];
    const sanitizedCustomerName = sanitizeInput(data.customer_name);
    const sanitizedCustomerPhone = sanitizeInput(data.customer_phone);
    const sanitizedEmail = data.customer_email ? sanitizeInput(data.customer_email) : void 0;
    const sanitizedAddress = data.address ? sanitizeInput(data.address) : void 0;
    const sanitizedBranch = data.branch ? sanitizeInput(data.branch) : void 0;
    const sanitizedCombinedAddress = sanitizedAddress && sanitizedBranch ? `${sanitizedAddress}, ${sanitizedBranch}` : sanitizedAddress;
    const sanitizedInstructions = data.special_instructions ? sanitizeInput(data.special_instructions) : void 0;
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const isHandWash = items.length > 0 ? items.some((item) => item.service_type.toLowerCase().includes("hand wash")) : data.service_type.toLowerCase().includes("hand wash");
    let assignedMachineId = data.machine_id ?? null;
    if (isHandWash) {
      assignedMachineId = null;
    }
    if (assignedMachineId) {
      const machine = db2.prepare("SELECT status FROM machines WHERE id = ?").get(assignedMachineId);
      if (!machine) {
        return res.status(400).json(apiResponse(false, void 0, "Machine not found"));
      }
      if (machine.status !== "available") {
        return res.status(400).json(apiResponse(false, void 0, "Machine is not available"));
      }
      const activeTransaction = db2.prepare("SELECT id FROM transactions WHERE machine_id = ? AND status IN ('accepted', 'washing', 'drying', 'ready')").get(assignedMachineId);
      if (activeTransaction) {
        return res.status(400).json(apiResponse(false, void 0, "Machine is already in use by another transaction"));
      }
    }
    let resolvedDeliveryFee = 0;
    if (data.delivery_method === "delivery") {
      const firstService = items.length > 0 ? items[0].service_type : data.service_type;
      if (sanitizedCombinedAddress) {
        const quote = await calculateDeliveryFeeByAddress(sanitizedCombinedAddress);
        resolvedDeliveryFee = quote.destination ? quote.fee : getDeliveryFee(firstService);
      } else {
        resolvedDeliveryFee = getDeliveryFee(firstService);
      }
    }
    let newTransactionId = null;
    let reference_number = "";
    let total_price = 0;
    let newTransaction = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      reference_number = generateReferenceNumber();
      try {
        db2.prepare("BEGIN TRANSACTION").run();
        total_price = 0;
        let delivery_fee = 0;
        const serviceTypePricing = {};
        if (items.length > 0) {
          const itemsByService = {};
          items.forEach((item) => {
            const key = item.service_type;
            itemsByService[key] = (itemsByService[key] || 0) + (item.quantity || 1);
          });
          Object.keys(itemsByService).forEach((serviceType) => {
            const totalQty = itemsByService[serviceType];
            const totalPrice = calculatePrice2(serviceType, totalQty);
            serviceTypePricing[serviceType] = { totalQty, totalPrice };
            total_price += totalPrice;
          });
          delivery_fee = resolvedDeliveryFee;
        } else {
          const qty = data.quantity || 1;
          total_price = calculatePrice2(data.service_type, qty);
          serviceTypePricing[data.service_type] = { totalQty: qty, totalPrice: total_price };
          delivery_fee = resolvedDeliveryFee;
        }
        total_price += delivery_fee;
        const initialStatus = assignedMachineId ? "accepted" : "pending";
        const stmt = db2.prepare(`
            INSERT INTO transactions (
              reference_number, customer_name, customer_phone, customer_email, service_type,
              quantity, special_instructions, appointment_date, appointment_time,
               delivery_method, address, branch, total_price, delivery_fee, status, payment_status, machine_id, payment_method, weight
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
        const insertResult = stmt.run(
          reference_number,
          sanitizedCustomerName,
          sanitizedCustomerPhone,
          sanitizedEmail || null,
          data.service_type,
          items.length > 0 ? items.reduce((sum, item) => sum + (item.quantity || 1), 0) : data.quantity || 1,
          sanitizedInstructions || "",
          data.appointment_date || today,
          data.appointment_time || "",
          data.delivery_method || "",
          sanitizedCombinedAddress || "",
          null,
          total_price,
          delivery_fee,
          initialStatus,
          data.payment_status || "unpaid",
          assignedMachineId,
          data.payment_method || "cash",
          data.weight || null
        );
        newTransactionId = Number(insertResult.lastInsertRowid);
        const itemStmt = db2.prepare(`
          INSERT INTO transaction_items (
            transaction_id, service_type, quantity, unit_price, total_price
          ) VALUES (?, ?, ?, ?, ?)
        `);
        if (items.length > 0) {
          items.forEach((item) => {
            const qty = item.quantity || 1;
            const serviceType = item.service_type;
            const pricing = serviceTypePricing[serviceType];
            let unitPrice;
            let itemTotal;
            if (pricing) {
              itemTotal = pricing.totalPrice / pricing.totalQty * qty;
              unitPrice = itemTotal / qty;
            } else {
              unitPrice = calculatePrice2(serviceType, qty) / qty;
              itemTotal = unitPrice * qty;
            }
            itemStmt.run(newTransactionId, serviceType, qty, unitPrice, itemTotal);
          });
        } else {
          const qty = data.quantity || 1;
          const unitPrice = calculatePrice2(data.service_type, qty) / qty;
          const itemTotal = unitPrice * qty;
          itemStmt.run(newTransactionId, data.service_type, qty, unitPrice, itemTotal);
        }
        if (assignedMachineId) {
          db2.prepare("UPDATE machines SET status = 'in-use', remaining_time = 2700, drying_time = 0, current_transaction_id = ? WHERE id = ?").run(newTransactionId, assignedMachineId);
        }
        if (!assignedMachineId) {
          const lastPosition = db2.prepare(`
            SELECT COALESCE(MAX(position), 0) as max_pos FROM queue WHERE status = 'waiting'
          `).get();
          const machines = db2.prepare("SELECT * FROM machines WHERE status = 'available'").all();
          const availableMachines = machines.length;
          const avgCycleTime = 2700;
          const newPosition = lastPosition.max_pos + 1;
          const estimatedWait = availableMachines > 0 ? newPosition / availableMachines * avgCycleTime : newPosition * avgCycleTime;
          const now = /* @__PURE__ */ new Date();
          const estimatedStart = new Date(now.getTime() + estimatedWait * 1e3);
          const estimatedEnd = new Date(estimatedStart.getTime() + avgCycleTime * 1e3);
          db2.prepare(`
            INSERT INTO queue (transaction_id, position, estimated_wait_time, estimated_start_time, estimated_end_time, status)
            VALUES (?, ?, ?, ?, ?, 'waiting')
          `).run(
            newTransactionId,
            newPosition,
            Math.round(estimatedWait),
            estimatedStart.toISOString(),
            estimatedEnd.toISOString()
          );
        }
        db2.prepare("COMMIT").run();
        console.log(`[API] Walk-in order created by admin: ${reference_number}, ${assignedMachineId ? "Machine " + assignedMachineId + " assigned (accepted)" : "added to queue at position " + (assignedMachineId ? "N/A" : "pending")}`);
        newTransaction = db2.prepare("SELECT * FROM transactions WHERE id = ?").get(newTransactionId);
        break;
      } catch (error) {
        db2.prepare("ROLLBACK").run();
        const isDupRef = (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062 || /Duplicate entry/i.test(error?.message || "") || /UNIQUE constraint failed/i.test(error?.message || "")) && /reference_number/i.test(error?.message || "");
        if (isDupRef) {
          console.warn(`[API] Reference number collision on attempt ${attempt + 1}, retrying...`);
          if (attempt === 2) {
            console.error("[API] Max retries reached for reference number generation");
            return res.status(500).json(apiResponse(false, void 0, "Failed to generate unique reference number"));
          }
          continue;
        }
        console.error("[API] Walk-in order creation error:", error);
        return res.status(500).json(apiResponse(false, void 0, "Failed to create walk-in order"));
      }
    }
    if (!newTransaction) {
      return res.status(500).json(apiResponse(false, void 0, "Failed to create walk-in order"));
    }
    res.status(201).json(
      apiResponse(true, { ...newTransaction, branch: newTransaction.branch ?? null, delivery_branch: newTransaction.branch ?? null })
    );
  });
  app.patch("/api/transactions/track/:reference/reschedule", publicRateLimiter, (req, res) => {
    const { reference } = req.params;
    const { appointment_date, appointment_time } = req.body || {};
    if (!appointment_date && !appointment_time) {
      return res.status(400).json(apiResponse(false, void 0, "No schedule changes provided"));
    }
    if (appointment_date && !/^\d{4}-\d{2}-\d{2}$/.test(appointment_date)) {
      return res.status(400).json(apiResponse(false, void 0, "Invalid date format (YYYY-MM-DD)"));
    }
    if (appointment_date) {
      const today = /* @__PURE__ */ new Date();
      today.setHours(0, 0, 0, 0);
      const d = /* @__PURE__ */ new Date(appointment_date + "T00:00:00");
      d.setHours(0, 0, 0, 0);
      if (isNaN(d.getTime()) || d < today) {
        return res.status(400).json(apiResponse(false, void 0, "Appointment date cannot be in the past"));
      }
    }
    if (appointment_time && !/^\d{2}:\d{2}$/.test(appointment_time)) {
      return res.status(400).json(apiResponse(false, void 0, "Invalid time format (HH:MM)"));
    }
    if (appointment_time && (appointment_time < "08:00" || appointment_time > "18:00")) {
      return res.status(400).json(apiResponse(false, void 0, "Please choose a time between 8:00 AM and 6:00 PM"));
    }
    try {
      const transaction = db2.prepare("SELECT id, status FROM transactions WHERE reference_number = ?").get(reference);
      if (!transaction) {
        return res.status(404).json(apiResponse(false, void 0, "Transaction not found"));
      }
      if (["completed", "declined", "ready"].includes(transaction.status)) {
        return res.status(400).json(apiResponse(false, void 0, "Cannot reschedule a " + transaction.status + " order"));
      }
      const fields = [];
      const values = [];
      if (appointment_date) {
        fields.push("appointment_date = ?");
        values.push(appointment_date);
      }
      if (appointment_time) {
        fields.push("appointment_time = ?");
        values.push(appointment_time);
      }
      fields.push("updated_at = ?");
      values.push((/* @__PURE__ */ new Date()).toISOString());
      values.push(transaction.id);
      db2.prepare(`UPDATE transactions SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      const updated = db2.prepare("SELECT * FROM transactions WHERE id = ?").get(transaction.id);
      res.json(apiResponse(true, updated));
    } catch (error) {
      console.error("[API] Reschedule error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to reschedule"));
    }
  });
  app.get("/api/transactions/track/:reference", publicRateLimiter, (req, res) => {
    const { reference } = req.params;
    try {
      const transaction = db2.prepare("SELECT id, reference_number, customer_name, service_type, quantity, special_instructions, appointment_date, appointment_time, delivery_method, address, branch, status, total_price, payment_status, payment_method, machine_id, created_at, updated_at FROM transactions WHERE reference_number = ?").get(reference);
      if (!transaction) {
        return res.status(404).json(apiResponse(false, void 0, "Transaction not found"));
      }
      const items = db2.prepare("SELECT * FROM transaction_items WHERE transaction_id = ? ORDER BY id").all(transaction.id);
      const review = db2.prepare("SELECT id, rating, comment, photos, created_at FROM reviews WHERE transaction_id = ?").get(transaction.id);
      if (review && review.photos) {
        try {
          review.photos = JSON.parse(review.photos);
        } catch {
          review.photos = [];
        }
      } else if (review) {
        review.photos = [];
      }
      let reviewWithReplies = review;
      if (review) {
        const replies = db2.prepare(`
             SELECT rr.id, rr.message, rr.created_at, rr.updated_at, u.username as admin_username, u.username as admin_name
             FROM review_replies rr
             JOIN admin_users u ON rr.admin_id = u.id
             WHERE rr.review_id = ?
             ORDER BY rr.created_at ASC
           `).all(review.id);
        reviewWithReplies = { ...review, replies };
      }
      res.json(apiResponse(true, { ...transaction, branch: transaction.branch ?? null, delivery_branch: transaction.branch ?? null, items, review: reviewWithReplies }));
    } catch (error) {
      console.error("[API] Transaction lookup error:", error);
      res.status(500).json(apiResponse(false, void 0, "Internal server error"));
    }
  });
  app.post("/api/reviews", publicRateLimiter, reviewUpload.array("photos", 5), (req, res) => {
    const transaction_id = parseInt(req.body.transaction_id);
    const rating = parseInt(req.body.rating);
    const comment = req.body.comment;
    if (!Number.isInteger(transaction_id) || transaction_id <= 0) {
      req.files?.forEach((f) => {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      });
      return res.status(400).json(apiResponse(false, void 0, "Invalid transaction ID"));
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      req.files?.forEach((f) => {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      });
      return res.status(400).json(apiResponse(false, void 0, "Rating must be an integer between 1 and 5"));
    }
    const files = req.files || [];
    for (const f of files) {
      if (!validateFileSignature(f.path, f.mimetype)) {
        files.forEach((x) => {
          if (fs.existsSync(x.path)) fs.unlinkSync(x.path);
        });
        return res.status(400).json(apiResponse(false, void 0, "Invalid file format - file signature does not match declared type"));
      }
    }
    const sanitizedComment = comment ? sanitizeInput(String(comment)).substring(0, 1e3) : null;
    try {
      const transaction = db2.prepare("SELECT id, status FROM transactions WHERE id = ?").get(transaction_id);
      if (!transaction) {
        files.forEach((f) => {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        });
        return res.status(404).json(apiResponse(false, void 0, "Transaction not found"));
      }
      if (transaction.status !== "completed") {
        files.forEach((f) => {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        });
        return res.status(400).json(apiResponse(false, void 0, "Reviews can only be submitted for completed orders"));
      }
      const existingReview = db2.prepare("SELECT id FROM reviews WHERE transaction_id = ?").get(transaction_id);
      if (existingReview) {
        files.forEach((f) => {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        });
        return res.status(409).json(apiResponse(false, void 0, "A review has already been submitted for this order"));
      }
      const photoUrls = files.map((f) => `/uploads/review-photos/${f.filename}`);
      const photosJson = photoUrls.length ? JSON.stringify(photoUrls) : null;
      db2.prepare(`
         INSERT INTO reviews (transaction_id, rating, comment, photos, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))
       `).run(transaction_id, rating, sanitizedComment, photosJson);
      res.json(apiResponse(true, { message: "Review submitted", photos: photoUrls }));
    } catch (error) {
      files.forEach((f) => {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      });
      console.error("[API] Review submission error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to submit review"));
    }
  });
  app.get("/api/reviews", requireAuth, (req, res) => {
    try {
      const reviews = db2.prepare(`
        SELECT r.*, t.reference_number, t.customer_name, t.service_type, t.total_price
        FROM reviews r
        JOIN transactions t ON r.transaction_id = t.id
        WHERE t.deleted_at IS NULL
        ORDER BY r.created_at DESC
      `).all();
      const parsed = reviews.map((r) => {
        if (r.photos) {
          try {
            r.photos = JSON.parse(r.photos);
          } catch {
            r.photos = [];
          }
        } else {
          r.photos = [];
        }
        return r;
      });
      res.json(apiResponse(true, parsed));
    } catch (error) {
      console.error("[API] Get reviews error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to get reviews"));
    }
  });
  app.get("/api/reviews/public", publicRateLimiter, (req, res) => {
    try {
      const reviews = db2.prepare(`
         SELECT r.*, t.reference_number, t.customer_name, t.service_type, t.total_price
         FROM reviews r
         JOIN transactions t ON r.transaction_id = t.id
         WHERE t.deleted_at IS NULL
         ORDER BY r.created_at DESC
       `).all();
      const replyStmt = db2.prepare(`
         SELECT rr.id, rr.message, rr.created_at, rr.updated_at, u.username as admin_username, u.username as admin_name
         FROM review_replies rr
         JOIN admin_users u ON rr.admin_id = u.id
         WHERE rr.review_id = ?
         ORDER BY rr.created_at ASC
       `);
      const enriched = reviews.map((review) => {
        let photos = review.photos;
        if (photos) {
          try {
            photos = JSON.parse(photos);
          } catch {
            photos = [];
          }
        } else {
          photos = [];
        }
        return {
          ...review,
          photos,
          replies: replyStmt.all(review.id)
        };
      });
      res.json(apiResponse(true, enriched));
    } catch (error) {
      console.error("[API] Get public reviews error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to get reviews"));
    }
  });
  app.get("/api/reviews/:reviewId/replies", requireAuth, (req, res) => {
    const reviewId = parseInt(req.params.reviewId);
    if (isNaN(reviewId)) {
      return res.status(400).json(apiResponse(false, void 0, "Invalid review ID"));
    }
    try {
      const replies = db2.prepare(`
        SELECT rr.*, u.username as admin_username
        FROM review_replies rr
        JOIN admin_users u ON rr.admin_id = u.id
        WHERE rr.review_id = ?
        ORDER BY rr.created_at ASC
      `).all(reviewId);
      res.json(apiResponse(true, replies));
    } catch (error) {
      console.error("[API] Get review replies error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to get review replies"));
    }
  });
  app.post("/api/reviews/:reviewId/replies", requireAuth, (req, res) => {
    const reviewId = parseInt(req.params.reviewId);
    const { message } = req.body;
    const user = req.user;
    if (isNaN(reviewId)) {
      return res.status(400).json(apiResponse(false, void 0, "Invalid review ID"));
    }
    if (!message || !message.trim()) {
      return res.status(400).json(apiResponse(false, void 0, "Message is required"));
    }
    try {
      const review = db2.prepare("SELECT id FROM reviews WHERE id = ?").get(reviewId);
      if (!review) {
        return res.status(404).json(apiResponse(false, void 0, "Review not found"));
      }
      const sanitizedMessage = sanitizeInput(message.trim()).substring(0, 1e3);
      const adminId = parseInt(user.userId);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const result = db2.prepare(`
        INSERT INTO review_replies (review_id, admin_id, message, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(reviewId, adminId, sanitizedMessage, now, now);
      const reply = db2.prepare(`
        SELECT rr.*, u.username as admin_username
        FROM review_replies rr
        JOIN admin_users u ON rr.admin_id = u.id
        WHERE rr.id = ?
      `).get(result.lastInsertRowid);
      res.status(201).json(apiResponse(true, reply));
    } catch (error) {
      console.error("[API] Create review reply error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to create review reply"));
    }
  });
  app.patch("/api/replies/:id", requireAuth, (req, res) => {
    const replyId = parseInt(req.params.id);
    const { message } = req.body;
    const user = req.user;
    if (isNaN(replyId)) {
      return res.status(400).json(apiResponse(false, void 0, "Invalid reply ID"));
    }
    if (!message || !message.trim()) {
      return res.status(400).json(apiResponse(false, void 0, "Message is required"));
    }
    try {
      const existing = db2.prepare("SELECT admin_id FROM review_replies WHERE id = ?").get(replyId);
      if (!existing) {
        return res.status(404).json(apiResponse(false, void 0, "Reply not found"));
      }
      const adminId = parseInt(user.userId);
      if (existing.admin_id !== adminId && user.role !== "super_admin") {
        return res.status(403).json(apiResponse(false, void 0, "You can only edit your own replies"));
      }
      const sanitizedMessage = sanitizeInput(message.trim()).substring(0, 1e3);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      db2.prepare(`
        UPDATE review_replies SET message = ?, updated_at = ? WHERE id = ?
      `).run(sanitizedMessage, now, replyId);
      const reply = db2.prepare(`
        SELECT rr.*, u.username as admin_username
        FROM review_replies rr
        JOIN admin_users u ON rr.admin_id = u.id
        WHERE rr.id = ?
      `).get(replyId);
      res.json(apiResponse(true, reply));
    } catch (error) {
      console.error("[API] Update review reply error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to update review reply"));
    }
  });
  app.delete("/api/replies/:id", requireAuth, (req, res) => {
    const replyId = parseInt(req.params.id);
    const user = req.user;
    if (isNaN(replyId)) {
      return res.status(400).json(apiResponse(false, void 0, "Invalid reply ID"));
    }
    try {
      const existing = db2.prepare("SELECT admin_id FROM review_replies WHERE id = ?").get(replyId);
      if (!existing) {
        return res.status(404).json(apiResponse(false, void 0, "Reply not found"));
      }
      const adminId = parseInt(user.userId);
      if (existing.admin_id !== adminId && user.role !== "super_admin") {
        return res.status(403).json(apiResponse(false, void 0, "You can only delete your own replies"));
      }
      db2.prepare("DELETE FROM review_replies WHERE id = ?").run(replyId);
      res.json(apiResponse(true, { success: true }));
    } catch (error) {
      console.error("[API] Delete review reply error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to delete review reply"));
    }
  });
  app.get("/api/transactions", requireAuth, (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status;
    const deliveryMethod = req.query.delivery_method;
    const search = (req.query.search || "").trim();
    let whereClause = "WHERE t.deleted_at IS NULL";
    const params = [];
    if (status) {
      whereClause += " AND t.status = ?";
      params.push(status);
    }
    if (deliveryMethod) {
      whereClause += " AND t.delivery_method = ?";
      params.push(deliveryMethod);
    }
    if (search) {
      whereClause += " AND (t.reference_number LIKE ? OR t.customer_name LIKE ? OR t.customer_phone LIKE ?)";
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    try {
      const countResult = db2.prepare("SELECT COUNT(*) as total FROM transactions t " + whereClause).get(...params);
      const transactions = db2.prepare(
        `SELECT t.*, m.name as machine_name
           FROM transactions t
           LEFT JOIN machines m ON t.machine_id = m.id
           ${whereClause} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`
      ).all(...params, limit, offset);
      const transactionIds = transactions.map((t) => t.id);
      let itemsByTransaction = {};
      if (transactionIds.length > 0) {
        const placeholders = transactionIds.map(() => "?").join(",");
        const allItems = db2.prepare(`SELECT * FROM transaction_items WHERE transaction_id IN (${placeholders}) ORDER BY transaction_id, id`).all(...transactionIds);
        itemsByTransaction = allItems.reduce((acc, item) => {
          if (!acc[item.transaction_id]) acc[item.transaction_id] = [];
          acc[item.transaction_id].push(item);
          return acc;
        }, {});
      }
      const transactionsWithItems = transactions.map((t) => ({
        ...t,
        branch: t.branch ?? null,
        delivery_branch: t.branch ?? null,
        items: itemsByTransaction[t.id] || []
      }));
      const meta = {
        page,
        limit,
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / limit)
      };
      res.json(apiResponse(true, transactionsWithItems, void 0, meta));
    } catch (error) {
      console.error("[API] Get transactions error:", error);
      res.status(500).json(apiResponse(false, void 0, "Internal server error"));
    }
  });
  app.patch("/api/transactions/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(apiResponse(false, void 0, "Invalid transaction ID"));
    }
    const result = updateTransactionSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(
        apiResponse(false, void 0, result.error.issues.map((e) => e.message).join(", "))
      );
    }
    try {
      const current = db2.prepare("SELECT * FROM transactions WHERE id = ?").get(id);
      if (!current) {
        return res.status(404).json(apiResponse(false, void 0, "Transaction not found"));
      }
      const updates = result.data;
      if (updates.status !== void 0 && updates.status !== current.status) {
        const allowed = {
          pending: ["accepted", "declined"],
          accepted: ["washing", "declined"],
          washing: ["drying", "declined"],
          drying: ["ready", "declined"],
          ready: ["completed"],
          completed: [],
          declined: []
        };
        if (!(allowed[current.status] || []).includes(updates.status)) {
          return res.status(400).json(apiResponse(false, void 0, "Invalid status transition"));
        }
      }
      const startsDrying = updates.status === "drying" && current.status === "washing" && current.machine_id !== null;
      const marksReady = updates.status === "ready" && current.status === "drying" && current.machine_id !== null;
      if (startsDrying || marksReady) {
        const machine = db2.prepare("SELECT remaining_time, drying_time FROM machines WHERE id = ?").get(current.machine_id);
        if (!machine) {
          return res.status(400).json(apiResponse(false, void 0, "Assigned machine not found"));
        }
        if (startsDrying && machine.remaining_time > 0) {
          return res.status(400).json(apiResponse(false, void 0, "Wait for the machine timer to finish before advancing this order"));
        }
        if (marksReady && machine.drying_time > 0) {
          return res.status(400).json(apiResponse(false, void 0, "Wait for the drying timer to finish before completing this order"));
        }
      }
      const fields = [];
      if (current.status === "declined" && updates.payment_status !== void 0) {
        return res.status(400).json(apiResponse(false, void 0, "Cannot change payment status for declined orders"));
      }
      const values = [];
      const newServiceType = updates.service_type || current.service_type;
      const isHandWash = newServiceType.toLowerCase().includes("hand wash");
      if (updates.status !== void 0 && updates.status === "washing" && isHandWash) {
        const hasProof = current.handwash_proof_image && current.handwash_proof_image.trim() !== "";
        if (!hasProof) {
          return res.status(400).json(apiResponse(false, void 0, "Handwash proof image is required before starting wash for hand wash orders"));
        }
      }
      if (updates.status !== void 0) {
        fields.push("status = ?");
        values.push(updates.status);
      }
      {
        const recomputedServiceType = updates.service_type || current.service_type;
        const recomputedQuantity = current.quantity || 1;
        const recomputedDeliveryFee = current.delivery_fee || 0;
        const recomputedTotalPrice = calculatePrice2(recomputedServiceType, recomputedQuantity) + recomputedDeliveryFee;
        fields.push("total_price = ?");
        values.push(recomputedTotalPrice);
      }
      if (updates.weight !== void 0) {
        fields.push("weight = ?");
        values.push(updates.weight);
      }
      if (updates.payment_status !== void 0) {
        fields.push("payment_status = ?");
        values.push(updates.payment_status);
      }
      const prevMachineId = current.machine_id;
      if (updates.machine_id !== void 0) {
        if (isHandWash) {
          fields.push("machine_id = NULL");
        } else {
          const machineId = updates.machine_id;
          if (machineId !== null) {
            const machine = db2.prepare("SELECT status FROM machines WHERE id = ?").get(machineId);
            if (!machine) {
              return res.status(400).json(apiResponse(false, void 0, "Machine not found"));
            }
            if (machine.status === "in-use") {
              const existingAssignment = db2.prepare("SELECT id FROM transactions WHERE machine_id = ? AND id != ?").get(machineId, id);
              if (existingAssignment) {
                return res.status(400).json(apiResponse(false, void 0, "Machine is already in use by another transaction"));
              }
            }
          }
          fields.push("machine_id = ?");
          values.push(updates.machine_id);
        }
      }
      if (updates.service_type !== void 0) {
        fields.push("service_type = ?");
        values.push(updates.service_type);
      }
      if (updates.appointment_date !== void 0) {
        fields.push("appointment_date = ?");
        values.push(updates.appointment_date);
      }
      if (updates.appointment_time !== void 0) {
        fields.push("appointment_time = ?");
        values.push(updates.appointment_time);
      }
      if (updates.payment_method !== void 0) {
        fields.push("payment_method = ?");
        values.push(updates.payment_method);
      }
      fields.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      const runUpdate = db2.transaction(() => {
        const fieldSet = fields.join(", ");
        const query = "UPDATE transactions SET " + fieldSet + " WHERE id = ?";
        db2.prepare(query).run(...values);
        const newStatus = updates.status !== void 0 ? updates.status : current.status;
        if (updates.status === "washing" && current.machine_id) {
          const machine = db2.prepare("SELECT remaining_time FROM machines WHERE id = ?").get(current.machine_id);
          const requestedWashTime = updates.remaining_time ?? machine?.remaining_time ?? 0;
          const washTime = requestedWashTime > 0 ? requestedWashTime : 2700;
          db2.prepare(`
            UPDATE machines
            SET status = 'in-use',
                remaining_time = ?,
                drying_time = 0,
                current_transaction_id = ?
            WHERE id = ?
          `).run(washTime, id, current.machine_id);
        }
        if (startsDrying) {
          db2.prepare("UPDATE machines SET status = 'in-use', remaining_time = 0, drying_time = ?, current_transaction_id = ? WHERE id = ?").run(updates.drying_time ?? 2700, id, current.machine_id);
        }
        if (marksReady) {
          db2.prepare("UPDATE machines SET status = 'available', remaining_time = 0, drying_time = 0, current_transaction_id = NULL WHERE id = ?").run(current.machine_id);
        }
        if (newStatus === "completed" || newStatus === "declined") {
          if (current.machine_id) {
            db2.prepare("UPDATE machines SET status = 'available', remaining_time = 0, drying_time = 0, current_transaction_id = NULL WHERE id = ?").run(current.machine_id);
          }
        }
        if (updates.machine_id !== void 0 && updates.machine_id !== null && !isHandWash) {
          db2.prepare("UPDATE machines SET status = 'in-use', current_transaction_id = ? WHERE id = ?").run(id, updates.machine_id);
        }
        if (updates.machine_id !== void 0 && updates.machine_id === null && !isHandWash) {
          if (prevMachineId) {
            db2.prepare("UPDATE machines SET status = 'available', current_transaction_id = NULL WHERE id = ?").run(prevMachineId);
          }
        }
        if (updates.machine_id === void 0 && (newStatus === "completed" || newStatus === "declined") && current.machine_id) {
          db2.prepare("UPDATE machines SET status = 'available', remaining_time = 0, drying_time = 0, current_transaction_id = NULL WHERE id = ?").run(current.machine_id);
        }
      });
      runUpdate();
      console.log(`[API] Transaction ${id} updated`);
      const updatedTransaction = db2.prepare("SELECT * FROM transactions WHERE id = ?").get(id);
      res.json(
        apiResponse(true, updatedTransaction)
      );
    } catch (error) {
      console.error("[API] Update transaction error:", error);
      res.status(500).json(apiResponse(false, void 0, "Internal server error"));
    }
  });
  app.delete("/api/transactions/:id", requireAuth, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(apiResponse(false, void 0, "Invalid transaction ID"));
    }
    try {
      const existing = db2.prepare("SELECT machine_id FROM transactions WHERE id = ?").get(id);
      if (!existing) {
        return res.status(404).json(apiResponse(false, void 0, "Transaction not found"));
      }
      try {
        db2.prepare("DELETE FROM queue WHERE transaction_id = ?").run(id);
      } catch (e) {
      }
      db2.prepare("DELETE FROM transaction_items WHERE transaction_id = ?").run(id);
      db2.prepare("DELETE FROM reviews WHERE transaction_id = ?").run(id);
      const result = db2.prepare("DELETE FROM transactions WHERE id = ?").run(id);
      if (result.changes === 0) {
        return res.status(404).json(apiResponse(false, void 0, "Transaction not found"));
      }
      if (existing.machine_id) {
        db2.prepare("UPDATE machines SET status = 'available', remaining_time = 0, drying_time = 0, current_transaction_id = NULL WHERE id = ?").run(existing.machine_id);
      }
      console.log(`[API] Transaction ${id} deleted`);
      res.json(apiResponse(true, { success: true }));
    } catch (error) {
      console.error("[API] Delete transaction error:", error);
      res.status(500).json(apiResponse(false, void 0, "Internal server error: " + error));
    }
  });
  app.post("/api/transactions/:id/handwash-proof", requireAuth, upload.single("image"), (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(apiResponse(false, void 0, "Invalid transaction ID"));
    }
    if (!req.file) {
      return res.status(400).json(apiResponse(false, void 0, "Image file is required"));
    }
    if (!validateFileSignature(req.file.path, req.file.mimetype)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json(apiResponse(false, void 0, "Invalid file format - file signature does not match declared type"));
    }
    try {
      const existing = db2.prepare("SELECT id, service_type FROM transactions WHERE id = ?").get(id);
      if (!existing) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json(apiResponse(false, void 0, "Transaction not found"));
      }
      if (!existing.service_type || !existing.service_type.toLowerCase().includes("hand wash")) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json(apiResponse(false, void 0, "Handwash proof can only be uploaded for hand wash orders"));
      }
      const filePath = `/uploads/handwash-proofs/${req.file.filename}`;
      db2.prepare(`
        UPDATE transactions
        SET handwash_proof_image = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(filePath, id);
      console.log(`[API] Handwash proof image uploaded for transaction ${id}: ${filePath}`);
      res.json(apiResponse(true, { success: true, filePath }));
    } catch (error) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      console.error("[API] Upload handwash proof error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to upload handwash proof"));
    }
  });
  app.post("/api/machines/reset", requireAuth, (req, res) => {
    try {
      const resetMachinesWithNoTime = db2.transaction(() => {
        const resetMachines = db2.prepare(`
           UPDATE machines
           SET status = 'available', remaining_time = 0, drying_time = 0, current_transaction_id = NULL
           WHERE remaining_time <= 0 AND drying_time <= 0
             AND id NOT IN (
               SELECT machine_id FROM transactions
               WHERE machine_id IS NOT NULL
                 AND status IN ('accepted', 'washing', 'drying', 'ready')
             )
         `).run();
        return { machines: resetMachines.changes, transactions: 0 };
      });
      const resetCounts = resetMachinesWithNoTime();
      console.log(`[API] Reset ${resetCounts.machines} machines without time remaining`);
      res.json(apiResponse(true, { success: true, ...resetCounts }));
    } catch (error) {
      console.error("[API] Reset machines error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to reset machines"));
    }
  });
  app.patch("/api/machines/:id", requireAuth, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(apiResponse(false, void 0, "Invalid machine ID"));
    }
    const result = machineUpdateSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(
        apiResponse(false, void 0, result.error.issues.map((e) => e.message).join(", "))
      );
    }
    console.log(`[API] Updating machine ${id}:`, result.data);
    try {
      const machine = db2.prepare("SELECT * FROM machines WHERE id = ?").get(id);
      if (!machine) {
        return res.status(404).json(apiResponse(false, void 0, `Machine ${id} not found`));
      }
      const updates = result.data;
      const nextStatus = updates.status ?? machine.status;
      let nextTime = updates.remaining_time ?? machine.remaining_time;
      let nextDryingTime = updates.drying_time ?? machine.drying_time;
      if (nextStatus === "available" || nextStatus === "maintenance") {
        nextTime = 0;
        nextDryingTime = 0;
      }
      if (nextStatus === "in-use") {
        const activeTransactions = db2.prepare(`
          SELECT reference_number FROM transactions
          WHERE machine_id = ? AND status IN ('accepted', 'washing', 'drying', 'ready')
        `).all(id);
        if (activeTransactions.length > 1) {
          return res.status(400).json(
            apiResponse(false, void 0, `Machine is already assigned to transaction ${activeTransactions[1].reference_number}`)
          );
        }
      }
      if (nextStatus === "available") {
        const activeTransaction = db2.prepare(`
          SELECT id FROM transactions
          WHERE machine_id = ? AND status IN ('accepted', 'washing', 'drying', 'ready')
        `).get(id);
        if (activeTransaction) {
          return res.status(400).json(
            apiResponse(false, void 0, "Cannot set machine to available while it has active transactions")
          );
        }
      }
      if (nextStatus === "available" || nextStatus === "maintenance") {
        db2.prepare("UPDATE machines SET status = ?, remaining_time = 0, drying_time = 0, current_transaction_id = NULL WHERE id = ?").run(nextStatus, id);
      } else {
        db2.prepare("UPDATE machines SET status = ?, remaining_time = ?, drying_time = ? WHERE id = ?").run(nextStatus, nextTime, nextDryingTime, id);
      }
      console.log(`[API] Machine ${id} updated to ${nextStatus} (${nextTime}m)`);
      res.json(
        apiResponse(true, {
          id,
          status: nextStatus,
          remaining_time: nextTime,
          drying_time: nextDryingTime
        })
      );
    } catch (error) {
      console.error("[API] Machine update error:", error);
      res.status(500).json(apiResponse(false, void 0, "Internal server error"));
    }
  });
  const machineCreateSchema = z.object({
    name: z.string().min(1, "Machine name is required").max(100),
    type: z.enum(["washer", "dryer", "all-in-one"]),
    capacity: z.number().int().min(1).max(100).optional()
  });
  app.post("/api/machines", requireAuth, (req, res) => {
    const result = machineCreateSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(
        apiResponse(false, void 0, result.error.issues.map((e) => e.message).join(", "))
      );
    }
    const { name, type, capacity } = result.data;
    try {
      const insertResult = db2.prepare(`
        INSERT INTO machines (name, type, capacity, status, remaining_time, avg_cycle_time, total_jobs_completed, is_default)
        VALUES (?, ?, ?, 'available', 0, 2700, 0, 0)
      `).run(name, type, capacity || 10);
      const newMachine = db2.prepare("SELECT * FROM machines WHERE id = ?").get(insertResult.lastInsertRowid);
      console.log(`[API] Machine created: ${name} (${type})`);
      res.status(201).json(apiResponse(true, newMachine));
    } catch (error) {
      console.error("[API] Create machine error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to create machine"));
    }
  });
  app.delete("/api/machines", requireAuth, (req, res) => {
    try {
      const machines = db2.prepare("SELECT id, status FROM machines").all();
      for (const machine of machines) {
        if (machine.status === "in-use") {
          return res.status(400).json(apiResponse(false, void 0, `Cannot delete machine ${machine.id}: it is currently in use`));
        }
        const activeTransactions = db2.prepare(`
          SELECT COUNT(*) as count FROM transactions
          WHERE machine_id = ? AND status IN ('accepted', 'washing', 'drying', 'ready')
        `).get(machine.id);
        if (activeTransactions.count > 0) {
          return res.status(400).json(apiResponse(false, void 0, `Cannot delete machine ${machine.id}: it has active transactions`));
        }
      }
      db2.prepare("UPDATE transactions SET machine_id = NULL WHERE machine_id IN (SELECT id FROM machines)").run();
      db2.prepare("DELETE FROM machines").run();
      console.log("[API] All machines deleted");
      res.json(apiResponse(true, { success: true, deleted: machines.length }));
    } catch (error) {
      console.error("[API] Delete all machines error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to delete machines"));
    }
  });
  app.delete("/api/machines/:id", requireAuth, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(apiResponse(false, void 0, "Invalid machine ID"));
    }
    try {
      const machine = db2.prepare("SELECT * FROM machines WHERE id = ?").get(id);
      if (!machine) {
        return res.status(404).json(apiResponse(false, void 0, "Machine not found"));
      }
      if (machine.status === "in-use") {
        return res.status(400).json(apiResponse(false, void 0, "Cannot delete machine that is in use"));
      }
      const activeTransactions = db2.prepare(`
        SELECT COUNT(*) as count FROM transactions
        WHERE machine_id = ? AND status IN ('accepted', 'washing', 'drying', 'ready')
      `).get(id);
      if (activeTransactions.count > 0) {
        return res.status(400).json(apiResponse(false, void 0, "Cannot delete machine with active transactions"));
      }
      db2.prepare("UPDATE transactions SET machine_id = NULL WHERE machine_id = ?").run(id);
      db2.prepare("DELETE FROM machines WHERE id = ?").run(id);
      console.log(`[API] Machine ${id} deleted`);
      res.json(apiResponse(true, { success: true }));
    } catch (error) {
      console.error("[API] Delete machine error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to delete machine"));
    }
  });
  app.get("/api/pricing", requireAuth, (req, res) => {
    try {
      const pricing = db2.prepare("SELECT * FROM pricing WHERE is_active = 1 ORDER BY service_type").all();
      res.json(apiResponse(true, pricing));
    } catch (error) {
      console.error("[API] Get pricing error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to get pricing"));
    }
  });
  app.get("/api/pricing/public", publicRateLimiter, (req, res) => {
    try {
      const pricing = db2.prepare("SELECT * FROM pricing WHERE is_active = 1 ORDER BY service_type").all();
      res.json(apiResponse(true, pricing));
    } catch (error) {
      console.error("[API] Get public pricing error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to get pricing"));
    }
  });
  app.get("/api/pricing/history", requireAuth, (req, res) => {
    try {
      const history = db2.prepare("SELECT * FROM price_history ORDER BY created_at DESC LIMIT 100").all();
      res.json(apiResponse(true, history));
    } catch (error) {
      console.error("[API] Get price history error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to get price history"));
    }
  });
  app.delete("/api/pricing/history", requireAuth, (req, res) => {
    try {
      db2.prepare("DELETE FROM price_history").run();
      console.log("[API] All price history deleted");
      res.json(apiResponse(true, { success: true }));
    } catch (error) {
      console.error("[API] Delete price history error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to delete price history"));
    }
  });
  const emptyStringToUndefined = (val) => val === "" ? void 0 : val;
  const pricingUpdateSchema = z.object({
    service_type: z.string().min(1, "Service type is required"),
    pricing_type: z.enum(["tiered", "per_kg"]),
    tier_1_limit: z.preprocess(emptyStringToUndefined, z.number().int().min(1).optional()),
    tier_1_price: z.preprocess(emptyStringToUndefined, z.number().min(0).optional()),
    tier_2_limit: z.preprocess(emptyStringToUndefined, z.number().int().min(1).optional()),
    tier_2_price: z.preprocess(emptyStringToUndefined, z.number().min(0).optional()),
    tier_3_limit: z.preprocess(emptyStringToUndefined, z.number().int().min(1).optional()),
    tier_3_price: z.preprocess(emptyStringToUndefined, z.number().min(0).optional()),
    tier_4_limit: z.preprocess(emptyStringToUndefined, z.number().int().min(1).optional()),
    tier_4_price: z.preprocess(emptyStringToUndefined, z.number().min(0).optional()),
    tier_5_price_per_kg: z.preprocess(emptyStringToUndefined, z.number().min(0).optional()),
    per_kg_price: z.preprocess(emptyStringToUndefined, z.number().min(0).optional()),
    delivery_fee: z.preprocess(emptyStringToUndefined, z.number().min(0).optional())
  });
  app.patch("/api/pricing/:serviceType", requireAuth, (req, res) => {
    const { serviceType } = req.params;
    const result = pricingUpdateSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(
        apiResponse(false, void 0, result.error.issues.map((e) => e.message).join(", "))
      );
    }
    try {
      const decodedServiceType = decodeURIComponent(serviceType);
      const currentPricing = db2.prepare("SELECT * FROM pricing WHERE service_type = ?").get(decodedServiceType);
      if (!currentPricing) {
        return res.status(404).json(apiResponse(false, void 0, "Pricing not found for service type"));
      }
      const updates = result.data;
      const fields = [];
      const values = [];
      const validPricingColumns = /* @__PURE__ */ new Set([
        "pricing_type",
        "base_price",
        "tier_1_limit",
        "tier_1_price",
        "tier_2_limit",
        "tier_2_price",
        "tier_3_limit",
        "tier_3_price",
        "tier_4_limit",
        "tier_4_price",
        "tier_5_price_per_kg",
        "per_kg_price",
        "is_active",
        "delivery_fee"
      ]);
      Object.entries(updates).forEach(([key, value]) => {
        if (value !== void 0 && validPricingColumns.has(key)) {
          fields.push(`${key} = ?`);
          values.push(value);
        }
      });
      fields.push("updated_at = CURRENT_TIMESTAMP");
      values.push(decodedServiceType);
      if (fields.length > 1) {
        const query = "UPDATE pricing SET " + fields.join(", ") + " WHERE service_type = ?";
        db2.prepare(query).run(...values);
        db2.prepare(`
          INSERT INTO price_history (service_type, old_price_data, new_price_data, changed_by, created_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).run(
          decodedServiceType,
          currentPricing ? JSON.stringify(currentPricing) : null,
          JSON.stringify({ ...currentPricing, ...updates }),
          req.user.userId
        );
        console.log(`[API] Pricing updated for ${decodedServiceType}`);
        res.json(apiResponse(true, { success: true }));
      } else {
        res.json(apiResponse(true, { success: true, message: "No changes made" }));
      }
    } catch (error) {
      console.error("[API] Update pricing error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to update pricing"));
    }
  });
  app.get("/api/stats", requireAuth, (req, res) => {
    try {
      const stats = db2.prepare(
        `
        SELECT
          COUNT(*) as total_orders,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN total_price ELSE 0 END), 0) as total_sales,
          COUNT(CASE WHEN status NOT IN ('completed', 'declined') THEN 1 END) as pending_orders
        FROM transactions
        WHERE deleted_at IS NULL
      `
      ).get();
      res.json(apiResponse(true, stats));
    } catch (error) {
      console.error("[API] Stats error:", error);
      res.status(500).json(apiResponse(false, void 0, "Internal server error"));
    }
  });
  app.get("/api/sales", requireAuth, (req, res) => {
    const range = req.query.range || "month";
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    const serviceType = req.query.service_type || "";
    let dateFilter = "";
    let prevDateFilter = "";
    let serviceFilter = "";
    const filterParams = [];
    if (serviceType) {
      serviceFilter = "AND service_type = ?";
      filterParams.push(serviceType);
    }
    switch (range) {
      case "today":
        dateFilter = `AND date(created_at, '+8 hours') = date('now', '+8 hours')`;
        prevDateFilter = `AND date(created_at, '+8 hours') = date('now', '+8 hours', '-1 day')`;
        break;
      case "week":
        dateFilter = `AND created_at >= date('now', '+8 hours', '-7 days')`;
        prevDateFilter = `AND created_at >= date('now', '+8 hours', '-14 days') AND created_at < date('now', '+8 hours', '-7 days')`;
        break;
      case "month":
        dateFilter = `AND created_at >= date('now', '+8 hours', '-30 days')`;
        prevDateFilter = `AND created_at >= date('now', '+8 hours', '-60 days') AND created_at < date('now', '+8 hours', '-30 days')`;
        break;
      default:
        dateFilter = "";
        prevDateFilter = "";
    }
    try {
      const stats = db2.prepare(
        "SELECT COUNT(*) as total_orders, COALESCE(SUM(CASE WHEN status = 'completed' THEN total_price ELSE 0 END), 0) as total_sales, COUNT(CASE WHEN status NOT IN ('completed', 'declined') THEN 1 END) as pending_orders, COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders, COUNT(CASE WHEN status = 'declined' THEN 1 END) as declined_orders FROM transactions WHERE deleted_at IS NULL " + dateFilter + " " + serviceFilter
      ).get(...filterParams);
      const prevStats = prevDateFilter ? db2.prepare(
        "SELECT COUNT(*) as total_orders, COALESCE(SUM(CASE WHEN status = 'completed' THEN total_price ELSE 0 END), 0) as total_sales FROM transactions WHERE deleted_at IS NULL " + prevDateFilter + " " + serviceFilter
      ).get(...filterParams) : null;
      const dailySalesAll = db2.prepare(
        "SELECT date(created_at, '+8 hours') as date, COUNT(*) as count, COALESCE(SUM(total_price), 0) as total, SUM(CASE WHEN delivery_method = 'pickup' THEN 1 ELSE 0 END) as walk_in_count, SUM(CASE WHEN delivery_method = 'delivery' THEN 1 ELSE 0 END) as booking_count FROM transactions WHERE deleted_at IS NULL " + dateFilter + " " + serviceFilter + " GROUP BY date(created_at, '+8 hours') ORDER BY date DESC LIMIT ? OFFSET ?"
      ).all(...filterParams, limit, (page - 1) * limit);
      const dailySales = db2.prepare(
        "SELECT date(created_at, '+8 hours') as date, COUNT(*) as count, COALESCE(SUM(total_price), 0) as total FROM transactions WHERE status = 'completed' AND deleted_at IS NULL " + dateFilter + " " + serviceFilter + " GROUP BY date(created_at, '+8 hours') ORDER BY date(created_at, '+8 hours') ASC"
      ).all(...filterParams);
      const serviceBreakdown = db2.prepare(
        "SELECT service_type as service, COUNT(*) as count, COALESCE(SUM(total_price), 0) as total FROM transactions WHERE deleted_at IS NULL " + dateFilter + " " + serviceFilter + " GROUP BY service_type ORDER BY count DESC"
      ).all(...filterParams);
      const paymentBreakdown = db2.prepare(
        "SELECT payment_status, COUNT(*) as count, COALESCE(SUM(total_price), 0) as total FROM transactions WHERE status = 'completed' AND deleted_at IS NULL " + dateFilter + " " + serviceFilter + " GROUP BY payment_status"
      ).all(...filterParams);
      const walkInStats = db2.prepare(
        "SELECT COUNT(*) as walk_in_orders, COALESCE(SUM(total_price), 0) as walk_in_sales FROM transactions WHERE delivery_method = 'pickup' AND deleted_at IS NULL " + dateFilter + " " + serviceFilter
      ).get(...filterParams);
      const bookingStats = db2.prepare(
        "SELECT COUNT(*) as booking_orders, COALESCE(SUM(total_price), 0) as booking_sales FROM transactions WHERE delivery_method = 'delivery' AND deleted_at IS NULL " + dateFilter + " " + serviceFilter
      ).get(...filterParams);
      const avgOrderValue = stats.total_orders > 0 ? stats.total_sales / stats.total_orders : 0;
      const completionRate = stats.total_orders > 0 ? stats.completed_orders / stats.total_orders * 100 : 0;
      const peakHours = db2.prepare(
        "SELECT CAST(strftime('%H', created_at, '+8 hours') as INTEGER) as hour, COUNT(*) as count FROM transactions WHERE deleted_at IS NULL " + dateFilter + " " + serviceFilter + " GROUP BY hour ORDER BY hour"
      ).all(...filterParams);
      const peakDays = db2.prepare(
        "SELECT CASE CAST(strftime('%w', created_at, '+8 hours') as INTEGER) WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday' WHEN 3 THEN 'Wednesday' WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday' WHEN 6 THEN 'Saturday' END as day, COUNT(*) as count FROM transactions WHERE deleted_at IS NULL " + dateFilter + " " + serviceFilter + " GROUP BY day ORDER BY count DESC"
      ).all(...filterParams);
      const topCustomers = db2.prepare(
        "SELECT customer_name, customer_phone, COUNT(*) as order_count, COALESCE(SUM(total_price), 0) as total_spent FROM transactions WHERE deleted_at IS NULL AND customer_name != '' AND customer_name IS NOT NULL " + dateFilter + " " + serviceFilter + " GROUP BY customer_name, customer_phone ORDER BY order_count DESC, total_spent DESC LIMIT 5"
      ).all(...filterParams);
      const prevTotalSales = prevStats ? prevStats.total_sales || 0 : 0;
      const prevTotalOrders = prevStats ? prevStats.total_orders || 0 : 0;
      const revenueChange = prevTotalSales > 0 ? (stats.total_sales - prevTotalSales) / prevTotalSales * 100 : 0;
      const ordersChange = prevTotalOrders > 0 ? (stats.total_orders - prevTotalOrders) / prevTotalOrders * 100 : 0;
      res.json(
        apiResponse(true, {
          ...stats,
          prev_total_sales: prevTotalSales,
          prev_total_orders: prevTotalOrders,
          revenue_change: revenueChange,
          orders_change: ordersChange,
          daily_sales: dailySales,
          daily_sales_all: dailySalesAll,
          service_breakdown: serviceBreakdown,
          payment_breakdown: paymentBreakdown,
          walk_in_orders: walkInStats.walk_in_orders,
          walk_in_sales: walkInStats.walk_in_sales,
          booking_orders: bookingStats.booking_orders,
          booking_sales: bookingStats.booking_sales,
          average_order_value: avgOrderValue,
          completion_rate: completionRate,
          peak_hours: peakHours,
          peak_days: peakDays,
          top_customers: topCustomers
        })
      );
    } catch (error) {
      console.error("[API] Sales report error:", error);
      res.status(500).json(apiResponse(false, void 0, "Internal server error"));
    }
  });
  app.get("/api/customers", requireAuth, (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const search = (req.query.search || "").trim();
    const searchClause = search ? " AND (customer_name LIKE ? OR customer_phone LIKE ?)" : "";
    const searchParams = search ? [`%${search}%`, `%${search}%`] : [];
    try {
      const countResult = db2.prepare(
        "SELECT COUNT(DISTINCT customer_phone) as total FROM transactions WHERE deleted_at IS NULL" + searchClause
      ).get(...searchParams);
      const customers = db2.prepare(
        `
        SELECT
          customer_phone as id,
          customer_name,
          customer_phone,
          address,
          MIN(created_at) as created_at,
          COUNT(*) as total_orders,
          COALESCE(SUM(total_price), 0) as total_spent
        FROM transactions
        WHERE deleted_at IS NULL${searchClause}
        GROUP BY customer_phone
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `
      ).all(...searchParams, limit, offset);
      const meta = {
        page,
        limit,
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / limit)
      };
      res.json(apiResponse(true, customers, void 0, meta));
    } catch (error) {
      console.error("[API] Get customers error:", error);
      res.status(500).json(apiResponse(false, void 0, "Internal server error"));
    }
  });
  app.post("/api/customers", requireAuth, (req, res) => {
    res.json(apiResponse(true, { message: "Customer info saved with transaction" }));
  });
  app.patch("/api/customers/:phone", requireAuth, (req, res) => {
    const { phone } = req.params;
    const { customer_name, address } = req.body;
    if (customer_name !== void 0 && (typeof customer_name !== "string" || customer_name.trim().length === 0 || customer_name.length > 100)) {
      return res.status(400).json(apiResponse(false, void 0, "Customer name must be 1-100 characters"));
    }
    if (address !== void 0 && address !== null && (typeof address !== "string" || address.length > 200)) {
      return res.status(400).json(apiResponse(false, void 0, "Address must be at most 200 characters"));
    }
    try {
      const updates = [];
      const values = [];
      if (customer_name !== void 0) {
        updates.push("customer_name = ?");
        values.push(sanitizeInput(customer_name.trim()));
      }
      if (address !== void 0) {
        updates.push("address = ?");
        values.push(address === null ? null : sanitizeInput(address));
      }
      if (updates.length > 0) {
        const query = "UPDATE transactions SET " + updates.join(", ") + " WHERE customer_phone = ?";
        values.push(phone);
        db2.prepare(query).run(...values);
      }
      console.log(`[API] Customer ${phone} updated`);
      res.json(apiResponse(true, { success: true }));
    } catch (error) {
      console.error("[API] Update customer error:", error);
      res.status(500).json(apiResponse(false, void 0, "Internal server error"));
    }
  });
  app.delete("/api/customers/:phone", requireAuth, (req, res) => {
    const { phone } = req.params;
    try {
      const transactions = db2.prepare("SELECT id, machine_id FROM transactions WHERE customer_phone = ? AND deleted_at IS NULL").all(phone);
      const transactionIds = transactions.map((t) => t.id);
      if (transactionIds.length === 0) {
        return res.status(404).json(apiResponse(false, void 0, "Customer not found"));
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const placeholders = transactionIds.map(() => "?").join(",");
      db2.prepare(`UPDATE transactions SET deleted_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(now, ...transactionIds);
      const machineIds = transactions.filter((t) => t.machine_id).map((t) => t.machine_id);
      if (machineIds.length > 0) {
        const machinePlaceholders = machineIds.map(() => "?").join(",");
        db2.prepare(`UPDATE machines SET status = 'available', remaining_time = 0, drying_time = 0, current_transaction_id = NULL WHERE id IN (${machinePlaceholders})`).run(...machineIds);
      }
      console.log(`[API] Customer ${phone} soft-deleted with ${transactionIds.length} transactions`);
      res.json(apiResponse(true, { success: true, deleted: transactionIds.length }));
    } catch (error) {
      console.error("[API] Delete customer error:", error);
      res.status(500).json(apiResponse(false, void 0, "Internal server error"));
    }
  });
  app.use((err, req, res, next) => {
    console.error("[Global Error]:", err);
    if (err.name === "ZodError") {
      return res.status(400).json(
        apiResponse(false, void 0, err.message)
      );
    }
    const e = err;
    const isDupErr = e?.code === "ER_DUP_ENTRY" || e?.errno === 1062 || /Duplicate entry/i.test(e?.message || "") || /UNIQUE constraint failed/i.test(e?.message || "");
    if (isDupErr) {
      if (/reference_number/i.test(err?.message || "")) {
        return res.status(409).json(
          apiResponse(false, void 0, "Reference number collision, please try again")
        );
      }
      return res.status(409).json(
        apiResponse(false, void 0, "Duplicate entry")
      );
    }
    const isFkErr = /FOREIGN KEY constraint failed/i.test(err?.message || "") || /foreign key constraint fails/i.test(err?.message || "");
    if (isFkErr) {
      return res.status(400).json(
        apiResponse(false, void 0, "Invalid reference to related record")
      );
    }
    if (err.message?.includes("CHECK constraint failed")) {
      return res.status(400).json(
        apiResponse(false, void 0, "Invalid value for field")
      );
    }
    if (err.name === "MulterError" && "code" in err) {
      const multerErr = err;
      if (multerErr.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json(
          apiResponse(false, void 0, "File size exceeds 5MB limit")
        );
      }
      return res.status(400).json(
        apiResponse(false, void 0, err.message)
      );
    }
    res.status(500).json(
      apiResponse(false, void 0, "Internal server error")
    );
  });
  app.get("/api/delivery/config", publicRateLimiter, (req, res) => {
    try {
      const origin = getDeliveryOrigin();
      const zones = getDeliveryZones(true);
      const bands = getDeliveryBands();
      res.json(apiResponse(true, { origin, zones, bands }));
    } catch (error) {
      console.error("[API] Get delivery config error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to get delivery config"));
    }
  });
  app.get("/api/delivery/fee", publicRateLimiter, (req, res) => {
    try {
      const zoneId = parseInt(String(req.query.zone_id || ""), 10);
      if (!zoneId) return res.status(400).json(apiResponse(false, void 0, "zone_id is required"));
      const result = calculateDeliveryFeeByZone(zoneId);
      res.json(apiResponse(true, result));
    } catch (error) {
      console.error("[API] Calculate delivery fee error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to calculate delivery fee"));
    }
  });
  app.put("/api/delivery/origin", requireAuth, async (req, res) => {
    try {
      const { name, address, latitude, longitude } = req.body || {};
      if (name !== void 0 && (typeof name !== "string" || !name.trim())) {
        return res.status(400).json(apiResponse(false, void 0, "name must be a non-empty string"));
      }
      if (address !== void 0 && address !== null && (typeof address !== "string" || !address.trim())) {
        return res.status(400).json(apiResponse(false, void 0, "address must be a non-empty string"));
      }
      if (latitude !== void 0 && (typeof latitude !== "number" || latitude < -90 || latitude > 90)) {
        return res.status(400).json(apiResponse(false, void 0, "latitude must be between -90 and 90"));
      }
      if (longitude !== void 0 && (typeof longitude !== "number" || longitude < -180 || longitude > 180)) {
        return res.status(400).json(apiResponse(false, void 0, "longitude must be between -180 and 180"));
      }
      const origin = getDeliveryOrigin();
      let lat = latitude;
      let lon = longitude;
      if ((lat === void 0 || lon === void 0) && (address || origin.address)) {
        const g = await geocodeAddress(address || origin.address);
        if (g) {
          lat = g.lat;
          lon = g.lon;
        }
      }
      if (origin.id) {
        db2.prepare("UPDATE delivery_origin SET name = ?, address = ?, latitude = ?, longitude = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(name || origin.name, address ?? origin.address, lat ?? origin.latitude, lon ?? origin.longitude, origin.id);
      } else {
        db2.prepare("INSERT INTO delivery_origin (name, address, latitude, longitude) VALUES (?, ?, ?, ?)").run(name || "Laundry Shop", address || null, lat || 0, lon || 0);
      }
      res.json(apiResponse(true, getDeliveryOrigin()));
    } catch (error) {
      console.error("[API] Update delivery origin error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to update delivery origin"));
    }
  });
  app.get("/api/delivery/reverse", publicRateLimiter, async (req, res) => {
    try {
      const lat = parseFloat(String(req.query.lat || ""));
      const lng = parseFloat(String(req.query.lng || ""));
      if (isNaN(lat) || isNaN(lng)) return res.status(400).json(apiResponse(false, void 0, "lat and lng are required"));
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
      const r = await fetch(url, { headers: { "User-Agent": "laundry-app/1.0" }, signal: AbortSignal.timeout(1e4) });
      if (!r.ok) return res.status(502).json(apiResponse(false, void 0, "Reverse geocoding failed"));
      const data = await r.json();
      const displayName = data.display_name || "";
      if (!displayName.toLowerCase().includes("san fernando") || !displayName.toLowerCase().includes("la union")) {
        return res.status(400).json(apiResponse(false, void 0, "Delivery is only available in San Fernando City, La Union"));
      }
      res.json(apiResponse(true, { address: displayName }));
    } catch (error) {
      res.status(500).json(apiResponse(false, void 0, "Failed to reverse geocode"));
    }
  });
  app.get("/api/delivery/quote-coords", publicRateLimiter, async (req, res) => {
    try {
      const lat = parseFloat(String(req.query.lat || ""));
      const lng = parseFloat(String(req.query.lng || ""));
      if (isNaN(lat) || isNaN(lng)) return res.status(400).json(apiResponse(false, void 0, "lat and lng are required"));
      if (lat < 16.55 || lat > 16.7 || lng < 120.25 || lng > 120.4) {
        return res.status(400).json(apiResponse(false, void 0, "Delivery is only available in San Fernando City, La Union"));
      }
      const origin = getDeliveryOrigin();
      let originLat = origin.latitude;
      let originLon = origin.longitude;
      if (!originLat && !originLon && origin.address) {
        const g = await geocodeAddress(origin.address);
        if (g) {
          originLat = g.lat;
          originLon = g.lon;
        }
      }
      let distance = await routeDistanceKm(originLat, originLon, lat, lng);
      if (distance === null) distance = haversineKm(originLat, originLon, lat, lng);
      const fee = calculateDeliveryFeeByDistance(distance);
      res.json(apiResponse(true, { distance_km: Math.round(distance * 100) / 100, fee }));
    } catch (error) {
      res.status(500).json(apiResponse(false, void 0, "Failed to quote delivery fee"));
    }
  });
  app.post("/api/delivery/quote", publicRateLimiter, async (req, res) => {
    try {
      const { address } = req.body || {};
      if (!address || typeof address !== "string" || !address.trim()) {
        return res.status(400).json(apiResponse(false, void 0, "address is required"));
      }
      const result = await calculateDeliveryFeeByAddress(address.trim());
      if (!result.destination) {
        return res.status(404).json(apiResponse(false, void 0, "Address not found"));
      }
      res.json(apiResponse(true, result));
    } catch (error) {
      console.error("[API] Quote delivery fee error:", error);
      res.status(500).json(apiResponse(false, void 0, "Failed to quote delivery fee"));
    }
  });
  app.get("/api/delivery/zones", requireAuth, (req, res) => {
    try {
      res.json(apiResponse(true, getDeliveryZones(false)));
    } catch (error) {
      res.status(500).json(apiResponse(false, void 0, "Failed to get delivery zones"));
    }
  });
  app.post("/api/delivery/zones", requireAuth, (req, res) => {
    try {
      const { name, latitude, longitude, is_active } = req.body || {};
      if (!name || typeof name !== "string" || !name.trim()) return res.status(400).json(apiResponse(false, void 0, "name is required"));
      const lat = latitude === void 0 ? 0 : latitude;
      const lon = longitude === void 0 ? 0 : longitude;
      if (typeof lat !== "number" || lat < -90 || lat > 90) return res.status(400).json(apiResponse(false, void 0, "latitude must be between -90 and 90"));
      if (typeof lon !== "number" || lon < -180 || lon > 180) return res.status(400).json(apiResponse(false, void 0, "longitude must be between -180 and 180"));
      const info = db2.prepare("INSERT INTO delivery_zones (name, latitude, longitude, is_active) VALUES (?, ?, ?, ?)").run(name, lat, lon, is_active ?? 1);
      const zone = db2.prepare("SELECT * FROM delivery_zones WHERE id = ?").get(info.lastInsertRowid);
      res.json(apiResponse(true, zone));
    } catch (error) {
      res.status(500).json(apiResponse(false, void 0, "Failed to create delivery zone"));
    }
  });
  app.delete("/api/delivery/zones/:id", requireAuth, (req, res) => {
    try {
      db2.prepare("DELETE FROM delivery_zones WHERE id = ?").run(req.params.id);
      res.json(apiResponse(true, void 0, "Deleted"));
    } catch (error) {
      res.status(500).json(apiResponse(false, void 0, "Failed to delete delivery zone"));
    }
  });
  app.get("/api/delivery/bands", requireAuth, (req, res) => {
    try {
      res.json(apiResponse(true, getDeliveryBands()));
    } catch (error) {
      res.status(500).json(apiResponse(false, void 0, "Failed to get delivery bands"));
    }
  });
  app.post("/api/delivery/bands", requireAuth, (req, res) => {
    try {
      const { min_km, max_km, fee, sort_order } = req.body || {};
      const min = min_km === void 0 ? 0 : min_km;
      const max = max_km === void 0 ? 9999 : max_km;
      const f = fee === void 0 ? 0 : fee;
      if (typeof min !== "number" || min < 0) return res.status(400).json(apiResponse(false, void 0, "min_km must be a non-negative number"));
      if (typeof max !== "number" || max < 0) return res.status(400).json(apiResponse(false, void 0, "max_km must be a non-negative number"));
      if (max <= min) return res.status(400).json(apiResponse(false, void 0, "max_km must be greater than min_km"));
      if (typeof f !== "number" || f < 0) return res.status(400).json(apiResponse(false, void 0, "fee must be a non-negative number"));
      const info = db2.prepare("INSERT INTO delivery_bands (min_km, max_km, fee, sort_order) VALUES (?, ?, ?, ?)").run(min, max, f, sort_order ?? 0);
      const band = db2.prepare("SELECT * FROM delivery_bands WHERE id = ?").get(info.lastInsertRowid);
      res.json(apiResponse(true, band));
    } catch (error) {
      res.status(500).json(apiResponse(false, void 0, "Failed to create delivery band"));
    }
  });
  app.delete("/api/delivery/bands/:id", requireAuth, (req, res) => {
    try {
      db2.prepare("DELETE FROM delivery_bands WHERE id = ?").run(req.params.id);
      res.json(apiResponse(true, void 0, "Deleted"));
    } catch (error) {
      res.status(500).json(apiResponse(false, void 0, "Failed to delete delivery band"));
    }
  });
  app.use("/api", (req, res) => {
    res.status(404).json(apiResponse(false, void 0, "API endpoint not found"));
  });
  app.use((err, req, res, next) => {
    console.error("[ERROR]", err);
    if (res.headersSent) return next(err);
    res.status(500).json(apiResponse(false, void 0, "Internal server error"));
  });
  const server = app.listen(PORT, () => {
    console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551   Laundry Management Server                       \u2551
\u2551   Running on http://localhost:${PORT}             \u2551
\u2551   Database: ${DB_NAME}                            \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
    `);
  });
  const timerInterval = setInterval(() => {
    try {
      const anyInUse = db2.prepare("SELECT 1 AS found FROM machines WHERE status = 'in-use' LIMIT 1").get();
      if (!anyInUse) return;
      const timerTransaction = db2.transaction(() => {
        const machinesCompleting = db2.prepare(`
            SELECT m.id, m.current_transaction_id FROM machines m
            LEFT JOIN transactions t ON t.id = m.current_transaction_id
            WHERE m.status = 'in-use' AND (
              (t.id IS NULL AND m.remaining_time <= 1 AND NOT EXISTS (
                SELECT 1 FROM transactions assigned
                WHERE assigned.machine_id = m.id AND assigned.status IN ('accepted', 'washing', 'drying', 'ready')
              ))
              OR (t.status = 'drying' AND m.drying_time <= 1)
            )
          `).all();
        db2.prepare(`
          UPDATE machines
          SET remaining_time = CASE
                WHEN (SELECT status FROM transactions WHERE id = machines.current_transaction_id) = 'washing'
                THEN MAX(0, remaining_time - 1)
                ELSE remaining_time
              END,
              drying_time = CASE
                WHEN (SELECT status FROM transactions WHERE id = machines.current_transaction_id) = 'drying'
                THEN MAX(0, drying_time - 1)
                ELSE drying_time
              END
           WHERE status = 'in-use'
             AND (current_transaction_id IS NULL OR current_transaction_id IN (SELECT id FROM transactions WHERE status IN ('washing', 'drying')))
         `).run();
        if (machinesCompleting.length > 0) {
          for (const machine of machinesCompleting) {
            const machineId = machine.id;
            const transactionId = machine.current_transaction_id;
            if (!transactionId) {
              db2.prepare(
                "UPDATE machines SET status = 'available', remaining_time = 0, drying_time = 0, current_transaction_id = NULL WHERE id = ?"
              ).run(machineId);
              continue;
            }
            const transaction = db2.prepare("SELECT status FROM transactions WHERE id = ?").get(transactionId);
            if (!transaction) {
              db2.prepare(
                "UPDATE machines SET status = 'available', remaining_time = 0, drying_time = 0, current_transaction_id = NULL WHERE id = ?"
              ).run(machineId);
              continue;
            }
            db2.prepare("UPDATE transactions SET status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('washing', 'drying')").run(transactionId);
            db2.prepare(
              "UPDATE machines SET status = 'available', remaining_time = 0, drying_time = 0, current_transaction_id = NULL WHERE id = ?"
            ).run(machineId);
            console.log(`[TIMER] Machine ${machineId} completed. Transaction ${transactionId} set to 'ready'`);
          }
        }
      });
      timerTransaction();
    } catch (error) {
      console.error("Failed to update machine times:", error);
    }
  }, 1e3);
  const shutdown = () => {
    console.log("[SERVER] Shutting down...");
    clearInterval(timerInterval);
    db2.close();
    server.close(() => {
      console.log("[SERVER] Server closed.");
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception during startup/runtime:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled promise rejection:", reason);
  process.exit(1);
});
var startedKey = "__laundryServerStarted";
if (!globalThis[startedKey]) {
  globalThis[startedKey] = true;
  startServer().catch((err) => {
    console.error("[FATAL] Server failed to start:", err);
    process.exit(1);
  });
}
