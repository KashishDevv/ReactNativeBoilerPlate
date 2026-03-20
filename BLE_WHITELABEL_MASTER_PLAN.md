# BLE White-Label / Multi-Tenant Architecture — Master Plan

**Scope:** BLE implementation only (native iOS/Android + React Native JS layer + BLE-related UI).  
**Goal:** Make the same BLE core reusable across clients (e.g. DyreID and future brands) without rewriting logic, with minimal risk to the current stable app.  
**Principle:** Do NOT redesign working functionality — assume all features are stable.

This document is the single source of truth for the white-label BLE architecture. Platform-specific details live in:
- **Android:** `android/BLE_WHITELABEL_ARCHITECTURE.md`
- **iOS:** `ios/BLE_WHITELABEL_ARCHITECTURE.md`

---

## 1. High-Level Architecture

### 1.1 Three-Layer View

| Layer | Responsibility | Shared | Configurable |
|-------|----------------|--------|--------------|
| **Native BLE core** (iOS/Android) | Scan, connect, GATT, bonding, DFU, transaction queue, events | ✅ | — |
| **Client config (native)** | Service UUID, manufacturer ID, device name patterns, brand name, optional passkey | — | ✅ |
| **JS BLE layer** | BLEService, events, device list, sync, connection logs | ✅ | Via config from native |
| **UI screens** | ModernBLEManager, DeviceDetails, DFU, LiveData, History, Connection Log | ✅ | Copy/strings from config |

- **Core:** All BLE logic stays in one place; no hardcoded "DyreID", "Health Tag", `0x1234`, or service UUID in core.
- **Config:** One abstraction per platform (`BLEClientConfig`). Native sets it at launch; JS receives a read-only snapshot via a new bridge method so UI can show correct brand/device names.

### 1.2 Industry Patterns Used

- **Strategy / dependency injection:** Client-specific behavior behind `BLEClientConfig`; core depends on the interface, not on a concrete brand.
- **Single codebase:** One repo powers multiple branded builds (flavors/schemes); no duplication of BLE logic.
- **Build-time separation:** Separate app binaries per client (Gradle product flavors on Android, Xcode schemes + xcconfig on iOS) with isolated app identity, naming, and which config implementation is used.
- **Single source of truth:** Device filtering and UUIDs live only in config; no scattered literals in core or UI.

### 1.3 Target Layout (Conceptual)

```
bluetoothLE/
├── android/                    # Android BLE + config (see android/BLE_WHITELABEL_ARCHITECTURE.md)
│   ├── app/src/main/           # Shared BLE + DefaultBLEClientConfig
│   ├── app/src/dyreid/         # Optional: DyreIDBLEConfig
│   └── app/src/clientB/        # Future: ClientBBLEConfig
├── ios/                        # iOS BLE + config (see ios/BLE_WHITELABEL_ARCHITECTURE.md)
│   ├── config/                 # BLEClientConfig, DefaultBLEClientConfig
│   └── Configurations/        # Optional: DyreID.xcconfig, ClientB.xcconfig
├── src/
│   ├── constants/
│   │   ├── BLEConstants.js     # Protocol/shared constants only; client UUIDs from native
│   │   └── BLEAppConfig.js     # NEW: JS cache of BLE client config (from native)
│   ├── services/ble/
│   │   └── BLEService.js       # Uses BLEAppConfig for brand + device patterns; no literals
│   └── screens/
│       ├── BLEManager/         # ModernBLEManager, LiveDataScreen, HistoricalDataScreen, ConnectionLogScreen
│       ├── DeviceDetails/     # DeviceDetails, SyncRecordsScreen
│       └── DFU/               # DFUScreen
└── BLE_WHITELABEL_MASTER_PLAN.md  # This file
```

---

## 2. What Must Be Configurable (BLE Only)

| Concept | Current (DyreID) | Where used |
|--------|-------------------|------------|
| GATT service UUID (smart tag) | `0f0e0d0c-0b0a-0908-0706-050403020100` | Native scan/filter; JS service discovery |
| Manufacturer company ID | `0x1234` | Native ad parsing; JS constants (replace with config) |
| Device name patterns | "DyreID", "Health Tag" | Native filter; JS `isSmartTag` / UI fallbacks |
| Default passkey | optional | Native pairing |
| Brand name | "DyreID" | Native logs; **JS UI** (alerts, titles, "Settings → Bluetooth → X") |

