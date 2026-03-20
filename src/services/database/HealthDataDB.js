/**
 * SQLite initialization and schema execution.
 * Single open connection; safe to call init multiple times (idempotent).
 */

import { open } from 'react-native-nitro-sqlite';
import { DB_NAME, SCHEMA_SQL } from './schema';

let db = null;

export function getDB() {
  return db;
}

export function isOpen() {
  return db != null;
}

function runSchema(connection) {
  const allSql = SCHEMA_SQL.join('\n');
  const statements = allSql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
  for (const sql of statements) {
    connection.execute(sql + ';');
  }
}

/**
 * Initialize database and create tables. Idempotent.
 */
export function init() {
  if (db) return db;
  try {
    db = open({ name: DB_NAME });
    runSchema(db);
    return db;
  } catch (e) {
    console.error('[HealthDataDB] init failed:', e);
    db = null;
    throw e;
  }
}

/**
 * Close the database (e.g. on app teardown). Re-open with init().
 */
export function close() {
  if (db) {
    try {
      db.close();
    } catch (e) {
      console.warn('[HealthDataDB] close error:', e);
    }
    db = null;
  }
}

export default { getDB, isOpen, init, close };
