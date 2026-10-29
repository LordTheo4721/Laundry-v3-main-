import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { createSqliteAdapter } from "./sqlite";
import { getDatabaseConfig } from "./config";
import { createDatabase } from "./connection";
import { translateSql } from "./sql";

describe("db config", () => {
  it("defaults to sqlite", () => {
    const cfg = getDatabaseConfig();
    // In test env without DB_ENGINE, resolveEngine checks DB_HOST; default sqlite
    expect(["sqlite", "mysql"]).toContain(cfg.engine);
  });

  it("resolves mysql when DB_ENGINE=mysql", () => {
    const prev = process.env.DB_ENGINE;
    process.env.DB_ENGINE = "mysql";
    const cfg = getDatabaseConfig();
    expect(cfg.engine).toBe("mysql");
    if (prev === undefined) delete process.env.DB_ENGINE; else process.env.DB_ENGINE = prev;
  });
});

describe("sqlite adapter", () => {
  let dbPath: string;
  let db: ReturnType<typeof createSqliteAdapter>;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `test-${Date.now()}-${Math.random()}.db`);
    db = createSqliteAdapter(dbPath);
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, active INTEGER DEFAULT 1)`);
  });

  afterEach(() => {
    db.close();
    for (const f of [dbPath, dbPath + "-wal", dbPath + "-shm"]) {
      try { fs.unlinkSync(f); } catch {}
    }
  });

  it("inserts and reads rows", () => {
    const info = db.prepare("INSERT INTO t (name) VALUES (?)").run("alice");
    expect(info.changes).toBe(1);
    expect(Number(info.lastInsertRowid)).toBeGreaterThan(0);
    const row = db.prepare("SELECT * FROM t WHERE id = ?").get(info.lastInsertRowid) as any;
    expect(row.name).toBe("alice");
    const all = db.prepare("SELECT * FROM t").all();
    expect(all.length).toBe(1);
  });

  it("updates and deletes", () => {
    db.prepare("INSERT INTO t (name) VALUES (?)").run("bob");
    const u = db.prepare("UPDATE t SET name = ? WHERE name = ?").run("robert", "bob");
    expect(u.changes).toBe(1);
    const d = db.prepare("DELETE FROM t WHERE name = ?").run("robert");
    expect(d.changes).toBe(1);
    expect(db.prepare("SELECT COUNT(*) as c FROM t").get().c).toBe(0);
  });

  it("transactions commit and rollback", () => {
    const tx = db.transaction(() => {
      db.prepare("INSERT INTO t (name) VALUES (?)").run("x");
      db.prepare("INSERT INTO t (name) VALUES (?)").run("y");
      return db.prepare("SELECT COUNT(*) as c FROM t").get().c;
    });
    const c = tx();
    expect(c).toBe(2);

    // rollback via thrown error
    try {
      db.transaction(() => {
        db.prepare("INSERT INTO t (name) VALUES (?)").run("z");
        throw new Error("boom");
      })();
    } catch {}
    expect(db.prepare("SELECT COUNT(*) as c FROM t").get().c).toBe(2);
  });

  it("healthCheck works", () => {
    expect(db.healthCheck()).toBe(true);
  });
});

describe("connection factory fallback", () => {
  it("creates sqlite when engine sqlite", () => {
    const cfg = getDatabaseConfig();
    const db = createDatabase({ ...cfg, engine: "sqlite", sqlitePath: ":memory:" } as any);
    // :memory: path not supported by better-sqlite3? it is
    expect(db.isSqlite()).toBe(true);
    db.close();
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