---

## 3. Native Layer (Summary)

- **Android:** `BLEClientConfig` interface + `BLEClientConfigHolder` + `DefaultBLEClientConfig`; set in `MainApplication.onCreate()`. `SampleBridgeAndroid` and `BLEConnectionManager` use holder. Product flavor `dyreid` exists; add flavors per client.
- **iOS:** `BLEClientConfig` protocol + `BLEClientConfigHolder` + `DefaultBLEClientConfig`; set in `AppDelegate`. `BridgingCodeModule` uses holder. Use Xcode schemes + optional xcconfig per client.

No changes to BLE flow logic — only read from config instead of constants.

---

## 4. Exposing BLE Config to JavaScript

To keep UI and JS BLE layer client-agnostic, the app must get **brand name** and **accepted device name patterns** (and optionally smart tag service UUID) on the JS side.

### 4.1 New Native → JS Contract

Add a single bridge method that returns a read-only snapshot of BLE client config:

**Android:** In `SampleBridgeAndroid.java`, add:

```java
@ReactMethod
public void getBLEClientConfig(Promise promise) {
    try {
        BLEClientConfig c = BLEClientConfigHolder.get();
        WritableMap map = Arguments.createMap();
        map.putString("brandName", c.getBrandName());
        map.putArray("acceptedDeviceNamePatterns", Arguments.fromList(
            new ArrayList<>(c.getAcceptedDeviceNamePatterns())));
        map.putString("smartTagServiceUuid", c.getSmartTagServiceUuid());
        map.putInt("manufacturerId", c.getManufacturerId());
        promise.resolve(map);
    } catch (Exception e) {
        promise.reject("GET_BLE_CONFIG_ERROR", e.getMessage());
    }
}
```

**iOS:** In `BridgingCodeModule.swift` (or ObjC bridge), add:

```swift
@objc func getBLEClientConfig(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
  guard let config = BLEClientConfigHolder.get() else {
    reject("GET_BLE_CONFIG_ERROR", "BLE config not set", nil)
    return
  }
  resolve([
    "brandName": config.brandName,
    "acceptedDeviceNamePatterns": config.acceptedDeviceNamePatterns,
    "smartTagServiceUuid": config.smartTagServiceUUID.uuidString,
    "manufacturerId": config.manufacturerId
  ])
}
```

(Export the method in the bridge so React Native can call it.)

### 4.2 JS-Side Config Module

- **New file:** `src/constants/BLEAppConfig.js` (or `src/config/BLEAppConfig.js`)
  - On init (or first use), call native `getBLEClientConfig()` and cache result in memory.
  - Export: `getBrandName()`, `getAcceptedDeviceNamePatterns()`, `getSmartTagServiceUuid()`, `getManufacturerId()` (and optionally `getDefaultPasskey()` if exposed).
  - Fallback: if native fails or is missing, use current DyreID defaults so existing behavior is unchanged.

This gives JS a single place to read client-specific BLE branding and device acceptance; no hardcoded "DyreID" or "Health Tag" in UI or BLEService.

---

## 5. JS Layer and UI Screens — Current Hardcoding and Fixes

### 5.1 BLEService.js

| Location | Current | Action |
|----------|---------|--------|
| `isSmartTag` (e.g. device list / auto-connect) | `deviceName?.includes('Health Tag') \|\| deviceName?.includes('Smart Tag')` | Use `BLEAppConfig.getAcceptedDeviceNamePatterns()` and check name against list (e.g. `patterns.some(p => name?.includes(p))`). |

### 5.2 BLEConstants.js

| Item | Current | Action |
|------|---------|--------|
| `SMART_TAG` / `SMART_TAG_ALT` | Hardcoded UUID | Keep for backward compatibility or mark deprecated; JS code that needs “current client’s” UUID should use `BLEAppConfig.getSmartTagServiceUuid()`. |
| `MANUFACTURER_COMPANY_ID` | `0x1234` | Prefer reading from `BLEAppConfig.getManufacturerId()` where used; keep constant as fallback for DyreID default. |

