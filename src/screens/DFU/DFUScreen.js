import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Platform,
  RefreshControl,
} from 'react-native';
import { pick, keepLocalCopy, types } from '@react-native-documents/picker';
import BLEService from '../../services/ble/BLEService';
import Colors from '../../theme/Colors';
import Fonts from '../../theme/Fonts';
import { Metrics } from '../../theme/Metrics';

const LATEST_VERSION = '1.0.11';

/** Parse "x.y.z" into { major, minor, patch }. Invalid or missing parts become 0. */
function parseVersion(v) {
  if (!v || typeof v !== 'string') return { major: 0, minor: 0, patch: 0 };
  const parts = v.trim().split('.').map((n) => parseInt(n, 10) || 0);
  return {
    major: parts[0] ?? 0,
    minor: parts[1] ?? 0,
    patch: parts[2] ?? 0,
  };
}

/** Compare two version strings. Returns < 0 if a < b, 0 if equal, > 0 if a > b. */
function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  return va.patch - vb.patch;
}

/** Increment patch: "1.0.11" -> "1.0.12". */
function incrementPatchVersion(v) {
  const { major, minor, patch } = parseVersion(v);
  return `${major}.${minor}.${patch + 1}`;
}

/** Format raw DFU error (e.g. "timeout 13", "Timeout 15") into a user-friendly message and optional raw line. */
function formatDfuError(raw) {
  if (!raw || typeof raw !== 'string') return { primary: raw || 'Unknown error', raw: null };
  const lower = raw.toLowerCase().trim();
  const timeoutMatch = lower.match(/timeout\s*[(\s]*(\d+)/);
  if (timeoutMatch) {
    const code = timeoutMatch[1];
    return {
      primary: 'Firmware update timed out. Keep the device close and try again. If it keeps failing, use a .bin file that matches this device.',
      raw: `Error: ${raw}`,
    };
  }
  if (lower.includes('timeout')) {
    return {
      primary: 'Firmware update timed out. Keep the device close and try again.',
      raw: `Error: ${raw}`,
    };
  }
  return { primary: raw, raw: null };
}

const DFUScreen = ({ route, navigation }) => {
  const { deviceId, deviceName } = route.params || {};
  const [currentVersion, setCurrentVersion] = useState(null);
  const [latestVersion, setLatestVersion] = useState(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [checkingVersion, setCheckingVersion] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [dfuState, setDfuState] = useState('');
  const [progress, setProgress] = useState(0);
  const [dfuError, setDfuError] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updateResult, setUpdateResult] = useState(null);

  const fetchCurrentVersion = useCallback(async () => {
    if (!deviceId) return;
    if (!BLEService.isDeviceConnected(deviceId)) {
      setCurrentVersion(null);
      return;
    }
    setCheckingVersion(true);
    setDfuError(null);
    try {
      const result = await BLEService.getFirmwareVersion(deviceId);
      if (result?.success && result?.data != null) {
        setCurrentVersion(typeof result.data === 'string' ? result.data : String(result.data));
      } else {
        setCurrentVersion(null);
      }
    } catch (e) {
      setCurrentVersion(null);
    } finally {
      setCheckingVersion(false);
    }
  }, [deviceId]);

  const checkForUpdates = useCallback(async () => {
    setCheckingUpdate(true);
    setDfuError(null);
    try {
      await new Promise((r) => setTimeout(r, 800));
      const current = currentVersion || '0.0.0';
      const isUpToDate = compareVersions(current, LATEST_VERSION) >= 0;
      if (isUpToDate) {
        setLatestVersion(LATEST_VERSION);
        setUpdateAvailable(false);
      } else {
        const nextVersion = incrementPatchVersion(currentVersion);
        setLatestVersion(nextVersion);
        setUpdateAvailable(true);
      }
    } catch (e) {
      setLatestVersion(null);
      setUpdateAvailable(false);
    } finally {
      setCheckingUpdate(false);
    }
  }, [currentVersion]);

  useEffect(() => {
    navigation.setOptions({
      title: deviceName ? `Firmware Update – ${deviceName}` : 'Firmware Update',
    });
    fetchCurrentVersion();
  }, [deviceId, deviceName, fetchCurrentVersion]);

  const onStateRef = React.useRef(null);
  const onProgressRef = React.useRef(null);
  const onErrorRef = React.useRef(null);

  useEffect(() => {
    onStateRef.current = (e) => {
      if (e?.deviceId === deviceId) {
        setDfuState(e?.state || '');
        if (e?.state === 'COMPLETED') {
          setProgress(100);
          setUpdating(false);
          setDfuError(null);
          setUpdateResult('success');
          setCurrentVersion(null);
        } else if (e?.state === 'CANCELED') {
          setUpdating(false);
          setUpdateResult(null);
        }
      }
    };
    onProgressRef.current = (e) => {
      if (e?.deviceId === deviceId) setProgress(e?.progress ?? 0);
    };
    onErrorRef.current = (e) => {
      if (e?.deviceId === deviceId) {
        const raw = e?.message || e?.errorCode || 'Unknown error';
        setDfuError(raw);
        setUpdating(false);
        setUpdateResult('failed');
      }
    };
    const onState = (e) => onStateRef.current?.(e);
    const onProgress = (e) => onProgressRef.current?.(e);
    const onError = (e) => onErrorRef.current?.(e);
    BLEService.on('DFUStateChanged', onState);
    BLEService.on('DFUProgress', onProgress);
    BLEService.on('DFUError', onError);
    return () => {
      BLEService.off('DFUStateChanged', onState);
      BLEService.off('DFUProgress', onProgress);
      BLEService.off('DFUError', onError);
    };
  }, [deviceId, fetchCurrentVersion]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setDfuError(null);
    setUpdateResult(null);
    await fetchCurrentVersion();
    setRefreshing(false);
  }, [fetchCurrentVersion]);

  const pickFile = useCallback(async () => {
    try {
      // Use types.allFiles so iOS gets UTI 'public.item' (not '*/*' which is invalid on iOS)
      const [file] = await pick({ type: [types.allFiles] });
      if (!file?.uri) return;
      const name = file.name ?? file.fileName ?? 'firmware';
      const isBin = name.toLowerCase().endsWith('.bin');
      if (!isBin) {
        Alert.alert('Invalid file', 'Please select a .bin firmware file.');
        return;
      }
      const [localCopy] = await keepLocalCopy({
        files: [{ uri: file.uri, fileName: name }],
        destination: 'cachesDirectory',
      });
      // keepLocalCopy returns { localUri, status } on success (not "uri") - use localUri so native gets a stable path in Caches
      const uriToUse = localCopy?.status === 'success' && localCopy?.localUri
        ? localCopy.localUri
        : file.uri;
      if (localCopy?.status === 'error' && localCopy?.copyError) {
        console.warn('[DFU] keepLocalCopy error:', localCopy.copyError, '- using pick URI as fallback');
      }
      setSelectedFile({
        uri: uriToUse,
        name,
        size: file.size,
      });
      setDfuError(null);
    } catch (e) {
      if (e?.code !== 'DOCUMENT_PICKER_CANCELED') {
        Alert.alert('Error', e?.message || 'Failed to pick file');
      }
    }
  }, []);

  const startUpdate = useCallback(async () => {
    if (!selectedFile || !deviceId) return;
    setUpdating(true);
    setDfuError(null);
    setUpdateResult(null);
    setProgress(0);
    setDfuState('STARTING');
    try {
      await BLEService.startMcuMgrDfu(deviceId, selectedFile.uri);
    } catch (e) {
      setDfuError(e?.message || 'Start update failed');
      setUpdating(false);
    }
  }, [deviceId, selectedFile]);

  const cancelUpdate = useCallback(async () => {
    try {
      await BLEService.cancelMcuMgrDfu();
    } catch (e) {
      Alert.alert('Cancel failed', e?.message || 'Could not cancel');
    }
  }, []);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} tintColor={Colors.primary} />
      }
    >
      {/* Version card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Firmware version</Text>
          {latestVersion != null && (
            <View style={[styles.chip, updateAvailable ? styles.chipUpdate : styles.chipOk]}>
              <Text style={styles.chipText}>
                {updateAvailable ? 'Update available' : 'No updates available'}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.versionRow}>
          <Text style={styles.versionLabel}>Current (device)</Text>
          {checkingVersion ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Text style={styles.versionValue}>{currentVersion ?? '—'}</Text>
          )}
        </View>
        <View style={[styles.versionRow, styles.versionRowLast]}>
          <Text style={styles.versionLabel}>Latest available</Text>
          {checkingUpdate ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Text style={styles.versionValue}>{latestVersion ?? '—'}</Text>
          )}
        </View>
        <TouchableOpacity
          style={styles.btnOutline}
          onPress={checkForUpdates}
          disabled={checkingUpdate}
          activeOpacity={0.7}
        >
          <Text style={styles.btnOutlineText}>
            {checkingUpdate ? 'Checking…' : 'Check for updates'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Firmware file card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Firmware file</Text>
        <Text style={styles.hint}>
          Select a .bin file for MCUboot update.
        </Text>
        <TouchableOpacity
          style={[styles.filePicker, selectedFile && styles.filePickerFilled]}
          onPress={pickFile}
          disabled={updating}
          activeOpacity={0.7}
        >
          <Text style={styles.filePickerText} numberOfLines={1}>
            {selectedFile ? selectedFile.name : 'Choose .bin file'}
          </Text>
          {selectedFile?.size != null && (
            <Text style={styles.fileSize}>
              {(selectedFile.size / 1024).toFixed(1)} KB
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btnPrimary, (!selectedFile || updating) && styles.btnDisabled]}
          onPress={startUpdate}
          disabled={!selectedFile || updating}
          activeOpacity={0.8}
        >
          <Text style={styles.btnPrimaryText}>
            {updating ? 'Updating…' : 'Start firmware update'}
          </Text>
        </TouchableOpacity>
        {updating && (
          <TouchableOpacity style={styles.btnCancel} onPress={cancelUpdate} activeOpacity={0.7}>
            <Text style={styles.btnCancelText}>Cancel update</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Progress & result card */}
      {(updating || dfuState || progress > 0 || updateResult) && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Status</Text>
          {updateResult === 'success' && (
            <View style={styles.resultChipSuccess}>
              <Text style={styles.resultChipText}>✓ Success</Text>
            </View>
          )}
          {updateResult === 'failed' && (
            <View style={styles.resultChipFailed}>
              <Text style={styles.resultChipText}>✕ Failed</Text>
            </View>
          )}
          {!updateResult && dfuState ? (
            <Text style={styles.stateLabel}>{dfuState}</Text>
          ) : null}
          {(progress > 0 || updating) && (
            <View style={styles.progressWrap}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progress}%` }]} />
              </View>
              <Text style={styles.progressPercent}>{progress}%</Text>
            </View>
          )}
        </View>
      )}

      {/* Error card */}
      {dfuError ? (() => {
        const { primary, raw } = formatDfuError(dfuError);
        return (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Update failed</Text>
            <Text style={styles.errorText}>{primary}</Text>
            {raw ? <Text style={styles.errorRaw}>{raw}</Text> : null}
          </View>
        );
      })() : null}
    </ScrollView>
  );
};

const CARD_RADIUS = 16;
const SECTION_GAP = 20;
const BOTTOM_PAD = 48;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Metrics.baseMargin,
    paddingBottom: BOTTOM_PAD,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: CARD_RADIUS,
    padding: Metrics.baseMargin,
    marginBottom: SECTION_GAP,
    ...Platform.select({
      ios: {
        shadowColor: Colors.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: { elevation: 3 },
    }),
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Metrics.smallMargin,
  },
  cardTitle: {
    fontSize: 17,
    fontFamily: Fonts.type?.bold || Fonts.type?.regular || undefined,
    fontWeight: '600',
    color: Colors.text,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  chipUpdate: {
    backgroundColor: Colors.warningLight,
  },
  chipOk: {
    backgroundColor: Colors.successLight,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.text,
  },
  versionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  versionRowLast: {
    borderBottomWidth: 0,
  },
  versionLabel: {
    fontSize: 14,
    color: Colors.lightText,
    fontFamily: Fonts.type?.regular || undefined,
  },
  versionValue: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  hint: {
    fontSize: 13,
    color: Colors.lightText,
    marginBottom: 12,
    lineHeight: 18,
  },
  btnOutline: {
    backgroundColor: 'transparent',
    paddingVertical: 12,
    paddingHorizontal: Metrics.baseMargin,
    borderRadius: 12,
    marginTop: 8,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  btnOutlineText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.primary,
    textAlign: 'center',
  },
  filePicker: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: Colors.border,
    borderRadius: 12,
    paddingVertical: 20,
    paddingHorizontal: Metrics.baseMargin,
    marginBottom: 12,
    alignItems: 'center',
    backgroundColor: Colors.backgroundSecondary,
  },
  filePickerFilled: {
    borderColor: Colors.primaryLight,
    backgroundColor: Colors.primaryLight,
  },
  filePickerText: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.text,
  },
  fileSize: {
    fontSize: 12,
    color: Colors.lightText,
    marginTop: 4,
  },
  btnPrimary: {
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    paddingHorizontal: Metrics.baseMargin,
    borderRadius: 12,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnPrimaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.white,
    textAlign: 'center',
  },
  btnCancel: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnCancelText: {
    fontSize: 14,
    color: Colors.error,
    fontWeight: '500',
  },
  resultChipSuccess: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.successLight,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 10,
  },
  resultChipFailed: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.errorLight,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 10,
  },
  resultChipText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  stateLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 10,
  },
  progressWrap: {
    marginTop: 4,
  },
  progressTrack: {
    height: 10,
    backgroundColor: Colors.lightGray,
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 5,
  },
  progressPercent: {
    fontSize: 13,
    color: Colors.lightText,
    textAlign: 'right',
  },
  errorCard: {
    backgroundColor: Colors.errorLight,
    borderRadius: CARD_RADIUS,
    padding: Metrics.baseMargin,
    borderLeftWidth: 4,
    borderLeftColor: Colors.error,
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.error,
    marginBottom: 6,
  },
  errorText: {
    fontSize: 14,
    color: Colors.error,
    lineHeight: 20,
  },
  errorRaw: {
    fontSize: 12,
    color: Colors.darkGray,
    marginTop: 8,
  },
});

export default DFUScreen;
