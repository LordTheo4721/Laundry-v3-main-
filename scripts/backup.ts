/**
 * Database Backup Script
 * Run this script periodically (e.g., daily) to backup the SQLite database
 * 
 * Usage: npx tsx scripts/backup.ts
 * Or add to package.json: "backup": "npx tsx scripts/backup.ts"
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const DB_ENGINE = (process.env.DB_ENGINE || 'sqlite').toLowerCase();
const DB_NAME = process.env.DB_NAME || 'laundry.db';
const BACKUP_DIR = process.env.BACKUP_DIR || 'backups';

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Generate timestamp for backup filename
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupFileName = `laundry-backup-${timestamp}.db`;
const backupPath = path.join(BACKUP_DIR, backupFileName);

async function main() {
  console.log(`[Backup] Starting database backup...`);
  console.log(`[Backup] Source: ${DB_NAME}`);
  console.log(`[Backup] Destination: ${backupPath}`);

  try {
    // Open source database
    const db = new Database(DB_NAME, { readonly: true });

    // Use SQLite's online backup API for a consistent snapshot
    await db.backup(backupPath);

    // Close database connection
    db.close();

    // Get file stats
    const stats = fs.statSync(backupPath);
    const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

    console.log(`[Backup] Success! Backup created: ${backupFileName}`);
    console.log(`[Backup] Size: ${sizeInMB} MB`);

    // Cleanup old backups (keep last 7 days)
    cleanupOldBackups();

  } catch (error) {
    console.error(`[Backup] Error:`, error);
    process.exit(1);
  }
}

main();

function cleanupOldBackups() {
  const DAYS_TO_KEEP = 7;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - DAYS_TO_KEEP);
  
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('laundry-backup-') && f.endsWith('.db'))
      .map(f => ({
        name: f,
        path: path.join(BACKUP_DIR, f),
        time: fs.statSync(path.join(BACKUP_DIR, f)).mtime
      }))
      .sort((a, b) => b.time.getTime() - a.time.getTime());
    
    // Keep all backups from the last 7 days
    const toKeep = files.filter(f => f.time > cutoffDate);
    const toDelete = files.filter(f => f.time <= cutoffDate);
    
    if (toDelete.length > 0) {
      console.log(`[Backup] Cleaning up ${toDelete.length} old backup(s)...`);
      toDelete.forEach(f => {
        fs.unlinkSync(f.path);
        console.log(`[Backup] Deleted: ${f.name}`);
      });
    }
    
    console.log(`[Backup] Total backups: ${toKeep.length}`);
  } catch (error) {
    console.error(`[Backup] Cleanup warning:`, error);
  }
}

console.log(`[Backup] Done!`);