### 5.3 ModernBLEManager.js

| Location | Current | Action |
|----------|---------|--------|
| Passkey-updated alert (iOS) | `"Find \"${device.name \|\| 'DyreID'}\""` | Use `BLEAppConfig.getBrandName()` as fallback when `device.name` is missing. |
| Screen title | "Smart Tags" | Either keep as generic "Smart Tags" or make configurable (e.g. `BLEAppConfig.getListTitle()` or keep fixed). |

### 5.4 DeviceDetails.js

| Location | Current | Action |
|----------|---------|--------|
| Passkey change alerts (iOS/Android) | `"Find \"${device?.name \|\| 'DyreID'}\""` | Use `BLEAppConfig.getBrandName()` as fallback. |
| "Smart Tag" label (commented) | Commented UI | If re-enabled, use config or generic "Device" / configurable label. |

### 5.5 DFUScreen.js

| Location | Current | Action |
|----------|---------|--------|
| Copy | No brand-specific strings found | No change required for BLE white-label; optional: use `getBrandName()` in any future “Report to [Brand]” or similar. |

### 5.6 LiveDataScreen.js, SyncRecordsScreen.js, HistoricalDataScreen.js, ConnectionLogScreen.js

| Screen | Current | Action |
|--------|---------|--------|
| LiveDataScreen | No DyreID/brand literals | No change. |
| SyncRecordsScreen (History) | No brand literals | No change. |
| HistoricalDataScreen | No brand literals | No change. |
| ConnectionLogScreen | "Connection log" title | No change (generic). |

### 5.7 UI Pages Audit Summary

| Page | Path | Brand / BLE config usage | Refactor action |
|------|------|--------------------------|-----------------|
| **ModernBLEManager** | `src/screens/BLEManager/ModernBLEManager.js` | Passkey alert uses `'DyreID'` fallback; title "Smart Tags" | Use `BLEAppConfig.getBrandName()` for fallback; keep or make "Smart Tags" configurable. |
| **DeviceDetails** | `src/screens/DeviceDetails/DeviceDetails.js` | Passkey alerts use `'DyreID'` fallback; commented "Smart Tag" label | Use `BLEAppConfig.getBrandName()` for fallback. |
| **DFU Screen** | `src/screens/DFU/DFUScreen.js` | No brand-specific strings | No BLE white-label change. |
| **LiveData** | `src/screens/BLEManager/LiveDataScreen.js` | None | No change. |
| **History Data** | `src/screens/DeviceDetails/SyncRecordsScreen.js`, `src/screens/BLEManager/HistoricalDataScreen.js` | None | No change. |
| **Connection logs** | `src/screens/BLEManager/ConnectionLogScreen.js` | Generic "Connection log" title | No change. |

Data flow for these screens remains unchanged; only copy that referenced "DyreID" or device name fallback is switched to config.

---

## 6. Build Strategy

### 6.1 Android (Gradle)

- **Already in place:** `flavorDimensions += ["client"]`, `productFlavors { dyreid { ... } }`, `debuggableVariants = ["dyreidDebug"]`.
- **Per client:** Add a new flavor (e.g. `clientB`) and a new source set `src/clientB/` with `ClientBBLEConfig` implementing `BLEClientConfig`. In `MainApplication` (or a flavor-specific override), set `BLEClientConfigHolder.set(new ClientBBLEConfig())`. No BLE core changes.

### 6.2 iOS (Xcode)

- **Schemes:** One scheme per client (e.g. DyreID, ClientB) with same target.
- **Config selection:** Either (a) single default config for now, or (b) compile-time flag / xcconfig and in `AppDelegate` set `BLEClientConfigHolder.set(DyreIDBLEConfig())` or `ClientBBLEConfig()`.
- **xcconfig (optional):** Per-client bundle ID and display name in `Configurations/DyreID.xcconfig`, etc.

### 6.3 Feature Flags (per client)

