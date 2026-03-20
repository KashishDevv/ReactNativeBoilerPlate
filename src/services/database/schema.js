/**
 * SQLite schema for health tag data.
 * - raw_measurements: short-term raw samples (optional retention 1–2 days).
 * - aggregated_measurements: long-term fixed-interval buckets (e.g. 6 min) for display and sync.
 */

export const DB_NAME = 'health_tag.db';
export const AGGREGATION_INTERVAL_MINUTES = 6;

/** Bucket minute offsets within each hour (6-min): 0, 6, 12, 18, 24, 30, 36, 42, 48, 54 */
export const BUCKET_MINUTES = [0, 6, 12, 18, 24, 30, 36, 42, 48, 54];

export const RAW_MEASUREMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS raw_measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  timestamp_seconds INTEGER NOT NULL,
  steps INTEGER,
  temperature REAL,
  received_at_iso TEXT,
  source TEXT,
  created_at_iso TEXT DEFAULT (datetime('now')),
  UNIQUE(device_id, timestamp_seconds)
);
CREATE INDEX IF NOT EXISTS idx_raw_device_ts ON raw_measurements(device_id, timestamp_seconds);
`;

export const AGGREGATED_MEASUREMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS aggregated_measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  bucket_timestamp_seconds INTEGER NOT NULL,
  interval_minutes INTEGER NOT NULL,
  metric_type TEXT NOT NULL,
  avg_value REAL,
  min_value REAL,
  max_value REAL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  created_at_iso TEXT DEFAULT (datetime('now')),
  UNIQUE(device_id, bucket_timestamp_seconds, interval_minutes, metric_type)
);
CREATE INDEX IF NOT EXISTS idx_agg_device_bucket ON aggregated_measurements(device_id, bucket_timestamp_seconds);
CREATE INDEX IF NOT EXISTS idx_agg_device_interval ON aggregated_measurements(device_id, interval_minutes);
`;

export const SYNC_METADATA_TABLE = `
CREATE TABLE IF NOT EXISTS sync_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  last_synced_bucket_seconds INTEGER,
  last_synced_at_iso TEXT,
  UNIQUE(device_id)
);
`;

export const SCHEMA_SQL = [
  RAW_MEASUREMENTS_TABLE,
  AGGREGATED_MEASUREMENTS_TABLE,
  SYNC_METADATA_TABLE,
];
