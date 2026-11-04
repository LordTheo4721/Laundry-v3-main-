// MySQL database access for the delivery service.

import { config } from './config.js';
import { createMysqlDatabase, type MysqlDatabase } from './mysql.js';
import { BarangayRow } from './types.js';

export type { Database } from './types.js';

const SEED: Array<[string, number, number, number, number]> = [
  ['Madayegdeg', 16.6085, 120.3121, 1, 39.0],
  ['Catbangen', 16.6133, 120.3128, 1, 39.0],
  ['Sevilla', 16.5982, 120.3204, 1, 39.0],
  ['Canaoay', 16.5947, 120.3045, 1, 39.0],
  ['Parian', 16.5861, 120.3248, 1, 39.0],
  ['Barangay I', 16.6152, 120.3168, 2, 49.0],
  ['Barangay II', 16.6165, 120.3155, 2, 49.0],
  ['Barangay III', 16.6181, 120.3182, 2, 49.0],
  ['Barangay IV', 16.6141, 120.3195, 2, 49.0],
  ['Tanqui', 16.6105, 120.3225, 2, 49.0],
  ['Ilocanos Norte', 16.6201, 120.3134, 2, 49.0],
  ['Ilocanos Sur', 16.6168, 120.3115, 2, 49.0],
  ['Pagdaraoan', 16.6264, 120.3189, 2, 49.0],
  ['San Francisco', 16.6192, 120.3041, 2, 49.0],
  ['Cabaroan', 16.6148, 120.3341, 2, 49.0],
  ['Lingsat', 16.6432, 120.3202, 2, 49.0],
  ['Carlatan', 16.6341, 120.3164, 2, 49.0],
  ['Biday', 16.6268, 120.3302, 2, 49.0],
  ['Pagdalagan', 16.5742, 120.3298, 2, 49.0],
  ['Bangcusay', 16.6541, 120.3245, 3, 65.0],
  ['Dalumpinas Este', 16.6482, 120.3361, 3, 65.0],
  ['Dalumpinas Oeste', 16.6465, 120.3149, 3, 65.0],
  ['Dallangayan Este', 16.6212, 120.3451, 3, 65.0],
  ['Dallangayan Oeste', 16.6234, 120.3378, 3, 65.0],
  ['Cadaclan', 16.5989, 120.3541, 3, 65.0],
  ['Santiago Norte', 16.6331, 120.3278, 3, 65.0],
  ['Santiago Sur', 16.6218, 120.3261, 3, 65.0],
  ['Pagudpud', 16.5812, 120.3098, 3, 65.0],
  ['San Vicente', 16.5898, 120.3402, 3, 65.0],
  ['Mameltac', 16.5721, 120.3481, 3, 65.0],
  ['Baraoas', 16.5912, 120.3602, 3, 65.0],
  ['Bato', 16.5824, 120.3698, 3, 65.0],
  ['Langcuas', 16.6081, 120.3465, 3, 65.0],
  ['Saoay', 16.6412, 120.3411, 3, 65.0],
  ['Pao Norte', 16.6361, 120.3592, 3, 65.0],
  ['Pao Sur', 16.6298, 120.3581, 3, 65.0],
  ['Abut', 16.6698, 120.3654, 4, 85.0],
  ['Apaleng', 16.6342, 120.3951, 4, 95.0],
  ['Nagyubuyuban', 16.6581, 120.3812, 4, 95.0],
  ['Bangbangolan', 16.6112, 120.3889, 4, 85.0],
  ['Bungro', 16.6672, 120.3482, 4, 85.0],
  ['Cabarsican', 16.6481, 120.3692, 4, 85.0],
  ['Calabugao', 16.6218, 120.3801, 4, 85.0],
  ['Camansi', 16.5921, 120.3812, 4, 85.0],
  ['Chulyao', 16.6012, 120.3721, 4, 85.0],
  ['Birunget', 16.6245, 120.3942, 4, 95.0],
  ['Masicong', 16.5802, 120.3891, 4, 95.0],
  ['Mamat-ing Norte', 16.6712, 120.3898, 4, 110.0],
  ['Mamat-ing Sur', 16.6634, 120.3912, 4, 110.0],
  ['Namancayan', 16.5642, 120.3712, 4, 85.0],
  ['Namarabar', 16.5712, 120.3921, 4, 95.0],
  ['Pias', 16.5561, 120.3598, 4, 85.0],
  ['Poris', 16.5612, 120.3845, 4, 95.0],
  ['Pushweng', 16.6391, 120.3812, 4, 85.0],
  ['Sallacong', 16.6512, 120.3981, 4, 110.0],
  ['San Guillermo', 16.6023, 120.3991, 4, 110.0],
  ['Siboan-Otong', 16.6181, 120.3689, 4, 85.0],
  ['Poro', 16.6111, 120.2882, 3, 65.0],
];

/** Every connection opened by initDatabase, so tests and shutdown can close them. */
const openDatabases: MysqlDatabase[] = [];

/**
 * Open the MySQL database (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_DATABASE),
 * create the barangays table if needed, and seed it. Throws if MySQL is unreachable.
 */
export function initDatabase(): MysqlDatabase {
  const db = createMysqlDatabase({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_DATABASE,
  });
  openDatabases.push(db);

  db.exec(`CREATE TABLE IF NOT EXISTS barangays (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(191) NOT NULL UNIQUE,
    latitude DOUBLE NOT NULL,
    longitude DOUBLE NOT NULL,
    delivery_tier INT NOT NULL,
    base_tier_fee DOUBLE NOT NULL,
    CONSTRAINT barangays_lat_range CHECK (latitude BETWEEN -90 AND 90),
    CONSTRAINT barangays_lng_range CHECK (longitude BETWEEN -180 AND 180),
    CONSTRAINT barangays_tier_range CHECK (delivery_tier BETWEEN 1 AND 4),
    CONSTRAINT barangays_fee_nonneg CHECK (base_tier_fee >= 0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

  const insert = db.prepare(
    'INSERT IGNORE INTO barangays (name, latitude, longitude, delivery_tier, base_tier_fee) VALUES (?, ?, ?, ?, ?)'
  );
  const seedTx = db.transaction(() => {
    for (const row of SEED) {
      insert.run(row[0], row[1], row[2], row[3], row[4]);
    }
  });
  seedTx();
  return db;
}

/** Close every connection opened by initDatabase. */
export function closeAllDatabases(): void {
  for (const db of openDatabases.splice(0)) db.close();
}

export function findBarangayById(db: MysqlDatabase, id: number): BarangayRow | undefined {
  const stmt = db.prepare(
    'SELECT id, name, latitude, longitude, delivery_tier, base_tier_fee FROM barangays WHERE id = ?'
  );
  const row = stmt.get(id) as
    | {
        id: number;
        name: string;
        latitude: number;
        longitude: number;
        delivery_tier: number;
        base_tier_fee: number;
      }
    | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    delivery_tier: row.delivery_tier,
    base_tier_fee: row.base_tier_fee,
  };
}
