import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Switch,
  ActivityIndicator,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ContainerTokens } from '../theme/containerTheme';
import { addonsForScrapp, CachedAddon, ScrappRef } from '../services/addons/inject';
import {
  ADDON_NOTICE,
  addAddonRepo,
  listAddons,
  readAddonNoticeAck,
  removeAddon,
  setAddonEnabled,
  updateAddon,
  writeAddonNoticeAck,
} from '../services/addons/store';
import {
  addonTokenStoreAvailable,
  clearAddonGithubToken,
  readAddonGithubToken,
  writeAddonGithubToken,
} from '../services/addons/githubToken';
import { devAddonPrefill } from '../services/addons/devPrefill';

export const AddonSheet: React.FC<{
  platform: string;
  scrapp: ScrappRef;
  tokens: ContainerTokens;
  onClose: () => void;
  onChanged: () => void;
}> = ({ platform, scrapp, tokens, onClose, onChanged }) => {
  const [rows, setRows] = useState<CachedAddon[]>([]);
  const [repo, setRepo] = useState(() => devAddonPrefill(scrapp.id));
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  const reload = useCallback(async () => {
    const all = await listAddons(platform);
    setRows(addonsForScrapp(all, scrapp));
    setHasToken(!!(await readAddonGithubToken()));
  }, [platform, scrapp]);

  useEffect(() => {
    reload().catch((failure) => {
      setError(failure instanceof Error ? failure.message : 'Add-ons konnten nicht gelesen werden.');
    });
  }, [reload]);

  const fail = (failure: unknown) => {
    setNote('');
    setError(failure instanceof Error ? failure.message : 'Das hat nicht geklappt.');
  };

  const commitAdd = async () => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const row = await addAddonRepo(platform, repo.trim(), scrapp);
      setRepo('');
      setNote(`${row.name} ${row.version} ist für ${scrapp.name} gespeichert.`);
      await reload();
      onChanged();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!repo.trim()) return;
    setError('');
    try {
      const acked = await readAddonNoticeAck(platform);
      if (!acked) {
        setConfirming(true);
        return;
      }
    } catch (failure) {
      fail(failure);
      return;
    }
    await commitAdd();
  };

  const confirmNotice = async () => {
    setBusy(true);
    try {
      await writeAddonNoticeAck(platform);
      setConfirming(false);
    } catch (failure) {
      fail(failure);
      setBusy(false);
      return;
    }
    setBusy(false);
    await commitAdd();
  };

  const saveToken = async () => {
    setBusy(true);
    setError('');
    try {
      await writeAddonGithubToken(token);
      setToken('');
      setNote('Token für private Add-ons liegt nur auf diesem Gerät.');
      await reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismiss} onPress={onClose} accessibilityLabel="Schließen" />
        <View style={[styles.sheet, { backgroundColor: tokens.card }]}>
          <View style={[styles.handle, { backgroundColor: tokens.line }]} />
          <Text style={[styles.title, { color: tokens.text }]}>Add-ons · {scrapp.name}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
            <Text selectable style={[styles.notice, { color: tokens.muted, borderColor: tokens.line }]}>{ADDON_NOTICE}</Text>
            {confirming ? (
              <View style={[styles.confirm, { borderColor: tokens.lime }]}>
                <Text style={[styles.body, { color: tokens.text }]}>
                  Beim ersten Add-on gilt dieser Hinweis einmalig. Danach wird er nicht erneut abgefragt.
                </Text>
                <View style={styles.rowActions}>
                  <TouchableOpacity onPress={() => setConfirming(false)} disabled={busy}>
                    <Text style={[styles.link, { color: tokens.muted }]}>Abbrechen</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { void confirmNotice(); }} disabled={busy}>
                    <Text style={[styles.link, { color: tokens.ink, backgroundColor: tokens.lime }]}>Hinweis bestätigen</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            <TextInput
              style={[styles.input, { color: tokens.text, borderColor: tokens.line, backgroundColor: tokens.input }]}
              value={repo}
              onChangeText={setRepo}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://github.com/owner/addon"
              placeholderTextColor={tokens.muted}
              accessibilityLabel="GitHub-Link des Add-ons"
            />
            <TouchableOpacity
              style={[styles.primary, { backgroundColor: tokens.lime, opacity: busy || !repo.trim() ? 0.5 : 1 }]}
              disabled={busy || !repo.trim()}
              onPress={() => { void add(); }}
            >
              <Text style={[styles.primaryText, { color: tokens.ink }]}>Hinzufügen</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setTokenOpen((open) => !open)} accessibilityRole="button">
              <Text style={[styles.link, { color: tokens.text }]}>Privates Repo? Token hinterlegen</Text>
            </TouchableOpacity>
            {tokenOpen ? (
              addonTokenStoreAvailable() ? (
                <View>
                  <Text style={[styles.meta, { color: tokens.muted }]}>
                    {hasToken ? 'Ein Token ist gespeichert. Es geht nur an GitHub für Add-ons.' : 'Optional. Das Token bleibt auf diesem Gerät.'}
                  </Text>
                  <TextInput
                    style={[styles.input, { color: tokens.text, borderColor: tokens.line, backgroundColor: tokens.input }]}
                    value={token}
                    onChangeText={setToken}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    placeholder="github_pat_…"
                    placeholderTextColor={tokens.muted}
                  />
                  <TouchableOpacity
                    style={[styles.secondary, { borderColor: tokens.lime, opacity: busy || !token.trim() ? 0.5 : 1 }]}
                    disabled={busy || !token.trim()}
                    onPress={() => { void saveToken(); }}
                  >
                    <Text style={[styles.secondaryText, { color: tokens.text }]}>Token speichern</Text>
                  </TouchableOpacity>
                  {hasToken ? (
                    <TouchableOpacity
                      disabled={busy}
                      onPress={() => {
                        void clearAddonGithubToken().then(reload).catch(fail);
                      }}
                    >
                      <Text style={[styles.link, { color: tokens.danger }]}>Add-on-Token löschen</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : (
                <Text selectable style={[styles.meta, { color: tokens.danger }]}>Sichere Ablage fehlt. Ein Token wird nicht gespeichert.</Text>
              )
            ) : null}
            <Text style={[styles.section, { color: tokens.text }]}>Installiert für diese OpenScrapp</Text>
            {rows.length === 0 ? <Text style={[styles.meta, { color: tokens.muted }]}>Noch keines.</Text> : null}
            {rows.map((row) => (
              <View key={row.id} style={[styles.addon, { borderColor: tokens.line }]}>
                <Text style={styles.icon} accessibilityLabel={row.name}>{row.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: tokens.text }]}>{row.name}</Text>
                  <Text style={[styles.meta, { color: tokens.muted }]}>{row.version}</Text>
                </View>
                <Switch
                  value={row.enabled}
                  disabled={busy}
                  accessibilityLabel={`${row.name} ein oder aus`}
                  onValueChange={(enabled) => {
                    void setAddonEnabled(platform, row.id, enabled).then(() => { void reload(); onChanged(); }).catch(fail);
                  }}
                />
                <TouchableOpacity
                  disabled={busy}
                  onPress={() => {
                    setBusy(true);
                    setError('');
                    void updateAddon(platform, row.id, scrapp)
                      .then(async (next) => {
                        setNote(`${next.name} ist ${next.version}.`);
                        await reload();
                        onChanged();
                      })
                      .catch(fail)
                      .finally(() => setBusy(false));
                  }}
                >
                  <Text style={[styles.link, { color: tokens.text }]}>Update</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={busy}
                  onPress={() => {
                    void removeAddon(platform, row.id).then(() => { void reload(); onChanged(); }).catch(fail);
                  }}
                >
                  <Text style={[styles.link, { color: tokens.danger }]}>Entfernen</Text>
                </TouchableOpacity>
              </View>
            ))}
            {error ? (
              <View>
                <Text selectable style={[styles.error, { color: tokens.danger }]}>{error}</Text>
                <TouchableOpacity onPress={() => { void Clipboard.setStringAsync(error); }}>
                  <Text style={[styles.link, { color: tokens.text }]}>Fehler kopieren</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {note ? <Text style={[styles.meta, { color: tokens.text }]}>{note}</Text> : null}
            {busy ? <ActivityIndicator color={tokens.lime} style={{ marginTop: 12 }} /> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  dismiss: { flex: 1 },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '86%', paddingBottom: 24 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  title: { fontSize: 18, fontWeight: '700', paddingHorizontal: 16, marginTop: 12 },
  scroll: { padding: 16, paddingBottom: 28 },
  notice: { fontSize: 13, lineHeight: 18, borderWidth: 1, borderRadius: 12, padding: 10 },
  body: { fontSize: 14, lineHeight: 20 },
  confirm: { borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 10 },
  primary: { borderRadius: 10, padding: 12, marginTop: 8, alignItems: 'center' },
  primaryText: { fontWeight: '700' },
  secondary: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 8, alignItems: 'center' },
  secondaryText: { fontWeight: '700' },
  link: { fontWeight: '700', marginTop: 10, overflow: 'hidden', borderRadius: 8, paddingHorizontal: 2 },
  section: { fontSize: 15, fontWeight: '700', marginTop: 18 },
  meta: { fontSize: 12, marginTop: 2 },
  addon: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, paddingVertical: 10, flexWrap: 'wrap' },
  icon: { fontSize: 18, width: 28, textAlign: 'center' },
  name: { fontWeight: '700' },
  error: { marginTop: 12, fontSize: 13 },
  rowActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16 },
});
