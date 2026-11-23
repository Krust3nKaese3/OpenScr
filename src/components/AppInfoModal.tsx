import React, { useEffect, useState } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, ScrollView, Platform, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MiniApp, Permission } from '../types';
import { ALL_PERMISSIONS, PERMISSION_INFO } from '../bridge/permissionInfo';
import { permissionsOfferedOnPlatform, showsLearningChrome } from '../services/iosPolicy';
import { StorageService } from '../services/StorageService';
import { versionLine } from '../services/githubPin';
import {
  SHOW_OVER_LOCK_KEY,
  clearOverLockNotice,
  publishOverLockNotice,
  readShowOverLockMap,
  showOverLockEnabled,
  showOverLockNativeReady,
  withShowOverLock,
} from '../services/showOverLock';

interface AppInfoModalProps {
  app: MiniApp | null;
  latestSha?: string;
  blocked: string | null;
  refreshing: boolean;
  onClose: () => void;
  onUpdate: (app: MiniApp) => void;
  onReport: (app: MiniApp) => void;
  onDelete: (app: MiniApp) => void;
  onShowSource?: (app: MiniApp) => void;
}

export const AppInfoModal: React.FC<AppInfoModalProps> = ({
  app,
  latestSha,
  blocked,
  refreshing,
  onClose,
  onUpdate,
  onReport,
  onDelete,
  onShowSource,
}) => {
  const [granted, setGranted] = useState<Permission[]>([]);
  const [denied, setDenied] = useState<Permission[]>([]);
  const [overLock, setOverLock] = useState(false);
  const android = Platform.OS === 'android';

  useEffect(() => {
    if (!app) return;
    let live = true;
    Promise.all([
      StorageService.getAppPermissions(app.id),
      StorageService.getDeniedPermissions(app.id),
      android ? AsyncStorage.getItem(SHOW_OVER_LOCK_KEY) : Promise.resolve(null),
    ]).then(([nextGranted, nextDenied, overRaw]) => {
      if (!live) return;
      setGranted(nextGranted);
      setDenied(nextDenied);
      setOverLock(showOverLockEnabled(readShowOverLockMap(overRaw), app.id));
    }).catch(() => {});
    return () => { live = false; };
  }, [app, android]);

  const setOverLockChoice = async (on: boolean) => {
    if (!app || !android) return;
    setOverLock(on);
    const map = withShowOverLock(readShowOverLockMap(await AsyncStorage.getItem(SHOW_OVER_LOCK_KEY)), app.id, on);
    await AsyncStorage.setItem(SHOW_OVER_LOCK_KEY, JSON.stringify(map));
    if (on) await publishOverLockNotice(app.id, app.manifest.name);
    else clearOverLockNotice(app.id);
  };

  const decide = async (permission: Permission, decision: 'granted' | 'denied') => {
    if (!app) return;
    await StorageService.setPermissionDecision(app.id, permission, decision);
    const [nextGranted, nextDenied] = await Promise.all([
      StorageService.getAppPermissions(app.id),
      StorageService.getDeniedPermissions(app.id),
    ]);
    setGranted(nextGranted);
    setDenied(nextDenied);
  };

  return (
    <Modal visible={!!app} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <ScrollView>
            <Text style={styles.title}>{app?.manifest.name}</Text>
            <Text style={styles.meta}>{app ? versionLine(app.manifest.version, app.commitSha, latestSha) : ''}</Text>
            <Text selectable style={styles.repo}>{app?.repoUrl}</Text>
            {app?.manifest.description ? <Text style={styles.desc}>{app.manifest.description}</Text> : null}
            {blocked ? <Text style={styles.blocked}>Gesperrt: {blocked}</Text> : null}
            {android ? (
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.permTitle}>Über dem Sperrbildschirm anzeigen</Text>
                  <Text style={styles.permDesc}>
                    Aus, bis du es einschaltest. Dann bleibt diese geöffnete OpenScrapp sichtbar, wenn das Handy gesperrt ist. Der Bildschirm darf ausgehen. Die Einschalttaste zeigt sie ohne PIN. Eine Benachrichtigung auf dem Sperrbildschirm nennt diese OpenScrapp, zum Beispiel „Werwolf öffnen“. Sie lässt sich wegwischen, bleibt nach dem Schließen der App stehen und verschwindet, wenn du die Einstellung ausmachst. Tippen öffnet nur diese OpenScrapp, mit ihrem letzten Stand. Katalog, Einstellungen und andere Apps bleiben hinter der Sperre.
                  </Text>
                  {overLock && !showOverLockNativeReady() ? (
                    <Text style={styles.state}>Wirkt ab dem nächsten App-Build.</Text>
                  ) : null}
                </View>
                <Switch
                  value={overLock}
                  onValueChange={(on) => { void setOverLockChoice(on); }}
                  accessibilityLabel="Über dem Sperrbildschirm anzeigen"
                />
              </View>
            ) : null}
            <Text style={styles.section}>Berechtigungen</Text>
            <Text style={styles.hint}>Jede Funktion gilt nur für diese OpenScrapp. Widerrufene Funktionen fragen nicht erneut, bis du sie hier wieder erlaubst.</Text>
            {permissionsOfferedOnPlatform(Platform.OS, ALL_PERMISSIONS).map((permission) => {
              const allowed = granted.includes(permission);
              const rejected = denied.includes(permission);
              const state = allowed ? 'erlaubt' : rejected ? 'abgelehnt' : 'nicht entschieden';
              return (
                <View key={permission} style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.permTitle}>{PERMISSION_INFO[permission].title}</Text>
                    <Text style={styles.permDesc}>{PERMISSION_INFO[permission].description}</Text>
                    <Text style={styles.state}>{state}</Text>
                  </View>
                  {allowed ? (
                    <TouchableOpacity style={styles.revoke} onPress={() => { void decide(permission, 'denied'); }}>
                      <Text style={styles.revokeText}>Widerrufen</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.allow} onPress={() => { void decide(permission, 'granted'); }}>
                      <Text style={styles.allowText}>Erlauben</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </ScrollView>
          <View style={styles.actions}>
            {!blocked && app ? (
              <TouchableOpacity style={styles.primary} disabled={refreshing} onPress={() => onUpdate(app)}>
                <Text style={styles.primaryText}>{refreshing ? 'Aktualisiere…' : 'Aktualisieren'}</Text>
              </TouchableOpacity>
            ) : null}
            {app && onShowSource && showsLearningChrome(Platform.OS) ? (
              <TouchableOpacity style={styles.secondary} onPress={() => onShowSource(app)}>
                <Text style={styles.secondaryText}>Quelltext</Text>
              </TouchableOpacity>
            ) : null}
            {app ? (
              <TouchableOpacity style={styles.secondary} onPress={() => onReport(app)}>
                <Text style={styles.secondaryText}>Melden</Text>
              </TouchableOpacity>
            ) : null}
            {app ? (
              <TouchableOpacity style={styles.danger} onPress={() => onDelete(app)}>
                <Text style={styles.dangerText}>Löschen</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.secondary} onPress={onClose}>
              <Text style={styles.secondaryText}>Schließen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 },
  card: { backgroundColor: 'white', borderRadius: 12, maxHeight: '90%', padding: 16 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  meta: { fontSize: 13, color: '#1565C0', marginBottom: 8 },
  repo: { fontSize: 12, color: '#333', backgroundColor: '#f2f2f2', padding: 8, borderRadius: 6, marginBottom: 8 },
  desc: { fontSize: 14, color: '#444', marginBottom: 8 },
  blocked: { color: '#b71c1c', fontWeight: '600', marginBottom: 8 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  hint: { fontSize: 12, color: '#666', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#eee' },
  rowText: { flex: 1, paddingRight: 8 },
  permTitle: { fontSize: 14, fontWeight: '600' },
  permDesc: { fontSize: 12, color: '#555' },
  state: { fontSize: 12, color: '#777', marginTop: 2 },
  allow: { backgroundColor: '#2196F3', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8 },
  allowText: { color: 'white', fontWeight: '600', fontSize: 12 },
  revoke: { backgroundColor: '#f3e5e5', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8 },
  revokeText: { color: '#b71c1c', fontWeight: '600', fontSize: 12 },
  actions: { paddingTop: 8 },
  primary: { backgroundColor: '#2196F3', borderRadius: 8, padding: 12, marginTop: 8 },
  primaryText: { color: 'white', textAlign: 'center', fontWeight: '700' },
  secondary: { backgroundColor: '#f0f0f0', borderRadius: 8, padding: 12, marginTop: 8 },
  secondaryText: { textAlign: 'center', fontWeight: '600', color: '#333' },
  danger: { backgroundColor: '#ffebee', borderRadius: 8, padding: 12, marginTop: 8 },
  dangerText: { textAlign: 'center', fontWeight: '700', color: '#b71c1c' },
});
