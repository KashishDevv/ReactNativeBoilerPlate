# BLE White-Label / Multi-Tenant Architecture (Android)

**Scope:** Android BLE native layer only.  
**Goal:** Make the same BLE core reusable across clients (e.g. DyreID and future brands) without rewriting logic, with minimal risk to the current stable app.

---

## 1. High-Level Architecture

### 1.1 Principle: Config vs Core

| Layer | Responsibility | Stays shared | Becomes configurable |
|-------|----------------|--------------|------------------------|
| **BLE Core** | Scanning, connecting, GATT, bonding, DFU, foreground service, transaction queue | ✅ | — |
| **Client config** | Which devices to accept, service UUID, manufacturer ID, device name patterns | — | ✅ |

- **Core:** `BLEConnectionManager`, `BLEForegroundService`, `SampleBridgeAndroid` (bridge + GATT ops), `TransactionManager`, `AdvertisementDataParser`, `BLEUtils`, `BLEError`, `BLEIdGenerator`, `BLELogLevel`.
- **Config:** One abstraction (e.g. `BLEClientConfig`) that core code reads. No hardcoded "DyreID", "Health Tag", `0x1234`, or `SMART_TAG_SERVICE_UUID` in core.

### 1.2 Target Layout (conceptual)

```
android/
├── app/
│   ├── build.gradle              # productFlavors (dyreid, clientB, ...)
│   └── src/
│       ├── main/                 # Shared BLE code + default config
│       │   └── java/.../
│       │       ├── BLEConnectionManager.java
│       │       ├── BLEForegroundService.java
│       │       ├── SampleBridgeAndroid.java   # Uses BLEClientConfig
│       │       ├── config/
│       │       │   ├── BLEClientConfig.java   # Interface
│       │       │   └── DefaultBLEClientConfig.java  # DyreID defaults (for main)
│       │       └── ...
│       ├── dyreid/               # Optional: DyreID-specific overrides
│       │   └── java/.../config/DyreIDBLEConfig.java
│       └── clientB/               # Future client
│           └── java/.../config/ClientBBLEConfig.java
```

- **main** holds all BLE logic and a default config (current DyreID behavior).
- **Flavor source sets** only provide a different `BLEClientConfig` implementation (and optionally resources). No BLE logic duplicated.

### 1.3 Industry Patterns Used

- **Strategy / dependency injection:** Client-specific behavior behind `BLEClientConfig`; bridge and connection manager depend on the interface, not on a concrete brand.
- **Product flavors:** One build variant per client (e.g. `dyreidDebug`, `dyreidRelease`); each can have its own `applicationId`, app name, and config implementation.
- **BuildConfig / resValue:** For non-BLE brand (app name, API URL) if needed later; BLE-specific values live in `BLEClientConfig` for clarity and testability.
- **Single source of truth:** Device filtering and UUIDs live only in config; no scattered string literals in core.

---

## 2. BLE Client Configuration Abstraction

### 2.1 What Must Be Configurable (BLE only)

From the current codebase, these are the client-specific values:

| Concept | Current (DyreID) | Config contract |
|--------|-------------------|------------------|
| GATT service UUID for “smart tag” | `0f0e0d0c-0b0a-0908-0706-050403020100` | `getSmartTagServiceUuid()` |
| Manufacturer company ID | `0x1234` | `getManufacturerId()` |
| Device name patterns (scan filter) | "DyreID", "Health Tag" | `getAcceptedDeviceNamePatterns()` (list or predicate) |
| Default passkey (if used) | `"123456"` | `getDefaultPasskey()` (optional) |

### 2.2 Interface (recommended)

```java
public interface BLEClientConfig {
    String getSmartTagServiceUuid();
    int getManufacturerId();
    /** Names or substrings that identify accepted devices, e.g. ["DyreID", "Health Tag"] */
    List<String> getAcceptedDeviceNamePatterns();
    /** Optional; null = use device/flow default */
    String getDefaultPasskey();
    /** Human-readable brand name for logs/notifications, e.g. "DyreID" */
    String getBrandName();
}
```

