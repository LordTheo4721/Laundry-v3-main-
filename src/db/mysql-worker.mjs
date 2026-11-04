// Worker thread for the MySQL adapter. The main thread calls into this worker
// synchronously (synckit blocks on Atomics.wait while the worker runs the
// async mysql2 call), so the app keeps its synchronous db.prepare()/get()/all()/run() API
// without deasync, which does not reliably pump the event loop.
import { runAsWorker } from "synckit";
import mysql from "mysql2/promise";

let pool = null;
let tx = null; // dedicated connection while a transaction is open

function toError(e) {
  return { __error: true, code: e?.code ?? "UNKNOWN", message: String(e?.message ?? e) };
}

async function init(cfg) {
  if (pool) return;
  const base = {
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    charset: "utf8mb4",
    timezone: "Z",
    dateStrings: true,
    multipleStatements: true,
    connectTimeout: cfg.connectTimeout,
  };
  // Best effort: create the database if the user is allowed to (shared hosts usually are not).
  const admin = mysql.createPool({ ...base, connectionLimit: 1 });
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
  } catch {
    /* ignore: database already exists or privilege missing */
  } finally {
    await admin.end().catch(() => {});
  }
  pool = mysql.createPool({
    ...base,
    database: cfg.database,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    connectionLimit: cfg.connectionLimit,
    queueLimit: cfg.queueLimit,
    waitForConnections: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  });
}

async function handle(action, payload) {
  switch (action) {
    case "init":
      await init(payload);
      return { ok: true };
    case "ping":
      await pool.query("SELECT 1");
      return { ok: true };
    case "query": {
      const conn = tx ?? pool;
      const [result] = await conn.query(payload.sql, payload.params);
      const isRows = Array.isArray(result);
      return {
        rows: isRows ? result : [],
        affectedRows: isRows ? 0 : result?.affectedRows ?? 0,
        insertId: isRows ? 0 : result?.insertId ?? 0,
      };
    }
    case "begin":
      tx = await pool.getConnection();
      await tx.beginTransaction();
      return { ok: true };
    case "commit":
      if (tx) {
        try { await tx.commit(); } finally { tx.release(); tx = null; }
      }
      return { ok: true };
    case "rollback":
      if (tx) {
        try { await tx.rollback(); } finally { tx.release(); tx = null; }
      }
      return { ok: true };
    case "close":
      if (tx) { tx.release(); tx = null; }
      if (pool) { await pool.end(); pool = null; }
      return { ok: true };
    default:
      throw new Error(`Unknown action ${action}`);
  }
}

runAsWorker(async (action, payload) => {
  try {
    return await handle(action, payload);
  } catch (e) {
    return toError(e);
  }
});
