import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatPlayer, listPlayers, type PlayerRecord } from '../services/playerRoster';
import { useContainerTheme } from '../theme/containerTheme';

type AppId = 'werwolf' | 'songraten';
type Direction = 'desc' | 'asc';
type RoleId = 'werwolf' | 'dorfbewohner';

interface Column {
  key: string;
  label: string;
  value: (row: PlayerRecord) => number | string;
}

const APPS: { id: AppId; label: string; icon: 'moon-outline' | 'musical-note-outline' }[] = [
  { id: 'werwolf', label: 'Werwolf', icon: 'moon-outline' },
  { id: 'songraten', label: 'Songraten', icon: 'musical-note-outline' },
];

const ROLES: { id: RoleId; label: string }[] = [
  { id: 'werwolf', label: 'Wolf' },
  { id: 'dorfbewohner', label: 'Dorf' },
];

function werwolfColumns(role: RoleId | null): Column[] {
  const read = (row: PlayerRecord, field: 'games' | 'wins' | 'deaths') => {
    if (!role) return row.werwolf?.[field] ?? 0;
    return row.werwolf?.roles[role]?.[field] ?? 0;
  };
  return [
    { key: 'name', label: 'Name', value: (row) => formatPlayer(row) },
    { key: 'games', label: 'Spiele', value: (row) => read(row, 'games') },
    { key: 'wins', label: 'Siege', value: (row) => read(row, 'wins') },
    { key: 'deaths', label: 'Tode', value: (row) => read(row, 'deaths') },
  ];
}

const COLUMNS: Record<AppId, Column[]> = {
  werwolf: werwolfColumns(null),
  songraten: [
    { key: 'name', label: 'Name', value: (row) => formatPlayer(row) },
    { key: 'games', label: 'Spiele', value: (row) => row.songraten?.games ?? 0 },
    { key: 'wins', label: 'Siege', value: (row) => row.songraten?.wins ?? 0 },
    { key: 'points', label: 'Punkte', value: (row) => row.songraten?.points ?? 0 },
    { key: 'dj', label: 'Als DJ', value: (row) => row.songraten?.djSongs ?? 0 },
    { key: 'guessed', label: 'Erraten', value: (row) => row.songraten?.guessed ?? 0 },
  ],
};