- **Compile-time:** Different `BLEClientConfig` per flavor/scheme = different UUIDs, name patterns, brand. No separate BLE feature-flag framework needed initially.
- **Runtime (future):** If you need e.g. “DFU only for some clients”, add `isDfuEnabled(): Bool` to `BLEClientConfig` and gate DFU entry in native/JS accordingly.

---

## 7. Step-by-Step Refactor Roadmap

### Phase 1: Expose config to JS (no behavior change)

1. **Native:** Implement `getBLEClientConfig` on Android and iOS; return `brandName`, `acceptedDeviceNamePatterns`, `smartTagServiceUuid`, `manufacturerId`.
2. **JS:** Add `BLEAppConfig.js` that calls `getBLEClientConfig` and caches result; expose getters with DyreID defaults as fallback.
3. **Verification:** Existing app runs unchanged; config returns current DyreID values.

### Phase 2: Remove JS and UI hardcoding

4. **BLEService.js:** Replace `isSmartTag` logic with `BLEAppConfig.getAcceptedDeviceNamePatterns()` (and optional service UUID from config).
5. **ModernBLEManager.js:** Replace `'DyreID'` fallback in passkey alert with `BLEAppConfig.getBrandName()`.
6. **DeviceDetails.js:** Replace `'DyreID'` fallback in passkey alerts with `BLEAppConfig.getBrandName()`.
7. **BLEConstants.js:** Document that client-specific UUID/manufacturer ID should be read from `BLEAppConfig` where needed; keep constants as fallback for default client.
8. **Verification:** Full regression (scan, connect, bond, GATT, DFU, LiveData, History, Connection log); no behavior change for DyreID.

### Phase 3: Optional second client

9. Add a second flavor/scheme and second config class; set holder to new config in that build.
10. Smoke-test second client build; confirm different brand name and device patterns in UI and behavior.

### Phase 4: Cleanup and docs

11. Grep for remaining "DyreID", "Health Tag", "Smart Tag" in BLE/UI code and remove or route through config.
12. Document for team: how to add a new client (flavor/scheme + new config class + optional xcconfig).

---

## 8. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Regressions in BLE flow | Phase 1–2 keep same effective config (DyreID); no new logic. Full regression test before Phase 3. |
| Config not set / nil | Native holder returns default config; JS `BLEAppConfig` falls back to DyreID defaults on error. |
| Flavor/scheme build issues | Keep single default (dyreid) working; add second client only when needed. |
| React Native / Metro | `debuggableVariants` already set for dyreid; add new variants when adding flavors. |
| Scattered literals | Single pass to replace literals; then grep to verify no "DyreID" / "Health Tag" / "Smart Tag" / `0x1234` in core or UI. |

---

## 9. Implementation TODO List (BLE Only)

**Status:** All required items (N1–N7, J1–J5) are **completed**. Optional items (O1–O4) can be done when adding a second client or scheme.

### Native (already done per platform docs)

- [x] **N1** Android: `BLEClientConfig` + `BLEClientConfigHolder` + `DefaultBLEClientConfig`; set in MainApplication.
- [x] **N2** Android: Bridge and BLEConnectionManager use config for UUID, manufacturer ID, device name patterns.
- [x] **N3** iOS: `BLEClientConfig` + `BLEClientConfigHolder` + `DefaultBLEClientConfig`; set in AppDelegate.
- [x] **N4** iOS: BridgingCodeModule uses config for UUID, manufacturer ID, device name patterns.
- [x] **N5** Android: Product flavor `dyreid` and `debuggableVariants`.
- [x] **N5b** Android: BLEForegroundService notification title uses `BLEClientConfig.getBrandName()` (see android doc item 6).

### Expose config to JS

- [x] **N6** Android: Add `getBLEClientConfig(Promise)` in SampleBridgeAndroid; return brandName, acceptedDeviceNamePatterns, smartTagServiceUuid, manufacturerId.
- [x] **N7** iOS: Add `getBLEClientConfig` in bridge; return same fields.

### JS and UI

