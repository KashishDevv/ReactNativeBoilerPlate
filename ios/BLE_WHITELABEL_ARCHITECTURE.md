# BLE White-Label / Multi-Tenant Architecture (iOS)

**Scope:** iOS BLE native layer only (Swift/Objective-C).  
**Goal:** Make the same BLE core reusable across clients (e.g. DyreID and future brands) without rewriting logic, with minimal risk to the current stable app.  
**Note:** This document is the iOS counterpart to `android/BLE_WHITELABEL_ARCHITECTURE.md`. Gradle applies to Android; iOS uses **Xcode schemes and xcconfig** for build variants.

---

## 1. High-Level Architecture

### 1.1 Principle: Config vs Core

| Layer | Responsibility | Stays shared | Becomes configurable |
|-------|----------------|--------------|------------------------|
| **BLE Core** | Scanning, connecting, GATT, bonding, DFU, transaction queue, event emission | ✅ | — |
| **Client config** | Which devices to accept, service UUID, manufacturer ID, device name patterns | — | ✅ |

- **Core:** `BridgingCodeModule.swift`, `TransactionManager.swift`, `BLEError.swift`, `BridgingCodeModule.m` (RN bridge). All BLE logic stays in one place.
- **Config:** One abstraction (e.g. `BLEClientConfig` protocol) that core code reads. No hardcoded "DyreID", "Health Tag", `0x1234`, or `0f0e0d0c-...` in core.

### 1.2 Target Layout (conceptual)

```
ios/
├── ReactNativeBoilerPlate.xcodeproj
├── BridgingCodeModule.swift          # Uses BLEClientConfig (no literals)
├── TransactionManager.swift         # Unchanged; no client-specific logic
├── BLEError.swift                   # Unchanged
├── config/
│   ├── BLEClientConfig.swift        # Protocol (interface)
│   ├── DefaultBLEClientConfig.swift # DyreID defaults (for main app)
│   └── (optional) DyreIDBLEConfig.swift  # Explicit DyreID if needed later
├── ReactNativeBoilerPlate/
│   ├── AppDelegate.swift            # Sets BLEClientConfigHolder at launch
│   ├── Info.plist
│   └── ...
├── Configurations/                  # Optional: per-client xcconfig
│   ├── Shared.xcconfig
│   ├── DyreID.xcconfig
│   └── ClientB.xcconfig
└── Schemes/                         # Or use Xcode scheme per client
    └── (schemes: DyreID-Debug, DyreID-Release, ClientB-Debug, ...)
```

- **Main app target** holds all BLE logic and a default config (current DyreID behavior).
- **Client-specific builds** are achieved via **schemes** and **xcconfig** (bundle ID, display name, and optionally which config class to use). No duplication of BLE code.

### 1.3 Industry Patterns Used

- **Strategy / dependency injection:** Client-specific behavior behind `BLEClientConfig`; `BridgingCodeModule` depends on the protocol, not on a concrete brand.
- **xcconfig + Schemes:** One scheme per client (e.g. DyreID-Debug, DyreID-Release); each can have its own bundle ID, display name, and (if needed) preprocessor/compile-time config. No need for multiple targets that duplicate build phases.
- **Single source of truth:** Device filtering and UUIDs live only in config; no scattered string literals in core.
- **Holder pattern:** `BLEClientConfigHolder` holds the current config instance so the bridge and any other code can resolve it without passing it through every call (similar to Android’s `BLEClientConfigHolder`).

---

## 2. BLE Client Configuration Abstraction

### 2.1 What Must Be Configurable (BLE only)

From the current iOS codebase, these are the client-specific values:

| Concept | Current (DyreID) | Config contract |
|--------|-------------------|------------------|
| GATT service UUID for “smart tag” | `0f0e0d0c-0b0a-0908-0706-050403020100` | `smartTagServiceUUID` |
| Manufacturer company ID | `0x1234` | `manufacturerId` |
| Device name patterns (scan filter) | "DyreID", "Health Tag" | `acceptedDeviceNamePatterns` |
| Default passkey (if used) | `"123456"` (if any) | `defaultPasskey` (optional) |
| Brand name (logs/notifications) | "DyreID" | `brandName` |

### 2.2 Protocol (Swift)

