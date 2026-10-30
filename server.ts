import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { createDatabase, getDatabaseConfig } from "./src/db";
import { fileURLToPath } from "url";
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
import { calculatePrice as calculatePriceShared, rowToConfig, FALLBACK_PRICING } from "./src/utils/sharedPricing";
import { ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS } from "./src/utils/reviewPhotoValidation";
import nodemailer from "nodemailer";

// Load environment variables
import dotenv from "dotenv";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment variables with defaults
const PORT = parseInt(process.env.PORT || "8080", 10);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const DB_NAME = process.env.DB_NAME || "laundry.db";
const MACHINE_DEFAULT_TIME = parseInt(process.env.MACHINE_DEFAULT_TIME || "2700", 10);

// JWT_SECRET must be set and strong in all environments
const rawJwtSecret = process.env.JWT_SECRET || "";
if (!rawJwtSecret || rawJwtSecret.length < 32 || rawJwtSecret.includes("change-in-production") || rawJwtSecret.includes("your-super-secret")) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be a strong secret (at least 32 characters) in production");
  }
  console.warn("[WARN] JWT_SECRET is missing or weak — using a temporary development secret. Set a strong JWT_SECRET in .env.");
}
const JWT_SECRET = rawJwtSecret && rawJwtSecret.length >= 32 && !rawJwtSecret.includes("change-in-production") && !rawJwtSecret.includes("your-super-secret")
  ? rawJwtSecret
  : uuidv4();

// Pre-hash admin password once at startup for secure comparison
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12 || ADMIN_PASSWORD.includes("change-me") || ADMIN_PASSWORD.includes("change-me-to")) {
  throw new Error("ADMIN_PASSWORD must be a strong password (at least 12 characters) and not a placeholder");
}
// Use higher cost factor (12) for better security against brute force
const HASHED_ADMIN_PASSWORD = bcrypt.hashSync(ADMIN_PASSWORD, 12);

// Initialize database via dual-database factory (SQLite default, MySQL optional)
const db = createDatabase(getDatabaseConfig());
db.pragma("foreign_keys = ON");

// Initialize database with schema and indexes
function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_number TEXT UNIQUE,
      customer_name TEXT,
      customer_phone TEXT,
      customer_email TEXT,
      service_type TEXT,
      quantity INTEGER DEFAULT 1,
      special_instructions TEXT,
      weight REAL,
      appointment_date TEXT,
      appointment_time TEXT,
      delivery_method TEXT,
      address TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'washing', 'drying', 'ready', 'completed', 'declined')),
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
      status TEXT DEFAULT 'available' CHECK (status IN ('available', 'in-use', 'maintenance')),
      remaining_time INTEGER DEFAULT 0,
      drying_time INTEGER DEFAULT 0
    );
  `);

  // Create reviews table separately to handle existing database
  db.exec(`
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

  // Create review_replies table (admin replies to customer reviews)
  db.exec(`
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

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_review_replies_review_id ON review_replies(review_id);
    CREATE INDEX IF NOT EXISTS idx_review_replies_admin_id ON review_replies(admin_id);
  `);

  // Create indexes for better query performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
    CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_transactions_customer_phone ON transactions(customer_phone);
    CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference_number);
    CREATE INDEX IF NOT EXISTS idx_machines_status ON machines(status);
  `);

  // Add missing columns if they don't exist - using allowlist to prevent SQL injection
  const addColumnIfNotExists = (table: string, column: string, defaultVal: string) => {
    // Validate table and column names against allowlist
    const allowedTables = new Set(["transactions", "machines", "reviews", "review_replies", "queue", "transaction_items", "pricing", "price_history", "admin_users", "audit_logs"]);
    const allowedColumns = new Set([
      "machine_id", "updated_at", "handwash_proof_image", "customer_email", "deleted_at", "delivery_fee", "payment_method",
      "status", "remaining_time", "drying_time", "capacity", "current_transaction_id", "is_default",
       "comment", "photos", "review_id", "message", "avg_cycle_time", "total_jobs_completed",
      "pricing_type", "base_price", "tier_1_limit", "tier_1_price", "tier_2_limit", "tier_2_price",
      "tier_3_limit", "tier_3_price", "tier_4_limit", "tier_4_price", "tier_5_price_per_kg", "per_kg_price",
      "is_active", "delivery_fee", "old_price_data", "new_price_data", "changed_by",
      "username", "password_hash", "role", "last_login",
      "admin_id", "action", "details", "ip_address", "user_agent"
    ]);
    
    if (!allowedTables.has(table) || !allowedColumns.has(column)) {
      console.warn(`[DB] Blocked attempt to add column ${column} to table ${table} - not in allowlist`);
      return;
    }
    
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${defaultVal}`);
    } catch (e) {
      // Column already exists
    }
  };

  addColumnIfNotExists("transactions", "machine_id", "INTEGER");
   addColumnIfNotExists("transactions", "updated_at", "DATETIME DEFAULT CURRENT_TIMESTAMP");
   addColumnIfNotExists("transactions", "handwash_proof_image", "TEXT");
   addColumnIfNotExists("transactions", "customer_email", "TEXT");
   addColumnIfNotExists("transactions", "deleted_at", "DATETIME");
   addColumnIfNotExists("transactions", "delivery_fee", "REAL DEFAULT 0");
  addColumnIfNotExists("transactions", "payment_method", "TEXT DEFAULT 'cash'");
  addColumnIfNotExists("machines", "status", "TEXT DEFAULT 'available'");
  addColumnIfNotExists("machines", "remaining_time", "INTEGER DEFAULT 0");
  addColumnIfNotExists("machines", "drying_time", "INTEGER DEFAULT 0");
  addColumnIfNotExists("machines", "capacity", "INTEGER DEFAULT 10");
  addColumnIfNotExists("machines", "current_transaction_id", "INTEGER");
  addColumnIfNotExists("machines", "is_default", "INTEGER DEFAULT 0");
  addColumnIfNotExists("reviews", "comment", "TEXT");
addColumnIfNotExists("reviews", "photos", "TEXT"); // JSON array of image URLs

  // Mark seeded machines as default
  db.prepare("UPDATE machines SET is_default = 1 WHERE name IN ('Premium Machine 1', 'Premium Machine 2', 'Premium Machine 3', 'Premium Machine 4')").run();

  // Clean up orphaned machine_id values and add foreign key constraint
  try {
    // Set orphaned machine_id to NULL
    db.prepare(`
      UPDATE transactions
      SET machine_id = NULL
      WHERE machine_id IS NOT NULL
      AND machine_id NOT IN (SELECT id FROM machines)
    `).run();
    
    // Add foreign key constraint (SQLite 3.35.0+ supports this)
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_transactions_machine_id ON transactions(machine_id);
    `);
  } catch (e) {
    console.warn("[DB] Could not add FK constraint for machine_id:", e);
  }
  
  // Add foreign key constraint for machine_id if not exists (for new databases)
  // Note: SQLite doesn't support ALTER TABLE ADD FOREIGN KEY, so this only works for new tables
  // The constraint is included in the CREATE TABLE above for new databases

  // Queue table for smart queue management (kept for potential future use)
  // Currently not used - machine assignment is manual
  db.exec(`
    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      estimated_wait_time INTEGER DEFAULT 0,
      estimated_start_time TEXT,
      estimated_end_time TEXT,
      status TEXT DEFAULT 'waiting',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
    )
  `);

  // Create indexes for queue table
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status);
    CREATE INDEX IF NOT EXISTS idx_queue_transaction ON queue(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_queue_position ON queue(position);
  `);

  // Create transaction_items table for multi-order support
  db.exec(`
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

  // Create indexes for transaction_items table
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_items_transaction ON transaction_items(transaction_id);
  `);

  // Email verifications table for booking flow
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_verifications (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       email TEXT NOT NULL,
       token TEXT NOT NULL,
       expires_at DATETIME NOT NULL,
      verified INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_email_verifications_email ON email_verifications(email);`);

  // Add queue-related columns to machines if not exist
   addColumnIfNotExists("machines", "avg_cycle_time", "INTEGER DEFAULT 2700");
   addColumnIfNotExists("machines", "total_jobs_completed", "INTEGER DEFAULT 0");
   addColumnIfNotExists("pricing", "delivery_fee", "REAL DEFAULT 50");

  // Create pricing table for dynamic pricing
   db.exec(`
     CREATE TABLE IF NOT EXISTS pricing (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       service_type TEXT NOT NULL UNIQUE,
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

   // Create price_history table for tracking price changes
   db.exec(`
     CREATE TABLE IF NOT EXISTS price_history (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       service_type TEXT NOT NULL,
       old_price_data TEXT, -- JSON string of old pricing
       new_price_data TEXT, -- JSON string of new pricing
       changed_by TEXT DEFAULT 'admin',
       created_at DATETIME DEFAULT CURRENT_TIMESTAMP
     )
   `);

   // Delivery configuration tables (distance-based delivery)
   db.exec(`
     CREATE TABLE IF NOT EXISTS delivery_origin (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT NOT NULL DEFAULT 'Laundry Shop',
       address TEXT,
       latitude REAL NOT NULL DEFAULT 0,
       longitude REAL NOT NULL DEFAULT 0,
       updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
     )
   `);
   db.exec(`
     CREATE TABLE IF NOT EXISTS delivery_zones (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT NOT NULL,
       latitude REAL NOT NULL DEFAULT 0,
       longitude REAL NOT NULL DEFAULT 0,
       is_active INTEGER DEFAULT 1,
       created_at DATETIME DEFAULT CURRENT_TIMESTAMP
     )
   `);
   db.exec(`
     CREATE TABLE IF NOT EXISTS delivery_bands (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       min_km REAL NOT NULL DEFAULT 0,
       max_km REAL NOT NULL DEFAULT 9999,
       fee REAL NOT NULL DEFAULT 0,
       sort_order INTEGER DEFAULT 0,
       created_at DATETIME DEFAULT CURRENT_TIMESTAMP
     )
   `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_price_history_service ON price_history(service_type);
    CREATE INDEX IF NOT EXISTS idx_price_history_created ON price_history(created_at);
  `);

  // Create admin_users table for multi-admin support
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin')),
      last_login DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create audit_logs table for tracking admin actions
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('login', 'logout', 'password_change', 'username_change', 'failed_login')),
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_id ON audit_logs(admin_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
  `);

  // Seed machines if empty
   const machineCount = db.prepare("SELECT COUNT(*) as count FROM machines").get() as { count: number };
   if (machineCount.count === 0) {
     const seed = db.prepare("INSERT INTO machines (name, type, status, remaining_time) VALUES (?, ?, ?, ?)");
     seed.run("Premium Machine 1", "all-in-one", "available", 0);
     seed.run("Premium Machine 2", "all-in-one", "available", 0);
     seed.run("Premium Machine 3", "all-in-one", "available", 0);
     seed.run("Premium Machine 4", "all-in-one", "available", 0);
   }

  // Seed pricing if empty
   const pricingCount = db.prepare("SELECT COUNT(*) as count FROM pricing").get() as { count: number };
   if (pricingCount.count === 0) {
     const pricingSeed = db.prepare(`
       INSERT INTO pricing (
         service_type, pricing_type, base_price, tier_1_limit, tier_1_price,
         tier_2_limit, tier_2_price, tier_3_limit, tier_3_price,
         tier_4_limit, tier_4_price, tier_5_price_per_kg, per_kg_price, delivery_fee
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     `);

     // Wash & Fold (Clothes) - tiered pricing
      pricingSeed.run(
        "Wash & Fold (Clothes)", "tiered", 0,
        5, 200,    // 1-5 kg: ₱200
        7, 250,    // 6-7 kg: ₱250
        8, 300,    // 8 kg: ₱300
        9, 350,    // 9 kg: ₱350
        50,        // 10+ kg: ₱50/kg
        0,
        50         // delivery_fee
      );

      // Comforter (Small) - per piece
      pricingSeed.run(
        "Comforter (Small)", "per_kg", 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 250,
        50
      );

      // Comforter (Medium) - per piece
      pricingSeed.run(
        "Comforter (Medium)", "per_kg", 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 300,
        50
      );

      // Comforter (Large) - per piece
      pricingSeed.run(
        "Comforter (Large)", "per_kg", 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 350,
        50
      );

      // Bedsheet/Curtain/Towel - per kg
      pricingSeed.run(
        "Bedsheet/Curtain/Towel", "per_kg", 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 50,
        50
      );

      // Hand Wash Service - per kg
       pricingSeed.run(
         "Hand Wash Service", "per_kg", 0,
         0, 0, 0, 0, 0, 0, 0, 0, 0, 50,
         0
        );
    }

   // Seed delivery defaults if empty
   const originCount = db.prepare("SELECT COUNT(*) as count FROM delivery_origin").get() as { count: number };
   if (originCount.count === 0) {
     db.prepare("INSERT INTO delivery_origin (name, address, latitude, longitude) VALUES (?, ?, ?, ?)").run("Laundry Shop", "Madayegdeg, San Fernando City, La Union (in front of Robinsons Mall / Place LU, beside Elyu Food Hub)", 16.6159, 120.3167);
   } else {
     // Migrate legacy origin to the configured shop location
     db.prepare("UPDATE delivery_origin SET name = ?, address = ?, latitude = ?, longitude = ?, updated_at = CURRENT_TIMESTAMP WHERE latitude = ? OR address = ? OR address IS NULL").run("Laundry Shop", "Madayegdeg, San Fernando City, La Union (in front of Robinsons Mall / Place LU, beside Elyu Food Hub)", 16.6159, 120.3167, 14.5995, "Main Branch");
   }
   const zoneCount = db.prepare("SELECT COUNT(*) as count FROM delivery_zones").get() as { count: number };
   if (zoneCount.count === 0) {
     const zoneSeed = db.prepare("INSERT INTO delivery_zones (name, latitude, longitude, is_active) VALUES (?, ?, ?, 1)");
     zoneSeed.run("Zone A - Nearby", 14.6000, 120.9850);
     zoneSeed.run("Zone B - Mid", 14.6100, 120.9900);
     zoneSeed.run("Zone C - Far", 14.6200, 121.0000);
   }
   const bandCount = db.prepare("SELECT COUNT(*) as count FROM delivery_bands").get() as { count: number };
   if (bandCount.count === 0) {
     const bandSeed = db.prepare("INSERT INTO delivery_bands (min_km, max_km, fee, sort_order) VALUES (?, ?, ?, ?)");
     bandSeed.run(0, 3, 50, 1);
     bandSeed.run(3, 6, 80, 2);
     bandSeed.run(6, 10, 120, 3);
     bandSeed.run(10, 9999, 180, 4);
   }

  // Seed default admin user if admin_users table is empty
  const adminCount = db.prepare("SELECT COUNT(*) as count FROM admin_users").get() as { count: number };
  if (adminCount.count === 0) {
    const defaultAdminPassword = process.env.ADMIN_PASSWORD;
     if (!defaultAdminPassword) {
      throw new Error("ADMIN_PASSWORD must be set in environment variables");
    }
     // Use higher cost factor (12) for better security
    const hashedPassword = bcrypt.hashSync(defaultAdminPassword, 12);
    const adminSeed = db.prepare("INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)");
    adminSeed.run("admin", hashedPassword, "super_admin");
    console.log("[DB] Default admin user created");
  }

  console.log("[DB] Database initialized with indexes");
}

initializeDatabase();

// ============================================
// Multer Configuration for File Uploads
// ============================================

const uploadsDir = path.join(__dirname, "uploads", "handwash-proofs");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const reviewPhotosDir = path.join(__dirname, "uploads", "review-photos");
if (!fs.existsSync(reviewPhotosDir)) {
  fs.mkdirSync(reviewPhotosDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error("Only JPEG, PNG, WebP, and GIF images are allowed"));
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(new Error("Invalid file extension"));
    }
    cb(null, true);
  },
});