- **Core code** (e.g. `SampleBridgeAndroid`, `BLEConnectionManager`) receives `BLEClientConfig` (e.g. via constructor or singleton) and uses it everywhere instead of constants.
- **Default implementation:** `DefaultBLEClientConfig` (in `main`) returns current DyreID values so behavior is unchanged when no flavor is used.
- **Per flavor:** Each flavor can provide its own implementation (e.g. `DyreIDBLEConfig`, `ClientBBLEConfig`) that returns that client’s UUID, manufacturer ID, and name patterns.

---

## 3. Gradle Strategy (Flavors + BuildConfig)

### 3.1 Flavor dimensions (optional but useful)

- **Dimension 1: `client`** — which brand (dyreid, clientB, …).  
- Later you can add **`environment`** (staging, prod) if needed.

Example:

```groovy
flavorDimensions += ["client"]
productFlavors {
    dyreid {
        dimension "client"
        applicationIdSuffix ""   // or ".dyreid" if you want separate app
        versionNameSuffix "-dyreid"
        // BLE config: use default (DyreID) via source set dyreid/config
    }
    // clientB {
    //     dimension "client"
    //     applicationIdSuffix ".clientb"
    //     versionNameSuffix "-clientb"
    // }
}
```

### 3.2 Source sets

- **main:** Shared BLE code + `DefaultBLEClientConfig` (DyreID).
- **dyreid:** Only `DyreIDBLEConfig` (or reuse default by not overriding).
- **clientB:** `ClientBBLEConfig` with different UUID/patterns.

This keeps BLE logic in one place and limits flavor code to “which config”.

### 3.3 BuildConfig (optional for BLE)

Use BuildConfig for app-level brand (e.g. API base URL, feature flags). BLE-specific values are better in `BLEClientConfig` so:

- They stay in one place and are easy to unit test.
- You can swap config at runtime in tests or future dynamic config.

If you prefer some BLE values in Gradle:

```groovy
dyreid {
    buildConfigField "String", "BLE_SERVICE_UUID", "\"0f0e0d0c-0b0a-0908-0706-050403020100\""
    buildConfigField "int", "BLE_MANUFACTURER_ID", "0x1234"
}
```

Then a small `BuildConfigBLEClientConfig` can wrap `BuildConfig` and implement `BLEClientConfig`. Recommendation: start with a single `BLEClientConfig` implementation (default + flavor-specific classes) and add BuildConfig later if needed.

### 3.4 React Native and debuggable variants

In `app/build.gradle`:

```groovy
react {
    debuggableVariants = ["dyreidDebug"]  // add others, e.g. "clientBDebug", when you add flavors
}
```

---

## 4. Feature Flags (per client)

- **Compile-time:** Different `BLEClientConfig` per flavor = different “features” (e.g. which UUID/name patterns). No need for a separate BLE feature-flag framework at first.
- **Runtime (future):** If you later need runtime toggles (e.g. enable DFU only for some clients), options:
  - Add to `BLEClientConfig` (e.g. `isDfuEnabled()`) and implement per flavor.
  - Or a small feature-flag module that reads from remote config / SharedPreferences; BLE code checks the flag before running DFU. Prefer keeping BLE behind `BLEClientConfig` for consistency.

---

## 5. Step-by-Step Refactor Roadmap

### Phase 1: Introduce config (no flavors yet)

1. Add `config/BLEClientConfig.java` (interface) and `config/DefaultBLEClientConfig.java` (current DyreID values) under `main`.
2. Replace all usages of `SMART_TAG_SERVICE_UUID`, `SMART_TAG_MANUFACTURER_ID`, and "DyreID"/"Health Tag" in:
   - `SampleBridgeAndroid.java`
   - `BLEConnectionManager.java`
   with calls to a single `BLEClientConfig` instance (e.g. provided by `MainApplication` or a small holder).
3. Ensure `BLEForegroundService` uses config for any brand-dependent strings (e.g. notification text) if present.
4. Run full regression (scan, connect, bond, GATT, DFU). No behavior change expected.

### Phase 2: Gradle flavors (single client: DyreID)

5. Add `productFlavors { dyreid { ... } }` and set `debuggableVariants`.
6. Optionally add `src/dyreid` with a `DyreIDBLEConfig` that delegates to default or repeats same values.
7. Build `dyreidDebug` / `dyreidRelease` and smoke-test. Still no behavior change.

### Phase 3: Second client (when needed)

8. Add `clientB` flavor and `ClientBBLEConfig` with that client’s UUID, manufacturer ID, and name patterns.
9. Implement “is device accepted” in bridge/scan callback using only `BLEClientConfig` (no hardcoded names).
10. Test both flavors.

