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
  const [open, setOpen] = React.useState(false);
  if (Platform.OS !== 'web') return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {open ? (
        <View style={styles.panel}>
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
      ) : null}
      <Pressable onPress={() => setOpen((value) => !value)} style={styles.toggle}>
        <Text style={styles.title}>{open ? 'Dev-Fixture ▾' : 'Dev-Fixture'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    zIndex: 50,
    alignItems: 'flex-end',
    maxWidth: 'calc(100% - 32px)',
  },
  panel: {
    marginBottom: 8,
    backgroundColor: 'rgba(20,20,24,0.92)',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#2A2A32',
    maxWidth: 360,
  },
  toggle: {
    backgroundColor: 'rgba(20,20,24,0.92)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#2A2A32',
  },
  title: { color: '#A3E635', fontSize: 11, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' },
  chip: { backgroundColor: '#2A2A32', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { color: '#F4F4F5', fontSize: 12 },
  status: { color: '#8E8E93', fontSize: 11, marginTop: 6 },
});
