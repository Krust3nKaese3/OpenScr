import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { notify } from '../services/notify';
import { addPlayer, formatPlayer, listPlayers, removePlayer, type PlayerRecord } from '../services/playerRoster';
import { useContainerTheme } from '../theme/containerTheme';

export function PlayerNamesModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const tokens = useContainerTheme();
  const [rows, setRows] = useState<PlayerRecord[]>([]);
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setRows(await listPlayers());
  };

  useEffect(() => {
    if (visible) void reload();
  }, [visible]);

  const save = async () => {
    setBusy(true);
    try {
      await addPlayer(name, tag);
      setName('');
      setTag('');
      await reload();
    } catch (error) {
      notify('Spielername', error instanceof Error ? error.message : 'Der Name konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: tokens.card }]}>
          <Text style={[styles.title, { color: tokens.text }]}>Spielernamen</Text>
          <Text style={[styles.hint, { color: tokens.muted }]}>
            Ein Name gilt für alle OpenScrapps auf diesem Gerät. Er besteht aus Anzeigename und Tag, zum Beispiel Mina#7K2.
          </Text>
          <View style={styles.form}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Anzeigename"
              placeholderTextColor={tokens.muted}
              autoCapitalize="words"
              autoCorrect={false}
              style={[styles.input, { color: tokens.text, borderColor: tokens.line, backgroundColor: tokens.bg }]}
            />
            <TextInput
              value={tag}
              onChangeText={setTag}
              placeholder="Tag"
              placeholderTextColor={tokens.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              style={[styles.tag, { color: tokens.text, borderColor: tokens.line, backgroundColor: tokens.bg }]}
            />
          </View>
          <TouchableOpacity style={[styles.add, { backgroundColor: tokens.lime }]} onPress={() => { void save(); }} disabled={busy} accessibilityLabel="Hinzufügen">
            {busy ? <ActivityIndicator color={tokens.ink} /> : <Ionicons name="add" size={26} color={tokens.ink} />}
          </TouchableOpacity>
          <ScrollView style={styles.list} nativeID="openscr-names-scroll">
            {rows.length === 0 ? <Text style={[styles.hint, { color: tokens.muted }]}>Noch keine Namen.</Text> : rows.map((row) => (
              <View key={row.id} style={styles.row}>
                <Text style={[styles.player, { color: tokens.text }]}>{formatPlayer(row)}</Text>
                <TouchableOpacity accessibilityLabel="Entfernen" onPress={() => { void removePlayer(row.id).then(reload); }}>
                  <Ionicons name="trash-outline" size={20} color={tokens.danger} />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity onPress={onClose} accessibilityLabel="Schließen" style={styles.close}>
            <Ionicons name="close" size={26} color={tokens.lime} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 20 },
  card: { borderRadius: 18, padding: 16, maxHeight: '80%' },
  title: { fontSize: 20, fontWeight: '700' },
  hint: { fontSize: 14, lineHeight: 20, marginTop: 8 },
  form: { flexDirection: 'row', gap: 8, marginTop: 12 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16 },
  tag: { width: 88, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16 },
  add: { marginTop: 10, borderRadius: 12, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  addText: { fontWeight: '700' },
  list: { marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  player: { fontSize: 16, fontWeight: '600' },
  close: { alignItems: 'center', marginTop: 8, padding: 8 },
});
