# Proper Flow Analysis – SDD v1.5

**Industry-standard BLE history sync (Fitbit, Garmin, Nordic practice).**  
**Ref:** ET-DSSID-SSD-V1.5_12012026.md

---

## 1️⃣ One-Sentence Summary (Client-Friendly)

**Sync starts only when the app sends DATA_SYNC_START on the Command characteristic; device status and live data are read-only metadata and data streams and never start sync.**

---

## 2️⃣ When EACH Characteristic Is Used (Timeline)

Let’s walk the exact order.

### 🔹 A. On Connection (Before Sync)

**✅ Device Status Characteristic**

**Used for:**

- Record count in flash
- Device RTC validity
- Battery
- Device state flags

**When read:**

- Immediately after services & characteristics discovery
- **BEFORE** any sync decision

📌 Never starts sync  
📌 Never sends data

---

### 🔹 B. History Sync Phase (CRITICAL)

**✅ Command / Control Characteristic**

This is the **ONLY** characteristic that starts sync.

**Commands sent:**

- DATA_SYNC_START(N)
- DATA_SYNC_STOP(N)

📌 **Rules**

- Sent only by app
- One active sync at a time
- Never sent during live mode

**✅ Data Transfer Characteristic**

**Used for:**

- Sending historical records (during sync)
- Sending live records (after sync)

📌 Same characteristic  
📌 Different meaning depending on phase  

This is normal BLE practice (Nordic, Fitbit, Garmin do this).

**History Sync Flow (precise)**

```
App → Command Char → DATA_SYNC_START(N)
Device → Data Char → Record 1
Device → Data Char → Record 2
...
Device → Data Char → Record N
App → Command Char → DATA_SYNC_STOP(N)
```

📌 Data Transfer characteristic is **PASSIVE**  
📌 It never initiates sync

---

### 🔹 C. Live Data Phase (After History Sync)

**✅ Data Transfer Characteristic (Notifications)**

**Used for:**

- Streaming live records in real-time
- Device → Data Char → New Record
- Device → Data Char → New Record

📌 No commands involved  
📌 No StartSync / StopSync  
📌 Infinite stream

---

### 🔹 D. Device Status Characteristic (Ongoing)

**Still used for:**

- Periodic reads
- Battery updates
- Debug checks

📌 Does NOT affect sync

---

## 3️⃣ Which Characteristic STARTS Sync? (Very Explicit)

🔥 **ONLY ONE** thing starts history sync

✅ **DATA_SYNC_START** written to Command / Control characteristic

**Nothing else.**

| Action                | Starts Sync? |
|-----------------------|--------------|
| Enable notifications  | ❌ No        |
| Live data received    | ❌ No        |
| Read device status    | ❌ No        |
| RSSI read             | ❌ No        |
| Reconnect             | ❌ No        |
| **DATA_SYNC_START**   | ✅ **YES**   |

---

## 4️⃣ What Your Logs Reveal (Important Insight)

From Android logs:

**DATA_SYNC_START is being sent:**

- Multiple times
- While sync already active
- Sometimes triggered by live data arrival

🚨 **This means:**

App logic is incorrectly treating:

- Live data
- Status reads
- Sync ACKs  

as reasons to restart sync.

**That is the root bug.**

*(Correct behavior: only Phase 1 Decide leads to DATA_SYNC_START; during Phase 2 and Phase 3, device status and live data must never trigger sync.)*

---

## 5️⃣ Correct Characteristic Usage – One Table (Client-Friendly)

| Phase        | Command Char | Data Char        | Status Char |
|-------------|--------------|------------------|-------------|
| Connect     | ❌           | ❌               | ❌          |
| Setup       | ❌           | ❌               | ✅ Read     |
| History Sync| ✅ Start / Stop | ✅ History records | ❌       |
| Live Mode   | ❌           | ✅ Live records  | ❌          |
| Monitoring  | ❌           | ❌               | ✅ Read     |

