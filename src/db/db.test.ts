import { getDatabaseConfig } from "./config";
import { translateSql } from "./sql";

describe("db config", () => {
  it("always uses the mysql engine", () => {
    const prev = process.env.DB_ENGINE;
    process.env.DB_ENGINE = "sqlite";
    expect(getDatabaseConfig().engine).toBe("mysql");
    if (prev === undefined) delete process.env.DB_ENGINE; else process.env.DB_ENGINE = prev;
  });

  it("reads MySQL settings from DB_* variables", () => {
    const keys = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_DATABASE"] as const;
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    process.env.DB_HOST = "127.0.0.1";
    process.env.DB_PORT = "3307";
    process.env.DB_USER = "app";
    process.env.DB_PASSWORD = "secret";
    process.env.DB_DATABASE = "laundry_test";
    const cfg = getDatabaseConfig();
    expect(cfg).toMatchObject({ host: "127.0.0.1", port: 3307, user: "app", password: "secret", database: "laundry_test" });
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
  });
});

describe("sql translation", () => {
  it("translates sqlite ddl to mysql", () => {
    const sql = "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, price REAL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)";
    const out = translateSql(sql, "mysql");
    expect(out).toContain("INT AUTO_INCREMENT PRIMARY KEY");
    expect(out).toContain("DOUBLE");
  });

  it("translates date functions", () => {
    const sql = "SELECT date(created_at) as d, CAST(strftime('%H', created_at) as INTEGER) as h FROM t WHERE date(created_at) = date('now')";
    const out = translateSql(sql, "mysql");
    expect(out).toContain("DATE(created_at)");
    expect(out).toContain("HOUR(created_at)");
    expect(out).toContain("CURDATE()");
  });
});
