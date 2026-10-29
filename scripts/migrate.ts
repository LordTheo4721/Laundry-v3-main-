/**
 * Migration / schema initialization helper.
 * Ensures the configured database engine is reachable and schema is initialized.
 * Usage: npx tsx scripts/migrate.ts
 */
import { db, dbConfig } from "../src/db";

async function main() {
  console.log(`[Migrate] Engine: ${dbConfig.engine}`);
  console.log(`[Migrate] Health: ${db.healthCheck()}`);
  // Schema is initialized automatically by server startup (initializeDatabase).
  // This script verifies connectivity and reports status.
  if (!db.healthCheck()) {
    console.error("[Migrate] Database health check failed");
    process.exit(1);
  }
  console.log("[Migrate] OK - database reachable. Start the server to apply schema/seeds.");
  db.close();
}

main().catch((e) => {
  console.error("[Migrate] Error:", e);
  process.exit(1);
});