### Phase 4 (optional): Cleanup and hardening

11. Remove any remaining DyreID-specific literals from core; add unit tests for `BLEClientConfig` and for “accept device” logic.
12. Document for your team: how to add a new client (new flavor + new config class).

---

## 6. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Regressions in BLE flow | Phase 1 is refactor-only: same values in `DefaultBLEClientConfig`. No new logic. |
| Flavor build issues | Introduce one flavor (dyreid) first; keep `main` buildable without flavors if needed (e.g. keep defaultConfig applicationId). |
| React Native / Metro | Set `debuggableVariants` so debug builds work; test `assembleDyreidRelease` early. |
| Scattered literals | Single pass to find "DyreID", "Health Tag", `0x1234`, `SMART_TAG_SERVICE_UUID` and replace with config; then grep to verify none left in core. |

---

## 7. Implementation TODO List (BLE only)

- [x] **1** Create `BLEClientConfig` interface (in `main`).
- [x] **2** Create `DefaultBLEClientConfig` with current DyreID values (service UUID, manufacturer ID, name list, optional default passkey, brand name).
- [x] **3** Provide `BLEClientConfig` via `BLEClientConfigHolder`; set in `MainApplication.onCreate()`.
- [x] **4** Refactor `SampleBridgeAndroid`: take `BLEClientConfig`; replace all `SMART_TAG_SERVICE_UUID`, `SMART_TAG_MANUFACTURER_ID`, and "DyreID"/"Health Tag" logic with config methods; implement “accepted device” using `getAcceptedDeviceNamePatterns()` and `getSmartTagServiceUuid()`.
- [x] **5** Refactor `BLEConnectionManager`: use `BLEClientConfigHolder.get().getSmartTagServiceUuid()` for scan filter.
- [x] **6** BLEForegroundService: persistent notification title and connection event notification title use `BLEClientConfigHolder.get().getBrandName()` when config is set.
- [x] **7** Add `productFlavors { dyreid { ... } }` and `debuggableVariants = ["dyreidDebug"]`. Use `assembleDyreidDebug` / `assembleDyreidRelease`.
- [ ] **8** (Optional) Add `dyreid` source set with `DyreIDBLEConfig` that mirrors default.
- [x] **9** Remove remaining hardcoded BLE client constants from core; verify with grep.
- [ ] **10** When adding a new client: add flavor + new `*BLEConfig` implementation; no changes to BLE core.

---

## 8. File-Level Summary

| File | Change |
|------|--------|
| **New:** `config/BLEClientConfig.java` | Interface for service UUID, manufacturer ID, name patterns, optional passkey, brand name. |
| **New:** `config/DefaultBLEClientConfig.java` | DyreID implementation (current constants). |
| **Edit:** `SampleBridgeAndroid.java` | Receive `BLEClientConfig`; use it for scan filter, manufacturer ID, service UUID, device name matching, and any passkey default. |
| **Edit:** `BLEConnectionManager.java` | Receive or resolve `BLEClientConfig`; use for service UUID in scan filter. |
| **Edit:** `BLEForegroundService.java` | Use config for brand name in notifications (if applicable). |
| **Edit:** `MainApplication.kt` | Create and hold `BLEClientConfig`; pass to bridge/connection manager (or expose via getter). |
| **Edit:** `app/build.gradle` | Add `productFlavors` (dyreid first), `debuggableVariants`. |
| **Optional:** `dyreid/.../DyreIDBLEConfig.java` | Explicit DyreID config class for flavor. |

This keeps the BLE implementation shared, client-agnostic, and ready for multiple builds (flavors) with minimal risk and no redesign of working functionality.

---

## 9. Verification (double-check)

- **No client constants in core:** `BLEConnectionManager` and `SampleBridgeAndroid` have no hardcoded `SMART_TAG_SERVICE_UUID`, `SMART_TAG_MANUFACTURER_ID`, `0x1234`, or `"DyreID"` / `"Health Tag"`; all such values come from `BLEClientConfig` / `DefaultBLEClientConfig`.
- **Config wiring:** `MainApplication.onCreate()` sets `BLEClientConfigHolder.set(DefaultBLEClientConfig())`; bridge and connection manager use `BLEClientConfigHolder.get()`.
- **Cleanup done:** Duplicate imports removed from `SampleBridgeAndroid`; debug-only scan callback block (verbose per-device manufacturer-data logging) and empty `if (mfgData != null)` block removed.

