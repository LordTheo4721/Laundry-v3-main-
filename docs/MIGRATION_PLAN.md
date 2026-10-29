# Database Migration Plan: SQLite to MySQL (Dual-Database)

## Overview
This document describes the migration from SQLite (legacy primary) to MySQL (new primary)
while retaining SQLite as a fully supported fallback engine.

## Engines
- Primary (production): MySQL 8.0+
- Fallback: SQLite (better-sqlite3) via `DB_ENGINE=sqlite` or automatic fallback.

## Configuration
Environment variables (see `.env.example`):
- `DB_ENGINE` = `sqlite` | `mysql`
- SQLite: `DB_NAME` / `SQLITE_PATH`
- MySQL: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`, `DB_SSL`, `DB_POOL_SIZE`
- `DB_FALLBACK_TO_SQLITE` = `true` | `false`

## Preflight Checks
1. Verify MySQL server reachable: `mysql -h $DB_HOST -P $DB_PORT -u $DB_USER -p -e "SELECT 1"`.
2. Verify Node.js >= 18 and dependencies installed (`npm install`).
3. Run test suite: `npm test` and type check: `npm run lint`.
4. Backup SQLite: `npm run backup`.
5. Confirm disk space for backup and MySQL data.

## Backup
- SQLite: `npm run backup` (creates `backups/laundry-backup-*.db`).
- MySQL: `mysqldump -h $DB_HOST -u $DB_USER -p $DB_DATABASE > backup.sql`.

## Schema & Data Migration
1. Set `DB_ENGINE=mysql` in `.env` (keep `DB_FALLBACK_TO_SQLITE=true` initially).
2. Start app: `npm run dev`. The connection factory creates the database if missing and
   `initializeDatabase()` runs translated DDL + seeds.
3. For existing SQLite data, export and import:
   - Use a script to read all rows from SQLite and insert into MySQL preserving IDs.
   - Or use `sqlite3 .dump` converted to MySQL syntax.
4. Verify row counts match between engines.

## Validation
- Health endpoint: `GET /api/health` returns `{ database: "connected" }`.
- Run verification queries:
  - `SELECT COUNT(*) FROM transactions;`
  - `SELECT COUNT(*) FROM machines;`
  - `SELECT COUNT(*) FROM pricing;`
  - `SELECT * FROM admin_users;`
- Run full test suite against MySQL by setting `DB_ENGINE=mysql`.

## Cutover
1. Put app in maintenance mode (stop traffic).
2. Final incremental sync of SQLite -> MySQL.
3. Switch `DB_ENGINE=mysql`, `DB_FALLBACK_TO_SQLITE=false`.
4. Restart app and smoke-test booking, admin login, reports.
5. Monitor logs for errors.

## Monitoring
- Watch `/api/health`.
- Monitor MySQL slow query log and connection pool usage.
- Alert on fallback activation (log: "MySQL unavailable, falling back to SQLite").

## Rollback Triggers
- Health check failures > 3 consecutive.
- Error rate spike in API responses.
- Data integrity mismatch.

## Rollback Procedure
1. Set `DB_ENGINE=sqlite` (or `DB_FALLBACK_TO_SQLITE=true`).
2. Restart app; SQLite fallback activates automatically.
3. Restore SQLite backup if needed: copy `backups/laundry-backup-*.db` to `laundry.db`.

## Post-Migration Cleanup
- Remove SQLite file after 30 days of stable MySQL operation (optional).
- Keep SQLite fallback enabled for disaster recovery.
- Update documentation and runbooks.

## Documented Limitations (SQLite fallback)
- Single-writer concurrency; file-level locking.
- No network access; local process only.
- Case-sensitive string comparisons (MySQL configured with utf8mb4_bin to match).
- Date functions differ; adapter translates common patterns.