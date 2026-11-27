import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { addAddonRepo, listAddons, removeAddon, setAddonEnabled } from '../services/addons/store';
import { addonTokenStoreAvailable, clearAddonGithubToken, readAddonGithubToken, writeAddonGithubToken } from '../services/addons/githubToken';
import { CachedAddon } from '../services/addons/inject';

/** Sichtbar nur, wenn der Aufrufer die Plattform schon geprüft hat. */
export const AddonSettings: React.FC<{ platform: string }> = ({ platform }) => {
  const [rows, setRows] = useState<CachedAddon[]>([]);
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const reload = async () => {
    setRows(await listAddons(platform));
    setHasToken(!!(await readAddonGithubToken()));
  };

  useEffect(() => { reload().catch(() => {}); }, [platform]);

  const saveToken = async () => {
    setBusy(true);
    try {
      await writeAddonGithubToken(token);
      setToken('');
      setNote('Token für private Add-ons liegt nur auf diesem Gerät.');
      await reload();
    } catch (error) {
      Alert.alert('Add-on', error instanceof Error ? error.message : 'Token nicht gespeichert.');
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    setBusy(true);
    setNote('');
    try {
      const row = await addAddonRepo(platform, repo.trim());
      setRepo('');
      setNote(`${row.name} ist gespeichert.`);
      await reload();
    } catch (error) {
      Alert.alert('Add-on', error instanceof Error ? error.message : 'Repository nicht geladen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Text style={styles.title}>Add-ons</Text>
      <Text style={styles.body}>
        Ein Add-on ist ein GitHub-Repository mit addon.json. Es wird nach dem Start der genannten OpenScrapp eingesetzt. Auf iOS gibt es diese Funktion nicht.
      </Text>
      <TextInput
        style={styles.input}
        value={repo}
        onChangeText={setRepo}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="https://github.com/owner/addon"
      />
      <TouchableOpacity style={styles.primary} disabled={busy || !repo.trim()} onPress={() => { void add(); }}>
        <Text style={styles.primaryText}>Add-on hinzufügen</Text>
      </TouchableOpacity>
      {addonTokenStoreAvailable() ? (
        <>
          <Text style={styles.label}>{hasToken ? 'Token für private Repositories ist gespeichert' : 'Optionales Token für private Repositories'}</Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder="github_pat_…"
          />
          <TouchableOpacity style={styles.secondary} disabled={busy || !token.trim()} onPress={() => { void saveToken(); }}>
            <Text style={styles.secondaryText}>Token nur für Add-ons speichern</Text>
          </TouchableOpacity>
          {hasToken ? (
            <TouchableOpacity style={styles.linkBtn} disabled={busy} onPress={() => { void clearAddonGithubToken().then(reload); }}>
              <Text style={styles.link}>Add-on-Token löschen</Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : (
        <Text style={styles.body}>Sichere Ablage fehlt. Ein Token wird nicht gespeichert.</Text>
      )}
      {rows.map((row) => (
        <View key={row.id} style={styles.row}>
          <Text style={styles.icon}>{row.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{row.name}</Text>
            <Text style={styles.meta}>{row.targetScrapp} · {row.version}</Text>
          </View>
          <TouchableOpacity disabled={busy} onPress={() => { void setAddonEnabled(platform, row.id, !row.enabled).then(reload); }}>
            <Text style={styles.link}>{row.enabled ? 'An' : 'Aus'}</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={busy} onPress={() => { void removeAddon(platform, row.id).then(reload); }}>
            <Text style={styles.link}>Weg</Text>
          </TouchableOpacity>
        </View>
      ))}
      {note ? <Text style={styles.body}>{note}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '700', marginTop: 16 },
  body: { fontSize: 13, color: '#444', marginVertical: 6 },
  label: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginTop: 6 },
  primary: { backgroundColor: '#2196F3', borderRadius: 8, padding: 10, marginTop: 8, alignItems: 'center' },
  primaryText: { color: 'white', fontWeight: '700' },
  secondary: { borderWidth: 1, borderColor: '#2196F3', borderRadius: 8, padding: 10, marginTop: 8, alignItems: 'center' },
  secondaryText: { color: '#1565C0', fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  icon: { fontSize: 18, width: 28, textAlign: 'center' },
  name: { fontWeight: '700' },
  meta: { fontSize: 12, color: '#666' },
  link: { color: '#1565C0', fontWeight: '700', marginLeft: 8 },
  linkBtn: { marginTop: 6 },
});
