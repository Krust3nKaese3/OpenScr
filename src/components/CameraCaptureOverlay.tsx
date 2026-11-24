import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CameraView } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import {
  cancelCameraCapture,
  finishCameraCapture,
  subscribeCameraCapture,
  type CameraCaptureRequest,
} from '../services/cameraCapture';

/** Visible preview with shutter or QR scan. The picture is returned as a data URI and not saved to the photo library. */
export function CameraCaptureOverlay() {
  const [request, setRequest] = useState<CameraCaptureRequest | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const done = useRef(false);

  useEffect(() => subscribeCameraCapture((next) => {
    done.current = false;
    setRequest(next);
  }), []);

  if (!request) return null;

  const finish = (value: string) => {
    if (done.current) return;
    done.current = true;
    finishCameraCapture(value);
  };

  const takePhoto = async () => {
    if (done.current) return;
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        base64: true,
        quality: 0.5,
      });
      const base64 = photo?.base64;
      if (!base64) throw new Error('Kein Bild.');
      const uri = photo?.uri;
      if (uri) {
        try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch { /* Die Vorschau-Datei darf fehlen. */ }
      }
      finish(`data:image/jpeg;base64,${base64}`);
    } catch (error) {
      if (done.current) return;
      done.current = true;
      cancelCameraCapture(error instanceof Error ? error.message : 'Foto fehlgeschlagen.');
    }
  };

  return (
    <View style={styles.screen}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        mode="picture"
        mute
        barcodeScannerSettings={request.mode === 'qr' ? { barcodeTypes: ['qr'] } : undefined}
        onBarcodeScanned={request.mode === 'qr' ? (event) => {
          const text = event?.data || '';
          if (text) finish(text);
        } : undefined}
      />
      <View style={styles.bar}>
        <Text style={styles.hint}>{request.mode === 'qr' ? 'QR-Code vor die Kamera halten' : 'Foto aufnehmen'}</Text>
        <View style={styles.actions}>
          {request.mode === 'photo' ? (
            <TouchableOpacity style={styles.shutter} onPress={() => { void takePhoto(); }} accessibilityLabel="Auslösen">
              <Text style={styles.shutterText}>Auslösen</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.cancel} onPress={() => cancelCameraCapture()} accessibilityLabel="Abbrechen">
            <Text style={styles.cancelText}>Abbrechen</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, backgroundColor: '#000', zIndex: 40 },
  camera: { flex: 1 },
  bar: { padding: 16, gap: 12, backgroundColor: '#0B0B0F' },
  hint: { color: '#fff', fontSize: 16, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 12 },
  shutter: { backgroundColor: '#C6F135', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18 },
  shutterText: { color: '#0B0B0F', fontWeight: '800' },
  cancel: { borderColor: '#fff', borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18 },
  cancelText: { color: '#fff', fontWeight: '700' },
});
