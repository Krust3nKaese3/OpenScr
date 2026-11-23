import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'qrcode';
import { decodeJoinUrl } from '../services/multiplayer/qr';
import type { MpUiState } from '../services/multiplayer/session';
import { encodeWifiQr } from '../services/multiplayer/guestHttp';
import { getInviteDraft, setInviteDraft, type InviteDraft } from '../services/multiplayer/invite';
import { loadWifiPassword, rememberWifiPassword } from '../services/multiplayer/wifiMemory';
import { openTetherSettings, readWifiLabel, startHotspot } from '../services/multiplayer/lanShare';

interface MultiplayerOverlayProps {
  state: MpUiState | null;
  onDone: () => void;
  onEnd: () => void;
  onScanned: (text: string) => void;
  onCancel: () => void;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}

/** Einladung für Browser-Gäste und Scanner für den Beitritt. Die OpenScrapp zeichnet das nicht selbst. */
export function MultiplayerOverlay({ state, onDone, onEnd, onScanned, onCancel, onApprove, onDeny }: MultiplayerOverlayProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanHint, setScanHint] = useState('');
  const saved = getInviteDraft();
  const [step, setStep] = useState<'choose' | 'wlan' | 'hotspot' | 'codes'>(saved ? 'codes' : 'choose');
  const [ssid, setSsid] = useState(saved?.ssid || '');
  const [password, setPassword] = useState(saved?.password || '');
  const [remember, setRemember] = useState(false);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAppQr, setShowAppQr] = useState(false);

  useEffect(() => {
    if (state?.mode !== 'host' || !state.qrFocus) return;
    if (state.qrFocus === 'wifi') setStep(getInviteDraft()?.ssid ? 'codes' : 'wlan');
    else if (state.qrFocus === 'game') setStep('codes');
    else if (state.qrFocus === 'hotspot') setStep('hotspot');
    else setStep(getInviteDraft() ? 'codes' : 'choose');
  }, [state?.mode, state?.qrFocus, state?.roomCode]);

  useEffect(() => {
    if (state?.mode !== 'host' || step !== 'wlan') return undefined;
    let cancel = false;
    void readWifiLabel().then(async (info) => {
      if (cancel) return;
      if (info.ssid) setSsid((current) => current || info.ssid);
      if (info.detail) setDetail(info.detail);
      if (!info.ssid) return;
      const stored = await loadWifiPassword(info.ssid);
      if (!cancel && stored) {
        setPassword((current) => current || stored);
        setRemember(true);
      }
    });
    return () => { cancel = true; };
  }, [state?.mode, step]);

  if (!state) return null;

  if (state.mode === 'scan') {
    const allowed = permission?.granted;
    return (
      <View style={styles.screen}>
        {allowed ? (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={(event) => {
              const text = event?.data || '';
              try {
                decodeJoinUrl(text);
              } catch (error) {
                setScanHint(error instanceof Error ? error.message : 'Das ist kein Spielraum.');
                return;
              }
              onScanned(text);
            }}
          />
        ) : (
          <View style={styles.center}>
            <Text style={styles.title}>Kamera für den QR-Code</Text>
            <TouchableOpacity style={styles.primary} onPress={() => { void requestPermission(); }}>
              <Text style={styles.primaryText}>Kamera erlauben</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.hintBar}>
          <Text style={styles.hint}>{scanHint || 'QR-Code des Hosts scannen'}</Text>
          <TouchableOpacity style={styles.secondary} onPress={onCancel}>
            <Text style={styles.secondaryText}>Abbrechen</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (state.mode === 'ask' && state.requestId) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>{state.askName || 'Jemand'} möchte beitreten</Text>
        <Text style={styles.hint}>Raum {state.roomCode}. Nur zulassen, wenn du den Namen kennst.</Text>
        <TouchableOpacity style={styles.primary} onPress={() => onApprove(state.requestId || '')}>
          <Text style={styles.primaryText}>Zulassen</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={() => onDeny(state.requestId || '')}>
          <Text style={styles.secondaryText}>Ablehnen</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const wifiPayload = ssid ? encodeWifiQr(ssid, password) : '';
  const finish = (link: InviteDraft['link'], nextSsid = ssid, nextPassword = password) => {
    const name = nextSsid.trim();
    setSsid(name);
    setPassword(nextPassword);
    setInviteDraft({ link, ssid: name, password: nextPassword });
    void rememberWifiPassword(name, nextPassword, remember);
    setStep('codes');
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {state.batteryWarning ? <Text style={styles.warn}>{state.batteryWarning}</Text> : null}
        <Text style={styles.title}>Mitspieler einladen</Text>
        <Text style={styles.code}>{state.roomCode}</Text>
        {step === 'choose' ? (
          <>
            <Text style={styles.hint}>Wie kommen die Gäste ins Netz? Danach spielen sie im Browser, ohne OpenScr zu installieren.</Text>
            <TouchableOpacity style={styles.primary} onPress={() => { setDetail(''); setStep('wlan'); }}>
              <Text style={styles.primaryText}>WLAN</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primary} onPress={() => { setDetail(''); setStep('hotspot'); }}>
              <Text style={styles.primaryText}>Hotspot</Text>
            </TouchableOpacity>
          </>
        ) : null}
        {step === 'wlan' ? (
          <>
            <Text style={styles.hint}>{detail || 'Dieses Handy ist in diesem WLAN.'}</Text>
            <TextInput style={styles.input} value={ssid} onChangeText={setSsid} placeholder="WLAN-Name" placeholderTextColor="#8b909c" autoCapitalize="none" />
            <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="WLAN-Passwort" placeholderTextColor="#8b909c" autoCapitalize="none" secureTextEntry />
            <TouchableOpacity style={styles.check} onPress={() => setRemember((value) => !value)}>
              <Text style={styles.hint}>{remember ? '☑' : '☐'} Passwort auf diesem Gerät merken</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primary} onPress={() => finish('wlan')} disabled={!ssid.trim() || !password}>
              <Text style={styles.primaryText}>QR-Codes zeigen</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => setStep('choose')}>
              <Text style={styles.secondaryText}>Zurück</Text>
            </TouchableOpacity>
          </>
        ) : null}
        {step === 'hotspot' ? (
          <>
            <Text style={styles.hint}>Der Hotspot dieses Handys. Wenn Android die Zugangsdaten nicht herausgibt, tippst du sie ab.</Text>
            <TouchableOpacity
              style={styles.primary}
              onPress={() => {
                setBusy(true);
                void startHotspot().then((result) => {
                  setBusy(false);
                  setDetail(result.detail);
                  if (result.ok && result.ssid && result.password) finish('hotspot', result.ssid, result.password);
                  else {
                    if (result.ssid) setSsid(result.ssid);
                    if (result.password) setPassword(result.password);
                  }
                });
              }}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Hotspot einschalten</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => { void openTetherSettings(); }}>
              <Text style={styles.secondaryText}>Systemeinstellungen öffnen</Text>
            </TouchableOpacity>
            {detail ? <Text style={styles.hint}>{detail}</Text> : null}
            <TextInput style={styles.input} value={ssid} onChangeText={setSsid} placeholder="Hotspot-Name" placeholderTextColor="#8b909c" autoCapitalize="none" />
            <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Hotspot-Passwort" placeholderTextColor="#8b909c" autoCapitalize="none" secureTextEntry />
            <TouchableOpacity style={styles.check} onPress={() => setRemember((value) => !value)}>
              <Text style={styles.hint}>{remember ? '☑' : '☐'} Passwort auf diesem Gerät merken</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primary} onPress={() => finish('hotspot')} disabled={!ssid.trim() || !password}>
              <Text style={styles.primaryText}>QR-Codes zeigen</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => setStep('choose')}>
              <Text style={styles.secondaryText}>Zurück</Text>
            </TouchableOpacity>
          </>
        ) : null}
        {step === 'codes' ? (
          <>
            <Text style={styles.label}>WLAN beitreten</Text>
            <QrBlock payload={wifiPayload} />
            <Text style={styles.hint}>{ssid ? `Netz ${ssid}` : 'Zuerst den Netznamen setzen.'}</Text>
            <Text style={styles.label}>Spiel im Browser</Text>
            {state.gameUrl ? <QrBlock payload={state.gameUrl} /> : <Text style={styles.hint}>Der Browser-Server braucht einen Build mit TCP. App-Gäste können weiter beitreten.</Text>}
            <Text style={styles.hint}>Gäste scannen beide Codes. Das Spiel läuft im normalen Browser.</Text>
            <TouchableOpacity style={styles.secondary} onPress={() => setShowAppQr((value) => !value)}>
              <Text style={styles.secondaryText}>{showAppQr ? 'App-Code ausblenden' : 'Code für die OpenScr-App'}</Text>
            </TouchableOpacity>
            {showAppQr && state.qrPayload ? <QrBlock payload={state.qrPayload} /> : null}
            <TouchableOpacity style={styles.primary} onPress={onDone}>
              <Text style={styles.primaryText}>Fertig</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => setStep('choose')}>
              <Text style={styles.secondaryText}>Netz ändern</Text>
            </TouchableOpacity>
          </>
        ) : null}
        <TouchableOpacity style={styles.secondary} onPress={onEnd}>
          <Text style={styles.secondaryText}>Raum beenden</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function QrBlock({ payload }: { payload: string }) {
  const matrix = useMemo(() => {
    if (!payload) return null;
    const code = QRCode.create(payload, { errorCorrectionLevel: 'M' });
    const size = code.modules.size;
    const cells: number[] = [];
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) cells.push(code.modules.get(row, col) ? 1 : 0);
    }
    return { size, cells };
  }, [payload]);
  if (!matrix) return null;
  const cell = Math.max(2, Math.floor(200 / matrix.size));
  return (
    <View style={styles.qrPad}>
      <View style={{ width: cell * matrix.size, height: cell * matrix.size, flexDirection: 'row', flexWrap: 'wrap' }}>
        {matrix.cells.map((bit, index) => (
          <View key={index} style={{ width: cell, height: cell, backgroundColor: bit ? '#000' : '#fff' }} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 30,
    backgroundColor: '#0f1115',
  },
  scroll: { alignItems: 'center', padding: 24, paddingTop: 48 },
  camera: { flex: 1, alignSelf: 'stretch', marginBottom: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  code: { color: '#fff', fontSize: 32, letterSpacing: 4, fontWeight: '800', marginBottom: 12 },
  label: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: 8 },
  qrPad: { backgroundColor: '#fff', padding: 10, borderRadius: 12, marginVertical: 8 },
  hint: { color: '#d5d8e0', fontSize: 15, textAlign: 'center', marginBottom: 12 },
  warn: { color: '#1a1206', backgroundColor: '#f0c14a', borderRadius: 10, padding: 10, marginBottom: 12, textAlign: 'center', overflow: 'hidden' },
  hintBar: { position: 'absolute', left: 16, right: 16, bottom: 28, alignItems: 'center' },
  input: { alignSelf: 'stretch', backgroundColor: '#1b1f2a', color: '#fff', borderRadius: 10, padding: 12, marginBottom: 10 },
  check: { marginBottom: 8 },
  primary: { backgroundColor: '#2f6fed', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28, marginBottom: 10, minWidth: 220, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  secondary: { paddingVertical: 10, paddingHorizontal: 16 },
  secondaryText: { color: '#fff', fontSize: 16 },
});