```swift
// config/BLEClientConfig.swift
import Foundation
import CoreBluetooth

/// Client/brand-specific BLE configuration for white-label support.
/// Core BLE logic uses this protocol instead of hardcoded UUIDs, manufacturer ID, or device name patterns.
protocol BLEClientConfig: AnyObject {
    /// GATT service UUID used to identify "smart tag" / supported devices.
    var smartTagServiceUUID: CBUUID { get }
    /// Manufacturer company ID used in BLE advertisement data (e.g. 0x1234).
    var manufacturerId: UInt16 { get }
    /// Device name substrings that identify accepted devices (e.g. "DyreID", "Health Tag").
    var acceptedDeviceNamePatterns: [String] { get }
    /// Optional default 6-digit passkey for pairing. Nil = use device/flow default.
    var defaultPasskey: String? { get }
    /// Human-readable brand name for logs and notifications (e.g. "DyreID").
    var brandName: String { get }
}

/// Holder so BridgingCodeModule (and tests) can resolve config without passing it everywhere.
enum BLEClientConfigHolder {
    private static var _config: BLEClientConfig?
    static func set(_ config: BLEClientConfig) { _config = config }
    static func get() -> BLEClientConfig? { _config }
}
```

### 2.3 Default Implementation (DyreID)

```swift
// config/DefaultBLEClientConfig.swift
import Foundation
import CoreBluetooth

/// Default BLE config with current DyreID values. Behavior unchanged when no scheme-specific config is used.
final class DefaultBLEClientConfig: BLEClientConfig {
    var smartTagServiceUUID: CBUUID {
        CBUUID(string: "0f0e0d0c-0b0a-0908-0706-050403020100")
    }
    var manufacturerId: UInt16 { 0x1234 }
    var acceptedDeviceNamePatterns: [String] { ["DyreID", "Health Tag"] }
    var defaultPasskey: String? { nil }
    var brandName: String { "DyreID" }
}
```

- **Core code** (`BridgingCodeModule`) uses `BLEClientConfigHolder.get()` (or an injected config) and calls `smartTagServiceUUID`, `manufacturerId`, `acceptedDeviceNamePatterns`, etc., instead of constants.
- **App launch:** In `AppDelegate.application(_:didFinishLaunchingWithOptions:)`, set `BLEClientConfigHolder.set(DefaultBLEClientConfig())` (or a scheme-specific config if you introduce it later).

---

## 3. Xcode Build Strategy (Schemes + xcconfig)

iOS does **not** use Gradle. Use **Xcode schemes** and **.xcconfig** files for client-specific builds.

### 3.1 Build Configurations

- Keep **Debug** and **Release** as today.
- Optionally add **client-specific xcconfig** files that override only what’s different per client (bundle ID, display name, etc.).

Example layout:

```
Configurations/
  Shared.xcconfig      # Common settings (e.g. deployment target, Swift version)
  DyreID.xcconfig      # PRODUCT_BUNDLE_IDENTIFIER = com.dyreid.healthtag
                       # INFOPLIST_KEY_CFBundleDisplayName = Health Tag
  ClientB.xcconfig     # PRODUCT_BUNDLE_IDENTIFIER = com.clientb.app
                       # INFOPLIST_KEY_CFBundleDisplayName = Client B App
```

- In Xcode: **Project → Info → Configurations**, duplicate Debug/Release and assign the appropriate xcconfig to each (e.g. Debug uses `Shared.xcconfig` + `DyreID.xcconfig` for DyreID).
- Or keep a single Debug/Release and use **schemes** to pass different build settings or environment variables; then in code you can choose which `BLEClientConfig` to use (e.g. from a scheme-defined env or a simple compile-time flag).

### 3.2 Schemes (recommended for minimal change)

- **One scheme per client** (e.g. `DyreID`, `ClientB`) with the same target.
- Each scheme uses the same build configuration (Debug/Release) but you can:
  - Add a **Run Script Phase** or **Preprocessor Macro** (e.g. `DYREID=1` vs `CLIENT_B=1`) and in `AppDelegate` set `BLEClientConfigHolder.set(DyreIDBLEConfig())` or `BLEClientConfigHolder.set(ClientBBLEConfig())` accordingly.
  - Or keep a single default config and only override when adding a second client.