- [x] **J1** Add `src/constants/BLEAppConfig.js`: call native `getBLEClientConfig`, cache, expose getters; fallback to DyreID defaults.
- [x] **J2** BLEService.js: Replace `isSmartTag` (Health Tag / Smart Tag) with `BLEAppConfig.isAcceptedDeviceName()` / `getAcceptedDeviceNamePatterns()`.
- [x] **J3** ModernBLEManager.js: Replace `device.name || 'DyreID'` in passkey alert with `device.name || BLEAppConfig.getBrandName()`.
- [x] **J4** DeviceDetails.js: Replace `device?.name || 'DyreID'` in passkey alerts with `device?.name || BLEAppConfig.getBrandName()`.
- [x] **J5** BLEConstants.js: Prefer `BLEAppConfig` for client-specific UUID/manufacturer where used; document fallback.

### Optional / later (when adding second client)

- [ ] **O1** Add DyreID scheme (iOS) and optionally `DyreID.xcconfig`.
- [ ] **O2** (Optional) Add `dyreid` source set with explicit `DyreIDBLEConfig` for Android.
- [ ] **O3** When adding new client: new flavor/scheme + new `*BLEConfig` + optional xcconfig; no BLE core changes.
- [ ] **O4** Feature flag in config (e.g. `isDfuEnabled`) if required per client.

---

## 10. Verification Checklist (after refactor)

- **Native (Android):** No client constants in BLE core; all from `BLEClientConfig` / Holder. BLEForegroundService persistent and connection notifications use `getBrandName()`.
- **Native (iOS):** No client constants in BridgingCodeModule; all from `BLEClientConfig` / Holder.
- **JS:** No hardcoded "DyreID", "Health Tag", "Smart Tag" in BLEService or BLE-related screens; use `BLEAppConfig` for brand and device patterns.
- **UI:** Passkey and “Forget device” alerts use `getBrandName()` for fallback device name.
- **Regression:** Scan, connect, bond, GATT read/write, DFU, LiveData, History (SyncRecords), Connection log — all behave as before for DyreID build.
- **New client:** Adding a new flavor/scheme and config class produces a build with different brand name and device patterns without touching BLE core or shared UI logic.

---

## 11. File-Level Summary

| File | Change |
|------|--------|
| **New:** `src/constants/BLEAppConfig.js` | Fetch and cache BLE client config from native; expose getters; DyreID fallback. |
| **Edit:** `BLEService.js` | `isSmartTag` from `BLEAppConfig.getAcceptedDeviceNamePatterns()`. |
| **Edit:** `ModernBLEManager.js` | Passkey alert fallback: `BLEAppConfig.getBrandName()`. |
| **Edit:** `DeviceDetails.js` | Passkey alert fallback: `BLEAppConfig.getBrandName()`. |
| **Edit:** `BLEConstants.js` | Document; use BLEAppConfig for client UUID/manufacturer where needed. |
| **Edit:** Android bridge | Add `getBLEClientConfig`. |
| **Edit:** iOS bridge | Add `getBLEClientConfig`. |

**No change (by design):** DFUScreen, LiveDataScreen, SyncRecordsScreen, HistoricalDataScreen, ConnectionLogScreen — no brand literals to replace. Logic remains shared.

---

## 12. Tools and Best Practices (Enterprise / Scalable BLE Apps)

- **Config vs core:** Keep all client-specific values (UUIDs, manufacturer ID, device name patterns, brand name) behind a single config abstraction; core and UI read from it. No magic strings in business logic.
- **Single codebase:** One repo, multiple builds (Gradle flavors, Xcode schemes). Reduces drift and speeds feature rollout across brands.
- **Bridge contract:** One method `getBLEClientConfig` from native to JS keeps the contract small and testable; JS caches and exposes getters so screens do not call native repeatedly.
- **Regression safety:** Refactor in phases: first expose config and add JS module with same values (no behavior change), then replace literals, then add a second client. Run full BLE + UI regression after Phase 2.
- **Feature flags:** Keep BLE feature toggles (e.g. DFU per client) in the same config protocol so adding a client does not scatter conditionals.

---

## 13. References

- Android details: `android/BLE_WHITELABEL_ARCHITECTURE.md`
- iOS details: `ios/BLE_WHITELABEL_ARCHITECTURE.md`
- Industry: Single codebase white-label, build-time separation (flavors/schemes), strategy pattern for config, BLE device filtering by service UUID and name patterns.
