/**
 * Health data repository: raw ingest, bucket aggregation, and query APIs.
 * Designed for reuse across apps (BLE layer independent).
 */

import HealthDataDB from './HealthDataDB';
import {
  AGGREGATION_INTERVAL_MINUTES,
} from './schema';
import {
  getBucketStartSeconds,
  groupRecordsByBucket,
  computeBucketAggregates,
} from './timeBuckets';

const METRIC_TEMPERATURE = 'temperature';
const METRIC_STEPS = 'steps';

function getRecordTimestampSeconds(record) {
  if (!record) return null;
  if (record.originalTimestamp != null) return record.originalTimestamp;
  if (typeof record.timestamp === 'number') {
    return record.timestamp > 4102444800 ? Math.floor(record.timestamp / 1000) : record.timestamp;
  }
  if (record.timestampDate instanceof Date) return Math.floor(record.timestampDate.getTime() / 1000);
  if (typeof record.timestampDate === 'string') {
    const ms = new Date(record.timestampDate).getTime();
    return isNaN(ms) ? null : Math.floor(ms / 1000);
  }
  return null;
}

/** Fallback timestamp when device timestamp is missing (e.g. from receivedAt or now). Avoids dropping records. */
function getRecordTimestampSecondsWithFallback(record) {
  const ts = getRecordTimestampSeconds(record);
  if (ts != null) return ts;
  if (record.receivedAt) {
    const ms = typeof record.receivedAt === 'string' ? new Date(record.receivedAt).getTime() : (record.receivedAt?.getTime?.() ?? 0);
    if (!isNaN(ms)) return Math.floor(ms / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

function ensureDB() {
  if (!HealthDataDB.isOpen()) {
    HealthDataDB.init();
  }
  return HealthDataDB.getDB();
}

/**
 * Insert one raw measurement and update aggregated bucket (real-time aggregation).
 * @param {string} deviceId
 * @param {{ timestamp?, timestampDate?, originalTimestamp?, steps?, temperature?, receivedAt?, source? }} record
 */
export function insertRaw(deviceId, record) {
  if (!record || !deviceId) return;
  const db = ensureDB();
  const ts = getRecordTimestampSeconds(record);
  if (ts == null) return;

  const steps = record.steps != null ? record.steps : null;
  const temperature = record.temperature != null && typeof record.temperature === 'number' ? record.temperature : null;
  const receivedAt = record.receivedAt != null ? (typeof record.receivedAt === 'string' ? record.receivedAt : record.receivedAt?.toISOString?.()) : null;
  const source = record.source || null;

  try {
    db.execute(
      `INSERT OR IGNORE INTO raw_measurements (device_id, timestamp_seconds, steps, temperature, received_at_iso, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [deviceId, ts, steps, temperature, receivedAt, source]
    );
    // Real-time aggregation: update bucket
    upsertBucketFromRecord(db, deviceId, ts, steps, temperature, AGGREGATION_INTERVAL_MINUTES);
  } catch (e) {
    console.warn('[HealthDataRepository] insertRaw error:', e);
  }
}

/**
 * Merge one sample into existing aggregated row (temperature: avg/min/max/count; steps: min/max/count).
 */
function upsertBucketFromRecord(db, deviceId, timestampSeconds, steps, temperature, intervalMinutes) {
  const bucket = getBucketStartSeconds(timestampSeconds, intervalMinutes);
  if (bucket == null) return;

  if (temperature != null && typeof temperature === 'number') {
    const r = db.execute(
      `SELECT avg_value, min_value, max_value, sample_count FROM aggregated_measurements
       WHERE device_id = ? AND bucket_timestamp_seconds = ? AND interval_minutes = ? AND metric_type = ?`,
      [deviceId, bucket, intervalMinutes, METRIC_TEMPERATURE]
    );
    let avg = temperature, minVal = temperature, maxVal = temperature, count = 1;
    const res = r.results ?? r.rows;
    if (res && res.length > 0) {
      const row = res[0];
      const prevAvg = row.avg_value;
      const prevMin = row.min_value;
      const prevMax = row.max_value;
      const prevCount = row.sample_count || 0;
      count = prevCount + 1;
      avg = (prevAvg * prevCount + temperature) / count;
      minVal = Math.min(prevMin, temperature);
      maxVal = Math.max(prevMax, temperature);
    }
    db.execute(
      `INSERT OR REPLACE INTO aggregated_measurements (device_id, bucket_timestamp_seconds, interval_minutes, metric_type, avg_value, min_value, max_value, sample_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [deviceId, bucket, intervalMinutes, METRIC_TEMPERATURE, avg, minVal, maxVal, count]
    );
  }

  if (steps != null && typeof steps === 'number') {
    const r = db.execute(
      `SELECT min_value, max_value, sample_count FROM aggregated_measurements
       WHERE device_id = ? AND bucket_timestamp_seconds = ? AND interval_minutes = ? AND metric_type = ?`,
      [deviceId, bucket, intervalMinutes, METRIC_STEPS]
    );
    let minVal = steps, maxVal = steps, count = 1;
    const resSteps = r.results ?? r.rows;
    if (resSteps && resSteps.length > 0) {
      const row = resSteps[0];
      minVal = Math.min(row.min_value, steps);
      maxVal = Math.max(row.max_value, steps);
      count = (row.sample_count || 0) + 1;
    }
    db.execute(
      `INSERT OR REPLACE INTO aggregated_measurements (device_id, bucket_timestamp_seconds, interval_minutes, metric_type, avg_value, min_value, max_value, sample_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [deviceId, bucket, intervalMinutes, METRIC_STEPS, maxVal, minVal, maxVal, count]
    );
  }
}

/**
 * Insert multiple raw records and aggregate into buckets (batch).
 * Nitro SQLite uses async transactions; call without await for fire-and-forget.
 */
export async function insertRawBatch(deviceId, records, options = {}) {
  if (!deviceId || !records || records.length === 0) return;
  const db = ensureDB();
  const intervalMinutes = options.intervalMinutes ?? AGGREGATION_INTERVAL_MINUTES;

  try {
    await db.transaction(async (tx) => {
      for (const record of records) {
        if (!record) continue;
        const ts = getRecordTimestampSecondsWithFallback(record);
        const steps = record.steps != null ? record.steps : null;
        const temperature = record.temperature != null && typeof record.temperature === 'number' ? record.temperature : null;
        const receivedAt = record.receivedAt != null ? (typeof record.receivedAt === 'string' ? record.receivedAt : record.receivedAt?.toISOString?.()) : null;
        const source = record.source || null;
        tx.execute(
          `INSERT OR IGNORE INTO raw_measurements (device_id, timestamp_seconds, steps, temperature, received_at_iso, source)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [deviceId, ts, steps, temperature, receivedAt, source]
        );
        upsertBucketWithTx(tx, deviceId, ts, steps, temperature, intervalMinutes);
      }
    });
  } catch (e) {
    console.warn('[HealthDataRepository] insertRawBatch error:', e);
  }
}

function upsertBucketWithTx(tx, deviceId, timestampSeconds, steps, temperature, intervalMinutes) {
  const bucket = getBucketStartSeconds(timestampSeconds, intervalMinutes);
  if (bucket == null) return;

  if (temperature != null && typeof temperature === 'number') {
    const r = tx.execute(
      `SELECT avg_value, min_value, max_value, sample_count FROM aggregated_measurements
       WHERE device_id = ? AND bucket_timestamp_seconds = ? AND interval_minutes = ? AND metric_type = ?`,
      [deviceId, bucket, intervalMinutes, METRIC_TEMPERATURE]
    );
    let avg = temperature, minVal = temperature, maxVal = temperature, count = 1;
    const resTx = r.results ?? r.rows;
    if (resTx && resTx.length > 0) {
      const row = resTx[0];
      const prevAvg = row.avg_value;
      const prevMin = row.min_value;
      const prevMax = row.max_value;
      const prevCount = row.sample_count || 0;
      count = prevCount + 1;
      avg = (prevAvg * prevCount + temperature) / count;
      minVal = Math.min(prevMin, temperature);
      maxVal = Math.max(prevMax, temperature);
    }
    tx.execute(
      `INSERT OR REPLACE INTO aggregated_measurements (device_id, bucket_timestamp_seconds, interval_minutes, metric_type, avg_value, min_value, max_value, sample_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [deviceId, bucket, intervalMinutes, METRIC_TEMPERATURE, avg, minVal, maxVal, count]
    );
  }

  if (steps != null && typeof steps === 'number') {
    const r = tx.execute(
      `SELECT min_value, max_value, sample_count FROM aggregated_measurements
       WHERE device_id = ? AND bucket_timestamp_seconds = ? AND interval_minutes = ? AND metric_type = ?`,
      [deviceId, bucket, intervalMinutes, METRIC_STEPS]
    );
    let minVal = steps, maxVal = steps, count = 1;
    const resTxSteps = r.results ?? r.rows;
    if (resTxSteps && resTxSteps.length > 0) {
      const row = resTxSteps[0];
      minVal = Math.min(row.min_value, steps);
      maxVal = Math.max(row.max_value, steps);
      count = (row.sample_count || 0) + 1;
    }
    tx.execute(
      `INSERT OR REPLACE INTO aggregated_measurements (device_id, bucket_timestamp_seconds, interval_minutes, metric_type, avg_value, min_value, max_value, sample_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [deviceId, bucket, intervalMinutes, METRIC_STEPS, maxVal, minVal, maxVal, count]
    );
  }
}

/**
 * Get aggregated rows for display (e.g. graphs).
 * Returns one row per bucket with temperature and steps merged into a single "record" per bucket.
 * @param {string} deviceId
 * @param {{ intervalMinutes?: number, fromSeconds?: number, toSeconds?: number, limit?: number }} options
 * @returns {Array<{ bucket_timestamp_seconds, timestampDate, steps_max, steps_min, steps_count, temp_avg, temp_min, temp_max, temp_count }>}
 */
export function getAggregatedForDisplay(deviceId, options = {}) {
  if (!deviceId) return [];
  let db;
  try {
    db = ensureDB();
  } catch (e) {
    if (__DEV__) console.warn('[HealthDataRepository] getAggregatedForDisplay ensureDB failed:', e);
    return [];
  }
  const intervalMinutes = options.intervalMinutes ?? AGGREGATION_INTERVAL_MINUTES;
  let sql = `
    SELECT bucket_timestamp_seconds,
           MAX(CASE WHEN metric_type = ? THEN max_value END) AS steps_max,
           MIN(CASE WHEN metric_type = ? THEN min_value END) AS steps_min,
           MAX(CASE WHEN metric_type = ? THEN sample_count END) AS steps_count,
           AVG(CASE WHEN metric_type = ? THEN avg_value END) AS temp_avg,
           MIN(CASE WHEN metric_type = ? THEN min_value END) AS temp_min,
           MAX(CASE WHEN metric_type = ? THEN max_value END) AS temp_max,
           SUM(CASE WHEN metric_type = ? THEN sample_count END) AS temp_count
    FROM aggregated_measurements
    WHERE device_id = ? AND interval_minutes = ?
  `;
  const params = [METRIC_STEPS, METRIC_STEPS, METRIC_STEPS, METRIC_TEMPERATURE, METRIC_TEMPERATURE, METRIC_TEMPERATURE, METRIC_TEMPERATURE, deviceId, intervalMinutes];

  if (options.fromSeconds != null) {
    sql += ' AND bucket_timestamp_seconds >= ?';
    params.push(options.fromSeconds);
  }
  if (options.toSeconds != null) {
    sql += ' AND bucket_timestamp_seconds <= ?';
    params.push(options.toSeconds);
  }
  sql += ' GROUP BY bucket_timestamp_seconds ORDER BY bucket_timestamp_seconds DESC';
  if (options.limit != null) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }

  let result;
  try {
    result = db.execute(sql, params);
  } catch (e) {
    if (__DEV__) console.warn('[HealthDataRepository] getAggregatedForDisplay execute failed:', e);
    return [];
  }
  const res = result.results ?? result.rows ?? [];
  if (!res.length) return [];
  const rows = [];
  for (let i = 0; i < res.length; i++) {
    const row = res[i];
    rows.push({
      bucket_timestamp_seconds: row.bucket_timestamp_seconds,
      timestampDate: new Date(row.bucket_timestamp_seconds * 1000),
      timestamp: row.bucket_timestamp_seconds,
      steps_max: row.steps_max,
      steps_min: row.steps_min,
      steps_count: row.steps_count,
      temp_avg: row.temp_avg,
      temp_min: row.temp_min,
      temp_max: row.temp_max,
      temp_count: row.temp_count,
      steps: row.steps_max,
      temperature: row.temp_avg != null ? row.temp_avg : (row.temp_max != null ? row.temp_max : null),
    });
  }
  return rows;
}

/**
 * Get aggregated records formatted like legacy Redux records for UI (HistoricalDataScreen, SyncRecordsScreen).
 * Each bucket becomes one "record" with steps = steps_max (latest in bucket), temperature = temp_avg.
 */
export function getAggregatedRecordsForUI(deviceId, options = {}) {
  const rows = getAggregatedForDisplay(deviceId, options);
  return rows.map(r => ({
    timestamp: r.bucket_timestamp_seconds,
    timestampDate: r.timestampDate,
    steps: r.steps_max,
    temperature: r.temp_avg != null ? r.temp_avg : r.temp_max,
    bucket_timestamp_seconds: r.bucket_timestamp_seconds,
    temp_min: r.temp_min,
    temp_max: r.temp_max,
    sample_count: r.temp_count ?? r.steps_count,
  }));
}

/**
 * Get aggregated data for sync to backend (only aggregated, not raw).
 * @param {string} deviceId
 * @param {{ intervalMinutes?: number, afterBucketSeconds?: number, limit?: number }} options
 */
export function getAggregatedForSync(deviceId, options = {}) {
  return getAggregatedForDisplay(deviceId, {
    ...options,
    fromSeconds: options.afterBucketSeconds,
  });
}

/**
 * Update last synced bucket for device (after successful sync).
 */
export function setLastSyncedBucket(deviceId, lastBucketSeconds) {
  if (!deviceId) return;
  try {
    const db = ensureDB();
    const now = new Date().toISOString();
    db.execute(
      `INSERT OR REPLACE INTO sync_metadata (device_id, last_synced_bucket_seconds, last_synced_at_iso)
       VALUES (?, ?, ?)`,
      [deviceId, lastBucketSeconds, now]
    );
  } catch (e) {
    if (__DEV__) console.warn('[HealthDataRepository] setLastSyncedBucket failed:', e);
  }
}

/**
 * Get last synced bucket timestamp for device.
 */
export function getLastSyncedBucket(deviceId) {
  if (!deviceId) return null;
  try {
    const db = ensureDB();
    const r = db.execute('SELECT last_synced_bucket_seconds FROM sync_metadata WHERE device_id = ?', [deviceId]);
    const res = r.results ?? r.rows;
    if (res && res.length > 0) return res[0].last_synced_bucket_seconds;
  } catch (e) {
    if (__DEV__) console.warn('[HealthDataRepository] getLastSyncedBucket failed:', e);
  }
  return null;
}

/**
 * Optional: delete raw measurements older than maxAgeSeconds to limit storage.
 */
export function pruneRawOlderThan(deviceId, maxAgeSeconds) {
  if (!deviceId || maxAgeSeconds <= 0) return 0;
  try {
    const db = ensureDB();
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
    const result = db.execute('DELETE FROM raw_measurements WHERE device_id = ? AND timestamp_seconds < ?', [deviceId, cutoff]);
    return result.rowsAffected ?? 0;
  } catch (e) {
    if (__DEV__) console.warn('[HealthDataRepository] pruneRawOlderThan failed:', e);
    return 0;
  }
}

/**
 * Re-aggregate from raw into buckets (e.g. after changing interval or backfilling).
 * Use when you want to rebuild aggregated_measurements from raw_measurements.
 */
export async function aggregateFromRaw(deviceId, intervalMinutes = AGGREGATION_INTERVAL_MINUTES) {
  const db = ensureDB();
  const r = db.execute(
    `SELECT timestamp_seconds, steps, temperature FROM raw_measurements WHERE device_id = ? ORDER BY timestamp_seconds`,
    [deviceId]
  );
  const res = r.results ?? r.rows ?? [];
  if (!res.length) return 0;
  const records = res.map(row => ({
    timestamp: row.timestamp_seconds,
    steps: row.steps,
    temperature: row.temperature,
  }));
  const byBucket = groupRecordsByBucket(records, intervalMinutes);
  let inserted = 0;
  await db.transaction(async (tx) => {
    for (const [bucketSeconds, recs] of byBucket) {
      const agg = computeBucketAggregates(recs);
      if (agg.temperature) {
        tx.execute(
          `INSERT OR REPLACE INTO aggregated_measurements (device_id, bucket_timestamp_seconds, interval_minutes, metric_type, avg_value, min_value, max_value, sample_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [deviceId, bucketSeconds, intervalMinutes, METRIC_TEMPERATURE, agg.temperature.avg, agg.temperature.min, agg.temperature.max, agg.temperature.count]
        );
        inserted++;
      }
      if (agg.steps) {
        tx.execute(
          `INSERT OR REPLACE INTO aggregated_measurements (device_id, bucket_timestamp_seconds, interval_minutes, metric_type, avg_value, min_value, max_value, sample_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [deviceId, bucketSeconds, intervalMinutes, METRIC_STEPS, agg.steps.max, agg.steps.min, agg.steps.max, agg.steps.count]
        );
        inserted++;
      }
    }
  });
  return inserted;
}

/**
 * Clear all stored data for a device (raw, aggregated, sync metadata).
 * Call when user or app clears device records so DB stays in sync with Redux.
 */
export function clearDeviceData(deviceId) {
  if (!deviceId) return;
  try {
    const db = ensureDB();
    db.execute('DELETE FROM raw_measurements WHERE device_id = ?', [deviceId]);
    db.execute('DELETE FROM aggregated_measurements WHERE device_id = ?', [deviceId]);
    db.execute('DELETE FROM sync_metadata WHERE device_id = ?', [deviceId]);
  } catch (e) {
    console.warn('[HealthDataRepository] clearDeviceData error:', e);
  }
}

export default {
  insertRaw,
  insertRawBatch,
  getAggregatedForDisplay,
  getAggregatedRecordsForUI,
  getAggregatedForSync,
  setLastSyncedBucket,
  getLastSyncedBucket,
  pruneRawOlderThan,
  aggregateFromRaw,
  clearDeviceData,
};