---

## 6️⃣ Golden Rules (Industry Best Practice)

1. **Command characteristic** = control only
2. **Data characteristic** = data only
3. **Status characteristic** = metadata only
4. **Sync starts only on explicit command** (DATA_SYNC_START)
5. **Live data must never trigger sync**
6. Same data characteristic is OK for history + live  
   **Phase decides meaning, not UUID**

---

## 7️⃣ Industry-Standard Sequence (Matches Our Android Implementation)

This is the **one** diagram to keep. It matches how we execute BLE on Android in this repo today:

- **One device = one `GattOperationQueue` = one in-flight GATT op**
- **All GATT ops are queued** (MTU, discover services, CCCD, reads, writes)
- **Callbacks advance the queue** (including `onServicesDiscovered`)
- **Timeout safety** prevents a stuck queue
- **During sync**: only DATA_SYNC_START/STOP + notifications (no competing RSSI/reads)

```
App / JS                      Per-Device GATT Queue                 Device
│                               │                                   │
│  Connect()                    │                                   │
│──────────────────────────────▶│                                   │
│                               │ connect GATT                      │
│                               │──────────────────────────────────▶│
│                               │◀──────── Connected ───────────────│
│                               │                                   │
│                               │ enqueue(Request MTU)              │
│                               │──────────────────────────────────▶│ requestMtu()
│                               │◀──────── onMtuChanged ────────────│
│                               │ enqueue(Discover Services)        │
│                               │──────────────────────────────────▶│ discoverServices()
│                               │◀──── onServicesDiscovered ────────│
│                               │                                   │
│                               │ enqueue(CCCD write(s))            │
│                               │──────────────────────────────────▶│ writeDescriptor(CCCD)
│                               │◀──── onDescriptorWrite (OK) ──────│
│                               │                                   │
│                               │ enqueue(Read Device Status / RTC) │
│                               │──────────────────────────────────▶│ readCharacteristic(Status)
│                               │◀──── onCharacteristicRead ────────│
│                               │                                   │
│  Decide: Missing history?     │ (protocol decides ONCE per sync)  │
│──────────────────────────────▶│                                   │
│                               │                                   │
│  DATA_SYNC_START (≤500)       │ enqueue(Write Command)            │
│──────────────────────────────▶│──────────────────────────────────▶│ writeCharacteristic(Command)
│                               │◀──── onCharacteristicWrite ───────│
│                               │                                   │
│                               │◀──── Notify record packets ───────│
│                               │                                   │
│  DATA_SYNC_STOP               │ enqueue(Write Command)            │
│──────────────────────────────▶│──────────────────────────────────▶│ writeCharacteristic(Command)
│                               │◀──── onCharacteristicWrite ───────│
│                               │                                   │
│  Next batch START (if needed) │ (only after STOP response/ACK)     │
│                               │                                   │
│           LIVE MODE           │                                   │
│◀──────── Live Notifications ──────────────────────────────────────│
```

---

## Android: Single Global GATT Operation Queue (Industry Pattern)

**Pattern:** One BLE device = one `GattOperationQueue` = one in-flight GATT operation. Callbacks drive the queue forward.

**Implemented in `SampleBridgeAndroid.java`:**
- **`GattOperationQueue`** – FIFO queue, `inFlight`, `onOperationComplete(status)`, and 10s op timeout fallback.
- **`GattOperation`** – `execute(gatt)`, `onComplete(status)`, `onTimeout()`, `name()`.
- **`gattQueues`** – one queue per deviceId; `setGatt(gatt)` is wired on connect.
- **`enqueueGattOp(...)`** – serialized onto a single Handler/Looper.
- **`runPendingGattComplete(deviceId, status)`** – called from GATT callbacks (including `onServicesDiscovered`) to advance.
- **`enqueueDiscoverServicesOp(...)` / `enqueueReadCharacteristicOp(...)`** – helpers to keep discovery/reads serialized.

