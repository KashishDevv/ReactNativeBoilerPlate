/**
 * Local database module for health tag data.
 * - HealthDataDB: init/close SQLite.
 * - HealthDataRepository: insert raw, aggregated queries, sync metadata.
 * - timeBuckets: fixed 6-min bucket utilities.
 */

export { init, close, getDB, isOpen } from './HealthDataDB';
export { default as HealthDataDB } from './HealthDataDB';
export { default as HealthDataRepository } from './HealthDataRepository';
export {
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
} from './HealthDataRepository';
export * from './schema';
export * from './timeBuckets';
