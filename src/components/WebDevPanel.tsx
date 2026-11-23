import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  devBluetoothOn,
  devFailNext,
  devFixtureSnapshot,
  devLogOut,
  devScanEmpty,
  devSetPaused,
  devSetPlaying,
  devSkipNext,
} from '../services/webDevFixtures';

const ACTIONS: { label: string; run: () => void }[] = [
  { label: 'Spielt', run: devSetPlaying },
  { label: 'Pause', run: devSetPaused },
  { label: 'Nächster', run: devSkipNext },
  { label: 'Fehler', run: devFailNext },
  { label: 'Abgemeldet', run: devLogOut },
  { label: 'BT an', run: devBluetoothOn },
  { label: 'Scan leer', run: devScanEmpty },
];

/** Browser-only controls for the Spotify and Bluetooth fixtures. */
export function WebDevPanel() {
  const [label, setLabel] = React.useState('');
  if (Platform.OS !== 'web') return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Text style={styles.title}>Dev-Fixture</Text>
      <View style={styles.row}>
        {ACTIONS.map((action) => (
          <Pressable
            key={action.label}
            onPress={() => {
              action.run();
              const snap = devFixtureSnapshot();
              setLabel(`${snap.track}${snap.paused ? ' · Pause' : ' · spielt'}${snap.loggedIn ? '' : ' · abgemeldet'}${snap.btOn ? ' · BT' : ''}${snap.scanEmpty ? ' · Scan leer' : ''}${snap.failNext ? ' · nächster Aufruf schlägt fehl' : ''}`);
            }}
            style={styles.chip}
          >
            <Text style={styles.chipText}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
      {label ? <Text style={styles.status}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 78,
    left: 8,
    right: 8,
    zIndex: 50,
    backgroundColor: 'rgba(20,20,24,0.92)',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#2A2A32',
  },
  title: { color: '#A3E635', fontSize: 11, fontWeight: '700', marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: '#2A2A32', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { color: '#F4F4F5', fontSize: 12 },
  status: { color: '#8E8E93', fontSize: 11, marginTop: 6 },
});
