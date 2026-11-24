import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { decodeJoinUrl } from '../services/multiplayer/qr';
import type { MpUiState } from '../services/multiplayer/session';

interface MultiplayerOverlayProps {
  state: MpUiState | null;
  onDone: () => void;
  onEnd: () => void;
  onScanned: (text: string) => void;
  onCancel: () => void;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}

/** Scanner und Beitrittsfrage. Die Einladung zeichnet die OpenScrapp selbst. */
export function MultiplayerOverlay({ state, onScanned, onCancel, onApprove, onDeny }: MultiplayerOverlayProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanHint, setScanHint] = useState('');

  if (!state || state.mode === 'host') return null;

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

  return null;
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
  camera: { flex: 1, alignSelf: 'stretch', marginBottom: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#F4F4F5', fontSize: 32, fontWeight: '700', letterSpacing: -0.6 },
  hint: { color: '#8E8E93', fontSize: 15, textAlign: 'center', marginBottom: 12 },
  hintBar: { position: 'absolute', left: 16, right: 16, bottom: 28, alignItems: 'center' },
  primary: { backgroundColor: '#A3E635', borderRadius: 18, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  primaryText: { color: '#0B0B0F', fontSize: 17, fontWeight: '700' },
  secondary: { paddingVertical: 10, paddingHorizontal: 16 },
  secondaryText: { color: '#F4F4F5', fontSize: 16 },
});
