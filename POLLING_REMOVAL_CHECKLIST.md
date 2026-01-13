# Polling Removal Checklist

## Overview
With the new flow, the tag sends notifications automatically, so **all app-side polling code must be removed**.

---

## iOS (`ios/BridgingCodeModule.swift`)

### Variables/Maps to Remove:
- [ ] `deviceStatusPollingTimers: [String: Timer]` (line 262)
- [ ] `nativePollingActive: [String: Bool]` (line 264)
- [ ] `pollingReadTimestamps: [String: Date]` (line 267)
- [ ] `POLLING_READ_WINDOW_MS` constant (line 268)

### Methods to Remove:
- [ ] `startDeviceStatusPolling(deviceId:intervalSeconds:)` (line 1271)
- [ ] `stopDeviceStatusPolling(deviceId:)` (line 1315)
- [ ] `isNativePollingActive(deviceId:resolver:rejecter:)` (line 1327)

### Method Calls to Remove:
- [ ] `startDeviceStatusPolling()` call in `sendDataAcquisitionAndLiveNotifications()` (line 1821)
- [ ] `startDeviceStatusPolling()` call in `handleSetDataAcquisitionIntervalResponse()` (line 2821)
- [ ] `stopDeviceStatusPolling()` call in `disconnectFromDevice()` (line 2925)
- [ ] `stopDeviceStatusPolling()` call in `unpairDevice()` (line 3055)
- [ ] `stopDeviceStatusPolling()` call in `factoryReset()` (line 3149)
- [ ] `stopDeviceStatusPolling()` call in `cleanupDevice()` (line 4086)
- [ ] All references to `pollingReadTimestamps` (lines 1307, 1623-1631)

### Event to Remove:
- [ ] `PollingStarted` event emission (line 1285)
- [ ] `PollingStarted` in `supportedEvents` (line 109)

### Logic to Update:
- [ ] Remove `isFromPolling` flag calculation (lines 1620-1635)
- [ ] Remove `isFromPolling` from `DeviceDataUpdated` event (line 1653)
- [ ] Update auto-sync trigger logic (if any polling-based triggers exist)

### Bridge Method to Remove:
- [ ] `isNativePollingActive` in `BridgingCodeModule.m` (line 37)

---

## Android (`android/app/src/main/java/com/reactnativeboilerplate/SampleBridgeAndroid.java`)

### Variables/Maps to Remove:
- [ ] `deviceStatusPollingTimers: Map<String, ScheduledFuture<?>>` (line 654)
- [ ] `pollingReadTimestamps: Map<String, Long>` (line 656)
- [ ] `POLLING_READ_WINDOW_MS` constant (line 657)
- [ ] `pollingStartDelays: Map<String, ScheduledFuture<?>>` (line 687)

### Methods to Remove:
- [ ] `startDeviceStatusPolling(deviceId, intervalSeconds)` (line 10094)
- [ ] `startDeviceStatusPollingWhenReady(deviceId, intervalSeconds)` (line 10064)
- [ ] `stopDeviceStatusPolling(deviceId)` (line 10134)

### Method Calls to Remove:
- [ ] `startDeviceStatusPollingWhenReady()` call in `onNotificationEnabled()` (line 2839)
- [ ] `startDeviceStatusPolling()` call in `handleSetDataAcquisitionIntervalResponse()` (line 4536)
- [ ] `stopDeviceStatusPolling()` call in `unpairDevice()` (line 4643)
- [ ] `stopDeviceStatusPolling()` call in `factoryReset()` (line 4769)
- [ ] `stopDeviceStatusPolling()` call in `repairDevice()` (line 4869)
- [ ] `stopDeviceStatusPolling()` call in `disconnectFromDevice()` (line 8967)
- [ ] `stopDeviceStatusPolling()` call in `cleanupDevice()` (line 8979)
- [ ] `startDeviceStatusPolling()` call in notification handler (line 7577)
- [ ] All references to `pollingReadTimestamps` (lines 10123, 3651-3669)

### Logic to Update:
- [ ] Remove `isFromPolling` flag calculation (lines 3651-3669)
- [ ] Remove `isFromPolling` from `DeviceDataUpdated` event (lines 3670, 3695)
- [ ] Remove polling delay timer logic (lines 7570-7579)
- [ ] Update auto-sync trigger logic (if any polling-based triggers exist)

---

## JavaScript (`src/services/ble/BLEService.js`)