This avoids duplicating the entire target and keeps BLE logic in one place.

### 3.3 BLE-Specific Values

- Keep BLE-specific values (service UUID, manufacturer ID, name patterns) in **Swift config** (`BLEClientConfig`), not in xcconfig, so:
  - They stay in one place and are easy to unit test.
  - You can swap config at runtime in tests or future dynamic config.
- Use xcconfig only for app-level branding: bundle ID, display name, and (if needed) API base URL or feature flags.

---

## 4. Feature Flags (per client)

- **Compile-time:** Different `BLEClientConfig` per scheme (or per build configuration) = different “features” (which UUID/name patterns). No separate BLE feature-flag framework needed at first.
- **Runtime (future):** If you need runtime toggles (e.g. enable DFU only for some clients), add to `BLEClientConfig` (e.g. `isDfuEnabled: Bool`) and implement per client. Prefer keeping BLE behind the config protocol for consistency.

---

## 5. Step-by-Step Refactor Roadmap

### Phase 1: Introduce config (no schemes yet)

1. Add `config/BLEClientConfig.swift` (protocol + `BLEClientConfigHolder`) and `config/DefaultBLEClientConfig.swift` (current DyreID values) under the iOS target.
2. In `AppDelegate.application(_:didFinishLaunchingWithOptions:)`, set `BLEClientConfigHolder.set(DefaultBLEClientConfig())`.
3. In `BridgingCodeModule.swift`:
   - Remove private constants: `SMART_TAG_SERVICE_UUID`, `SMART_TAG_MANUFACTURER_ID`, and the duplicate `smartTagServiceUUID`.
   - Replace all usages with `BLEClientConfigHolder.get()!.smartTagServiceUUID`, `.manufacturerId`, and `.acceptedDeviceNamePatterns` (with a helper like `func isAcceptedDevice(name: String?) -> Bool` that checks patterns).
   - Replace all literal checks for `"DyreID"`, `"Health Tag"` with the config’s `acceptedDeviceNamePatterns`.
   - Replace the single literal `0x1234` in `parseManufacturerData` with config’s `manufacturerId`.
   - Use `config.brandName` for any user-facing or log strings that mention the brand (e.g. “Settings → Bluetooth → DyreID”).
4. Run full regression (scan, connect, bond, GATT, DFU). No behavior change expected.

### Phase 2: Schemes (single client: DyreID)

5. Optionally add a scheme “DyreID” that uses the same target and build config; ensure Debug/Release still build and run.
6. Optionally add `DyreID.xcconfig` and assign it to the project’s Debug/Release so bundle ID and display name stay consistent. No BLE logic change.

### Phase 3: Second client (when needed)

7. Add a new scheme “ClientB” and a new config class `ClientBBLEConfig` with that client’s UUID, manufacturer ID, and name patterns.
8. Use a preprocessor macro or launch-time flag so `AppDelegate` sets `BLEClientConfigHolder.set(ClientBBLEConfig())` when building for ClientB.
9. Add `ClientB.xcconfig` with ClientB’s bundle ID and display name.
10. Test both schemes.

### Phase 4 (optional): Cleanup and hardening

11. Remove any remaining DyreID-specific literals from core; add unit tests for `BLEClientConfig` and for “accept device” logic.
12. Document for the team: how to add a new client (new scheme + new config class + optional xcconfig).

---

## 6. Risk Mitigation

| Risk | Mitigation |
|------|-------------|
| Regressions in BLE flow | Phase 1 is refactor-only: same values in `DefaultBLEClientConfig`. No new logic. |
| Config holder nil | Guard `BLEClientConfigHolder.get()` in `BridgingCodeModule`; if nil, assert or use a fallback default so the app never runs without a config. |
| Scheme/build issues | Introduce one scheme (DyreID) first; keep existing Debug/Release as default. |
| Scattered literals | Single pass to find "DyreID", "Health Tag", `0x1234`, `SMART_TAG_SERVICE_UUID`, `0f0e0d0c-...` and replace with config; then grep to verify none left in core. |

---

## 7. Implementation TODO List (BLE only)