export function PlayerStatsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const tokens = useContainerTheme();
  const [rows, setRows] = useState<PlayerRecord[]>([]);
  const [app, setApp] = useState<AppId | null>(null);
  const [role, setRole] = useState<RoleId | null>(null);
  const [sortKey, setSortKey] = useState('wins');
  const [direction, setDirection] = useState<Direction>('desc');

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const id = 'openscr-scroll-style';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = [
      '#openscr-stats-scroll, #openscr-names-scroll { scrollbar-width: thin; scrollbar-color: #3a3a44 transparent; }',
      '#openscr-stats-scroll::-webkit-scrollbar, #openscr-names-scroll::-webkit-scrollbar { width: 8px; height: 8px; }',
      '#openscr-stats-scroll::-webkit-scrollbar-thumb, #openscr-names-scroll::-webkit-scrollbar-thumb { background: #3a3a44; border-radius: 8px; }',
      '#openscr-stats-scroll::-webkit-scrollbar-track, #openscr-names-scroll::-webkit-scrollbar-track { background: transparent; }',
    ].join('');
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    if (!visible) return;
    setApp(null);
    setRole(null);
    setSortKey('wins');
    setDirection('desc');
    void listPlayers().then(setRows);
  }, [visible]);

  const columns = app === 'werwolf' ? werwolfColumns(role) : app ? COLUMNS[app] : [];
  const roleLabel = ROLES.find((entry) => entry.id === role)?.label;
  const sorted = useMemo(() => {
    const column = columns.find((item) => item.key === sortKey) || columns[0];
    if (!column) return rows;
    const factor = direction === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const left = column.value(a);
      const right = column.value(b);
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor;
      return String(left).localeCompare(String(right), 'de') * factor;
    });
  }, [rows, columns, sortKey, direction]);

  const chooseSort = (key: string) => {
    if (key === sortKey) setDirection((current) => current === 'desc' ? 'asc' : 'desc');
    else {
      setSortKey(key);
      setDirection('desc');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: tokens.card }]}>
          <View style={styles.head}>
            {app ? (
              <TouchableOpacity accessibilityLabel="Zurück" onPress={() => { setApp(null); setRole(null); }}>
                <Ionicons name="chevron-back" size={26} color={tokens.lime} />
              </TouchableOpacity>
            ) : <View style={styles.spacer} />}
            <Text style={[styles.title, { color: tokens.text }]}>{roleLabel ? `Als ${roleLabel}` : 'Statistik'}</Text>
            <TouchableOpacity accessibilityLabel="Schließen" onPress={onClose}>
              <Ionicons name="close" size={26} color={tokens.lime} />
            </TouchableOpacity>
          </View>
          {app ? (
            <View>
              {app === 'werwolf' ? (
                <View style={styles.filters}>
                  <TouchableOpacity
                    accessibilityLabel="Alle Rollen"
                    style={[styles.filter, { backgroundColor: role ? tokens.bg : tokens.lime }]}
                    onPress={() => setRole(null)}
                  >
                    <Text style={[styles.filterText, { color: role ? tokens.text : tokens.bg }]}>Alle</Text>
                  </TouchableOpacity>
                  {ROLES.map((entry) => {
                    const active = role === entry.id;
                    return (
                      <TouchableOpacity
                        key={entry.id}
                        accessibilityLabel={entry.label}
                        style={[styles.filter, { backgroundColor: active ? tokens.lime : tokens.bg }]}
                        onPress={() => setRole(entry.id)}
                      >
                        <Text style={[styles.filterText, { color: active ? tokens.bg : tokens.text }]}>{entry.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
            <ScrollView horizontal>
              <View>
                <View style={styles.tableRow}>
                  {columns.map((column) => {
                    const active = column.key === sortKey;
                    return (
                      <TouchableOpacity key={column.key} style={[styles.cell, column.key === 'name' && styles.nameCell]} onPress={() => chooseSort(column.key)} accessibilityLabel={column.label}>
                        <Text style={[styles.headText, { color: active ? tokens.lime : tokens.muted }]}>{column.label}</Text>
                        {active ? (
                          <Ionicons name={direction === 'asc' ? 'chevron-up' : 'chevron-down'} size={16} color={tokens.lime} />
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <ScrollView style={styles.body} nativeID="openscr-stats-scroll">
                  {sorted.map((row) => (
                    <View key={row.id} style={[styles.tableRow, { borderTopColor: tokens.line }]}>
                      {columns.map((column) => (
                        <Text key={column.key} style={[styles.cellText, column.key === 'name' && styles.nameCell, { color: tokens.text }]} numberOfLines={1}>
                          {String(column.value(row))}
                        </Text>
                      ))}
                    </View>
                  ))}
                </ScrollView>
              </View>
            </ScrollView>
            </View>
          ) : (
            <View style={styles.choices}>
              {APPS.map((entry) => (
                <TouchableOpacity
                  key={entry.id}
                  accessibilityLabel={entry.label}
                  style={[styles.choice, { backgroundColor: tokens.bg }]}
                  onPress={() => { setApp(entry.id); setRole(null); setSortKey('wins'); setDirection('desc'); }}
                >
                  <Ionicons name={entry.icon} size={36} color={tokens.lime} />
                  <Text style={[styles.choiceLabel, { color: tokens.text }]}>{entry.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 16 },
  card: { borderRadius: 18, padding: 16, maxHeight: '86%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  spacer: { width: 26 },
  title: { fontSize: 20, fontWeight: '700' },
  choices: { flexDirection: 'row', gap: 12, marginTop: 20 },
  choice: { flex: 1, borderRadius: 16, minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 10 },
  choiceLabel: { fontSize: 16, fontWeight: '700' },
  filters: { flexDirection: 'row', gap: 8, marginTop: 16, marginBottom: 4 },
  filter: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  filterText: { fontSize: 14, fontWeight: '700' },
  tableRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'transparent' },
  cell: { width: 108, flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, paddingRight: 8 },
  nameCell: { width: 168 },
  headText: { fontSize: 13, fontWeight: '700' },
  cellText: { width: 108, fontSize: 14, paddingVertical: 10, paddingRight: 8 },
  body: { maxHeight: 420 },
});