### Variables/Maps to Remove:
- [ ] `demoPollingActive: Map` (line 4323)
- [ ] `fallbackPollingTimers: Map` (line 160) - if only used for polling
- [ ] `fallbackPollingInterval` (line 161) - if only used for polling

### Methods to Remove:
- [ ] `startDemoDevicePolling(deviceId, pollIntervalMs)` (line 4321)
- [ ] `stopDemoDevicePolling(deviceId)` (line 4482)
- [ ] `handlePollingStarted(eventData)` (line 416)

### Event Listeners to Remove:
- [ ] `PollingStarted` listener for iOS (line 417)
- [ ] `PollingStarted` listener for Android (line 531)

### Logic to Update:
- [ ] Remove polling callback setup in `initDemoTagMode()` (lines 247-268)
- [ ] Remove `startDemoDevicePolling()` call in `connectToDemoDevice()` (line 4242)
- [ ] Remove `isFromPolling` flag extraction (lines 2103-2123)
- [ ] Remove `isFromPolling` flag handling in `handleDeviceStatusUpdate()` (lines 2299-2303, 2483-2517)
- [ ] Update `maybeTriggerAutoSyncFromDeviceStatus()` to remove `isFromPolling` check (line 5950)
- [ ] Remove polling-related comments (line 5939-5947)

### Auto-Sync Logic Updates:
- [ ] Update `maybeTriggerAutoSyncFromDeviceStatus()` to trigger on all notifications (not just polling reads)
- [ ] Remove `isFromPolling` from conditions check (line 5962-5978)
- [ ] Update auto-sync trigger logic to work with notifications instead of polling

---

## DemoTag (`src/services/ble/DemoTagSimulator.js`)

### Variables/Maps to Remove:
- [ ] `pollingIntervals: Map` (line 41)
- [ ] `onPollingIntervalChanged: callback` (line 48)

### Methods to Remove:
- [ ] `getPollingInterval(deviceId)` (line 1024)
- [ ] `setPollingIntervalCallback(callback)` (line 1049)
- [ ] `hasPollingIntervalCallback()` (line 1057)

### Logic to Update:
- [ ] Remove polling interval callback in `SET_DATA_INTERVAL` command (lines 638-644)
- [ ] Remove `pollingIntervals` references in `SET_DATA_INTERVAL` (line 618)
- [ ] Remove `pollingIntervals` references in `FACTORY_RESET` (line 769)
- [ ] Remove `pollingIntervals` cleanup in `cleanup()` (line 1091)
- [ ] Remove `pollingIntervals` references in `getPollingInterval()` calls (lines 343, 467, 726)

### Notification Updates:
- [ ] Update `startNotifications()` to use data interval directly (not polling interval)
- [ ] Remove polling interval references from notification setup

---

## Auto-Sync Trigger Updates

### Current Behavior:
- Auto-sync triggered when `isFromPolling=true` AND records available
- Polling reads marked with `isFromPolling` flag

### New Behavior:
- Auto-sync triggered by tag notifications (when records available)
- No `isFromPolling` flag needed

### Files to Update:
- [ ] `src/services/ble/BLEService.js:5950` - Remove `isFromPolling` check
- [ ] `src/services/ble/BLEService.js:5700-6154` - Update auto-sync logic
- [ ] Update conditions check to remove `isFromPolling` requirement

---

## Testing Checklist

After removing polling code:

- [ ] Verify notifications are received from tag automatically
- [ ] Verify auto-sync triggers from notifications (not polling)
- [ ] Verify no polling timers are created
- [ ] Verify no `PollingStarted` events are emitted
- [ ] Verify `isFromPolling` flag is no longer used
- [ ] Verify demo tag still works (if using demo mode)
- [ ] Verify connection/disconnection cleanup doesn't reference polling
- [ ] Verify factory reset/unpair doesn't reference polling
- [ ] Verify SET_DATA_INTERVAL command doesn't reference polling

---

## Estimated Impact

- **Lines of Code to Remove**: ~500+ lines
- **Files Modified**: 4 main files (iOS, Android, JS, DemoTag)
- **Complexity**: Medium-High (requires careful removal to avoid breaking existing functionality)
- **Risk**: Medium (polling is currently a workaround, removing it assumes tag will send notifications)

---

## Notes

1. **Keep-alive reads** may still be needed (different from polling) - verify if these should remain
2. **Manual reads** (user-initiated) should still work - don't remove read capability
3. **DemoTag** may need to simulate notifications instead of polling
4. **Auto-sync logic** needs careful update to ensure it still triggers correctly