// Multer storage for review photos (multiple files)
const reviewPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, reviewPhotosDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const reviewUpload = multer({
  storage: reviewPhotoStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 }, // 5MB per file, max 5 files
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error("Only JPEG, PNG, WebP, and GIF images are allowed"));
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(new Error("Invalid file extension"));
    }
    cb(null, true);
  },
});

// Validate file magic bytes after upload
const validateFileSignature = (filePath: string, mimetype: string): boolean => {
  try {
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(12);
    fs.readSync(fd, buffer, 0, 12, 0);
    fs.closeSync(fd);
    
    const signatures: Record<string, Buffer[]> = {
      "image/jpeg": [Buffer.from([0xFF, 0xD8, 0xFF])],
      "image/png": [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
      "image/webp": [Buffer.from([0x52, 0x49, 0x46, 0x46]), Buffer.from([0x57, 0x45, 0x42, 0x50])], // RIFF....WEBP at offset 8
      "image/gif": [Buffer.from("GIF87a"), Buffer.from("GIF89a")],
    };
    const validSignatures = signatures[mimetype];
    if (!validSignatures) return false;
    
    if (mimetype === "image/webp") {
      // WebP: RIFF at offset 0, WEBP at offset 8
      return buffer.subarray(0, 4).equals(Buffer.from([0x52, 0x49, 0x46, 0x46])) && 
             buffer.subarray(8, 12).equals(Buffer.from([0x57, 0x45, 0x42, 0x50]));
    }
    return validSignatures.some(sig => buffer.subarray(0, sig.length).equals(sig));
  } catch {
    return false;
  }
};

// ============================================
// Validation Schemas (Zod)
// ============================================

const loginSchema = z.object({
  username: z.string().min(1, "Username is required").max(50),
  password: z.string().min(1, "Password is required"),
});

const transactionSchema = z.object({
  customer_name: z.string().min(1, "Customer name is required").max(100),
  customer_phone: z.string().min(1, "Customer phone is required").max(20),
  customer_email: z.string().email("Invalid email address").max(100).optional().or(z.literal("")).transform(val => val === "" ? undefined : val),
  service_type: z.string().min(1, "Service type is required"),
  quantity: z.number().int().min(1).max(100).optional(),
  special_instructions: z.string().max(500).optional(),
  appointment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
  appointment_time: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format (HH:MM)").optional(),
   delivery_method: z.enum(["pickup", "delivery"]).optional(),
   address: z.string().max(200).optional(),
   delivery_zone_id: z.number().int().positive().optional(),
  payment_status: z.enum(["unpaid", "paid"]).optional(),
  payment_method: z.string().optional(),
  machine_id: z.number().int().positive().nullable().optional(),
  weight: z.number().min(0).optional(),
  items: z.array(z.object({
    service_type: z.string().min(1, "Service type is required"),
    quantity: z.number().int().min(1).max(100).optional(),
    unit_price: z.number().min(0).optional(),
  })).min(1, "At least one item is required").optional(),
});

const updateTransactionSchema = z.object({
  status: z.enum(["pending", "accepted", "washing", "drying", "ready", "completed", "declined"]).optional(),
  total_price: z.number().min(0).optional(),
  weight: z.number().min(0).optional(),
  remaining_time: z.number().int().min(0).optional(),
  drying_time: z.number().int().min(0).optional(),
  payment_status: z.enum(["unpaid", "paid"]).optional(),
  payment_method: z.string().optional(),
  machine_id: z.number().int().positive().nullable().optional(),
  service_type: z.string().optional(),
  appointment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
  appointment_time: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format (HH:MM)").optional(),
});

const machineUpdateSchema = z.object({
  status: z.enum(["available", "in-use", "maintenance"]).optional(),
  remaining_time: z.number().int().min(0).optional(),
  drying_time: z.number().int().min(0).optional(),
});

// ============================================
// Helper Functions
// ============================================

// calculatePrice uses shared pricing logic with database lookup and fallback
 function calculatePrice(serviceType: string, quantity: number): number {
   const qty = quantity || 1;

   // Try to get pricing from database
   const pricing = db.prepare("SELECT * FROM pricing WHERE service_type = ? AND is_active = 1").get(serviceType) as {
     service_type: string;
     pricing_type: 'tiered' | 'per_kg';
     base_price: number;
     tier_1_limit: number;
     tier_1_price: number;
     tier_2_limit: number;
     tier_2_price: number;
     tier_3_limit: number;
     tier_3_price: number;
     tier_4_limit: number;
     tier_4_price: number;
     tier_5_price_per_kg: number;
     per_kg_price: number;
     is_active: number;
     delivery_fee: number;
   } | undefined;

   if (pricing) {
     const config = rowToConfig(pricing);
     return calculatePriceShared(config, qty);
   }

   // Fallback to hardcoded pricing if not in database
   const fallback = FALLBACK_PRICING[serviceType];
   if (fallback) {
     return calculatePriceShared(fallback, qty);
   }

   return 0;
 }

  /**
   * Haversine distance in kilometers between two lat/lng points
   */
  function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function getDeliveryOrigin(): { id: number; name: string; address: string | null; latitude: number; longitude: number } {
    const row = db.prepare("SELECT * FROM delivery_origin ORDER BY id LIMIT 1").get() as any;
    if (row) return row;
    return { id: 0, name: "Laundry Shop", address: null, latitude: 0, longitude: 0 };
  }

  function getDeliveryZones(activeOnly = true): any[] {
    const sql = activeOnly ? "SELECT * FROM delivery_zones WHERE is_active = 1 ORDER BY name" : "SELECT * FROM delivery_zones ORDER BY name";
    return db.prepare(sql).all() as any[];
  }

  function getDeliveryBands(): any[] {
    return db.prepare("SELECT * FROM delivery_bands ORDER BY sort_order, min_km").all() as any[];
  }

  function calculateDeliveryFeeByZone(zoneId: number): { distance_km: number; fee: number; zone: any | null } {
    const origin = getDeliveryOrigin();
    const zone = db.prepare("SELECT * FROM delivery_zones WHERE id = ?").get(zoneId) as any;
    if (!zone) return { distance_km: 0, fee: 0, zone: null };
    const distance = haversineKm(origin.latitude, origin.longitude, zone.latitude, zone.longitude);
    const bands = getDeliveryBands();
    let fee = 0;
    for (const band of bands) {
      if (distance >= band.min_km && distance <= band.max_km) { fee = band.fee; break; }
    }
    if (fee === 0 && bands.length > 0) {
      const last = bands[bands.length - 1];
      if (distance > last.max_km) fee = last.fee;
    }
    return { distance_km: Math.round(distance * 100) / 100, fee, zone };
  }

  function calculateDeliveryFeeByDistance(distanceKm: number): number {
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

    /**
     * Fixed delivery fee lookup from pricing table (matches frontend pricing config).
     * Falls back to 0 when no active pricing row exists.
     */
    function getDeliveryFee(serviceType: string): number {
      try {
        const row = db.prepare("SELECT delivery_fee FROM pricing WHERE service_type = ? AND is_active = 1").get(serviceType) as { delivery_fee: number } | undefined;
        return row?.delivery_fee ?? 0;
      } catch {
        return 0;
      }
    }

  // Free map APIs: OpenStreetMap Nominatim (geocoding) + OSRM (routing)
  async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
    try {
      const q = address.toLowerCase().includes("san fernando") ? address : `${address}, San Fernando City, La Union, Philippines`;
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { "User-Agent": "laundry-app/1.0" } });
      if (!res.ok) return null;
      const data = await res.json() as any[];
      if (!Array.isArray(data) || data.length === 0) return null;
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    } catch {
      return null;
    }
  }

  async function routeDistanceKm(originLat: number, originLon: number, destLat: number, destLon: number): Promise<number | null> {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${originLon},${originLat};${destLon},${destLat}?overview=false`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as any;
      if (!data.routes || !data.routes[0]) return null;
      return data.routes[0].distance / 1000;
    } catch {
      return null;
    }
  }

  async function calculateDeliveryFeeByAddress(address: string): Promise<{ distance_km: number; fee: number; destination: { lat: number; lon: number } | null }> {
    const origin = getDeliveryOrigin();
    // Ensure origin has coordinates; geocode origin address if needed
    let originLat = origin.latitude;
    let originLon = origin.longitude;
    if ((!originLat && !originLon) && origin.address) {
      const g = await geocodeAddress(origin.address);
      if (g) { originLat = g.lat; originLon = g.lon; }
    }
    const dest = await geocodeAddress(address);
    if (!dest) return { distance_km: 0, fee: 0, destination: null };
    let distance = await routeDistanceKm(originLat, originLon, dest.lat, dest.lon);
    if (distance === null) {
      // Fallback to straight-line distance
      distance = haversineKm(originLat, originLon, dest.lat, dest.lon);
    }
    const fee = calculateDeliveryFeeByDistance(distance);
    return { distance_km: Math.round(distance * 100) / 100, fee, destination: dest };
  }

 /**
  * Calculate the total order price including delivery fee based on delivery method
  */
 function calculateOrderTotal(serviceType: string, quantity: number, deliveryMethod: string): number {
   const servicePrice = calculatePrice(serviceType, quantity);
   const deliveryFee = deliveryMethod === 'delivery' ? getDeliveryFee(serviceType) : 0;
   return servicePrice + deliveryFee;
 }

function generateReferenceNumber(): string {
  // Use timestamp + cryptographically strong random bytes for unpredictability
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `LF-${timestamp}-${random}`;
}

// Standardized API response
function apiResponse<T>(success: boolean, data?: T, error?: string, meta?: PaginationMeta) {
  return {
    success,
    ...(data !== undefined && { data }),
    ...(error && { error }),
    ...(meta && { meta }),
    timestamp: new Date().toISOString(),
  };
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface JwtPayload {
  userId: string;
  username?: string;
  type: "admin" | "customer";
  role?: "admin" | "super_admin";
}

// ============================================
// Middleware
// ============================================

// Rate limiter for login attempts
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: "Too many login attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limiter
const apiRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 500, // 500 requests per minute
  message: { error: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for public endpoints
const publicRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 requests per window
  message: { error: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// JWT Authentication middleware
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Check Authorization header first
  const authHeader = req.headers.authorization;
  // Also check cookie
  const cookieToken = req.cookies?.admin_token;
  
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : cookieToken;

  if (!token) {
    return res.status(401).json(apiResponse(false, undefined, "No token provided"));
  }

  try {
    // Explicitly specify algorithm to prevent algorithm confusion attacks
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as JwtPayload;
    (req as express.Request & { user: JwtPayload }).user = decoded;
    next();
  } catch (error) {
    return res.status(401).json(apiResponse(false, undefined, "Invalid or expired token"));
  }
};

// Role-based access control middleware
const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = (req as express.Request & { user: JwtPayload }).user;
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return res.status(403).json(apiResponse(false, undefined, "Admin access required"));
  }
  next();
};

const requireSuperAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = (req as express.Request & { user: JwtPayload }).user;
  if (!user || user.role !== 'super_admin') {
    return res.status(403).json(apiResponse(false, undefined, "Super admin access required"));
  }
  next();
};

// ============================================
// API Routes
// ============================================

async function startServer() {
  let vite: any;
  
  // Create Vite in dev mode only when explicitly requested. Defaulting to
  // production serving avoids a blank page on hosts where NODE_ENV is unset.
  if (process.env.NODE_ENV === "development") {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom",
    });
  }

   const app = express();

   // Trust the first proxy hop in production (Render) so req.ip and rate limiters
   // see the real client address.
   if (process.env.NODE_ENV === "production") {
     app.set("trust proxy", 1);
   }

   // Security middleware - Helmet for comprehensive security headers
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
    crossOriginEmbedderPolicy: false, // Allow embedding for development
    hsts: {
      maxAge: 31536000,
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

  // Middleware
  app.use(express.json({ limit: "10kb" }));
  app.use(cookieParser());
  app.use(apiRateLimiter);
  app.use(morgan("short")); // HTTP request logging - short format to avoid sensitive data

  // API responses are never cached. A stale admin answer must never be served
  // from the browser cache (or restored from the back-forward cache) after the
  // session has ended.
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
  });

  // Serve uploaded files statically - require authentication to prevent unauthorized access
  const uploadsPath = path.join(__dirname, "uploads");
  app.use("/uploads", requireAuth, express.static(uploadsPath));

  // CORS middleware - strict origin validation
  app.use((req, res, next) => {
    const allowedOrigins = [
      'http://localhost:8080',
      'https://happywashlandry.onrender.com',
      // GitHub Codespaces patterns - more specific to prevent subdomain takeover
      /^https:\/\/[a-z0-9-]+\.githubpreview\.dev$/,
      /^https:\/\/[a-z0-9-]+\.github\.dev$/,
       // Render domains (explicit production host only)
    ];
    const origin = req.headers.origin;
    const isAllowed = allowedOrigins.some(o => 
      typeof o === 'string' ? o === origin : o.test(origin || '')
    );
    if (isAllowed && origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Custom CSP with Codespaces/Render support for HMR WebSocket
  app.use((req, res, next) => {
    const isCodespaces = !!process.env.CODESPACES;
    const codespaceName = process.env.CODESPACE_NAME;
    const githubUser = process.env.GITHUB_USER;
    const codespaceUrl = codespaceName && githubUser 
      ? `https://${codespaceName}-8080.${githubUser}.githubpreview.dev`
      : '';
    const renderUrl = 'https://happywashlandry.onrender.com';
    const isDev = process.env.NODE_ENV === "development";
    
     // CSP with Codespaces/Render support for HMR WebSocket
      const connectSrc = [`'self'`, renderUrl, "https://nominatim.openstreetmap.org", "https://router.project-osrm.org"]
        .concat(codespaceUrl ? [codespaceUrl] : [])
       .concat(isDev ? ['http://localhost:*', 'ws://localhost:*', 'ws://127.0.0.1:*'] : [])
       .join(' ');
    // 'none' must be the ONLY source expression in frame-ancestors. Mixing it with
    // other sources makes browsers ignore the whole directive.
    const frameAncestors = `'none'`;
    
    res.setHeader("Content-Security-Policy", 
      `default-src 'self'; ` +
      `script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com; ` +
      // fonts.googleapis.com serves the @import'ed font stylesheets used in src/index.css
      `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; ` +
      `img-src 'self' data: https:; ` +
      `font-src 'self' https://fonts.gstatic.com; ` +
      `connect-src ${connectSrc}; ` +
      `frame-ancestors ${frameAncestors}; ` +
      `base-uri 'self'; ` +
      `form-action 'self'; ` +
      `object-src 'none'; ` +
      `media-src 'self'; ` +
      `worker-src 'self' blob:; ` +
      `frame-src 'self' https://www.openstreetmap.org https://www.google.com https://www.google.com/maps https://maps.google.com`
    );
    next();
  });

  // Permissions Policy
  app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });

   // CSRF protection is provided by SameSite=strict admin cookies. State-changing
   // admin requests are same-origin and cookie-bound; no additional token is used.

  // Use Vite middleware for dev
  if (vite) {
    app.use(vite.middlewares);
  } else {
    // Production mode - serve static files from dist/
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
  }

  // Serve index.html for all non-API routes (SPA support)
  app.get("*", async (req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    try {
      // The admin portal lives inside this single page app, so the page shell
      // itself must never be cached either - otherwise a restored page could
      // show the admin screens without a valid session.
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      if (vite) {
        // Dev mode - use Vite to transform HTML
        const indexPath = path.join(__dirname, "index.html");
        const html = await vite.transformIndexHtml(req.path, fs.readFileSync(indexPath, "utf-8"));
        res.send(html);
      } else {
        // Production mode - serve index.html from dist/
        const indexPath = path.join(__dirname, "dist", "index.html");
        res.sendFile(indexPath);
      }
    } catch (e) {
      next(e);
    }
  });

  // Health check (no auth required)
  app.get("/api/health", (req, res) => {
    try {
      // Check database connectivity
      db.prepare("SELECT 1").get();
      res.json(apiResponse(true, { status: "ok", database: "connected" }));
    } catch (error) {
      res.status(503).json(apiResponse(false, undefined, "Database unavailable"));
    }
  });

  // ============================================
  // Email Verification (booking flow)
  // ============================================
  const emailTransporter = (() => {
    const host = process.env.SMTP_HOST;
    if (!host) return null;
    return nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  })();

  app.post("/api/verify-email/send", (req, res) => {
    try {
      const email = String(req.body?.email || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json(apiResponse(false, undefined, "Invalid email"));
      }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
       db.prepare("INSERT INTO email_verifications (email, token, expires_at) VALUES (?, ?, ?)").run(email, code, expires);
      if (emailTransporter) {
        emailTransporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: email,
          subject: "Your verification code",
          text: `Your verification code is: ${code}. It expires in 10 minutes.`,
        }).catch((e) => console.error("[Email] send failed:", e));
      } else {
        console.log(`[Email] Verification code for ${email}: ${code} (SMTP not configured)`);
      }
      res.json(apiResponse(true, { sent: true }));
    } catch (e) {
      console.error(e);
      res.status(500).json(apiResponse(false, undefined, "Failed to send verification"));
    }
  });

  app.post("/api/verify-email/confirm", (req, res) => {
    try {
      const email = String(req.body?.email || "").trim();
      const code = String(req.body?.code || "").trim();
       const row = db.prepare("SELECT * FROM email_verifications WHERE email = ? AND token = ? AND verified = 0 ORDER BY id DESC LIMIT 1").get(email, code) as any;
      if (!row) return res.status(400).json(apiResponse(false, undefined, "Invalid code"));
      if (new Date(row.expires_at) < new Date()) return res.status(400).json(apiResponse(false, undefined, "Code expired"));
      db.prepare("UPDATE email_verifications SET verified = 1 WHERE id = ?").run(row.id);
      res.json(apiResponse(true, { verified: true }));
    } catch (e) {
      console.error(e);
      res.status(500).json(apiResponse(false, undefined, "Verification failed"));
    }
  });

  app.get("/api/verify-email/status", (req, res) => {
    try {
      const email = String(req.query.email || "").trim();
      const row = db.prepare("SELECT verified FROM email_verifications WHERE email = ? ORDER BY id DESC LIMIT 1").get(email) as any;
      res.json(apiResponse(true, { verified: !!row?.verified }));
    } catch (e) {
      res.status(500).json(apiResponse(false, undefined, "Status check failed"));
    }
  });

  // ============================================
  // Admin Authentication
  // ============================================

  // Helper function to log audit events
  const logAudit = (adminId: number, action: 'login' | 'logout' | 'password_change' | 'username_change' | 'failed_login', details: string | null, req: express.Request) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const userAgent = req.get('user-agent') || 'unknown';
      db.prepare(`
        INSERT INTO audit_logs (admin_id, action, details, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?)
      `).run(adminId, action, details, ip, userAgent);
    } catch (e) {
      console.error("[AUDIT] Failed to log audit event:", e);
    }
  };

  // Admin login
  app.post("/api/admin/login", loginRateLimiter, (req, res) => {
    try {
      const result = loginSchema.safeParse(req.body);

      if (!result.success) {
        return res.status(400).json(
          apiResponse(false, undefined, result.error.errors.map((e) => e.message).join(", "))
        );
      }

      const { username, password } = result.data;

      // Find admin user by username
      const admin = db.prepare("SELECT * FROM admin_users WHERE username = ?").get(username) as { id: number; username: string; password_hash: string; role: string; last_login: string | null } | undefined;

      if (!admin) {
        logAudit(0, 'failed_login', `Failed login attempt for username: ${username}`, req);
        return res.status(401).json(apiResponse(false, undefined, "Invalid username or password"));
      }

      const isValid = bcrypt.compareSync(password, admin.password_hash);

      if (!isValid) {
        logAudit(admin.id, 'failed_login', `Failed login attempt for username: ${username}`, req);
        return res.status(401).json(apiResponse(false, undefined, "Invalid username or password"));
      }

      // Update last_login
      db.prepare("UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?").run(admin.id);

       const token = jwt.sign(
         { userId: admin.id, username: admin.username, type: "admin", role: admin.role },
         JWT_SECRET,
         { expiresIn: "24h", algorithm: "HS256" }
       );

      // Set httpOnly cookie for better security
      const isProduction = process.env.NODE_ENV === 'production';
      res.cookie('admin_token', token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/'
      });

      // Log successful login
      logAudit(admin.id, 'login', `Successful login for ${admin.username}`, req);

      return res.json(apiResponse(true, { 
        token, 
        expiresIn: "24h",
        user: {
          id: admin.id,
          username: admin.username,
          role: admin.role,
          last_login: admin.last_login
        }
      }, undefined));
    } catch (error) {
      console.error("[API] Login error:", error);
      res.status(500).json(apiResponse(false, undefined, "Internal server error"));
    }
  });

  // Admin logout
  app.post("/api/admin/logout", requireAuth, (req, res) => {
    const user = (req as express.Request & { user: { userId: number; username: string } }).user;
    if (user) {
      logAudit(user.userId, 'logout', `Logout for ${user.username}`, req);
    }
    // Clear the httpOnly cookie
    res.clearCookie('admin_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/'
    });
    res.json(apiResponse(true, undefined, "Logged out successfully"));
  });

  // Verify admin token
  app.get("/api/admin/verify", requireAuth, (req, res) => {
    const user = (req as express.Request & { user: { userId: number; username: string; role: string } }).user;
    res.json(apiResponse(true, { 
      authenticated: true,
      user: {
        id: user.userId,
        username: user.username,
        role: user.role
      }
    }));
  });

  // Get admin profile
  app.get("/api/admin/profile", requireAuth, (req, res) => {
    const user = (req as express.Request & { user: { userId: number; username: string; role: string } }).user;
    const admin = db.prepare("SELECT id, username, role, last_login, created_at FROM admin_users WHERE id = ?").get(user.userId) as { id: number; username: string; role: string; last_login: string | null; created_at: string } | undefined;
    
    if (!admin) {
      return res.status(404).json(apiResponse(false, undefined, "Admin user not found"));
    }
    
    res.json(apiResponse(true, admin));
  });

  // Update admin username
  const updateUsernameSchema = z.object({
    username: z.string().min(3, "Username must be at least 3 characters").max(50, "Username must be at most 50 characters").regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
    currentPassword: z.string().min(1, "Current password is required"),
  });

  app.patch("/api/admin/profile", requireAuth, (req, res) => {
    try {
      const result = updateUsernameSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json(apiResponse(false, undefined, result.error.errors.map((e) => e.message).join(", ")));
      }

      const { username, currentPassword } = result.data;
      const user = (req as express.Request & { user: { userId: number; username: string; role: string } }).user;

      // Check if username is already taken
      const existingAdmin = db.prepare("SELECT id FROM admin_users WHERE username = ? AND id != ?").get(username, user.userId);
      if (existingAdmin) {
        return res.status(409).json(apiResponse(false, undefined, "Username already taken"));
      }

      // Verify current password
      const admin = db.prepare("SELECT password_hash FROM admin_users WHERE id = ?").get(user.userId) as { password_hash: string } | undefined;
      if (!admin || !bcrypt.compareSync(currentPassword, admin.password_hash)) {
        logAudit(user.userId, 'username_change', `Failed username change attempt - invalid password`, req);
        return res.status(401).json(apiResponse(false, undefined, "Current password is incorrect"));
      }

      // Update username
      db.prepare("UPDATE admin_users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(username, user.userId);
      
      logAudit(user.userId, 'username_change', `Username changed from ${user.username} to ${username}`, req);
      
      res.json(apiResponse(true, { username }, "Username updated successfully"));
    } catch (error) {
      console.error("[API] Update username error:", error);
      res.status(500).json(apiResponse(false, undefined, "Internal server error"));
    }
  });

  // Password strength validation
  function validatePasswordStrength(password: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (password.length < 8) errors.push("Password must be at least 8 characters long");
    if (!/[A-Z]/.test(password)) errors.push("Password must contain at least one uppercase letter");
    if (!/[a-z]/.test(password)) errors.push("Password must contain at least one lowercase letter");
    if (!/[0-9]/.test(password)) errors.push("Password must contain at least one number");
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) errors.push("Password must contain at least one special character");
    return { isValid: errors.length === 0, errors };
  }

  // Change password
  const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(1, "New password is required"),
    confirmPassword: z.string().min(1, "Confirm password is required"),
  }).refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

  // Rate limiter for password change
  const passwordChangeRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 attempts per hour
    message: { error: "Too many password change attempts. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.patch("/api/admin/change-password", requireAuth, passwordChangeRateLimiter, (req, res) => {
    try {
      const result = changePasswordSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json(apiResponse(false, undefined, result.error.errors.map((e) => e.message).join(", ")));
      }

      const { currentPassword, newPassword } = result.data;
      const user = (req as express.Request & { user: { userId: number; username: string; role: string } }).user;

      // Validate password strength
      const strength = validatePasswordStrength(newPassword);
      if (!strength.isValid) {
        return res.status(400).json(apiResponse(false, undefined, strength.errors.join("; ")));
      }

      // Verify current password
      const admin = db.prepare("SELECT password_hash FROM admin_users WHERE id = ?").get(user.userId) as { password_hash: string } | undefined;
      if (!admin || !bcrypt.compareSync(currentPassword, admin.password_hash)) {
        logAudit(user.userId, 'password_change', `Failed password change attempt - invalid current password`, req);
        return res.status(401).json(apiResponse(false, undefined, "Current password is incorrect"));
      }

      // Hash new password with higher cost factor
      const newPasswordHash = bcrypt.hashSync(newPassword, 12);
      
      // Update password
      db.prepare("UPDATE admin_users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newPasswordHash, user.userId);
      
      logAudit(user.userId, 'password_change', `Password changed successfully`, req);
      
      res.json(apiResponse(true, undefined, "Password changed successfully"));
    } catch (error) {
      console.error("[API] Change password error:", error);
      res.status(500).json(apiResponse(false, undefined, "Internal server error"));
    }
  });

  // ============================================
  // Public Routes
  // ============================================

  // Get machines (public)
  app.get("/api/machines", (req, res) => {
    const machines = db.prepare("SELECT * FROM machines ORDER BY id").all();
    res.json(apiResponse(true, machines));
  });

   // Input handling helper - keep validated input intact and rely on framework escaping.
   // Only control characters are removed; HTML/JS is not stripped here.
   function sanitizeInput(str: string): string {
     if (typeof str !== "string") return "";
     return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
   }

   // Create transaction (public) - supports multi-order items
   app.post("/api/transactions", async (req, res) => {
    const result = transactionSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json(
        apiResponse(false, undefined, result.error.errors.map((e) => e.message).join(", "))
      );
    }

    const data = result.data;
    const items = data.items || [];
    
    // Sanitize customer inputs to prevent XSS
    const sanitizedCustomerName = sanitizeInput(data.customer_name);
    const sanitizedCustomerPhone = sanitizeInput(data.customer_phone);
    const sanitizedEmail = data.customer_email ? sanitizeInput(data.customer_email) : undefined;
    const sanitizedAddress = data.address ? sanitizeInput(data.address) : undefined;
    const sanitizedInstructions = data.special_instructions ? sanitizeInput(data.special_instructions) : undefined;
    
    // Hand wash orders should NOT be assigned to any machine
    const isHandWash = data.service_type.toLowerCase().includes('hand wash');
    const machineId = isHandWash ? null : (data.machine_id || null);

    // Validate machine availability before creating the transaction
    if (machineId) {
      const machine = db.prepare("SELECT status FROM machines WHERE id = ?").get(machineId) as { status: string } | undefined;
      if (!machine) {
        return res.status(400).json(apiResponse(false, undefined, "Machine not found"));
      }
      if (machine.status !== 'available') {
        return res.status(400).json(apiResponse(false, undefined, "Machine is not available"));
      }
      const activeTransaction = db.prepare("SELECT id FROM transactions WHERE machine_id = ? AND status IN ('accepted', 'washing', 'drying', 'ready')").get(machineId);
      if (activeTransaction) {
        return res.status(400).json(apiResponse(false, undefined, "Machine is already in use by another transaction"));
      }
     }
 
     // Resolve delivery fee once (address-based when possible, else fixed pricing fee)
     let resolvedDeliveryFee = 0;
     if (data.delivery_method === 'delivery') {
       const firstService = items.length > 0 ? items[0].service_type : data.service_type;
       if (sanitizedAddress) {
         const quote = await calculateDeliveryFeeByAddress(sanitizedAddress);
         resolvedDeliveryFee = quote.destination ? quote.fee : getDeliveryFee(firstService);
       } else {
         resolvedDeliveryFee = getDeliveryFee(firstService);
       }
     }
 
     // Retry logic for reference number collision (max 3 attempts)
     let transactionId: number | null = null;
    let reference_number = '';
    let total_price = 0;
    let newTransaction: any = null;
    
    for (let attempt = 0; attempt < 3; attempt++) {
      reference_number = generateReferenceNumber();
      
      try {
        db.prepare("BEGIN TRANSACTION").run();

        // Calculate total price from items if provided, otherwise use legacy single-item calculation
         // Include delivery fee based on delivery method
         total_price = 0;
         let delivery_fee = 0;
         // Store grouped pricing info for consistent transaction_items
         const serviceTypePricing: Record<string, { totalQty: number; totalPrice: number }> = {};
         
         if (items.length > 0) {
           // Group items by service type for tiered pricing
           const itemsByService: Record<string, number> = {};
           items.forEach(item => {
             const key = item.service_type;
             itemsByService[key] = (itemsByService[key] || 0) + (item.quantity || 1);
           });

           // Calculate price for each service type using tiered pricing
           Object.keys(itemsByService).forEach(serviceType => {
             const totalQty = itemsByService[serviceType];
             const totalPrice = calculatePrice(serviceType, totalQty);
             serviceTypePricing[serviceType] = { totalQty, totalPrice };
             total_price += totalPrice;
           });
            // Add delivery fee for delivery method (resolved before transaction, may be address-based)
            delivery_fee = resolvedDeliveryFee;
          } else {
            const qty = data.quantity || 1;
            total_price = calculatePrice(data.service_type, qty);
            serviceTypePricing[data.service_type] = { totalQty: qty, totalPrice: total_price };
            // Add delivery fee based on delivery method
            delivery_fee = resolvedDeliveryFee;
          }
         total_price += delivery_fee;

          const insertResult = db.prepare(`
            INSERT INTO transactions (
              reference_number, customer_name, customer_phone, customer_email, service_type,
              quantity, special_instructions, appointment_date, appointment_time,
              delivery_method, address, total_price, delivery_fee, machine_id, payment_method, weight
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            reference_number,
            sanitizedCustomerName,
            sanitizedCustomerPhone,
            sanitizedEmail || null,
            data.service_type,
            items.length > 0 ? items.reduce((sum, item) => sum + (item.quantity || 1), 0) : (data.quantity || 1),
            sanitizedInstructions || "",
            data.appointment_date || "",
            data.appointment_time || "",
            data.delivery_method || "",
            sanitizedAddress || "",
            total_price,
            delivery_fee,
            machineId,
            data.payment_method || "cash",
            data.weight || null
          );

        transactionId = Number(insertResult.lastInsertRowid);

        // Update machine status to in-use when assigned to a normal booking
        if (machineId) {
          db.prepare("UPDATE machines SET status = 'in-use', current_transaction_id = ? WHERE id = ?").run(transactionId, machineId);
        }

        // Insert transaction items - support both multi-item and legacy single-item format
        const itemStmt = db.prepare(`
          INSERT INTO transaction_items (
            transaction_id, service_type, quantity, unit_price, total_price
          ) VALUES (?, ?, ?, ?, ?)
        `);
        
        if (items.length > 0) {
          // Multi-item format: distribute grouped total price proportionally by quantity
          items.forEach(item => {
            const qty = item.quantity || 1;
            const serviceType = item.service_type;
            const pricing = serviceTypePricing[serviceType];
            
            let unitPrice: number;
            let itemTotal: number;
            
            if (pricing) {
              // Distribute grouped total proportionally by quantity
              itemTotal = (pricing.totalPrice / pricing.totalQty) * qty;
              unitPrice = itemTotal / qty;
            } else {
              // Fallback: calculate individually
              unitPrice = calculatePrice(serviceType, qty) / qty;
              itemTotal = unitPrice * qty;
            }
            
            itemStmt.run(transactionId, serviceType, qty, unitPrice, itemTotal);
          });
        } else {
          // Legacy single-item format
          const qty = data.quantity || 1;
          const unitPrice = calculatePrice(data.service_type, qty) / qty;
          const itemTotal = unitPrice * qty;
          itemStmt.run(transactionId, data.service_type, qty, unitPrice, itemTotal);
        }

        db.prepare("COMMIT").run();

        console.log(`[API] Transaction created: ${reference_number} with ${items.length > 0 ? items.length : 1} item(s)`);
        
        // Fetch the full transaction data to return
        newTransaction = db.prepare("SELECT * FROM transactions WHERE id = ?").get(transactionId);
        break; // Success, exit retry loop
      } catch (error: any) {
        db.prepare("ROLLBACK").run();
        
        // Check if it's a unique constraint violation on reference_number
        if (error.message?.includes('UNIQUE constraint failed') && error.message?.includes('reference_number')) {
          console.warn(`[API] Reference number collision on attempt ${attempt + 1}, retrying...`);
          if (attempt === 2) {
            console.error("[API] Max retries reached for reference number generation");
            return res.status(500).json(apiResponse(false, undefined, "Failed to generate unique reference number"));
          }
          continue; // Retry with new reference number
        }
        
        console.error("[API] Transaction creation error:", error);
        return res.status(500).json(apiResponse(false, undefined, "Failed to create transaction"));
      }
    }
    
    if (!newTransaction) {
      return res.status(500).json(apiResponse(false, undefined, "Failed to create transaction"));
    }

    const transactionItems = db.prepare(
      "SELECT service_type, quantity, unit_price FROM transaction_items WHERE transaction_id = ?"
    ).all(newTransaction.id);
    
    res.status(201).json(
      apiResponse(true, { ...newTransaction, items: transactionItems })
    );
  });

   // Create walk-in order (admin only - for walk-in/call-in orders)
   app.post("/api/admin/transactions", requireAuth, async (req, res) => {
    const result = transactionSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json(
        apiResponse(false, undefined, result.error.errors.map((e) => e.message).join(", "))
      );
    }

    const data = result.data;
    const items = data.items || [];
    
    // Sanitize customer inputs to prevent XSS
    const sanitizedCustomerName = sanitizeInput(data.customer_name);
    const sanitizedCustomerPhone = sanitizeInput(data.customer_phone);
    const sanitizedEmail = data.customer_email ? sanitizeInput(data.customer_email) : undefined;
    const sanitizedAddress = data.address ? sanitizeInput(data.address) : undefined;
    const sanitizedInstructions = data.special_instructions ? sanitizeInput(data.special_instructions) : undefined;
    
    // For walk-in orders, default to today's date
    const today = new Date().toISOString().split('T')[0];

    const isHandWash = items.length > 0
      ? items.some(item => item.service_type.toLowerCase().includes('hand wash'))
      : data.service_type.toLowerCase().includes('hand wash');
    
    let assignedMachineId: number | null = data.machine_id ?? null;

    // Hand wash orders should not have a machine assigned
    if (isHandWash) {
      assignedMachineId = null;
    }

    // Validate machine availability before creating the walk-in order
    if (assignedMachineId) {
      const machine = db.prepare("SELECT status FROM machines WHERE id = ?").get(assignedMachineId) as { status: string } | undefined;
      if (!machine) {
        return res.status(400).json(apiResponse(false, undefined, "Machine not found"));
      }
      if (machine.status !== 'available') {
        return res.status(400).json(apiResponse(false, undefined, "Machine is not available"));
      }
      const activeTransaction = db.prepare("SELECT id FROM transactions WHERE machine_id = ? AND status IN ('accepted', 'washing', 'drying', 'ready')").get(assignedMachineId);
      if (activeTransaction) {
        return res.status(400).json(apiResponse(false, undefined, "Machine is already in use by another transaction"));
      }
     }
 
     // Resolve delivery fee once (address-based when possible, else fixed pricing fee)
     let resolvedDeliveryFee = 0;
     if (data.delivery_method === 'delivery') {
       const firstService = items.length > 0 ? items[0].service_type : data.service_type;
       if (sanitizedAddress) {
         const quote = await calculateDeliveryFeeByAddress(sanitizedAddress);
         resolvedDeliveryFee = quote.destination ? quote.fee : getDeliveryFee(firstService);
       } else {
         resolvedDeliveryFee = getDeliveryFee(firstService);
       }
     }
 
     // Retry logic for reference number collision (max 3 attempts)
     let newTransactionId: number | null = null;
    let reference_number = '';
    let total_price = 0;
    let newTransaction: any = null;
    
    for (let attempt = 0; attempt < 3; attempt++) {
      reference_number = generateReferenceNumber();
      
      try {
        db.prepare("BEGIN TRANSACTION").run();

        // Calculate total price from items if provided, otherwise use legacy single-item calculation
         // Include delivery fee based on delivery method
         total_price = 0;
         let delivery_fee = 0;
         // Store grouped pricing info for consistent transaction_items
         const serviceTypePricing: Record<string, { totalQty: number; totalPrice: number }> = {};
         
         if (items.length > 0) {
           // Group items by service type for tiered pricing
           const itemsByService: Record<string, number> = {};
           items.forEach(item => {
             const key = item.service_type;
             itemsByService[key] = (itemsByService[key] || 0) + (item.quantity || 1);
           });

           // Calculate price for each service type using tiered pricing
           Object.keys(itemsByService).forEach(serviceType => {
             const totalQty = itemsByService[serviceType];
             const totalPrice = calculatePrice(serviceType, totalQty);
             serviceTypePricing[serviceType] = { totalQty, totalPrice };
             total_price += totalPrice;
           });
            // Add delivery fee for delivery method (resolved before transaction, may be address-based)
            delivery_fee = resolvedDeliveryFee;
          } else {
            const qty = data.quantity || 1;
            total_price = calculatePrice(data.service_type, qty);
            serviceTypePricing[data.service_type] = { totalQty: qty, totalPrice: total_price };
            // Add delivery fee based on delivery method
            delivery_fee = resolvedDeliveryFee;
          }
         total_price += delivery_fee;

         // Walk-in orders start as 'accepted' if machine assigned, 'pending' otherwise
         const initialStatus = assignedMachineId ? "accepted" : "pending";

          const stmt = db.prepare(`
            INSERT INTO transactions (
              reference_number, customer_name, customer_phone, customer_email, service_type,
              quantity, special_instructions, appointment_date, appointment_time,
              delivery_method, address, total_price, delivery_fee, status, payment_status, machine_id, payment_method, weight
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          const insertResult = stmt.run(
            reference_number,
            sanitizedCustomerName,
            sanitizedCustomerPhone,
            sanitizedEmail || null,
            data.service_type,
            items.length > 0 ? items.reduce((sum, item) => sum + (item.quantity || 1), 0) : (data.quantity || 1),
            sanitizedInstructions || "",
            data.appointment_date || today,
            data.appointment_time || "",
            data.delivery_method || "",
            sanitizedAddress || "",
            total_price,
            delivery_fee,
            initialStatus,
            data.payment_status || "unpaid",
            assignedMachineId,
            data.payment_method || "cash",
            data.weight || null
          );

        newTransactionId = Number(insertResult.lastInsertRowid);

        // Insert transaction items - support both multi-item and legacy single-item format
        const itemStmt = db.prepare(`
          INSERT INTO transaction_items (
            transaction_id, service_type, quantity, unit_price, total_price
          ) VALUES (?, ?, ?, ?, ?)
        `);
        
        if (items.length > 0) {
          // Multi-item format: distribute grouped total price proportionally by quantity
          items.forEach(item => {
            const qty = item.quantity || 1;
            const serviceType = item.service_type;
            const pricing = serviceTypePricing[serviceType];
            
            let unitPrice: number;
            let itemTotal: number;
            
            if (pricing) {
              // Distribute grouped total proportionally by quantity
              itemTotal = (pricing.totalPrice / pricing.totalQty) * qty;
              unitPrice = itemTotal / qty;
            } else {
              // Fallback: calculate individually
              unitPrice = calculatePrice(serviceType, qty) / qty;
              itemTotal = unitPrice * qty;
            }
            
            itemStmt.run(newTransactionId, serviceType, qty, unitPrice, itemTotal);
          });
        } else {
          // Legacy single-item format
          const qty = data.quantity || 1;
          const unitPrice = calculatePrice(data.service_type, qty) / qty;
          const itemTotal = unitPrice * qty;
          itemStmt.run(newTransactionId, data.service_type, qty, unitPrice, itemTotal);
        }

        // Update machine status to in-use when assigned to walk-in order
        if (assignedMachineId) {
          db.prepare("UPDATE machines SET status = 'in-use', remaining_time = 2700, drying_time = 0, current_transaction_id = ? WHERE id = ?").run(newTransactionId, assignedMachineId);
        }

        // Add to queue if no machine assigned (pending orders)
        if (!assignedMachineId) {
          const lastPosition = db.prepare(`
            SELECT COALESCE(MAX(position), 0) as max_pos FROM queue WHERE status = 'waiting'
          `).get() as { max_pos: number };

          const machines = db.prepare("SELECT * FROM machines WHERE status = 'available'").all() as { id: number; avg_cycle_time: number }[];
          const availableMachines = machines.length;
          const avgCycleTime = 2700;
          const newPosition = lastPosition.max_pos + 1;
          
          const estimatedWait = availableMachines > 0
            ? (newPosition / availableMachines) * avgCycleTime
            : newPosition * avgCycleTime;

          const now = new Date();
          const estimatedStart = new Date(now.getTime() + estimatedWait * 1000);
          const estimatedEnd = new Date(estimatedStart.getTime() + avgCycleTime * 1000);

          db.prepare(`
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

        db.prepare("COMMIT").run();

        console.log(`[API] Walk-in order created by admin: ${reference_number}, ${assignedMachineId ? 'Machine ' + assignedMachineId + ' assigned (accepted)' : 'added to queue at position ' + (assignedMachineId ? 'N/A' : 'pending')}`);
        
        newTransaction = db.prepare("SELECT * FROM transactions WHERE id = ?").get(newTransactionId);
        break; // Success, exit retry loop
      } catch (error: any) {
        db.prepare("ROLLBACK").run();
        
        // Check if it's a unique constraint violation on reference_number
        if (error.message?.includes('UNIQUE constraint failed') && error.message?.includes('reference_number')) {
          console.warn(`[API] Reference number collision on attempt ${attempt + 1}, retrying...`);
          if (attempt === 2) {
            console.error("[API] Max retries reached for reference number generation");
            return res.status(500).json(apiResponse(false, undefined, "Failed to generate unique reference number"));
          }
          continue; // Retry with new reference number
        }
        
        console.error("[API] Walk-in order creation error:", error);
        return res.status(500).json(apiResponse(false, undefined, "Failed to create walk-in order"));
      }
    }
    
    if (!newTransaction) {
      return res.status(500).json(apiResponse(false, undefined, "Failed to create walk-in order"));
    }
    
    res.status(201).json(
      apiResponse(true, newTransaction)
    );
  });

   // Reschedule appointment (public - for tracking)
   app.patch("/api/transactions/track/:reference/reschedule", publicRateLimiter, (req, res) => {
     const { reference } = req.params;
     const { appointment_date, appointment_time } = req.body || {};

      if (!appointment_date && !appointment_time) {
        return res.status(400).json(apiResponse(false, undefined, "No schedule changes provided"));
      }
      if (appointment_date && !/^\d{4}-\d{2}-\d{2}$/.test(appointment_date)) {
        return res.status(400).json(apiResponse(false, undefined, "Invalid date format (YYYY-MM-DD)"));
      }
      if (appointment_date) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const d = new Date(appointment_date + 'T00:00:00'); d.setHours(0, 0, 0, 0);
        if (isNaN(d.getTime()) || d < today) {
          return res.status(400).json(apiResponse(false, undefined, "Appointment date cannot be in the past"));
        }
      }
      if (appointment_time && !/^\d{2}:\d{2}$/.test(appointment_time)) {
        return res.status(400).json(apiResponse(false, undefined, "Invalid time format (HH:MM)"));
      }
      if (appointment_time && (appointment_time < '08:00' || appointment_time > '18:00')) {
        return res.status(400).json(apiResponse(false, undefined, "Please choose a time between 8:00 AM and 6:00 PM"));
      }
 
      try {
       const transaction = db.prepare("SELECT id FROM transactions WHERE reference_number = ?").get(reference) as { id: number } | undefined;
       if (!transaction) {
         return res.status(404).json(apiResponse(false, undefined, "Transaction not found"));
       }

       const fields: string[] = [];
       const values: (string | number | null)[] = [];
       if (appointment_date) {
         fields.push("appointment_date = ?");
         values.push(appointment_date);
       }
       if (appointment_time) {
         fields.push("appointment_time = ?");
         values.push(appointment_time);
       }
       fields.push("updated_at = ?");
       values.push(new Date().toISOString());
       values.push(transaction.id);

       db.prepare(`UPDATE transactions SET ${fields.join(", ")} WHERE id = ?`).run(...values);

       const updated = db.prepare("SELECT * FROM transactions WHERE id = ?").get(transaction.id);
       res.json(apiResponse(true, updated));
     } catch (error) {
       console.error("[API] Reschedule error:", error);
       res.status(500).json(apiResponse(false, undefined, "Failed to reschedule"));
     }
   });

   // Get transaction by reference (public - for tracking)
   app.get("/api/transactions/track/:reference", publicRateLimiter, (req, res) => {
    const { reference } = req.params;

    try {
       const transaction = db
         .prepare("SELECT * FROM transactions WHERE reference_number = ? OR customer_phone = ? OR customer_email = ?")
         .get(reference, reference, reference);

      if (!transaction) {
        return res.status(404).json(apiResponse(false, undefined, "Transaction not found"));
      }

      // Get transaction items
      const items = db
        .prepare("SELECT * FROM transaction_items WHERE transaction_id = ? ORDER BY id")
        .all(transaction.id);

       // Check if review exists
        const review = db
          .prepare("SELECT id, rating, comment, photos, created_at FROM reviews WHERE transaction_id = ?")
          .get(transaction.id) as any;
        if (review && review.photos) {
          try { review.photos = JSON.parse(review.photos); } catch { review.photos = []; }
        } else if (review) {
          review.photos = [];
        }

       let reviewWithReplies = review;
       if (review) {
         const replies = db
           .prepare(`
             SELECT rr.id, rr.message, rr.created_at, rr.updated_at, u.username as admin_username, u.username as admin_name
             FROM review_replies rr
             JOIN admin_users u ON rr.admin_id = u.id
             WHERE rr.review_id = ?
             ORDER BY rr.created_at ASC
           `)
           .all(review.id);
         reviewWithReplies = { ...review, replies };
       }

       res.json(apiResponse(true, { ...transaction, items, review: reviewWithReplies }));
    } catch (error) {
      console.error("[API] Transaction lookup error:", error);
      res.status(500).json(apiResponse(false, undefined, "Internal server error"));
    }
  });

  // Submit review (public) - supports optional photo uploads (multipart/form-data)
   app.post("/api/reviews", publicRateLimiter, reviewUpload.array("photos", 5), (req, res) => {
     const transaction_id = parseInt(req.body.transaction_id);
     const rating = parseInt(req.body.rating);
     const comment = req.body.comment;

     if (!Number.isInteger(transaction_id) || transaction_id <= 0) {
       // Clean up any uploaded files
       (req.files as Express.Multer.File[] | undefined)?.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
       return res.status(400).json(apiResponse(false, undefined, "Invalid transaction ID"));
     }
     if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
       (req.files as Express.Multer.File[] | undefined)?.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
       return res.status(400).json(apiResponse(false, undefined, "Rating must be an integer between 1 and 5"));
     }

     // Validate uploaded file signatures (magic bytes)
     const files = (req.files as Express.Multer.File[] | undefined) || [];
     for (const f of files) {
       if (!validateFileSignature(f.path, f.mimetype)) {
         files.forEach(x => { if (fs.existsSync(x.path)) fs.unlinkSync(x.path); });
         return res.status(400).json(apiResponse(false, undefined, "Invalid file format - file signature does not match declared type"));
       }
     }

     // Sanitize comment to prevent XSS
     const sanitizedComment = comment ? sanitizeInput(String(comment)).substring(0, 1000) : null;

     try {
       // Check if transaction exists and is completed
       const transaction = db
         .prepare("SELECT id, status FROM transactions WHERE id = ?")
         .get(transaction_id) as { id: number; status: string } | undefined;

       if (!transaction) {
         files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
         return res.status(404).json(apiResponse(false, undefined, "Transaction not found"));
       }
       if (transaction.status !== 'completed') {
         files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
         return res.status(400).json(apiResponse(false, undefined, "Reviews can only be submitted for completed orders"));
       }

       const existingReview = db.prepare("SELECT id FROM reviews WHERE transaction_id = ?").get(transaction_id);
       if (existingReview) {
         files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
         return res.status(409).json(apiResponse(false, undefined, "A review has already been submitted for this order"));
       }

       // Persist photo URLs
       const photoUrls = files.map(f => `/uploads/review-photos/${f.filename}`);
       const photosJson = photoUrls.length ? JSON.stringify(photoUrls) : null;

       db.prepare(`
         INSERT INTO reviews (transaction_id, rating, comment, photos, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))
       `).run(transaction_id, rating, sanitizedComment, photosJson);

       res.json(apiResponse(true, { message: "Review submitted", photos: photoUrls }));
     } catch (error) {
       files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
       console.error("[API] Review submission error:", error);
       res.status(500).json(apiResponse(false, undefined, "Failed to submit review"));
     }
   });

  // Get reviews (admin only)
  app.get("/api/reviews", requireAuth, (req, res) => {
    try {
      const reviews = db.prepare(`
        SELECT r.*, t.reference_number, t.customer_name, t.service_type, t.total_price
        FROM reviews r
        JOIN transactions t ON r.transaction_id = t.id
        WHERE t.deleted_at IS NULL
        ORDER BY r.created_at DESC
      `).all();

       const parsed = (reviews as any[]).map((r) => {
         if (r.photos) { try { r.photos = JSON.parse(r.photos); } catch { r.photos = []; } }
         else { r.photos = []; }
         return r;
       });
       res.json(apiResponse(true, parsed));
    } catch (error) {
      console.error("[API] Get reviews error:", error);
      res.status(500).json(apiResponse(false, undefined, "Failed to get reviews"));
    }
  });

   // Get public reviews (no auth required)
   app.get("/api/reviews/public", publicRateLimiter, (req, res) => {
     try {
       const reviews = db.prepare(`
         SELECT r.*, t.reference_number, t.customer_name, t.service_type, t.total_price
         FROM reviews r
         JOIN transactions t ON r.transaction_id = t.id
         WHERE t.deleted_at IS NULL
         ORDER BY r.created_at DESC
       `).all() as any[];

       // Attach admin replies to each review
       const replyStmt = db.prepare(`
         SELECT rr.id, rr.message, rr.created_at, rr.updated_at, u.username as admin_username, u.username as admin_name
         FROM review_replies rr
         JOIN admin_users u ON rr.admin_id = u.id
         WHERE rr.review_id = ?
         ORDER BY rr.created_at ASC
       `);
        const enriched = reviews.map((review: any) => {
          let photos = review.photos;
          if (photos) { try { photos = JSON.parse(photos); } catch { photos = []; } }
          else { photos = []; }
          return {
            ...review,
            photos,
            replies: replyStmt.all(review.id),
          };
        });

       res.json(apiResponse(true, enriched));
     } catch (error) {
       console.error("[API] Get public reviews error:", error);
       res.status(500).json(apiResponse(false, undefined, "Failed to get reviews"));
     }
  });

  // ============================================
  // Review replies (admin only)
  // ============================================

  // List replies for a review
  app.get("/api/reviews/:reviewId/replies", requireAuth, (req, res) => {
    const reviewId = parseInt(req.params.reviewId);
    if (isNaN(reviewId)) {
      return res.status(400).json(apiResponse(false, undefined, "Invalid review ID"));
    }
    try {
      const replies = db.prepare(`
        SELECT rr.*, u.username as admin_username
        FROM review_replies rr
        JOIN admin_users u ON rr.admin_id = u.id
        WHERE rr.review_id = ?
        ORDER BY rr.created_at ASC
      `).all(reviewId);
      res.json(apiResponse(true, replies));
    } catch (error) {
      console.error("[API] Get review replies error:", error);
      res.status(500).json(apiResponse(false, undefined, "Failed to get review replies"));
    }
  });

  // Create a reply for a review
  app.post("/api/reviews/:reviewId/replies", requireAuth, (req, res) => {
    const reviewId = parseInt(req.params.reviewId);
    const { message } = req.body;
    const user = (req as express.Request & { user: { userId: string; username?: string; role?: string } }).user;

    if (isNaN(reviewId)) {
      return res.status(400).json(apiResponse(false, undefined, "Invalid review ID"));
    }
    if (!message || !message.trim()) {
      return res.status(400).json(apiResponse(false, undefined, "Message is required"));
    }

    try {
      const review = db.prepare("SELECT id FROM reviews WHERE id = ?").get(reviewId);
      if (!review) {
        return res.status(404).json(apiResponse(false, undefined, "Review not found"));
      }

      const sanitizedMessage = sanitizeInput(message.trim()).substring(0, 1000);
      const adminId = parseInt(user.userId);
      const now = new Date().toISOString();

      const result = db.prepare(`
        INSERT INTO review_replies (review_id, admin_id, message, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(reviewId, adminId, sanitizedMessage, now, now);

      const reply = db.prepare(`
        SELECT rr.*, u.username as admin_username
        FROM review_replies rr
        JOIN admin_users u ON rr.admin_id = u.id
        WHERE rr.id = ?
      `).get(result.lastInsertRowid);

      res.status(201).json(apiResponse(true, reply));
    } catch (error) {
      console.error("[API] Create review reply error:", error);
      res.status(500).json(apiResponse(false, undefined, "Failed to create review reply"));
    }
  });

  // Update a reply (admin can edit their own replies)
  app.patch("/api/replies/:id", requireAuth, (req, res) => {
    const replyId = parseInt(req.params.id);
    const { message } = req.body;
    const user = (req as express.Request & { user: { userId: string; username?: string; role?: string } }).user;

    if (isNaN(replyId)) {
      return res.status(400).json(apiResponse(false, undefined, "Invalid reply ID"));
    }
    if (!message || !message.trim()) {
      return res.status(400).json(apiResponse(false, undefined, "Message is required"));
    }

    try {
      const existing = db.prepare("SELECT admin_id FROM review_replies WHERE id = ?").get(replyId);
      if (!existing) {
        return res.status(404).json(apiResponse(false, undefined, "Reply not found"));
      }

      const adminId = parseInt(user.userId);
      // Only allow editing own replies unless super_admin
      if (existing.admin_id !== adminId && user.role !== 'super_admin') {
        return res.status(403).json(apiResponse(false, undefined, "You can only edit your own replies"));
      }

      const sanitizedMessage = sanitizeInput(message.trim()).substring(0, 1000);
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE review_replies SET message = ?, updated_at = ? WHERE id = ?
      `).run(sanitizedMessage, now, replyId);

      const reply = db.prepare(`
        SELECT rr.*, u.username as admin_username
        FROM review_replies rr
        JOIN admin_users u ON rr.admin_id = u.id
        WHERE rr.id = ?
      `).get(replyId);

      res.json(apiResponse(true, reply));
    } catch (error) {
      console.error("[API] Update review reply error:", error);
      res.status(500).json(apiResponse(false, undefined, "Failed to update review reply"));
    }
  });

  // Delete a reply (admin can delete their own replies)
  app.delete("/api/replies/:id", requireAuth, (req, res) => {
    const replyId = parseInt(req.params.id);
    const user = (req as express.Request & { user: { userId: string; username?: string; role?: string } }).user;

    if (isNaN(replyId)) {
      return res.status(400).json(apiResponse(false, undefined, "Invalid reply ID"));
    }

    try {
      const existing = db.prepare("SELECT admin_id FROM review_replies WHERE id = ?").get(replyId);
      if (!existing) {
        return res.status(404).json(apiResponse(false, undefined, "Reply not found"));
      }

      const adminId = parseInt(user.userId);
      // Only allow deleting own replies unless super_admin
      if (existing.admin_id !== adminId && user.role !== 'super_admin') {
        return res.status(403).json(apiResponse(false, undefined, "You can only delete your own replies"));
      }

      db.prepare("DELETE FROM review_replies WHERE id = ?").run(replyId);

      res.json(apiResponse(true, { success: true }));
    } catch (error) {
      console.error("[API] Delete review reply error:", error);
      res.status(500).json(apiResponse(false, undefined, "Failed to delete review reply"));
    }
  });

  // Email verification routes removed - not used in current workflow
  // If needed in future, implement with proper email service integration

  // ============================================
  // Protected Routes (Require Authentication)
  // ============================================

  // Get all transactions with pagination
  app.get("/api/transactions", requireAuth, (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    const deliveryMethod = req.query.delivery_method as string;
    const search = ((req.query.search as string) || "").trim();

    let whereClause = "WHERE t.deleted_at IS NULL";
    const params: (string | number)[] = [];

    if (status) {
      whereClause += " AND t.status = ?";
      params.push(status);
    }
    if (deliveryMethod) {
      whereClause += " AND t.delivery_method = ?";
      params.push(deliveryMethod);
    }
    if (search) {
      // Server-side search so the admin can find orders across every page,
      // not just the page currently loaded.
      whereClause += " AND (t.reference_number LIKE ? OR t.customer_name LIKE ? OR t.customer_phone LIKE ?)";
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    try {
      // Get total count
      const countResult = db
        .prepare("SELECT COUNT(*) as total FROM transactions t " + whereClause)
        .get(...params) as { total: number };

      // Build query with machine name using LEFT JOIN
      const transactions = db
        .prepare(
          `SELECT t.*, m.name as machine_name
           FROM transactions t
           LEFT JOIN machines m ON t.machine_id = m.id
           ${whereClause} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset);

      // Get all transaction items in a single query (fixes N+1)
      const transactionIds = transactions.map((t: any) => t.id);
      let itemsByTransaction: Record<number, any[]> = {};
      if (transactionIds.length > 0) {
        const placeholders = transactionIds.map(() => "?").join(",");
        const allItems = db
          .prepare(`SELECT * FROM transaction_items WHERE transaction_id IN (${placeholders}) ORDER BY transaction_id, id`)
          .all(...transactionIds);
        // Group items by transaction_id
        itemsByTransaction = allItems.reduce((acc, item) => {
          if (!acc[item.transaction_id]) acc[item.transaction_id] = [];
          acc[item.transaction_id].push(item);
          return acc;
        }, {} as Record<number, any[]>);
      }

      const transactionsWithItems = transactions.map((t: any) => ({
        ...t,
        items: itemsByTransaction[t.id] || []
      }));

      const meta: PaginationMeta = {
        page,
        limit,
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / limit),
      };

      res.json(apiResponse(true, transactionsWithItems, undefined, meta));
    } catch (error) {
      console.error("[API] Get transactions error:", error);
      res.status(500).json(apiResponse(false, undefined, "Internal server error"));
    }
  });

  // Update transaction
  app.patch("/api/transactions/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json(apiResponse(false, undefined, "Invalid transaction ID"));
    }

    const result = updateTransactionSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json(
        apiResponse(false, undefined, result.error.errors.map((e) => e.message).join(", "))
      );
    }

    try {
      const current = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id);

      if (!current) {
        return res.status(404).json(apiResponse(false, undefined, "Transaction not found"));
      }

      const updates = result.data;
      const startsDrying = updates.status === 'drying' && current.status === 'washing' && current.machine_id !== null;
      const marksReady = updates.status === 'ready' && current.status === 'drying' && current.machine_id !== null;

      if (startsDrying || marksReady) {
        const machine = db.prepare("SELECT remaining_time, drying_time FROM machines WHERE id = ?").get(current.machine_id) as { remaining_time: number; drying_time: number } | undefined;
        if (!machine) {
          return res.status(400).json(apiResponse(false, undefined, "Assigned machine not found"));
        }
        if (startsDrying && machine.remaining_time > 0) {
          return res.status(400).json(apiResponse(false, undefined, "Wait for the machine timer to finish before advancing this order"));
        }
        if (marksReady && machine.drying_time > 0) {
          return res.status(400).json(apiResponse(false, undefined, "Wait for the drying timer to finish before completing this order"));
        }
      }

      const fields: string[] = [];

      // Prevent payment status changes for declined orders
      if (current.status === 'declined' && updates.payment_status !== undefined) {
        return res.status(400).json(apiResponse(false, undefined, "Cannot change payment status for declined orders"));
      }
      const values: (string | number | null)[] = [];

      // Check if this is a hand wash order - hand wash orders cannot have a machine
      // Also check if service_type is being changed to/from hand wash
      const newServiceType = updates.service_type || current.service_type;
      const isHandWash = newServiceType.toLowerCase().includes('hand wash');
      
      // Validate handwash proof requirement for hand wash orders moving to washing
      if (updates.status !== undefined && updates.status === 'washing' && isHandWash) {
        const hasProof = current.handwash_proof_image && current.handwash_proof_image.trim() !== '';
        if (!hasProof) {
          return res.status(400).json(apiResponse(false, undefined, "Handwash proof image is required before starting wash for hand wash orders"));
        }
      }
      
      if (updates.status !== undefined) {
        fields.push("status = ?");
        values.push(updates.status);
      }
      if (updates.total_price !== undefined) {
        fields.push("total_price = ?");
        values.push(updates.total_price);
      }
      if (updates.weight !== undefined) {
        fields.push("weight = ?");
        values.push(updates.weight);
      }
      if (updates.payment_status !== undefined) {
        fields.push("payment_status = ?");
        values.push(updates.payment_status);
      }
      // Track the previous machine_id for status updates
      const prevMachineId = current.machine_id;

      if (updates.machine_id !== undefined) {
        // For hand wash orders, ignore any machine assignment attempts
        if (isHandWash) {
          fields.push("machine_id = NULL");
        } else {
          // Validate machine is available for assignment
          const machineId = updates.machine_id;
          if (machineId !== null) {
            const machine = db.prepare("SELECT status FROM machines WHERE id = ?").get(machineId) as { status: string } | undefined;
            if (!machine) {
              return res.status(400).json(apiResponse(false, undefined, "Machine not found"));
            }
            if (machine.status === 'in-use') {
              // Check if it's already assigned to this transaction (fix: use id != ? instead of id = ?)
              const existingAssignment = db.prepare("SELECT id FROM transactions WHERE machine_id = ? AND id != ?").get(machineId, id);
              if (existingAssignment) {
                return res.status(400).json(apiResponse(false, undefined, "Machine is already in use by another transaction"));
              }
            }
          }
          fields.push("machine_id = ?");
          values.push(updates.machine_id);
        }
      }
       if (updates.service_type !== undefined) {
         fields.push("service_type = ?");
         values.push(updates.service_type);
       }
       if (updates.appointment_date !== undefined) {
         fields.push("appointment_date = ?");
         values.push(updates.appointment_date);
       }
       if (updates.appointment_time !== undefined) {
         fields.push("appointment_time = ?");
         values.push(updates.appointment_time);
       }
       if (updates.payment_method !== undefined) {
        fields.push("payment_method = ?");
        values.push(updates.payment_method);
      }

      // Always update the updated_at timestamp
      fields.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);

      // Build the query - field names are from hardcoded allowlist above, values are parameterized
      const fieldSet = fields.join(", ");
      const query = "UPDATE transactions SET " + fieldSet + " WHERE id = ?";
      db.prepare(query).run(...values);

      // Handle machine status changes based on transaction status updates
      const newStatus = updates.status !== undefined ? updates.status : current.status;

      if (updates.status === 'washing' && current.machine_id) {
        const machine = db.prepare("SELECT remaining_time FROM machines WHERE id = ?").get(current.machine_id) as { remaining_time: number } | undefined;
        const requestedWashTime = updates.remaining_time ?? machine?.remaining_time ?? 0;
        const washTime = requestedWashTime > 0 ? requestedWashTime : 2700;
        db.prepare(`
          UPDATE machines
          SET status = 'in-use',
              remaining_time = ?,
              drying_time = 0,
              current_transaction_id = ?
          WHERE id = ?
        `).run(washTime, id, current.machine_id);
      }

      if (startsDrying) {
        db.prepare("UPDATE machines SET status = 'in-use', remaining_time = 0, drying_time = ?, current_transaction_id = ? WHERE id = ?").run(updates.drying_time ?? 2700, id, current.machine_id);
      }
      if (marksReady) {
        db.prepare("UPDATE machines SET status = 'available', remaining_time = 0, drying_time = 0, current_transaction_id = NULL WHERE id = ?").run(current.machine_id);
      }

      // If status is being changed to completed or declined, reset the machine
      if (newStatus === 'completed' || newStatus === 'declined') {
        if (current.machine_id) {
          db.prepare("UPDATE machines SET status = 'available', remaining_time = 0, drying_time = 0, current_transaction_id = NULL WHERE id = ?").run(current.machine_id);
        }
      }

      // Update machine status when machine_id is assigned
      if (updates.machine_id !== undefined && updates.machine_id !== null && !isHandWash) {
        db.prepare("UPDATE machines SET status = 'in-use', current_transaction_id = ? WHERE id = ?").run(id, updates.machine_id);
      }
      // If machine_id is being set to NULL, update the previous machine status back to available
      if (updates.machine_id !== undefined && updates.machine_id === null && !isHandWash) {
        if (prevMachineId) {
          db.prepare("UPDATE machines SET status = 'available', current_transaction_id = NULL WHERE id = ?").run(prevMachineId);
        }
      }
      // If machine_id is unchanged but status changed to completed/declined, reset the machine
      if (updates.machine_id === undefined && (newStatus === 'completed' || newStatus === 'declined') && current.machine_id) {
        db.prepare("UPDATE machines SET status = 'available', remaining_time = 0, drying_time = 0, current_transaction_id = NULL WHERE id = ?").run(current.machine_id);
      }

      console.log(`[API] Transaction ${id} updated`);

      // Fetch and return the updated transaction
      const updatedTransaction = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id);
      res.json(
        apiResponse(true, updatedTransaction)
      );
    } catch (error) {
      console.error("[API] Update transaction error:", error);
      res.status(500).json(apiResponse(false, undefined, "Internal server error"));
    }
  });

  // Delete transaction
  app.delete("/api/transactions/:id", requireAuth, (req, res) => {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json(apiResponse(false, undefined, "Invalid transaction ID"));
    }

    try {
          // Check if transaction exists first and get its machine_id
          const existing = db.prepare("SELECT machine_id FROM transactions WHERE id = ?").get(id) as { machine_id: number | null } | undefined;
          if (!existing) {
            return res.status(404).json(apiResponse(false, undefined, "Transaction not found"));
          }
          
          // First delete any related queue entries (if queue table exists)
          try {
            db.prepare("DELETE FROM queue WHERE transaction_id = ?").run(id);
          } catch (e) {
            // Queue table might not exist, ignore error
          }
          
          // Delete related transaction_items
          db.prepare("DELETE FROM transaction_items WHERE transaction_id = ?").run(id);
          
          // Delete related reviews
          db.prepare("DELETE FROM reviews WHERE transaction_id = ?").run(id);
          
          const result = db.prepare("DELETE FROM transactions WHERE id = ?").run(id);

          if (result.changes === 0) {
            return res.status(404).json(apiResponse(false, undefined, "Transaction not found"));
          }

          // Update machine status back to available if it was assigned to this transaction
          if (existing.machine_id) {
            db.prepare("UPDATE machines SET status = 'available', remaining_time = 0, drying_time = 0, current_transaction_id = NULL WHERE id = ?").run(existing.machine_id);
          }

          console.log(`[API] Transaction ${id} deleted`);
      res.json(apiResponse(true, { success: true }));
    } catch (error) {
      console.error("[API] Delete transaction error:", error);
      res.status(500).json(apiResponse(false, undefined, "Internal server error: " + error));
    }
  });

  // Upload handwash proof image
  app.post("/api/transactions/:id/handwash-proof", requireAuth, upload.single("image"), (req, res) => {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json(apiResponse(false, undefined, "Invalid transaction ID"));
    }

    if (!req.file) {
      return res.status(400).json(apiResponse(false, undefined, "Image file is required"));
    }

    // Validate file signature (magic bytes) to prevent file type spoofing
    if (!validateFileSignature(req.file.path, req.file.mimetype)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json(apiResponse(false, undefined, "Invalid file format - file signature does not match declared type"));
    }

    try {
      // Check if transaction exists
      const existing = db.prepare("SELECT id, service_type FROM transactions WHERE id = ?").get(id) as { id: number; service_type: string } | undefined;
      if (!existing) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json(apiResponse(false, undefined, "Transaction not found"));
      }

      // Verify this is a handwash order
      if (!existing.service_type || !existing.service_type.toLowerCase().includes("hand wash")) {
        // Delete the uploaded file since it's not a handwash order
        fs.unlinkSync(req.file.path);
        return res.status(400).json(apiResponse(false, undefined, "Handwash proof can only be uploaded for hand wash orders"));
      }

      // Store the relative file path in the database
      const filePath = `/uploads/handwash-proofs/${req.file.filename}`;
      
      db.prepare(`
        UPDATE transactions
        SET handwash_proof_image = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(filePath, id);

      console.log(`[API] Handwash proof image uploaded for transaction ${id}: ${filePath}`);
      res.json(apiResponse(true, { success: true, filePath }));
    } catch (error) {
      // Clean up uploaded file on error
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      console.error("[API] Upload handwash proof error:", error);
      res.status(500).json(apiResponse(false, undefined, "Failed to upload handwash proof"));
    }
  });

  // Reset machines
  app.post("/api/machines/reset", requireAuth, (req, res) => {
    try {
       const resetMachinesWithNoTime = db.transaction(() => {
         // Only reset machines that have no active transactions assigned.
         const resetMachines = db.prepare(`
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
      res.status(500).json(apiResponse(false, undefined, "Failed to reset machines"));
    }
  });

  // Update machine
  app.patch("/api/machines/:id", requireAuth, (req, res) => {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json(apiResponse(false, undefined, "Invalid machine ID"));
    }

    const result = machineUpdateSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json(
        apiResponse(false, undefined, result.error.errors.map((e) => e.message).join(", "))
      );
    }

    console.log(`[API] Updating machine ${id}:`, result.data);

    try {
      const machine = db.prepare("SELECT * FROM machines WHERE id = ?").get(id);

      if (!machine) {
        return res.status(404).json(apiResponse(false, undefined, `Machine ${id} not found`));
      }

      const updates = result.data;
      const nextStatus = updates.status ?? (machine as { status: string }).status;
      let nextTime = updates.remaining_time ?? (machine as { remaining_time: number }).remaining_time;
      let nextDryingTime = updates.drying_time ?? (machine as { drying_time: number }).drying_time;

      // Force time to 0 for available/maintenance
      if (nextStatus === "available" || nextStatus === "maintenance") {
        nextTime = 0;
        nextDryingTime = 0;
      }

      // Prevent assigning a machine that's already in use to another transaction
      // A single linked active transaction is valid during timer updates.
      if (nextStatus === "in-use") {
        const activeTransactions = db.prepare(`
          SELECT reference_number FROM transactions
          WHERE machine_id = ? AND status IN ('accepted', 'washing', 'drying', 'ready')
        `).all(id) as { reference_number: string }[];
        
        if (activeTransactions.length > 1) {
          return res.status(400).json(
            apiResponse(false, undefined, `Machine is already assigned to transaction ${activeTransactions[1].reference_number}`)
          );
        }
      }

      // If setting to available, ensure no active transactions are using this machine
      if (nextStatus === "available") {
        const activeTransaction = db.prepare(`
          SELECT id FROM transactions
          WHERE machine_id = ? AND status IN ('accepted', 'washing', 'drying', 'ready')
        `).get(id);
        
        if (activeTransaction) {
          return res.status(400).json(
            apiResponse(false, undefined, "Cannot set machine to available while it has active transactions")
          );
        }
      }

      // Clear current_transaction_id when setting to available or maintenance
      if (nextStatus === "available" || nextStatus === "maintenance") {
        db.prepare("UPDATE machines SET status = ?, remaining_time = 0, drying_time = 0, current_transaction_id = NULL WHERE id = ?").run(nextStatus, id);
      } else {
        db.prepare("UPDATE machines SET status = ?, remaining_time = ?, drying_time = ? WHERE id = ?").run(nextStatus, nextTime, nextDryingTime, id);
      }

      console.log(`[API] Machine ${id} updated to ${nextStatus} (${nextTime}m)`);
      res.json(
        apiResponse(true, {
          id,
          status: nextStatus,
          remaining_time: nextTime,
          drying_time: nextDryingTime,
        })
      );
    } catch (error) {
      console.error("[API] Machine update error:", error);
      res.status(500).json(apiResponse(false, undefined, "Internal server error"));
    }
  });

  // Create machine
  const machineCreateSchema = z.object({
    name: z.string().min(1, "Machine name is required").max(100),
    type: z.enum(["washer", "dryer", "all-in-one"]),
    capacity: z.number().int().min(1).max(100).optional(),
  });

  app.post("/api/machines", requireAuth, (req, res) => {
    const result = machineCreateSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json(
        apiResponse(false, undefined, result.error.errors.map((e) => e.message).join(", "))
      );
    }

    const { name, type, capacity } = result.data;

    try {
      const insertResult = db.prepare(`
        INSERT INTO machines (name, type, capacity, status, remaining_time, avg_cycle_time, total_jobs_completed, is_default)
        VALUES (?, ?, ?, 'available', 0, 2700, 0, 0)
      `).run(name, type, capacity || 10);

      const newMachine = db.prepare("SELECT * FROM machines WHERE id = ?").get(insertResult.lastInsertRowid);

      console.log(`[API] Machine created: ${name} (${type})`);
      res.status(201).json(apiResponse(true, newMachine));
    } catch (error) {
      console.error("[API] Create machine error:", error);
      res.status(500).json(apiResponse(false, undefined, "Failed to create machine"));
    }
  });

  // Delete all machines
  app.delete("/api/machines", requireAuth, (req, res) => {
    try {
      const machines = db.prepare("SELECT id, status FROM machines").all() as { id: number; status: string }[];
      
      for (const machine of machines) {
        if (machine.status === 'in-use') {
          return res.status(400).json(apiResponse(false, undefined, `Cannot delete machine ${machine.id}: it is currently in use`));
        }
        const activeTransactions = db.prepare(`
          SELECT COUNT(*) as count FROM transactions
          WHERE machine_id = ? AND status IN ('accepted', 'washing', 'drying', 'ready')
        `).get(machine.id) as { count: number };
        if (activeTransactions.count > 0) {
          return res.status(400).json(apiResponse(false, undefined, `Cannot delete machine ${machine.id}: it has active transactions`));
        }
      }

       db.prepare("UPDATE transactions SET machine_id = NULL WHERE machine_id IN (SELECT id FROM machines)").run();
       db.prepare("DELETE FROM machines").run();
      console.log("[API] All machines deleted");
      res.json(apiResponse(true, { success: true, deleted: machines.length }));
    } catch (error) {
      console.error("[API] Delete all machines error:", error);
      res.status(500).json(apiResponse(false, undefined, "Failed to delete machines"));
    }
  });

  // Delete machine
  app.delete("/api/machines/:id", requireAuth, (req, res) => {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json(apiResponse(false, undefined, "Invalid machine ID"));
    }

    try {
      // Check if machine exists
      const machine = db.prepare("SELECT * FROM machines WHERE id = ?").get(id);
      if (!machine) {
        return res.status(404).json(apiResponse(false, undefined, "Machine not found"));
      }

      // Check if machine is in use
      if ((machine as { status: string }).status === 'in-use') {
        return res.status(400).json(apiResponse(false, undefined, "Cannot delete machine that is in use"));
      }

      // Check if machine has active transactions
      const activeTransactions = db.prepare(`
        SELECT COUNT(*) as count FROM transactions
        WHERE machine_id = ? AND status IN ('accepted', 'washing', 'drying', 'ready')
      `).get(id) as { count: number };

      if (activeTransactions.count > 0) {
        return res.status(400).json(apiResponse(false, undefined, "Cannot delete machine with active transactions"));
      }

       db.prepare("UPDATE transactions SET machine_id = NULL WHERE machine_id = ?").run(id);
       db.prepare("DELETE FROM machines WHERE id = ?").run(id);

      console.log(`[API] Machine ${id} deleted`);
      res.json(apiResponse(true, { success: true }));
    } catch (error) {
      console.error("[API] Delete machine error:", error);
      res.status(500).json(apiResponse(false, undefined, "Failed to delete machine"));
    }
  });

  // ============================================
  // Pricing Management Routes (Admin)
  // ============================================

  // Get all pricing
  app.get("/api/pricing", requireAuth, (req, res) => {
    try {
      const pricing = db.prepare("SELECT * FROM pricing WHERE is_active = 1 ORDER BY service_type").all();
      res.json(apiResponse(true, pricing));
    } catch (error) {
      console.error("[API] Get pricing error:", error);
      res.status(500).json(apiResponse(false, undefined, "Failed to get pricing"));
    }
  });

  // Get pricing for public (for booking form)
  app.get("/api/pricing/public", publicRateLimiter, (req, res) => {
    try {
      const pricing = db.prepare("SELECT * FROM pricing WHERE is_active = 1 ORDER BY service_type").all();
      res.json(apiResponse(true, pricing));
    } catch (error) {
      console.error("[API] Get public pricing error:", error);
      res.status(500).json(apiResponse(false, undefined, "Failed to get pricing"));
    }
  });

  // Get price history
  app.get("/api/pricing/history", requireAuth, (req, res) => {
    try {
      const history = db.prepare("SELECT * FROM price_history ORDER BY created_at DESC LIMIT 100").all();
      res.json(apiResponse(true, history));
    } catch (error) {
      console.error("[API] Get price history error:", error);
      res.status(500).json(apiResponse(false, undefined, "Failed to get price history"));
    }
  });

  // Delete all price history
  app.delete("/api/pricing/history", requireAuth, (req, res) => {
    try {
      db.prepare("DELETE FROM price_history").run();
      console.log("[API] All price history deleted");
      res.json(apiResponse(true, { success: true }));
    } catch (error) {
      console.error("[API] Delete price history error:", error);
      res.status(500).json(apiResponse(false, undefined, "Failed to delete price history"));
    }
  });

  const emptyStringToUndefined = (val: unknown) => val === '' ? undefined : val;