---

## 10. SampleBridgeAndroid.java size

The file remains large (~13k lines) because it is a single React Native native module that implements the full BLE surface: scanning, connection, GATT ops, bonding, DFU, foreground service, and many `@ReactMethod` entry points. This is a common pattern for RN bridges. Further reduction would require extracting separate classes (e.g. GattOps, DFU, ScanHandler) and passing context/bridge references—a larger refactor. The current cleanup removed only obvious cruft (duplicate imports, unused debug block, empty blocks).

---

## 11. App-level reuse (beyond BLE)

**Can we make the app reusable by others or spin up a new app with the same functionality?**  
Yes. The current codebase can support this. It’s not the main driver, but it’s reasonable to keep in mind when choosing where to put config and copy.

### What’s already in place

| Layer | Status |
|-------|--------|
| **Android BLE (native)** | ✅ Client-agnostic. Device filtering, service UUID, manufacturer ID, and name patterns come from `BLEClientConfig`. Adding a new client = new flavor + new config class; no BLE logic changes. |
| **Android build** | ✅ Product flavor `dyreid` exists. New clients = new flavor with their own `applicationIdSuffix`, `versionNameSuffix`, and (optionally) app name/icon via flavor source sets. |

### What to consider when making design choices

These are the main touchpoints if you want one codebase to power multiple brands or separate apps. You don’t have to do them all up front; treat them as “when we touch this, we do it in a reusable way.”

| Area | Current | Reuse-friendly approach |
|------|---------|--------------------------|
| **API base URL** | `src/constants/Urls.js`: hardcoded `https://api.staging.dyreid.no/api/` | Single place (e.g. `Urls.js` or env) that reads from build/env: `process.env.API_BASE_URL` or a small `AppConfig` that flavors or env set. No logic change, only config source. |
| **App name & bundle ID** | Android: `strings.xml` + `applicationId` in Gradle. iOS: bundle id in project. | Per-client: use flavor `resValue` / `applicationIdSuffix` and flavor-specific `strings.xml` (or xcconfig on iOS). Same codebase, different names/IDs per build. |
| **User-facing copy (fallbacks)** | A few strings use `'DyreID'` when device name is missing (e.g. “Find [device] in Bluetooth”): `ModernBLEManager.js`, `DeviceDetails.js`. | Optional: one constant or small `Branding` object (e.g. `BRAND_DEVICE_NAME_FALLBACK: 'DyreID'`) so one change updates all. Or leave as-is until you add a second brand. |
| **“Is this our device?” in JS** | `BLEService.js` uses `deviceName?.includes('Health Tag')` / `'Smart Tag'` for `isSmartTag`. | Native already filters by config. If JS needs the same list for UI, consider a tiny JS config (e.g. `ACCEPTED_DEVICE_NAME_SUBSTRINGS`) or an API that returns client config; only if you need it. |
| **BLE constants in JS** | `src/constants/BLEConstants.js`: SMART_TAG UUID, manufacturer ID, etc. | For a second hardware client with different UUIDs, you’d add a JS-side config (or read from native). For “same hardware, different brand” (DyreID vs another app using same tag), native config is enough; JS can stay as-is. |

### Two ways to reuse

1. **Same app, rebranded (white-label)**  
   One codebase, multiple builds: different app name, icon, API URL, and (if needed) BLE config per flavor. Android: add a flavor and point `BLEClientConfigHolder` to that client’s config. Optionally add env or build-time config for API base and copy. No second repo.

2. **New app for another client (same functionality)**  
   Same idea: new flavor (or new app that uses the same core). Share the BLE and app logic; differ by applicationId, app name, API URL, and BLE config. Could be the same repo + flavor or a separate repo that depends on a shared library; flavors are usually enough to start.

### Summary

- **Yes, you can do this with the current codebase.**  
- BLE and build structure already support multiple clients.  
- For full app reuse, the main levers are: **API URL**, **app name/bundle ID**, and optionally **a few user-facing strings** and **JS-side device-name checks**.  
- Introduce these when you touch the relevant code (e.g. when adding a second brand or client), rather than redesigning everything now.