- [x] **1** Create `config/BLEClientConfig.swift`: protocol + `BLEClientConfigHolder`.
- [x] **2** Create `config/DefaultBLEClientConfig.swift` with current DyreID values (service UUID, manufacturer ID, name list, optional default passkey, brand name).
- [x] **3** In `AppDelegate`, set `BLEClientConfigHolder.set(DefaultBLEClientConfig())` at launch.
- [x] **4** Refactor `BridgingCodeModule.swift`: remove `SMART_TAG_SERVICE_UUID`, `SMART_TAG_MANUFACTURER_ID`, duplicate `smartTagServiceUUID`; use `BLEClientConfigHolder.get()` for all of these; implement “accepted device” via `acceptedDeviceNamePatterns` and `smartTagServiceUUID`; replace the single `0x1234` in `parseManufacturerData` with config.
- [x] **5** Replace all "DyreID" / "Health Tag" string checks with a helper that uses `acceptedDeviceNamePatterns`.
- [x] **6** Use `config.brandName` for any log or user-facing strings that mention the brand (e.g. “Settings → Bluetooth → DyreID”).
- [ ] **7** Add scheme “DyreID” (optional) and optionally `DyreID.xcconfig` for bundle ID and display name.
- [ ] **8** (Optional) Add `config/DyreIDBLEConfig.swift` that mirrors default for explicit scheme wiring.
- [x] **9** Remove remaining hardcoded BLE client constants from core; verify with grep.
- [ ] **10** When adding a new client: add scheme + new `*BLEConfig` implementation + optional xcconfig; no changes to BLE core.

---

## 8. File-Level Summary

| File | Change |
|------|--------|
| **New:** `config/BLEClientConfig.swift` | Protocol + `BLEClientConfigHolder`. |
| **New:** `config/DefaultBLEClientConfig.swift` | DyreID implementation (current constants). |
| **Edit:** `BridgingCodeModule.swift` | Use `BLEClientConfigHolder.get()` for service UUID, manufacturer ID, device name matching, and any passkey default; remove literals. |
| **Edit:** `AppDelegate.swift` | Set `BLEClientConfigHolder.set(DefaultBLEClientConfig())` in `application(_:didFinishLaunchingWithOptions:)`. |
| **Optional:** `Configurations/DyreID.xcconfig` | Bundle ID, display name. |
| **Optional:** `config/DyreIDBLEConfig.swift` | Explicit DyreID config for scheme. |

`TransactionManager.swift` and `BLEError.swift` remain unchanged; they contain no client-specific constants.

---

## 9. Verification (after refactor)

- **No client constants in core:** `BridgingCodeModule` has no hardcoded `0f0e0d0c-...`, `0x1234`, or `"DyreID"` / `"Health Tag"`; all such values come from `BLEClientConfig` / `DefaultBLEClientConfig`.
- **Config wiring:** `AppDelegate` sets `BLEClientConfigHolder.set(DefaultBLEClientConfig())`; bridge uses `BLEClientConfigHolder.get()`.
- **Cleanup:** Grep for `DyreID`, `Health Tag`, `0x1234`, `SMART_TAG_SERVICE_UUID`, `smartTagServiceUUID` (literal UUID string) in `BridgingCodeModule.swift` and confirm only references are inside config types or comments.

---

## 10. Gradle vs Xcode (clarification)

- **Android** uses **Gradle** (product flavors, source sets, `BuildConfig`) for multi-client builds—see `android/BLE_WHITELABEL_ARCHITECTURE.md`.
- **iOS** uses **Xcode**: **schemes**, **build configurations**, and **.xcconfig** files. There is no Gradle on iOS. The same conceptual split (config vs core) applies on both platforms so that adding a new client only requires a new config implementation and build/scheme setup, not changes to BLE core logic.

---

## 11. Summary

- **BLE core** stays shared and client-agnostic; **client-specific behavior** is behind `BLEClientConfig`.
- **Config** is set at app launch; **BridgingCodeModule** reads it via `BLEClientConfigHolder` and uses it for scan filtering, service UUID, manufacturer ID, and device name matching.
- **Multi-client builds** on iOS are done with **schemes** and optional **xcconfig**; no need to duplicate the app target.
- Refactor is **low risk** if Phase 1 is done first with default config preserving current DyreID behavior and full regression testing is run before introducing schemes or a second client.