// Update pricing
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
     delivery_fee: z.preprocess(emptyStringToUndefined, z.number().min(0).optional()),
   });

  app.patch("/api/pricing/:serviceType", requireAuth, (req, res) => {
    const { serviceType } = req.params;
    const result = pricingUpdateSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json(
        apiResponse(false, undefined, result.error.errors.map((e) => e.message).join(", "))
      );
    }

    try {
      // Get current pricing for history - use decoded serviceType
      const decodedServiceType = decodeURIComponent(serviceType);
      const currentPricing = db.prepare("SELECT * FROM pricing WHERE service_type = ?").get(decodedServiceType);
      
      if (!currentPricing) {
        return res.status(404).json(apiResponse(false, undefined, "Pricing not found for service type"));
      }
      
      const updates = result.data;
      const fields: string[] = [];
      const values: (string | number)[] = [];

      // Allowlist of valid pricing columns to prevent SQL injection
       const validPricingColumns = new Set([
         'pricing_type', 'base_price', 'tier_1_limit', 'tier_1_price',
         'tier_2_limit', 'tier_2_price', 'tier_3_limit', 'tier_3_price',
         'tier_4_limit', 'tier_4_price', 'tier_5_price_per_kg', 'per_kg_price', 'is_active', 'delivery_fee'
       ]);

      Object.entries(updates).forEach(([key, value]) => {
        if (value !== undefined && validPricingColumns.has(key)) {
          fields.push(`${key} = ?`);
          values.push(value);
        }
      });

      fields.push("updated_at = CURRENT_TIMESTAMP");
      values.push(decodedServiceType);

      if (fields.length > 1) { // More than just updated_at
        const query = "UPDATE pricing SET " + fields.join(", ") + " WHERE service_type = ?";
        db.prepare(query).run(...values);

        // Record in price history
        db.prepare(`
          INSERT INTO price_history (service_type, old_price_data, new_price_data, changed_by, created_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).run(
          decodedServiceType,
          currentPricing ? JSON.stringify(currentPricing) : null,
          JSON.stringify({ ...currentPricing, ...updates }),
          (req as express.Request & { user: JwtPayload }).user.userId
        );

        console.log(`[API] Pricing updated for ${decodedServiceType}`);
        res.json(apiResponse(true, { success: true }));
      } else {
        res.json(apiResponse(true, { success: true, message: "No changes made" }));
      }
    } catch (error) {
      console.error("[API] Update pricing error:", error);
      res.status(500).json(apiResponse(false, undefined, "Failed to update pricing"));
    }
  });

  // Get stats
  app.get("/api/stats", requireAuth, (req, res) => {
    try {
      const stats = db
        .prepare(
          `
        SELECT
          COUNT(*) as total_orders,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN total_price ELSE 0 END), 0) as total_sales,
          COUNT(CASE WHEN status NOT IN ('completed', 'declined') THEN 1 END) as pending_orders
        FROM transactions
        WHERE deleted_at IS NULL
      `
        )
        .get();

      res.json(apiResponse(true, stats));
    } catch (error) {
      console.error("[API] Stats error:", error);
      res.status(500).json(apiResponse(false, undefined, "Internal server error"));
    }
  });

  // Sales Reports
  app.get("/api/sales", requireAuth, (req, res) => {
    const range = (req.query.range as string) || "month";
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
    const serviceType = (req.query.service_type as string) || "";

    let dateFilter = "";
    let prevDateFilter = "";
    let serviceFilter = "";
    const filterParams: (string | number)[] = [];

    if (serviceType) {
      serviceFilter = "AND service_type = ?";
      filterParams.push(serviceType);
    }

    switch (range) {
      case "today":
        dateFilter = `AND date(created_at) = date('now')`;
        prevDateFilter = `AND date(created_at) = date('now', '-1 day')`;
        break;
      case "week":
        dateFilter = `AND created_at >= date('now', '-7 days')`;
        prevDateFilter = `AND created_at >= date('now', '-14 days') AND created_at < date('now', '-7 days')`;
        break;
      case "month":
        dateFilter = `AND created_at >= date('now', '-30 days')`;
        prevDateFilter = `AND created_at >= date('now', '-60 days') AND created_at < date('now', '-30 days')`;
        break;
      default:
        dateFilter = "";
        prevDateFilter = "";
    }

    try {
      // Get basic stats
      const stats = db
        .prepare(
          "SELECT COUNT(*) as total_orders, COALESCE(SUM(CASE WHEN status = 'completed' THEN total_price ELSE 0 END), 0) as total_sales, COUNT(CASE WHEN status NOT IN ('completed', 'declined') THEN 1 END) as pending_orders, COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders, COUNT(CASE WHEN status = 'declined' THEN 1 END) as declined_orders FROM transactions WHERE deleted_at IS NULL " + dateFilter + " " + serviceFilter
        )
        .get(...filterParams) as { total_orders: number; total_sales: number; pending_orders: number; completed_orders: number; declined_orders: number };

      // Get previous period stats for comparison
      const prevStats = prevDateFilter
        ? db
            .prepare(
              "SELECT COUNT(*) as total_orders, COALESCE(SUM(CASE WHEN status = 'completed' THEN total_price ELSE 0 END), 0) as total_sales FROM transactions WHERE deleted_at IS NULL " + prevDateFilter + " " + serviceFilter
            )
            .get(...filterParams) as { total_orders: number; total_sales: number }
        : null;

      // Get daily sales with walk-in vs booking breakdown
      const dailySalesAll = db
        .prepare(
          "SELECT date(created_at) as date, COUNT(*) as count, COALESCE(SUM(total_price), 0) as total, SUM(CASE WHEN delivery_method = 'pickup' THEN 1 ELSE 0 END) as walk_in_count, SUM(CASE WHEN delivery_method = 'delivery' THEN 1 ELSE 0 END) as booking_count FROM transactions WHERE deleted_at IS NULL " + dateFilter + " " + serviceFilter + " GROUP BY date(created_at) ORDER BY date DESC LIMIT ? OFFSET ?"
        )
        .all(...filterParams, limit, (page - 1) * limit);

      // Revenue trend includes completed orders only, matching total_sales.
      const dailySales = db
        .prepare(
          "SELECT date(created_at) as date, COUNT(*) as count, COALESCE(SUM(total_price), 0) as total FROM transactions WHERE status = 'completed' AND deleted_at IS NULL " + dateFilter + " " + serviceFilter + " GROUP BY date(created_at) ORDER BY date(created_at) ASC"
        )
        .all(...filterParams);

      // Get service breakdown
      const serviceBreakdown = db
        .prepare(
          "SELECT service_type as service, COUNT(*) as count, COALESCE(SUM(total_price), 0) as total FROM transactions WHERE deleted_at IS NULL " + dateFilter + " " + serviceFilter + " GROUP BY service_type ORDER BY count DESC"
        )
        .all(...filterParams);

      // Get payment status breakdown
      const paymentBreakdown = db
        .prepare(
          "SELECT payment_status, COUNT(*) as count, COALESCE(SUM(total_price), 0) as total FROM transactions WHERE status = 'completed' AND deleted_at IS NULL " + dateFilter + " " + serviceFilter + " GROUP BY payment_status"
        )
        .all(...filterParams);

      // Get walk-in vs booking stats
      const walkInStats = db
        .prepare(
          "SELECT COUNT(*) as walk_in_orders, COALESCE(SUM(total_price), 0) as walk_in_sales FROM transactions WHERE delivery_method = 'pickup' AND deleted_at IS NULL " + dateFilter + " " + serviceFilter
        )
        .get(...filterParams) as { walk_in_orders: number; walk_in_sales: number };

      const bookingStats = db
        .prepare(
          "SELECT COUNT(*) as booking_orders, COALESCE(SUM(total_price), 0) as booking_sales FROM transactions WHERE delivery_method = 'delivery' AND deleted_at IS NULL " + dateFilter + " " + serviceFilter
        )
        .get(...filterParams) as { booking_orders: number; booking_sales: number };

      // Calculate average order value and completion rate
      const avgOrderValue = stats.total_orders > 0 ? stats.total_sales / stats.total_orders : 0;
      const completionRate = stats.total_orders > 0 ? (stats.completed_orders / stats.total_orders) * 100 : 0;

      // Get peak hours (orders by hour of day)
      const peakHours = db
        .prepare(
          "SELECT CAST(strftime('%H', created_at) as INTEGER) as hour, COUNT(*) as count FROM transactions WHERE deleted_at IS NULL " + dateFilter + " " + serviceFilter + " GROUP BY hour ORDER BY hour"
        )
        .all(...filterParams);

      // Get peak days (orders by day of week)
      const peakDays = db
        .prepare(
          "SELECT CASE CAST(strftime('%w', created_at) as INTEGER) WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday' WHEN 3 THEN 'Wednesday' WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday' WHEN 6 THEN 'Saturday' END as day, COUNT(*) as count FROM transactions WHERE deleted_at IS NULL " + dateFilter + " " + serviceFilter + " GROUP BY day ORDER BY count DESC"
        )
        .all(...filterParams);

      // Get top customers (repeat customers)
      const topCustomers = db
        .prepare(
          "SELECT customer_name, customer_phone, COUNT(*) as order_count, COALESCE(SUM(total_price), 0) as total_spent FROM transactions WHERE deleted_at IS NULL AND customer_name != '' AND customer_name IS NOT NULL " + dateFilter + " " + serviceFilter + " GROUP BY customer_name, customer_phone ORDER BY order_count DESC, total_spent DESC LIMIT 5"
        )
        .all(...filterParams);

      // Calculate week-over-week change
      const prevTotalSales = prevStats ? (prevStats.total_sales || 0) : 0;
      const prevTotalOrders = prevStats ? (prevStats.total_orders || 0) : 0;
      const revenueChange = prevTotalSales > 0 ? ((stats.total_sales - prevTotalSales) / prevTotalSales) * 100 : 0;
      const ordersChange = prevTotalOrders > 0 ? ((stats.total_orders - prevTotalOrders) / prevTotalOrders) * 100 : 0;

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
          top_customers: topCustomers,
        })
      );
    } catch (error) {
      console.error("[API] Sales report error:", error);
      res.status(500).json(apiResponse(false, undefined, "Internal server error"));
    }
  });

  // Get customers
  app.get("/api/customers", requireAuth, (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;
    const search = ((req.query.search as string) || "").trim();

    // Server-side search so the admin can find any customer, not just the ones
    // on the page currently loaded.
    const searchClause = search
      ? " AND (customer_name LIKE ? OR customer_phone LIKE ?)"
      : "";
    const searchParams: string[] = search
      ? [`%${search}%`, `%${search}%`]
      : [];

    try {
      // Get total count (excluding soft-deleted)
      const countResult = db
        .prepare(
          "SELECT COUNT(DISTINCT customer_phone) as total FROM transactions WHERE deleted_at IS NULL" + searchClause
        )
        .get(...searchParams) as { total: number };

      // Get paginated customers (excluding soft-deleted)
      const customers = db
        .prepare(
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
        )
        .all(...searchParams, limit, offset);

      const meta: PaginationMeta = {
        page,
        limit,
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / limit),
      };

      res.json(apiResponse(true, customers, undefined, meta));
    } catch (error) {
      console.error("[API] Get customers error:", error);
      res.status(500).json(apiResponse(false, undefined, "Internal server error"));
    }
  });

  // Create customer (just returns success since customers are tracked via transactions)
  app.post("/api/customers", requireAuth, (req, res) => {
    res.json(apiResponse(true, { message: 'Customer info saved with transaction' }));
  });

  // Update customer (not implemented - tracked via transactions)
   app.patch("/api/customers/:phone", requireAuth, (req, res) => {
     const { phone } = req.params;
     const { customer_name, address } = req.body;

     if (customer_name !== undefined && (typeof customer_name !== 'string' || customer_name.trim().length === 0 || customer_name.length > 100)) {
       return res.status(400).json(apiResponse(false, undefined, "Customer name must be 1-100 characters"));
     }
     if (address !== undefined && address !== null && (typeof address !== 'string' || address.length > 200)) {
       return res.status(400).json(apiResponse(false, undefined, "Address must be at most 200 characters"));
     }

     try {
       // Update all transactions for this customer phone
       const updates: string[] = [];
       const values: (string | number | null)[] = [];

       if (customer_name !== undefined) {
         updates.push("customer_name = ?");
         values.push(sanitizeInput(customer_name.trim()));
       }
       if (address !== undefined) {
         updates.push("address = ?");
         values.push(address === null ? null : sanitizeInput(address));
       }

       if (updates.length > 0) {
         const query = "UPDATE transactions SET " + updates.join(", ") + " WHERE customer_phone = ?";
         values.push(phone);
         db.prepare(query).run(...values);
       }

       console.log(`[API] Customer ${phone} updated`);
       res.json(apiResponse(true, { success: true }));
     } catch (error) {
       console.error("[API] Update customer error:", error);
       res.status(500).json(apiResponse(false, undefined, "Internal server error"));
     }
   });

   // Delete customer: permanently remove customer account data; soft-delete related recent activity (transactions)
   app.delete("/api/customers/:phone", requireAuth, (req, res) => {
    const { phone } = req.params;
    try {
      // Get all transaction IDs and machine_ids for this customer phone
      const transactions = db.prepare("SELECT id, machine_id FROM transactions WHERE customer_phone = ? AND deleted_at IS NULL").all(phone) as { id: number; machine_id: number | null }[];
      const transactionIds = transactions.map(t => t.id);
      
      if (transactionIds.length === 0) {
        return res.status(404).json(apiResponse(false, undefined, "Customer not found"));
      }
      
      // Soft delete: mark transactions as deleted
      const now = new Date().toISOString();
      const placeholders = transactionIds.map(() => "?").join(",");
      db.prepare(`UPDATE transactions SET deleted_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(now, ...transactionIds);
      
      // Reset machine statuses for transactions that had a machine assigned
      const machineIds = transactions.filter(t => t.machine_id).map(t => t.machine_id!);
      if (machineIds.length > 0) {
        const machinePlaceholders = machineIds.map(() => "?").join(",");
        db.prepare(`UPDATE machines SET status = 'available', remaining_time = 0, drying_time = 0, current_transaction_id = NULL WHERE id IN (${machinePlaceholders})`).run(...machineIds);
      }
      
      console.log(`[API] Customer ${phone} soft-deleted with ${transactionIds.length} transactions`);
      res.json(apiResponse(true, { success: true, deleted: transactionIds.length }));
    } catch (error) {
      console.error("[API] Delete customer error:", error);
      res.status(500).json(apiResponse(false, undefined, "Internal server error"));
    }
  });

  // Global error handler
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("[Global Error]:", err);
    
    // Handle Zod validation errors
    if (err.name === 'ZodError') {
      return res.status(400).json(
        apiResponse(false, undefined, err.message)
      );
    }
    
    // Handle SQLite constraint errors
    if (err.message?.includes('UNIQUE constraint failed')) {
      if (err.message.includes('reference_number')) {
        return res.status(409).json(
          apiResponse(false, undefined, "Reference number collision, please try again")
        );
      }
      return res.status(409).json(
        apiResponse(false, undefined, "Duplicate entry")
      );
    }
    
    if (err.message?.includes('FOREIGN KEY constraint failed')) {
      return res.status(400).json(
        apiResponse(false, undefined, "Invalid reference to related record")
      );
    }
    
    if (err.message?.includes('CHECK constraint failed')) {
      return res.status(400).json(
        apiResponse(false, undefined, "Invalid value for field")
      );
    }
    
    // Handle multer errors
    if (err.name === 'MulterError' && 'code' in err) {
      const multerErr = err as { code: string };
      if (multerErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json(
          apiResponse(false, undefined, "File size exceeds 5MB limit")
        );
      }
      return res.status(400).json(
        apiResponse(false, undefined, err.message)
      );
    }
    
    res.status(500).json(
      apiResponse(false, undefined, "Internal server error")
    );
  });

   // ============================================
   // Delivery configuration APIs
   // ============================================

   // Public: get delivery config (origin, zones, bands)
   app.get("/api/delivery/config", publicRateLimiter, (req, res) => {
     try {
       const origin = getDeliveryOrigin();
       const zones = getDeliveryZones(true);
       const bands = getDeliveryBands();
       res.json(apiResponse(true, { origin, zones, bands }));
     } catch (error) {
       console.error("[API] Get delivery config error:", error);
       res.status(500).json(apiResponse(false, undefined, "Failed to get delivery config"));
     }
   });

   // Public: calculate delivery fee for a zone
   app.get("/api/delivery/fee", publicRateLimiter, (req, res) => {
     try {
       const zoneId = parseInt(String(req.query.zone_id || ""), 10);
       if (!zoneId) return res.status(400).json(apiResponse(false, undefined, "zone_id is required"));
       const result = calculateDeliveryFeeByZone(zoneId);
       res.json(apiResponse(true, result));
     } catch (error) {
       console.error("[API] Calculate delivery fee error:", error);
       res.status(500).json(apiResponse(false, undefined, "Failed to calculate delivery fee"));
     }
   });

   // Admin: update origin
   app.put("/api/delivery/origin", requireAuth, async (req, res) => {
     try {
       const { name, address, latitude, longitude } = req.body || {};
       const origin = getDeliveryOrigin();
       let lat = latitude;
       let lon = longitude;
       if ((lat === undefined || lon === undefined) && (address || origin.address)) {
         const g = await geocodeAddress(address || origin.address);
         if (g) { lat = g.lat; lon = g.lon; }
       }
       if (origin.id) {
         db.prepare("UPDATE delivery_origin SET name = ?, address = ?, latitude = ?, longitude = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(name || origin.name, address ?? origin.address, lat ?? origin.latitude, lon ?? origin.longitude, origin.id);
       } else {
         db.prepare("INSERT INTO delivery_origin (name, address, latitude, longitude) VALUES (?, ?, ?, ?)").run(name || "Laundry Shop", address || null, lat || 0, lon || 0);
       }
       res.json(apiResponse(true, getDeliveryOrigin()));
     } catch (error) {
       console.error("[API] Update delivery origin error:", error);
       res.status(500).json(apiResponse(false, undefined, "Failed to update delivery origin"));
     }
   });

   // Public: reverse geocode coordinates to address
   app.get("/api/delivery/reverse", publicRateLimiter, async (req, res) => {
     try {
       const lat = parseFloat(String(req.query.lat || ""));
       const lng = parseFloat(String(req.query.lng || ""));
       if (isNaN(lat) || isNaN(lng)) return res.status(400).json(apiResponse(false, undefined, "lat and lng are required"));
       const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
       const r = await fetch(url, { headers: { "User-Agent": "laundry-app/1.0" } });
       if (!r.ok) return res.status(502).json(apiResponse(false, undefined, "Reverse geocoding failed"));
       const data = await r.json() as any;
       const displayName = data.display_name || "";
       if (!displayName.toLowerCase().includes("san fernando") || !displayName.toLowerCase().includes("la union")) {
         return res.status(400).json(apiResponse(false, undefined, "Delivery is only available in San Fernando City, La Union"));
       }
       res.json(apiResponse(true, { address: displayName }));
     } catch (error) {
       res.status(500).json(apiResponse(false, undefined, "Failed to reverse geocode"));
     }
   });

   // Public: quote delivery fee by coordinates
   app.get("/api/delivery/quote-coords", publicRateLimiter, async (req, res) => {
     try {
       const lat = parseFloat(String(req.query.lat || ""));
       const lng = parseFloat(String(req.query.lng || ""));
       if (isNaN(lat) || isNaN(lng)) return res.status(400).json(apiResponse(false, undefined, "lat and lng are required"));
       // Restrict to San Fernando City, La Union service area
       if (lat < 16.55 || lat > 16.70 || lng < 120.25 || lng > 120.40) {
         return res.status(400).json(apiResponse(false, undefined, "Delivery is only available in San Fernando City, La Union"));
       }
       const origin = getDeliveryOrigin();
       let originLat = origin.latitude;
       let originLon = origin.longitude;
       if ((!originLat && !originLon) && origin.address) {
         const g = await geocodeAddress(origin.address);
         if (g) { originLat = g.lat; originLon = g.lon; }
       }
       let distance = await routeDistanceKm(originLat, originLon, lat, lng);
       if (distance === null) distance = haversineKm(originLat, originLon, lat, lng);
       const fee = calculateDeliveryFeeByDistance(distance);
       res.json(apiResponse(true, { distance_km: Math.round(distance * 100) / 100, fee }));
     } catch (error) {
       res.status(500).json(apiResponse(false, undefined, "Failed to quote delivery fee"));
     }
   });

   // Public: quote delivery fee by address using free map APIs
   app.post("/api/delivery/quote", publicRateLimiter, async (req, res) => {
     try {
       const { address } = req.body || {};
       if (!address || typeof address !== 'string' || !address.trim()) {
         return res.status(400).json(apiResponse(false, undefined, "address is required"));
       }
       const result = await calculateDeliveryFeeByAddress(address.trim());
       if (!result.destination) {
         return res.status(404).json(apiResponse(false, undefined, "Address not found"));
       }
       res.json(apiResponse(true, result));
     } catch (error) {
       console.error("[API] Quote delivery fee error:", error);
       res.status(500).json(apiResponse(false, undefined, "Failed to quote delivery fee"));
     }
   });

   // Admin: zones CRUD
   app.get("/api/delivery/zones", requireAuth, (req, res) => {
     try {
       res.json(apiResponse(true, getDeliveryZones(false)));
     } catch (error) {
       res.status(500).json(apiResponse(false, undefined, "Failed to get delivery zones"));
     }
   });
   app.post("/api/delivery/zones", requireAuth, (req, res) => {
     try {
       const { name, latitude, longitude, is_active } = req.body || {};
       if (!name) return res.status(400).json(apiResponse(false, undefined, "name is required"));
       const info = db.prepare("INSERT INTO delivery_zones (name, latitude, longitude, is_active) VALUES (?, ?, ?, ?)").run(name, latitude || 0, longitude || 0, is_active ?? 1);
       const zone = db.prepare("SELECT * FROM delivery_zones WHERE id = ?").get(info.lastInsertRowid);
       res.json(apiResponse(true, zone));
     } catch (error) {
       res.status(500).json(apiResponse(false, undefined, "Failed to create delivery zone"));
     }
   });
   app.delete("/api/delivery/zones/:id", requireAuth, (req, res) => {
     try {
       db.prepare("DELETE FROM delivery_zones WHERE id = ?").run(req.params.id);
       res.json(apiResponse(true, undefined, "Deleted"));
     } catch (error) {
       res.status(500).json(apiResponse(false, undefined, "Failed to delete delivery zone"));
     }
   });

   // Admin: bands CRUD
   app.get("/api/delivery/bands", requireAuth, (req, res) => {
     try {
       res.json(apiResponse(true, getDeliveryBands()));
     } catch (error) {
       res.status(500).json(apiResponse(false, undefined, "Failed to get delivery bands"));
     }
   });
   app.post("/api/delivery/bands", requireAuth, (req, res) => {
     try {
       const { min_km, max_km, fee, sort_order } = req.body || {};
       const info = db.prepare("INSERT INTO delivery_bands (min_km, max_km, fee, sort_order) VALUES (?, ?, ?, ?)").run(min_km ?? 0, max_km ?? 9999, fee ?? 0, sort_order ?? 0);
       const band = db.prepare("SELECT * FROM delivery_bands WHERE id = ?").get(info.lastInsertRowid);
       res.json(apiResponse(true, band));
     } catch (error) {
       res.status(500).json(apiResponse(false, undefined, "Failed to create delivery band"));
     }
   });
   app.delete("/api/delivery/bands/:id", requireAuth, (req, res) => {
     try {
       db.prepare("DELETE FROM delivery_bands WHERE id = ?").run(req.params.id);
       res.json(apiResponse(true, undefined, "Deleted"));
     } catch (error) {
       res.status(500).json(apiResponse(false, undefined, "Failed to delete delivery band"));
     }
   });

    // Global error handler (must be last middleware)
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error("[ERROR]", err);
      if (res.headersSent) return next(err);
      res.status(500).json(apiResponse(false, undefined, "Internal server error"));
    });

    // Start the server
    const server = app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════╗
