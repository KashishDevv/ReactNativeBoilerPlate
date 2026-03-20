/**
 * Fixed time-bucket utilities for interval reshaping.
 * Maps any timestamp into a fixed bucket (e.g. 6-min: 00, 06, 12, 18, 24, 30, 36, 42, 48, 54).
 */

import { BUCKET_MINUTES, AGGREGATION_INTERVAL_MINUTES } from './schema';

/**
 * Get bucket start as Unix seconds for a given timestamp.
 * @param {number} timestampSeconds - Unix seconds (device or UTC).
 * @param {number} intervalMinutes - Bucket interval (e.g. 6 or 10).
 * @returns {number} Start of bucket in Unix seconds.
 */
export function getBucketStartSeconds(timestampSeconds, intervalMinutes = AGGREGATION_INTERVAL_MINUTES) {
  if (timestampSeconds == null || typeof timestampSeconds !== 'number' || !Number.isFinite(timestampSeconds)) return null;
  const date = new Date(timestampSeconds * 1000);
  if (isNaN(date.getTime())) return null;
  const utcMinutes = date.getUTCMinutes();
  const utcHours = date.getUTCHours();
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const minuteOfDay = utcHours * 60 + utcMinutes;
  const bucketIndex = Math.floor(minuteOfDay / intervalMinutes);
  const bucketMinuteOfDay = bucketIndex * intervalMinutes;
  const bucketMs = dayStart + bucketMinuteOfDay * 60 * 1000;
  return Math.floor(bucketMs / 1000);
}

/**
 * Get bucket start as Date for display.
 */
export function getBucketDate(timestampSeconds, intervalMinutes = AGGREGATION_INTERVAL_MINUTES) {
  const bucket = getBucketStartSeconds(timestampSeconds, intervalMinutes);
  return bucket != null ? new Date(bucket * 1000) : null;
}

/**
 * Group an array of records by bucket (bucket_seconds -> records).
 * @param {Array<{ timestamp, timestampDate?, steps?, temperature? }>} records
 * @param {number} intervalMinutes
 * @returns {Map<number, Array>} bucket_seconds -> records
 */
export function groupRecordsByBucket(records, intervalMinutes = AGGREGATION_INTERVAL_MINUTES) {
  const map = new Map();
  for (const r of records) {
    const ts = getRecordTimestampSeconds(r);
    if (ts == null) continue;
    const bucket = getBucketStartSeconds(ts, intervalMinutes);
    if (bucket == null) continue;
    if (!map.has(bucket)) map.set(bucket, []);
    map.get(bucket).push(r);
  }
  return map;
}

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

/**
 * Compute aggregates for a list of records (temperature: avg/min/max/count; steps: first, last, count).
 */
export function computeBucketAggregates(records) {
  if (!records || records.length === 0) {
    return { temperature: null, steps: null };
  }
  const temps = records.map(r => r.temperature).filter(v => v != null && typeof v === 'number');
  const stepsList = records.map(r => r.steps).filter(v => v != null && typeof v === 'number');
  const temperature = temps.length > 0
    ? {
        avg: temps.reduce((a, b) => a + b, 0) / temps.length,
        min: Math.min(...temps),
        max: Math.max(...temps),
        count: temps.length,
      }
    : null;
  const steps = stepsList.length > 0
    ? {
        min: Math.min(...stepsList),
        max: Math.max(...stepsList),
        count: stepsList.length,
        delta: stepsList.length > 1 ? Math.max(...stepsList) - Math.min(...stepsList) : stepsList[0],
      }
    : null;
  return { temperature, steps };
}

export { BUCKET_MINUTES, AGGREGATION_INTERVAL_MINUTES };
