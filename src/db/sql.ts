// SQL dialect translation helpers for dual-database support.

export type SqlEngine = "sqlite" | "mysql";

export function translateSql(sql: string, engine: SqlEngine): string {
  if (engine === "sqlite") return sql;
  let s = sql;

  // DDL type mappings
  s = s.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, "INT AUTO_INCREMENT PRIMARY KEY");
  s = s.replace(/AUTOINCREMENT/gi, "AUTO_INCREMENT");
  s = s.replace(/\bREAL\b/g, "DOUBLE");
  // Keep TEXT, DATETIME, INT as-is (MySQL compatible enough)

  // SQLite-specific functions -> MySQL
  // date('now') variants
  s = s.replace(/date\('now'\)/gi, "CURDATE()");
  s = s.replace(/date\('now',\s*'-1 day'\)/gi, "DATE_SUB(CURDATE(), INTERVAL 1 DAY)");
  s = s.replace(/date\('now',\s*'-7 days'\)/gi, "DATE_SUB(CURDATE(), INTERVAL 7 DAY)");
  s = s.replace(/date\('now',\s*'-14 days'\)/gi, "DATE_SUB(CURDATE(), INTERVAL 14 DAY)");
  s = s.replace(/date\('now',\s*'-30 days'\)/gi, "DATE_SUB(CURDATE(), INTERVAL 30 DAY)");
  s = s.replace(/date\('now',\s*'-60 days'\)/gi, "DATE_SUB(CURDATE(), INTERVAL 60 DAY)");
  // date(col)
  s = s.replace(/\bdate\(([^)]+)\)/gi, "DATE($1)");
  // strftime
  s = s.replace(/CAST\(strftime\('%H',\s*([^)]+)\)\s*as\s*INTEGER\)/gi, "HOUR($1)");
  s = s.replace(/CAST\(strftime\("%H",\s*([^)]+)\)\s*as\s*INTEGER\)/gi, "HOUR($1)");
  s = s.replace(/strftime\('%w',\s*([^)]+)\)/gi, "(DAYOFWEEK($1) - 1)");
  // INSERT OR IGNORE / REPLACE
  s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, "INSERT IGNORE INTO");
  s = s.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, "REPLACE INTO");

  // PRAGMA foreign_keys = ON -> MySQL equivalent (handled by adapter, but strip)
  if (/^\s*PRAGMA\b/i.test(s)) {
    return ""; // adapter will skip empty
  }

  return s;
}

export function isPragma(sql: string): boolean {
  return /^\s*PRAGMA\b/i.test(sql.trim());
}