║   Laundry Management Server                       ║
║   Running on http://localhost:${PORT}             ║
║   NODE_ENV: ${process.env.NODE_ENV || "(unset -> production)"}  ║
║   Database: ${DB_NAME}                            ║
╚═══════════════════════════════════════════════════╝
    `);
  });

  // Background task to decrement machine time every second
  const timerInterval = setInterval(() => {
    try {
      // Use a transaction to ensure atomicity of multi-table updates
      const timerTransaction = db.transaction(() => {
        // Wash timers pause at zero until the admin explicitly starts drying.
        const machinesCompleting = db
          .prepare(`
            SELECT m.id, m.current_transaction_id FROM machines m
            LEFT JOIN transactions t ON t.id = m.current_transaction_id
            WHERE m.status = 'in-use' AND (
              (t.id IS NULL AND m.remaining_time <= 1 AND NOT EXISTS (
                SELECT 1 FROM transactions assigned
                WHERE assigned.machine_id = m.id AND assigned.status IN ('accepted', 'washing', 'drying', 'ready')
              ))
              OR (t.status = 'drying' AND m.drying_time <= 1)
            )
          `)
          .all() as { id: number; current_transaction_id: number | null }[];
        
        // Decrement only the timer belonging to the active phase.
        db.prepare(`
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
        `).run();

        // Process machines that just completed their cycle
        if (machinesCompleting.length > 0) {
          for (const machine of machinesCompleting) {
            const machineId = machine.id;
            const transactionId = machine.current_transaction_id;
            
            if (!transactionId) {
              // No transaction assigned, just release machine
              db.prepare(
                "UPDATE machines SET status = 'available', remaining_time = 0, drying_time = 0, current_transaction_id = NULL WHERE id = ?"
              ).run(machineId);
              continue;
            }

            // Get current transaction status
            const transaction = db.prepare("SELECT status FROM transactions WHERE id = ?").get(transactionId) as { status: string } | undefined;
            
            if (!transaction) {
              // Transaction not found, release machine
              db.prepare(
                "UPDATE machines SET status = 'available', remaining_time = 0, drying_time = 0, current_transaction_id = NULL WHERE id = ?"
              ).run(machineId);
              continue;
            }

            // Update transaction status
            db.prepare("UPDATE transactions SET status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(transactionId);
            db.prepare(
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
  }, 1000);

  // Graceful shutdown handlers
  const shutdown = () => {
    console.log("[SERVER] Shutting down...");
    clearInterval(timerInterval);
    db.close();
    server.close(() => {
      console.log("[SERVER] Server closed.");
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error("[FATAL] Server failed to start:", err);
  process.exit(1);
});
