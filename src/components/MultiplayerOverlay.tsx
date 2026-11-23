import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'qrcode';
import { decodeJoinUrl } from '../services/multiplayer/qr';
import type { MpUiState } from '../services/multiplayer/session';
import { encodeWifiQr, shareableGameUrl } from '../services/multiplayer/guestHttp';
import { getInviteDraft, setInviteDraft, type InviteDraft } from '../services/multiplayer/invite';
import { rememberWifiPassword } from '../services/multiplayer/wifiMemory';
import { openTetherSettings, openWifiSettings, startHotspot } from '../services/multiplayer/lanShare';
import { useContainerTheme } from '../theme/containerTheme';

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
  const [step, setStep] = useState<'choose' | 'wlan' | 'hotspot' | 'codes'>(saved?.link === 'hotspot' && saved.ssid ? 'codes' : 'wlan');
  const [ssid, setSsid] = useState(saved?.ssid || '');
  const [password, setPassword] = useState(saved?.password || '');
  const [remember, setRemember] = useState(false);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAppQr, setShowAppQr] = useState(false);
  const [link, setLink] = useState<'wlan' | 'hotspot'>(saved?.link === 'hotspot' ? 'hotspot' : 'wlan');
  const tokens = useContainerTheme();

  useEffect(() => {
    if (state?.mode !== 'host' || !state.qrFocus) return;
    const draft = getInviteDraft();
    if (state.qrFocus === 'hotspot') {
      setLink('hotspot');
      setStep(draft?.link === 'hotspot' && draft.ssid ? 'codes' : 'hotspot');
    } else if (state.qrFocus === 'game' && draft?.link === 'hotspot' && draft.ssid) {
      setLink('hotspot');
      setStep('codes');
    } else {
      setLink('wlan');
      setStep('wlan');
    }
  }, [state?.mode, state?.qrFocus, state?.roomCode]);

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
  const finish = (nextLink: InviteDraft['link'], nextSsid = ssid, nextPassword = password) => {
    const name = nextSsid.trim();
    setSsid(name);
    setPassword(nextPassword);
    setLink(nextLink);
    setInviteDraft({ link: nextLink, ssid: name, password: nextPassword });
    void rememberWifiPassword(name, nextPassword, remember);
    setStep('codes');
  };
  const ready = step === 'codes' && !!ssid.trim() && !!password;
  const guests = state.connectedGuests || 0;
  const chip = link === 'hotspot'
    ? (ssid ? `Hotspot an${guests ? ` · ${guests} verbunden` : ''}` : 'Hotspot aus')
    : 'Gleiches WLAN';

  return (
    <View style={[styles.screen, { backgroundColor: tokens.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onDone} accessibilityLabel="Zurück" style={styles.hit}>
            <Text style={[styles.back, { color: tokens.text }]}>←</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={() => {
              Alert.alert('Einladen', 'Gäste scannen beide Codes mit der normalen Kamera. OpenScr brauchen sie nicht.', [
                { text: 'Schließen', style: 'cancel' },
                { text: 'Raum beenden', style: 'destructive', onPress: onEnd },
              ]);
            }}
            accessibilityLabel="Hilfe"
            style={[styles.help, { borderColor: tokens.lime }]}
          >
            <Text style={{ color: tokens.lime, fontWeight: '700' }}>?</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.title, { color: tokens.text }]}>Mitspieler einladen</Text>
        <Text style={[styles.sub, { color: tokens.muted }]}>{state.roomCode}</Text>
        {state.batteryWarning ? <Text style={styles.warn}>{state.batteryWarning}</Text> : null}
        <View style={[styles.segment, { backgroundColor: tokens.card }]}>
          <TouchableOpacity style={[styles.segmentItem, link === 'wlan' ? { backgroundColor: tokens.lime } : null]} onPress={() => { setLink('wlan'); setStep('wlan'); }}>
            <Text style={[styles.segmentText, { color: link === 'wlan' ? tokens.ink : tokens.muted }]}>WLAN</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.segmentItem, link === 'hotspot' ? { backgroundColor: tokens.lime } : null]} onPress={() => { setLink('hotspot'); setStep(getInviteDraft()?.link === 'hotspot' && ssid ? 'codes' : 'hotspot'); }}>
            <Text style={[styles.segmentText, { color: link === 'hotspot' ? tokens.ink : tokens.muted }]}>Hotspot</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.chip, { backgroundColor: tokens.card }]}>
          <View style={[styles.chipDot, { backgroundColor: link === 'wlan' || ssid ? tokens.lime : tokens.muted }]} />
          <Text style={[styles.chipText, { color: tokens.text }]}>{chip}</Text>
        </View>
        {link === 'wlan' ? (
          <>
            <Text style={[styles.hint, { color: tokens.muted }]}>Stellt sicher, dass ihr im selben WLAN seid</Text>
            <TouchableOpacity style={[styles.primary, { backgroundColor: tokens.lime }]} onPress={() => { void openWifiSettings(); }}>
              <Text style={[styles.primaryText, { color: tokens.ink }]}>WLAN teilen</Text>
            </TouchableOpacity>
            <View style={styles.stepRow}>
              <View style={[styles.stepBadge, { backgroundColor: tokens.lime }]}><Text style={[styles.stepNum, { color: tokens.ink }]}>1</Text></View>
              <Text style={[styles.stepTitle, { color: tokens.text }]}>Spiel öffnen</Text>
            </View>
            <View style={[styles.gameCard, { backgroundColor: tokens.card }]}>
              <GuestJoin state={state} size={220} ink={tokens.text} muted={tokens.muted} spinner={tokens.lime} />
              <Text style={[styles.gameText, { color: tokens.text }]}>Scanne den Code mit der normalen Kamera. Du brauchst OpenScr nicht.</Text>
            </View>
            {state.guestPhase === 'ready' && state.gameUrl ? <GameLinkActions url={state.gameUrl} /> : null}
            <TouchableOpacity onPress={() => setShowAppQr((value) => !value)}>
              <Text style={[styles.quiet, { color: tokens.muted }]}>{showAppQr ? 'App-Code ausblenden' : 'Code für die OpenScr-App'}</Text>
            </TouchableOpacity>
            {showAppQr && state.qrPayload ? <QrBlock payload={state.qrPayload} size={140} /> : null}
            <TouchableOpacity style={[styles.primary, { backgroundColor: tokens.lime }]} onPress={onDone}>
              <Text style={[styles.primaryText, { color: tokens.ink }]}>Spiel starten</Text>
            </TouchableOpacity>
          </>
        ) : ready ? (
          <>
            <View style={styles.stepRow}>
              <View style={[styles.stepBadge, { backgroundColor: tokens.lime }]}><Text style={[styles.stepNum, { color: tokens.ink }]}>1</Text></View>
              <Text style={[styles.stepTitle, { color: tokens.text }]}>{link === 'hotspot' ? 'Mit Hotspot verbinden' : 'Mit WLAN verbinden'}</Text>
            </View>
            <View style={[styles.qrCard, { backgroundColor: tokens.card }]}>
              <QrBlock payload={wifiPayload} size={220} />
            </View>
            <View style={styles.stepRow}>
              <View style={[styles.stepBadge, { backgroundColor: tokens.lime }]}><Text style={[styles.stepNum, { color: tokens.ink }]}>2</Text></View>
              <Text style={[styles.stepTitle, { color: tokens.text }]}>Spiel öffnen</Text>
            </View>
            <View style={[styles.gameCard, { backgroundColor: tokens.card }]}>
              <GuestJoin state={state} size={72} ink={tokens.text} muted={tokens.muted} spinner={tokens.lime} />
              <Text style={[styles.gameText, { color: tokens.text }]}>Scanne den Code mit der normalen Kamera. Du brauchst OpenScr nicht.</Text>
            </View>
            {state.guestPhase === 'ready' && state.gameUrl ? <GameLinkActions url={state.gameUrl} /> : null}
            <TouchableOpacity onPress={() => setShowAppQr((value) => !value)}>
              <Text style={[styles.quiet, { color: tokens.muted }]}>{showAppQr ? 'App-Code ausblenden' : 'Code für die OpenScr-App'}</Text>
            </TouchableOpacity>
            {showAppQr && state.qrPayload ? <QrBlock payload={state.qrPayload} size={140} /> : null}
            <TouchableOpacity style={[styles.primary, { backgroundColor: tokens.lime }]} onPress={onDone}>
              <Text style={[styles.primaryText, { color: tokens.ink }]}>Spiel starten</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={[styles.hint, { color: tokens.muted }]}>Der Hotspot dieses Handys. Wenn Android die Zugangsdaten nicht herausgibt, tippst du sie ab.</Text>
            <TouchableOpacity
              style={[styles.primary, { backgroundColor: tokens.lime }]}
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
              {busy ? <ActivityIndicator color={tokens.ink} /> : <Text style={[styles.primaryText, { color: tokens.ink }]}>Hotspot einschalten</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { void openTetherSettings(); }}>
              <Text style={[styles.quiet, { color: tokens.muted }]}>Systemeinstellungen öffnen</Text>
            </TouchableOpacity>
            {detail ? <Text style={[styles.hint, { color: tokens.muted }]}>{detail}</Text> : null}
            <TextInput style={[styles.input, { backgroundColor: tokens.card, color: tokens.text }]} value={ssid} onChangeText={setSsid} placeholder="Hotspot-Name" placeholderTextColor={tokens.muted} autoCapitalize="none" />
            <TextInput style={[styles.input, { backgroundColor: tokens.card, color: tokens.text }]} value={password} onChangeText={setPassword} placeholder="Hotspot-Passwort" placeholderTextColor={tokens.muted} autoCapitalize="none" secureTextEntry />
            <TouchableOpacity onPress={() => setRemember((value) => !value)}>
              <Text style={[styles.hint, { color: tokens.muted }]}>{remember ? '☑' : '☐'} Passwort auf diesem Gerät merken</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primary, { backgroundColor: tokens.lime, opacity: !ssid.trim() || !password ? 0.4 : 1 }]} onPress={() => finish('hotspot')} disabled={!ssid.trim() || !password}>
              <Text style={[styles.primaryText, { color: tokens.ink }]}>QR-Codes zeigen</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function GuestJoin({ state, size, ink, muted, spinner }: { state: MpUiState; size: number; ink: string; muted: string; spinner: string }) {
  if (state.guestPhase === 'ready' && state.gameUrl) return <QrBlock payload={state.gameUrl} size={size} />;
  if (state.guestPhase === 'failed') {
    return <Text selectable style={[styles.gameText, { color: muted }]}>{state.guestError || 'Der Browser-Server braucht einen Build mit TCP.'}</Text>;
  }
  return (
    <>
      <ActivityIndicator color={spinner} />
      <Text style={[styles.gameText, { color: ink }]}>Raum wird vorbereitet…</Text>
    </>
  );
}