**Current status:** All critical `BluetoothGatt.*` operations are routed through the single per-device queue. Any remaining `gatt.*` calls in code are inside queued operations (expected), not bypass calls.



Android Auto Connect Flow


1. App startup

initializeStateRestoration()
  → restoreExistingConnections()
     For each bonded device:
       - Already in connectedGatts → ensureDataExchangeActive()
       - Else → device = bondedDevices.get(id) or getRemoteDevice(id)

Restore always runs on startup, independent of auto-connect.

2. User enables auto-connect (e.g. from UI)

startAutoConnect()
  → If no bonded devices → resolve, return
  → If already enabled → resolve, return
  → autoConnectEnabled = true
  → syncSystemBondedDevices()
  → After 500ms:
       restoreExistingConnections()
       If not all bonded connected → startScanningForBondedDevices()
       Schedule autoConnectReconnectRunnable in 30s

JS sets androidAutoConnectEnabled = true after a successful start.

3. Periodic loop (every 30s while auto-connect on)

autoConnectReconnectRunnable:
  → If !autoConnectEnabled → return
  → syncSystemBondedDevices()
  → restoreExistingConnections()
  → If enabled, have bonded, and not all connected → startScanningForBondedDevices()
  → If still enabled → postDelayed(self, 30s)

So we repeatedly restore and, when needed, scan for bonded devices.

4. Scan finds a bonded device

onScanResult (bonded device)
  → shouldAllowConnection? (not forgotten, not manual-disconnect) else return
  → Already connected/connecting? else return
  → device = bondedDevices.get or getRemoteDevice
  → stopScanning()
  → mainHandler.post(() -> restoreConnectionToDevice(id, device))

Connection uses the same restore path as startup and manual restore.

5. Restore path (shared by startup, loop, scan)

restoreConnectionToDevice(id, device)
  → If already in connectedGatts → ensureDataExchangeActive, return
  → If in connectingDevices → return (no duplicate)
  → connectingDevices.add(id)
  → BLEConnectionManager.connectToDeviceWithQueueDrivenDiscovery(id, device, callback)
       → connectGatt(autoConnect=false)
  → On CONNECTED: 900ms delay → enqueueDiscoverServices → … → SECURE_READY
       → checkAndEmitDeviceConnected → DeviceConnected event
  → On DISCONNECTED or FAILED: cleanup connectingDevices, connectedGatts, etc.

This is the single connect flow for manual, restore, and auto-connect.

6. App returns to foreground

onAppStateChanged("active")
  → Start foreground service if needed
  → After 500ms:
       restoreExistingConnections()
       If autoConnectEnabled and not all bonded connected → startScanningForBondedDevices()

Quick restore + optional scan when coming back to app.

7. User disables auto-connect

stopAutoConnect()
  → autoConnectEnabled = false
  → mainHandler.removeCallbacks(autoConnectReconnectRunnable)
  → If scanning → stopScanning()

No disconnects; we only stop the loop and scan.

8. UI / JS
* Events: Same as manual connections: DeviceConnected, DeviceDisconnected, DeviceDataUpdated, RSSIUpdate, etc. No separate auto-connect–specific events on Android.
* Status: getAutoConnectStatus → enabled reflects autoConnectEnabled.
* BLEService: isAutoConnectEnabled() on Android uses androidAutoConnectEnabled, kept in sync with start/stop/getStatus.

9. Timeline (when auto-connect is on)

T=0       User enables auto-connect
T=0.5s    Restore + maybe scan (15s)
T=30.5s   Loop: restore + maybe scan
T=60.5s   Loop: restore + maybe scan
…

When a bonded device is found in scan → we connect via restore → DeviceConnected → UI updates as with manual connect.

Summary: One connection path (restore → BLEConnectionManager → queue → DeviceConnected). Auto-connect adds a 30s loop that restores and optionally scans; when scan finds a bonded device we run the same restore flow. The UI keeps using the existing BLE events.
