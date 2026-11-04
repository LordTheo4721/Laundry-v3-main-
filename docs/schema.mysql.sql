-- MySQL/MariaDB schema for Laundry v3 (import via phpMyAdmin)
-- Engine: InnoDB, charset utf8mb4

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference_number VARCHAR(64) UNIQUE,
  customer_name TEXT,
  customer_phone VARCHAR(32),
  customer_email TEXT,
  service_type TEXT,
  quantity INT DEFAULT 1,
  special_instructions TEXT,
  weight DOUBLE,
  appointment_date TEXT,
  appointment_time TEXT,
  delivery_method TEXT,
  address TEXT,
  branch TEXT,
  status VARCHAR(32) DEFAULT 'pending' CHECK (status IN ('pending','accepted','washing','drying','ready','completed','declined')),
  total_price DOUBLE DEFAULT 0,
  payment_status TEXT DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid')),
  payment_method TEXT DEFAULT 'cash',
  machine_id INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  handwash_proof_image TEXT,
  deleted_at DATETIME,
  delivery_fee DOUBLE DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS machines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name TEXT,
  type TEXT,
  capacity INT DEFAULT 10,
  status VARCHAR(32) DEFAULT 'available' CHECK (status IN ('available','in-use','maintenance')),
  remaining_time INT DEFAULT 0,
  drying_time INT DEFAULT 0,
  current_transaction_id INT,
  is_default INT DEFAULT 0,
  avg_cycle_time INT DEFAULT 2700,
  total_jobs_completed INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transaction_id INT UNIQUE,
  rating INT CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  photos TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS review_replies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  review_id INT NOT NULL,
  admin_id INT NOT NULL,
  message TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS queue (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transaction_id INT NOT NULL,
  position INT NOT NULL,
  estimated_wait_time INT DEFAULT 0,
  estimated_start_time TEXT,
  estimated_end_time TEXT,
  status VARCHAR(32) DEFAULT 'waiting',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS transaction_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transaction_id INT NOT NULL,
  service_type TEXT NOT NULL,
  quantity INT DEFAULT 1,
  unit_price DOUBLE DEFAULT 0,
  total_price DOUBLE DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS email_verifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  token TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  verified INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS pricing (
  id INT AUTO_INCREMENT PRIMARY KEY,
  service_type VARCHAR(128) NOT NULL UNIQUE,
  pricing_type TEXT NOT NULL DEFAULT 'tiered',
  base_price DOUBLE DEFAULT 0,
  tier_1_limit INT DEFAULT 5,
  tier_1_price DOUBLE DEFAULT 0,
  tier_2_limit INT DEFAULT 7,
  tier_2_price DOUBLE DEFAULT 0,
  tier_3_limit INT DEFAULT 8,
  tier_3_price DOUBLE DEFAULT 0,
  tier_4_limit INT DEFAULT 9,
  tier_4_price DOUBLE DEFAULT 0,
  tier_5_price_per_kg DOUBLE DEFAULT 0,
  per_kg_price DOUBLE DEFAULT 0,
  is_active INT DEFAULT 1,
  delivery_fee DOUBLE DEFAULT 50,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS price_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  service_type VARCHAR(128) NOT NULL,
  old_price_data TEXT,
  new_price_data TEXT,
  changed_by TEXT DEFAULT 'admin',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS delivery_origin (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Laundry Shop',
  address TEXT,
  latitude DOUBLE NOT NULL DEFAULT 0,
  longitude DOUBLE NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS delivery_zones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name TEXT NOT NULL,
  latitude DOUBLE NOT NULL DEFAULT 0,
  longitude DOUBLE NOT NULL DEFAULT 0,
  is_active INT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS delivery_bands (
  id INT AUTO_INCREMENT PRIMARY KEY,
  min_km DOUBLE NOT NULL DEFAULT 0,
  max_km DOUBLE NOT NULL DEFAULT 9999,
  fee DOUBLE NOT NULL DEFAULT 0,
  sort_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS admin_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin','admin')),
  last_login DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  action VARCHAR(32) NOT NULL CHECK (action IN ('login','logout','password_change','username_change','failed_login')),
  details TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Indexes
CREATE INDEX idx_review_replies_review_id ON review_replies(review_id);
CREATE INDEX idx_review_replies_admin_id ON review_replies(admin_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_transactions_customer_phone ON transactions(customer_phone);
CREATE INDEX idx_transactions_reference ON transactions(reference_number);
CREATE INDEX idx_transactions_machine_id ON transactions(machine_id);
CREATE INDEX idx_machines_status ON machines(status);
CREATE INDEX idx_queue_status ON queue(status);
CREATE INDEX idx_queue_transaction ON queue(transaction_id);
CREATE INDEX idx_queue_position ON queue(position);
CREATE INDEX idx_items_transaction ON transaction_items(transaction_id);
CREATE INDEX idx_email_verifications_email ON email_verifications(email);
CREATE INDEX idx_price_history_service ON price_history(service_type);
CREATE INDEX idx_price_history_created ON price_history(created_at);
CREATE INDEX idx_audit_logs_admin_id ON audit_logs(admin_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

SET FOREIGN_KEY_CHECKS = 1;