function GameLinkActions({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(shareableGameUrl(url));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const share = () => {
    void Share.share({ message: shareableGameUrl(url) });
  };
  return (
    <View style={styles.linkRow}>
      <TouchableOpacity style={styles.linkBtn} onPress={() => { void copy(); }} accessibilityLabel="Link kopieren">
        <Text style={styles.linkBtnText}>{copied ? 'Kopiert' : 'Link kopieren'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.linkBtn} onPress={share} accessibilityLabel="Teilen">
        <Text style={styles.linkBtnText}>Teilen</Text>
      </TouchableOpacity>
    </View>
  );
}

function QrBlock({ payload, size: edge = 200 }: { payload: string; size?: number }) {
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
  const cell = Math.max(2, Math.floor(edge / matrix.size));
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
    backgroundColor: '#0B0B0F',
  },
  scroll: { paddingHorizontal: 22, paddingTop: 48, paddingBottom: 36 },
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  hit: { width: 36, height: 36, justifyContent: 'center' },
  back: { fontSize: 24, fontWeight: '600' },
  help: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  camera: { flex: 1, alignSelf: 'stretch', marginBottom: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#F4F4F5', fontSize: 32, fontWeight: '700', letterSpacing: -0.6 },
  sub: { fontSize: 16, marginTop: 2, marginBottom: 16 },
  segment: { flexDirection: 'row', borderRadius: 24, padding: 4, marginBottom: 14 },
  segmentItem: { flex: 1, borderRadius: 20, paddingVertical: 10, alignItems: 'center' },
  segmentText: { fontSize: 15, fontWeight: '700' },
  chip: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 18 },
  chipDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  chipText: { fontSize: 14, fontWeight: '600' },
  stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, marginTop: 6 },
  stepBadge: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  stepNum: { fontWeight: '800' },
  stepTitle: { fontSize: 18, fontWeight: '700' },
  qrCard: { borderRadius: 18, alignItems: 'center', paddingVertical: 16, marginBottom: 16 },
  gameCard: { borderRadius: 18, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12, marginBottom: 8 },
  linkRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  linkBtn: { flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center', backgroundColor: '#1c1c22' },
  linkBtnText: { color: '#F4F4F5', fontSize: 15, fontWeight: '700' },
  gameText: { flex: 1, fontSize: 14, lineHeight: 20 },
  quiet: { textAlign: 'center', marginVertical: 8, fontSize: 14 },
  qrPad: { backgroundColor: '#fff', padding: 8, borderRadius: 12 },
  hint: { color: '#8E8E93', fontSize: 15, textAlign: 'center', marginBottom: 12 },
  warn: { color: '#1a1206', backgroundColor: '#f0c14a', borderRadius: 10, padding: 10, marginBottom: 12, textAlign: 'center', overflow: 'hidden' },
  hintBar: { position: 'absolute', left: 16, right: 16, bottom: 28, alignItems: 'center' },
  input: { alignSelf: 'stretch', borderRadius: 14, padding: 14, marginBottom: 10 },
  primary: { backgroundColor: '#A3E635', borderRadius: 18, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  primaryText: { color: '#0B0B0F', fontSize: 17, fontWeight: '700' },
  secondary: { paddingVertical: 10, paddingHorizontal: 16 },
  secondaryText: { color: '#F4F4F5', fontSize: 16 },
});
