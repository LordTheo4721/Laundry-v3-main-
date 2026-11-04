// Translates the app's SQL (written in the SQLite-style dialect used throughout
// server.ts) into MySQL/MariaDB syntax before it runs.

export type SqlEngine = "mysql";

function splitArgs(inner: string): string[] {
  return inner.split(",").map((p) => p.trim()).filter((p) => p !== "");
}

function unquote(v: string): string {
  return v.trim().replace(/^['"]|['"]$/g, "");
}

function parseModifiers(mods: string[]): string {
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

export function translateSql(sql: string, engine: SqlEngine): string {
  let s = sql;

  // DDL type mappings
  s = s.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, "INT AUTO_INCREMENT PRIMARY KEY");
  s = s.replace(/AUTOINCREMENT/gi, "AUTO_INCREMENT");
  s = s.replace(/\bREAL\b/g, "DOUBLE");
  // Keep TEXT, DATETIME, INT as-is (MySQL compatible enough)

  // INSERT OR IGNORE / REPLACE
  s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, "INSERT IGNORE INTO");
  s = s.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, "REPLACE INTO");

  // PRAGMA foreign_keys = ON -> MySQL equivalent (handled by adapter, but strip)
  if (/^\s*PRAGMA\b/i.test(s)) {
    return ""; // adapter will skip empty
  }

  // datetime('now', ...) and datetime(col, ...)
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

  // date('now', ...) and date(col, ...)
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

  // strftime('%H', expr, mods) inside CAST(... as INTEGER)
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

  // strftime('%w', expr, mods)
  s = s.replace(/strftime\('%w',\s*([^)]+)\)/gi, (_m, inner) => {
    const parts = splitArgs(inner);
    const base = (parts[0] || "").trim();
    const mods = parts.slice(1);
    const baseExpr = base.toLowerCase() === "'now'" ? "UTC_TIMESTAMP()" : base;
    const modExpr = parseModifiers(mods);
    if (!modExpr) return `(DAYOFWEEK(${baseExpr}) - 1)`;
    return `(DAYOFWEEK(${baseExpr}${modExpr}) - 1)`;
  });

  // SQLite MAX(a, b) scalar form -> MySQL GREATEST(a, b)
  s = s.replace(/\bMAX\(\s*([^()]+?)\s*,\s*([^()]+?)\s*\)/g, "GREATEST($1, $2)");
  // SQLite CAST(... AS INTEGER) -> MySQL CAST(... AS SIGNED)
  s = s.replace(/\bas\s+INTEGER\s*\)/gi, "AS SIGNED)");

  return s;
}

export function isPragma(sql: string): boolean {
  return /^\s*PRAGMA\b/i.test(sql.trim());
}