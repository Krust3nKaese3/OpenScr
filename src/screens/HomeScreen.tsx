import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Modal,
  ScrollView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { readDebugLog, clearDebugLog } from '../services/DebugLog';
import { MiniApp, Folder, MiniAppOrigin } from '../types';
import { StorageService } from '../services/StorageService';
import { GitRepoService } from '../services/GitRepoService';
import { MiniAppRunner } from '../components/MiniAppRunner';
import * as Clipboard from 'expo-clipboard';
import { Linking } from 'react-native';
import { classifyDeepLink, githubRepoKey, isGitHubRepoUrl, matchesMiniApp, queueDeepLink, repoUrlFromQr } from '../services/deepLinks';
import { SpotifySettingsModal } from '../components/SpotifySettingsModal';
import { AppInfoModal } from '../components/AppInfoModal';
import { LegalModal } from '../components/LegalModal';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { bundledBlocklistFile, bundledCatalogFile, loadPolicyLists } from '../services/remoteLists';
import { devFolderFor, devFoldersEnabled, setDevFolder } from '../services/devFolder';
import {
  REPORT_EMAIL,
  blockReasonFor,
  catalogEntryFor,
  catalogRepoNames,
  decideAdd,
  installMode,
  reportMailto,
  mergeUpdatedApp,
  type BlocklistFile,
  type CatalogFile,
} from '../services/storePolicy';
import { updateStatus, versionLine } from '../services/githubPin';
import { installedAppAccess } from '../services/developerMode';
import { GithubSession } from '../services/GithubSession';
import { DeveloperModeModal } from '../components/DeveloperModeModal';
import { FirstOpenScrappModal } from '../components/FirstOpenScrappModal';
import { SourceCodeModal } from '../components/SourceCodeModal';
import { showsCuratedCatalog } from '../services/iosPolicy';
import { appearanceMode, setAppearance, useContainerTheme } from '../theme/containerTheme';
import { NavGlyph, ScrappGlyph } from '../components/ScrappGlyph';
import { notify } from '../services/notify';

function confirmForeign(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    notify('Unbekannte Quelle', message, [
      { text: 'Abbrechen', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Trotzdem hinzufügen', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export const HomeScreen: React.FC = () => {
  const [apps, setApps] = useState<MiniApp[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [catalog, setCatalog] = useState<CatalogFile>(() => bundledCatalogFile());
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const [blocklist, setBlocklist] = useState<BlocklistFile>(() => bundledBlocklistFile());
  const [latestSha, setLatestSha] = useState<Record<string, string>>({});
  const [infoApp, setInfoApp] = useState<MiniApp | null>(null);
  const [legalDoc, setLegalDoc] = useState<'privacy' | 'terms' | null>(null);
  const mode = installMode(Platform.OS);
  const ownReposOnly = mode === 'own-repos-only';
  const catalogOnly = mode === 'catalog-only';
  const showCatalog = showsCuratedCatalog(Platform.OS);
  const [devMode, setDevMode] = useState(false);
  const [githubLogin, setGithubLogin] = useState<string | null>(null);
  const [showDeveloper, setShowDeveloper] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [sourceApp, setSourceApp] = useState<MiniApp | null>(null);
  const dismissedUpdates = useRef<Set<string>>(new Set());
  const [repoUrl, setRepoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedApp, setSelectedApp] = useState<MiniApp | null>(null);
  const closeSelectedApp = useCallback(() => setSelectedApp(null), []);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [debugLines, setDebugLines] = useState<string[] | null>(null);
  const [showSpotifySettings, setShowSpotifySettings] = useState(false);
  const openDebugLog = async () => setDebugLines(await readDebugLog());
  const [newFolderName, setNewFolderName] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [tab, setTab] = useState<'home' | 'add' | 'settings'>('home');
  const tokens = useContainerTheme();
  const { width: windowWidth } = useWindowDimensions();
  const tileWidth = Math.floor((windowWidth - 44) / 2);
  const [permission, requestPermission] = useCameraPermissions();
  const scanLock = useRef(false);
  const gate = useRef<Promise<void>>(Promise.resolve());
  const enqueue = (task: () => Promise<void>) => {
    const next = gate.current.then(task, task);
    gate.current = next.then(() => undefined, () => undefined);
  };

  const performAdd = async (raw: string, source: 'field' | 'link') => {
    const trimmed = raw.trim();
    if (!trimmed) {
      notify('Fehler', 'Bitte eine Repository-URL eingeben.');
      return;
    }
    if (source === 'link' && !isGitHubRepoUrl(trimmed)) {
      notify('Add-Link', 'Der Add-Link enthält keine gültige GitHub-URL (https://github.com/besitzer/repo).');
      return;
    }
    const decision = decideAdd(trimmed, {
      catalog,
      blocklist,
      catalogOnly,
      ownReposOnly,
      developerMode: devMode,
      signedInLogin: githubLogin,
    });
    if (decision.type === 'reject' || decision.type === 'blocked') {
      notify(decision.title, decision.message);
      return;
    }
    if (decision.type === 'confirm-foreign') {
      const accepted = await confirmForeign(decision.message);
      if (!accepted) return;
    }
    setLoading(true);
    try {
      const key = githubRepoKey(trimmed);
      if (key) {
        const existing = (await StorageService.getApps()).find((a) => githubRepoKey(a.repoUrl) === key);
        if (existing) {
          notify('Bereits installiert', `${existing.manifest.name} ist schon installiert.`, [
            { text: 'OK', style: 'cancel' },
            { text: 'Öffnen', onPress: () => { void openAppRef.current(existing); } },
          ]);
          return;
        }
      }
      const blockedNow = blockReasonFor('', trimmed, blocklist);
      if (blockedNow) {
        notify('OpenScrapp gesperrt', blockedNow);
        return;
      }
      let downloadToken: string | undefined;
      let origin: MiniAppOrigin = 'free';
      let ownerLogin: string | undefined;
      if (decision.type === 'install-own') {
        const confirmed = await GithubSession.confirmOwnership(trimmed);
        downloadToken = confirmed.token;
        origin = 'developer';
        ownerLogin = confirmed.login;
      } else if (decision.type === 'install') {
        origin = decision.origin;
      }
      const app = await GitRepoService.fetchRepo(trimmed, downloadToken ? { token: downloadToken } : undefined);
      app.origin = origin;
      if (ownerLogin) app.ownerLogin = ownerLogin;
      const blockedId = blockReasonFor(app.id, app.repoUrl, blocklist);
      if (blockedId) {
        await GitRepoService.deleteApp(app);
        notify('OpenScrapp gesperrt', blockedId);
        return;
      }
      await StorageService.saveApp(app);
      await loadData();
      if (source === 'field') setRepoUrl('');
      setTab('home');
      notify('Hinzugefügt', `${app.manifest.name} wurde hinzugefügt.`);
    } catch (error: any) {
      await refreshSession();
      notify('Fehler', error.message);
    } finally {
      setLoading(false);
    }
  };
  const performAddRef = useRef(performAdd);
  performAddRef.current = performAdd;
  const openAppRef = useRef<(app: MiniApp, opts?: { quiet?: boolean }) => Promise<void>>(async () => {});

  // openscr://add?url=… (and exp+openscr://add?url=…) installs a repo.
  // Other openscr://<miniapp>/… links open that mini-app. Handled before the mini-app flow.
  useEffect(() => {
    const recent = { url: '', at: 0 };
    const handle = (url?: string | null) => {
      if (!url) return;
      const now = Date.now();
      if (recent.url === url && now - recent.at < 2500) return;
      recent.url = url;
      recent.at = now;
      enqueue(async () => {
        const classified = classifyDeepLink(url);
        if (classified.type === 'ignore') return;
        if (classified.type === 'add') {
          await performAddRef.current(classified.repoUrl, 'link');
          return;
        }
        if (classified.type === 'lock') {
          const all = await StorageService.getApps();
          const target = all.find((a) => a.id === classified.appId);
          if (target) await openAppRef.current(target, { quiet: true });
          return;
        }
        const link = classified.link;
        const all = await StorageService.getApps();
        const target = all.find((a) => {
          const entry = catalogEntryFor(a.repoUrl, catalogRef.current);
          return matchesMiniApp(link, a, entry ? catalogRepoNames(entry) : []);
        });
        if (!target) { notify('Deep-Link', `OpenScrapp "${link.miniapp}" ist nicht installiert.\n\n${url}`); return; }
        queueDeepLink(target.id, link);
        await openAppRef.current(target);
      });
    };
    Linking.getInitialURL().then(handle).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => { handle(e.url); });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    loadData();
    loadPolicyLists().then((lists) => {
      setCatalog(lists.catalog);
      setBlocklist(lists.blocklist);
    }).catch(() => {});
    void refreshSession();
  }, []);

  const refreshSession = async () => {
    if (!ownReposOnly && !catalogOnly) {
      setDevMode(false);
      setGithubLogin(null);
      return;
    }
    const session = await GithubSession.load();
    setDevMode(session.developerMode);
    setGithubLogin(session.login);
  };

  const accessFor = (
    app: MiniApp,
    session?: { developerMode: boolean; signedInLogin: string | null },
  ) => installedAppAccess(app, {
    catalogOnly,
    ownReposOnly,
    developerMode: session ? session.developerMode : devMode,
    signedInLogin: session ? session.signedInLogin : githubLogin,
    inCatalog: !!catalogEntryFor(app.repoUrl, catalog),
  });

  const loadData = async () => {
    const loadedApps = await StorageService.getApps();
    const loadedFolders = await StorageService.getFolders();
    setApps(loadedApps);
    setFolders(loadedFolders);
    void checkUpdates(loadedApps);
  };

  const checkUpdates = async (installed: MiniApp[]) => {
    const session = (ownReposOnly || catalogOnly) ? await GithubSession.load() : { developerMode: false, login: null as string | null };
    const found: Record<string, string> = {};
    for (const app of installed) {
      const access = accessFor(app, { developerMode: session.developerMode, signedInLogin: session.login });
      if (!access.allowed) continue;
      try {
        if (access.verifyOwnership) {
          const confirmed = await GithubSession.confirmOwnership(app.repoUrl);
          found[app.id] = await GitRepoService.latestCommit(app.repoUrl, { token: confirmed.token });
        } else {
          found[app.id] = await GitRepoService.latestCommit(app.repoUrl);
        }
      } catch {
        // Offline or GitHub rate limit: the installed copy stays usable.
        // Developer-mode apps still re-check ownership when opened.
      }
    }
    if (Object.keys(found).length > 0) setLatestSha((current) => ({ ...current, ...found }));
  };

  const handleAddRepo = () => {
    const raw = repoUrl.trim();
    const next = /^github\.com\//i.test(raw) ? `https://${raw}` : raw;
    enqueue(() => performAdd(next, 'field'));
  };

  const openScanner = async () => {
    let granted = permission?.granted === true;
    if (!granted) {
      const res = await requestPermission();
      granted = res.granted;
    }
    if (!granted) {
      notify(
        'Kamera',
        'Ohne Kamerazugriff kann OpenScr keinen QR-Code scannen. Erlaube die Kamera in den Einstellungen.',
        [
          { text: 'Abbrechen', style: 'cancel' },
          { text: 'Einstellungen', onPress: () => { Linking.openSettings().catch(() => {}); } },
        ],
      );
      return;
    }
    scanLock.current = false;
    setScanning(true);
  };

  const handleBarcode = (result: { data: string }) => {
    if (scanLock.current) return;
    scanLock.current = true;
    setScanning(false);
    const parsed = repoUrlFromQr(result.data);
    if (!parsed.ok) {
      notify('QR-Code', parsed.message);
      return;
    }
    enqueue(() => performAdd(parsed.repoUrl, 'link'));
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      notify('Fehler', 'Bitte einen Ordnernamen eingeben.');
      return;
    }

    const folder: Folder = {
      id: Date.now().toString(),
      name: newFolderName.trim(),
      createdAt: Date.now(),
    };

    await StorageService.saveFolder(folder);
    await loadData();
    setNewFolderName('');
    setShowFolderModal(false);
  };

  const handleDeleteFolder = async (folderId: string) => {
    notify(
      'Ordner löschen',
      'Apps in diesem Ordner wandern in die Übersicht. Fortfahren?',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            await StorageService.deleteFolder(folderId);
            await loadData();
          },
        },
      ]
    );
  };

  const handleMoveApp = (app: MiniApp, folderId: string | null) => {
    notify('App verschieben', `${app.manifest.name} verschieben?`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Verschieben',
        onPress: async () => {
          await StorageService.updateAppFolder(app.id, folderId);
          await loadData();
        },
      },
    ]);
  };

  const handleDeleteApp = (app: MiniApp) => {
    notify('App löschen', `${app.manifest.name} und alle ihre gespeicherten Daten löschen?`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: async () => {
          await GitRepoService.deleteApp(app);
          await StorageService.deleteApp(app.id);
          setInfoApp((current) => current?.id === app.id ? null : current);
          await loadData();
        },
      },
    ]);
  };

  const [actionApp, setActionApp] = useState<MiniApp | null>(null);
  const [folderDraft, setFolderDraft] = useState('');
  useEffect(() => {
    setFolderDraft(actionApp ? devFolderFor(actionApp.id) : '');
  }, [actionApp]);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const handleRefreshApp = async (app: MiniApp) => {
    const access = accessFor(app);
    if (!access.allowed) {
      notify(ownReposOnly ? 'Nur eigene Repositories' : 'Entwicklermodus', access.reason);
      return null;
    }
    setRefreshingId(app.id);
    try {
      let token: string | undefined;
      if (access.verifyOwnership) {
        const confirmed = await GithubSession.confirmOwnership(app.repoUrl);
        token = confirmed.token;
      }
      const fresh = await GitRepoService.fetchRepo(app.repoUrl, token ? { token } : undefined);
      const merged = mergeUpdatedApp(app, fresh);
      await StorageService.saveApp(merged);
      if (merged.commitSha) setLatestSha((current) => ({ ...current, [app.id]: merged.commitSha as string }));
      await loadData();
      return merged;
    } catch (error: any) {
      await refreshSession();
      notify('Aktualisierung fehlgeschlagen', error.message);
      return null;
    } finally {
      setRefreshingId(null);
    }
  };

  const openApp = async (app: MiniApp, opts?: { quiet?: boolean }) => {
    const quiet = opts?.quiet === true;
    const reason = blockReasonFor(app.id, app.repoUrl, blocklist);
    if (reason) {
      if (!quiet) notify('OpenScrapp gesperrt', reason);
      return;
    }
    const access = accessFor(app);
    if (!access.allowed) {
      if (!quiet) notify(ownReposOnly ? 'Nur eigene Repositories' : 'Entwicklermodus', access.reason);
      return;
    }
    let authToken: string | undefined;
    if (access.verifyOwnership) {
      try {
        const confirmed = await GithubSession.confirmOwnership(app.repoUrl);
        authToken = confirmed.token;
      } catch (error: any) {
        await refreshSession();
        if (!quiet) notify(ownReposOnly ? 'Nur eigene Repositories' : 'Entwicklermodus', error.message || 'Die Zugehörigkeit konnte nicht geprüft werden.');
        return;
      }
    }
    let latest: string | undefined = latestSha[app.id];
    if (!latest) {
      try {
        latest = await GitRepoService.latestCommit(app.repoUrl, authToken ? { token: authToken } : undefined);
        const resolved = latest;
        setLatestSha((current) => ({ ...current, [app.id]: resolved }));
      } catch {
        latest = undefined;
      }
    }
    if (!quiet && latest && updateStatus(app.commitSha, latest) === 'available' && !dismissedUpdates.current.has(app.id)) {
      const installed = app;
      const newest = latest;
      notify(
        'Update verfügbar',
        `${versionLine(installed.manifest.version, installed.commitSha, newest)}\n\nDer Speicher dieser OpenScrapp bleibt beim Aktualisieren erhalten.`,
        [
          { text: 'Später', onPress: () => { dismissedUpdates.current.add(installed.id); setSelectedApp(installed); } },
          { text: 'Aktualisieren', onPress: () => { void refreshAndOpen(installed); } },
        ],
      );
      return;
    }
    setSelectedApp(app);
  };
  openAppRef.current = openApp;

  const refreshAndOpen = async (app: MiniApp) => {
    const merged = await handleRefreshApp(app);
    if (merged) setSelectedApp(merged);
  };

  const reportApp = (app: MiniApp) => {
    const url = reportMailto({
      name: app.manifest.name,
      repoUrl: app.repoUrl,
      id: app.id,
      version: app.manifest.version,
      commitSha: app.commitSha,
    });
    Linking.openURL(url).catch(() => {
      notify('Melden', `Die Mail-App konnte nicht geöffnet werden. Schreibe an ${REPORT_EMAIL}.`);
    });
  };

  const toggleFolder = (folderId: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  const renderApp = (app: MiniApp) => {
    const blocked = blockReasonFor(app.id, app.repoUrl, blocklist);
    const access = accessFor(app);
    const locked = blocked || (!access.allowed ? access.reason : null);
    const latest = latestSha[app.id];
    const status = updateStatus(app.commitSha, latest);
    const folder = folders.find((item) => item.id === app.folderId);
    return (
      <TouchableOpacity
        key={app.id}
        style={[styles.tile, { width: tileWidth, backgroundColor: tokens.card, opacity: locked ? 0.5 : 1 }]}
        onPress={() => { void openApp(app); }}
        onLongPress={() => setActionApp(app)}
      >
        <View style={styles.tileTop}>
          <ScrappGlyph name={app.manifest.name} color={tokens.lime} card={tokens.card} />
          {status === 'available' && !locked ? <View style={[styles.dot, { backgroundColor: tokens.lime }]} /> : null}
        </View>
        <View>
          <Text style={[styles.tileName, { color: tokens.text }]} numberOfLines={2}>{app.manifest.name}</Text>
          {locked ? <Text style={[styles.tileMeta, { color: tokens.muted }]} numberOfLines={1}>Gesperrt</Text> : null}
          {!locked && folder ? <Text style={[styles.tileMeta, { color: tokens.muted }]} numberOfLines={1}>{folder.name}</Text> : null}
          {devFolderFor(app.id) ? <Text style={[styles.tileMeta, { color: tokens.lime }]} numberOfLines={1}>Lokaler Ordner</Text> : null}
        </View>
      </TouchableOpacity>
    );
  };

  const canTypeRepo = ownReposOnly ? !!githubLogin : catalogOnly ? devMode && !!githubLogin : true;

  const wordmark = (withApps: boolean) => (
    <View style={[styles.wordRow, withApps ? styles.wordLeft : styles.wordCenter]}>
      <Text style={[styles.word, { color: tokens.text }]}>Open</Text>
      <Text style={[styles.word, { color: tokens.lime }]}>Scr</Text>
      {withApps ? <Text style={[styles.appsLabel, { color: tokens.muted }]}>Apps</Text> : null}
    </View>
  );

  const catalogBlock = showCatalog ? (
    <View style={styles.catalogBlock}>
      {catalog.apps.map((entry) => {
        const installed = apps.find((app) => catalogEntryFor(app.repoUrl, catalog)?.repoUrl === entry.repoUrl);
        const blocked = blockReasonFor(installed?.id || '', entry.repoUrl, blocklist);
        return (
          <View key={entry.repoUrl} style={[styles.catalogCard, { backgroundColor: tokens.card }]}>
            <Text style={[styles.tileName, { color: tokens.text }]}>{entry.name}</Text>
            <Text style={[styles.tileMeta, { color: tokens.muted }]}>{entry.description}</Text>
            {blocked ? <Text style={[styles.tileMeta, { color: tokens.danger }]}>Gesperrt: {blocked}</Text> : (
              <TouchableOpacity
                style={[styles.catalogButton, { borderColor: tokens.lime }]}
                disabled={loading}
                onPress={() => {
                  if (installed) void openApp(installed);
                  else enqueue(() => performAdd(entry.repoUrl, 'link'));
                }}
              >
                <Text style={[styles.catalogButtonText, { color: tokens.ink, backgroundColor: tokens.lime }]}>{installed ? 'Öffnen' : 'Installieren'}</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  ) : null;

  return (
    <View style={[styles.container, { backgroundColor: tokens.bg }]}>
      {selectedApp ? (
        <MiniAppRunner key={selectedApp.id} app={selectedApp} onClose={closeSelectedApp} />
      ) : (
        <>
          <View style={styles.header}>
            {tab === 'add' ? (
              <>
                <TouchableOpacity onPress={() => { setScanning(false); setTab('home'); }} accessibilityLabel="Zurück" style={styles.iconHit}>
                  <Text style={[styles.iconGlyph, { color: tokens.lime }]}>☰</Text>
                </TouchableOpacity>
                {wordmark(false)}
                <TouchableOpacity onPress={() => setLegalDoc('privacy')} accessibilityLabel="Datenschutz" style={styles.iconHit}>
                  <Text style={[styles.iconGlyph, { color: tokens.lime }]}>✓</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {wordmark(true)}
                <TouchableOpacity onPress={() => setTab('settings')} accessibilityLabel="Konto" style={[styles.avatar, { backgroundColor: tokens.card, borderColor: tokens.line }]}>
                  <Text style={[styles.avatarText, { color: tokens.text }]}>{githubLogin ? githubLogin.slice(0, 1).toUpperCase() : '·'}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {tab === 'home' ? (
            <ScrollView contentContainerStyle={styles.homeScroll} keyboardShouldPersistTaps="handled">
              <View style={styles.grid}>
                {apps.map(renderApp)}
              </View>
              <TouchableOpacity style={[styles.addTile, { backgroundColor: tokens.card }]} onPress={() => setTab('add')}>
                <Text style={[styles.addPlus, { color: tokens.lime }]}>+</Text>
                <Text style={[styles.addLabel, { color: tokens.text }]}>Hinzufügen</Text>
              </TouchableOpacity>
            </ScrollView>
          ) : null}

          {tab === 'add' ? (
            <ScrollView contentContainerStyle={styles.addScroll} keyboardShouldPersistTaps="handled">
              <Text style={[styles.screenTitle, { color: tokens.text }]}>Scrapp hinzufügen</Text>
              {canTypeRepo ? (
                <>
                  <TouchableOpacity style={[styles.scanFrame, { backgroundColor: tokens.card }]} onPress={() => { if (!scanning) void openScanner(); }} accessibilityLabel="QR-Code scannen">
                    {scanning ? (
                      <CameraView
                        style={styles.scanCamera}
                        facing="back"
                        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                        onBarcodeScanned={handleBarcode}
                        onMountError={() => {
                          setScanning(false);
                          notify('Kamera', 'Die Kamera konnte nicht gestartet werden.');
                        }}
                      />
                    ) : (
                      <View style={styles.fakeQr}>
                        <View style={[styles.finder, { borderColor: tokens.lime, top: 18, left: 28 }]} />
                        <View style={[styles.finder, { borderColor: tokens.lime, top: 18, right: 28 }]} />
                        <View style={[styles.finder, { borderColor: tokens.lime, bottom: 18, left: 28 }]} />
                        <View style={[styles.qrNoise, { backgroundColor: tokens.muted }]} />
                      </View>
                    )}
                    <View style={[styles.corner, styles.cornerTL, { borderColor: tokens.lime }]} />
                    <View style={[styles.corner, styles.cornerTR, { borderColor: tokens.lime }]} />
                    <View style={[styles.corner, styles.cornerBL, { borderColor: tokens.lime }]} />
                    <View style={[styles.corner, styles.cornerBR, { borderColor: tokens.lime }]} />
                  </TouchableOpacity>
                  <Text style={[styles.scanCaption, { color: tokens.muted }]}>{scanning ? 'QR-Code vor die Kamera halten' : 'QR-Code scannen'}</Text>
                  {scanning ? (
                    <TouchableOpacity onPress={() => setScanning(false)}>
                      <Text style={[styles.quiet, { color: tokens.muted }]}>Abbrechen</Text>
                    </TouchableOpacity>
                  ) : null}
                  <View style={styles.orRow}>
                    <View style={[styles.orLine, { backgroundColor: tokens.line }]} />
                    <Text style={[styles.orText, { color: tokens.muted }]}>oder</Text>
                    <View style={[styles.orLine, { backgroundColor: tokens.line }]} />
                  </View>
                  <View style={[styles.field, { backgroundColor: tokens.input, borderColor: tokens.line }]}>
                    <Text style={[styles.fieldMark, { color: tokens.text }]}>⌘</Text>
                    <TextInput
                      style={[styles.fieldInput, { color: tokens.text }]}
                      placeholder="github.com/nutzer/repo"
                      placeholderTextColor={tokens.muted}
                      value={repoUrl}
                      onChangeText={setRepoUrl}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                  <TouchableOpacity
                    style={[styles.loadButton, { backgroundColor: loading ? tokens.line : tokens.lime }]}
                    onPress={handleAddRepo}
                    disabled={loading}
                  >
                    <Text style={[styles.loadText, { color: tokens.ink }]}>{loading ? 'Lädt…' : 'Laden'}</Text>
                  </TouchableOpacity>
                  <Text style={[styles.trust, { color: tokens.muted }]}>Nur Code, dem du vertraust</Text>
                </>
              ) : (
                <View style={[styles.note, { backgroundColor: tokens.card }]}>
                  <Text style={[styles.noteText, { color: tokens.text }]}>
                    {ownReposOnly
                      ? 'OpenScr ist ein Werkzeug, mit dem du eigene OpenScrapps aus HTML und JavaScript baust und auf diesem Gerät ausführst. Geladen wird nur ein Repository, das dem angemeldeten GitHub-Konto gehört.'
                      : 'In dieser Version kannst du OpenScrapps aus dem Katalog installieren. Eigene Repositories nur im Entwicklermodus.'}
                  </Text>
                  {ownReposOnly ? (
                    <TouchableOpacity onPress={() => setShowGuide(true)}>
                      <Text style={[styles.link, { color: tokens.lime }]}>Dein erstes OpenScrapp</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity onPress={() => setShowDeveloper(true)}>
                    <Text style={[styles.link, { color: tokens.lime }]}>{githubLogin ? `Angemeldet als ${githubLogin}` : 'Mit GitHub anmelden'}</Text>
                  </TouchableOpacity>
                </View>
              )}
              {catalogBlock}
            </ScrollView>
          ) : null}

          {tab === 'settings' ? (
            <ScrollView contentContainerStyle={styles.addScroll}>
              <Text style={[styles.screenTitle, { color: tokens.text }]}>Einstellungen</Text>
              <TouchableOpacity style={[styles.settingRow, { backgroundColor: tokens.card }]} onPress={() => { void setAppearance(appearanceMode() === 'dark' ? 'light' : 'dark'); }}>
                <Text style={[styles.settingText, { color: tokens.text }]}>{appearanceMode() === 'dark' ? 'Helles Erscheinungsbild' : 'Dunkles Erscheinungsbild'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.settingRow, { backgroundColor: tokens.card }]} onPress={() => setLegalDoc('privacy')}>
                <Text style={[styles.settingText, { color: tokens.text }]}>Datenschutz</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.settingRow, { backgroundColor: tokens.card }]} onPress={() => setLegalDoc('terms')}>
                <Text style={[styles.settingText, { color: tokens.text }]}>Nutzung</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.settingRow, { backgroundColor: tokens.card }]} onPress={() => setShowGuide(true)}>
                <Text style={[styles.settingText, { color: tokens.text }]}>Dein erstes OpenScrapp</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.settingRow, { backgroundColor: tokens.card }]} onPress={() => setShowDeveloper(true)}>
                <Text style={[styles.settingText, { color: tokens.text }]}>{githubLogin ? `Angemeldet als ${githubLogin}` : 'Mit GitHub anmelden'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.settingRow, { backgroundColor: tokens.card }]} onPress={() => setShowFolderModal(true)}>
                <Text style={[styles.settingText, { color: tokens.text }]}>Neuer Ordner</Text>
              </TouchableOpacity>
              {folders.map((folder) => (
                <TouchableOpacity key={folder.id} style={[styles.settingRow, { backgroundColor: tokens.card }]} onPress={() => toggleFolder(folder.id)} onLongPress={() => { void handleDeleteFolder(folder.id); }}>
                  <Text style={[styles.settingText, { color: tokens.text }]}>{expandedFolders.has(folder.id) ? '▼' : '▶'} {folder.name}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={[styles.settingRow, { backgroundColor: tokens.card }]} onPress={openDebugLog}>
                <Text style={[styles.settingText, { color: tokens.text }]}>Debug-Log</Text>
              </TouchableOpacity>
              {Platform.OS !== 'ios' ? (
            <TouchableOpacity style={styles.toolbarButton} onPress={() => setShowSpotifySettings(true)}>
              <Text style={styles.toolbarButtonText}>Spotify</Text>
            </TouchableOpacity>
            ) : null}
              {ownReposOnly ? (
                <Text style={[styles.trust, { color: tokens.muted }]}>Auf diesem Gerät nur eigene Repositories. Kein Katalog.</Text>
              ) : null}
            </ScrollView>
          ) : null}

          <View style={styles.navWrap} pointerEvents="box-none">
            <View style={[styles.navPill, { backgroundColor: tokens.nav, borderColor: tokens.line }]}>
              {([
                ['home', 'Start'],
                ['add', 'QR-Code scannen'],
                ['settings', 'Einstellungen'],
              ] as const).map(([id, label]) => {
                const active = tab === id;
                const glyph = id === 'home' ? 'home' : id === 'add' ? 'qr' : 'settings';
                return (
                  <TouchableOpacity key={id} style={styles.navItem} onPress={() => { setScanning(false); setTab(id); }} accessibilityLabel={label}>
                    <NavGlyph name={glyph} color={active ? tokens.lime : tokens.muted} />
                    {active ? <View style={[styles.navUnderline, { backgroundColor: tokens.lime }]} /> : <View style={styles.navUnderline} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {Platform.OS !== 'ios' ? (
          <SpotifySettingsModal visible={showSpotifySettings} onClose={() => setShowSpotifySettings(false)} />
          ) : null}

          <Modal visible={debugLines !== null} transparent animationType="slide" onRequestClose={() => setDebugLines(null)}>
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContainer, { maxHeight: '85%', width: '92%', backgroundColor: tokens.card }]}>
                <Text style={[styles.modalTitle, { color: tokens.text }]}>Debug-Log ({debugLines?.length ?? 0})</Text>
                <ScrollView style={{ maxHeight: 420, backgroundColor: tokens.bg, borderRadius: 12, padding: 8, marginBottom: 12 }}>
                  <Text selectable style={{ color: tokens.text, fontFamily: 'monospace', fontSize: 11 }}>
                    {debugLines && debugLines.length ? [...debugLines].reverse().join('\n') : 'Noch keine Einträge.'}
                  </Text>
                </ScrollView>
                <View style={styles.modalButtons}>
                  <TouchableOpacity style={[styles.modalButtonCreate, { backgroundColor: tokens.lime }]} onPress={async () => { await Clipboard.setStringAsync((debugLines || []).join('\n')); notify('Debug-Log', 'In die Zwischenablage kopiert'); }}>
                    <Text style={[styles.modalButtonText, { color: tokens.ink }]}>Kopieren</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalButtonCreate, { backgroundColor: tokens.lime }]} onPress={openDebugLog}>
                    <Text style={[styles.modalButtonText, { color: tokens.ink }]}>Neu laden</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalButtonCancel, { backgroundColor: tokens.bg }]} onPress={async () => { await clearDebugLog(); setDebugLines([]); }}>
                    <Text style={[styles.modalButtonText, { color: tokens.text }]}>Leeren</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalButtonCancel, { backgroundColor: tokens.bg }]} onPress={() => setDebugLines(null)}>
                    <Text style={[styles.modalButtonText, { color: tokens.text }]}>Schließen</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          <Modal visible={showFolderModal} transparent animationType="slide">
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContainer, { backgroundColor: tokens.card }]}>
                <Text style={[styles.modalTitle, { color: tokens.text }]}>Neuer Ordner</Text>
                <TextInput
                  style={[styles.modalInput, { color: tokens.text, borderColor: tokens.line, backgroundColor: tokens.bg }]}
                  placeholder="Ordnername"
                  placeholderTextColor={tokens.muted}
                  value={newFolderName}
                  onChangeText={setNewFolderName}
                />
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButtonCancel, { backgroundColor: tokens.bg }]}
                    onPress={() => {
                      setShowFolderModal(false);
                      setNewFolderName('');
                    }}
                  >
                    <Text style={[styles.modalButtonText, { color: tokens.text }]}>Abbrechen</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButtonCreate, { backgroundColor: tokens.lime }]}
                    onPress={handleCreateFolder}
                  >
                    <Text style={[styles.modalButtonText, { color: tokens.ink }]}>Anlegen</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        </>
      )}

      <AppInfoModal
        app={infoApp}
        latestSha={infoApp ? latestSha[infoApp.id] : undefined}
        blocked={infoApp ? blockReasonFor(infoApp.id, infoApp.repoUrl, blocklist) : null}
        refreshing={!!infoApp && refreshingId === infoApp.id}
        onClose={() => setInfoApp(null)}
        onUpdate={(app) => { void handleRefreshApp(app); }}
        onReport={reportApp}
        onDelete={handleDeleteApp}
        onShowSource={ownReposOnly ? (app) => { setInfoApp(null); setSourceApp(app); } : undefined}
      />
      <LegalModal document={legalDoc} onClose={() => setLegalDoc(null)} />
      <DeveloperModeModal
        visible={showDeveloper}
        ownReposOnly={ownReposOnly}
        onClose={() => setShowDeveloper(false)}
        onChanged={() => { void refreshSession(); }}
      />
      <FirstOpenScrappModal visible={showGuide} onClose={() => setShowGuide(false)} />
      <SourceCodeModal app={sourceApp} visible={!!sourceApp} onClose={() => setSourceApp(null)} />

      <Modal visible={!!actionApp} transparent animationType="fade" onRequestClose={() => setActionApp(null)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setActionApp(null)} />
          <View style={[styles.sheet, { backgroundColor: tokens.card, zIndex: 1 }]}>
            <Text style={[styles.modalTitle, { color: tokens.text }]}>{actionApp?.manifest.name}</Text>
            <Text selectable style={[styles.sheetUrl, { color: tokens.muted, backgroundColor: tokens.bg }]}>{actionApp?.repoUrl}</Text>
            {devFoldersEnabled() && actionApp ? (
              <View style={styles.devFolder}>
                <Text style={[styles.tileMeta, { color: tokens.muted }]}>Lokaler Ordner</Text>
                <TextInput
                  value={folderDraft}
                  onChangeText={setFolderDraft}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="E:\git_projects\mobile_apps\GuessTheSongScrapp"
                  placeholderTextColor={tokens.muted}
                  style={[styles.devFolderInput, { color: tokens.text, borderColor: tokens.line, backgroundColor: tokens.bg }]}
                />
                <TouchableOpacity
                  style={styles.sheetRow}
                  onPress={() => {
                    setDevFolder(actionApp.id, folderDraft);
                    notify(
                      'Ordner',
                      folderDraft.trim()
                        ? 'Die App liest jetzt aus diesem Ordner.'
                        : 'Kein Ordner eingetragen. Der GitHub-Stand wird wieder genutzt.',
                    );
                    setActionApp(null);
                  }}
                >
                  <Text style={{ fontSize: 16, color: tokens.lime }}>Ordner übernehmen</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {[
              { label: 'Info und Berechtigungen', fn: (a: MiniApp) => setInfoApp(a) },
              ...(ownReposOnly ? [{ label: 'Quelltext', fn: (a: MiniApp) => setSourceApp(a) }] : []),
              { label: 'Aktualisieren', fn: (a: MiniApp) => { void handleRefreshApp(a); } },
              { label: 'Melden', fn: (a: MiniApp) => reportApp(a) },
              { label: 'GitHub-Link kopieren', fn: async (a: MiniApp) => { await Clipboard.setStringAsync(a.repoUrl); } },
              { label: 'In die Übersicht', fn: (a: MiniApp) => handleMoveApp(a, null) },
              ...folders.map((f) => ({ label: `Verschieben nach ${f.name}`, fn: (a: MiniApp) => handleMoveApp(a, f.id) })),
              { label: 'Löschen', fn: (a: MiniApp) => handleDeleteApp(a), danger: true },
              { label: 'Abbrechen', fn: () => {} },
            ].map((b: any) => (
              <TouchableOpacity
                key={b.label}
                style={styles.sheetRow}
                onPress={() => { const a = actionApp; setActionApp(null); if (a) b.fn(a); }}
              >
                <Text style={{ fontSize: 16, color: b.danger ? tokens.danger : tokens.text }}>{b.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  devFolder: { paddingHorizontal: 4, paddingBottom: 8 },
  devFolderInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginTop: 6, fontSize: 14 },
  container: { flex: 1 },
  header: {
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wordRow: { flexDirection: 'row', alignItems: 'baseline' },
  wordLeft: { flex: 1, justifyContent: 'flex-start' },
  wordCenter: { flex: 1, justifyContent: 'center' },
  word: { fontSize: 28, fontWeight: '700', letterSpacing: -0.6 },
  appsLabel: { fontSize: 15, marginLeft: 8, fontWeight: '500' },
  avatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '700' },
  iconHit: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  iconGlyph: { fontSize: 22, fontWeight: '700' },
  homeScroll: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 120 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: { borderRadius: 22, minHeight: 132, padding: 16, marginBottom: 12, justifyContent: 'space-between' },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between' },
  tileName: { fontSize: 16, fontWeight: '600' },
  tileMeta: { fontSize: 12, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  addTile: { borderRadius: 22, minHeight: 92, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  addPlus: { fontSize: 28, fontWeight: '500', lineHeight: 32 },
  addLabel: { fontSize: 16, fontWeight: '600', marginTop: 2 },
  addScroll: { paddingHorizontal: 22, paddingBottom: 130 },
  screenTitle: { fontSize: 32, fontWeight: '700', letterSpacing: -0.8, marginBottom: 22, marginTop: 8 },
  scanFrame: { alignSelf: 'center', width: 280, height: 280, borderRadius: 28, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  scanCamera: { width: 280, height: 280 },
  fakeQr: { width: 180, height: 180, alignItems: 'center', justifyContent: 'center' },
  finder: { position: 'absolute', width: 36, height: 36, borderWidth: 4, borderRadius: 4 },
  qrNoise: { width: 70, height: 70, opacity: 0.35, borderRadius: 6 },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: '#A3E635' },
  cornerTL: { top: 14, left: 14, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  cornerTR: { top: 14, right: 14, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  cornerBL: { bottom: 14, left: 14, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
  cornerBR: { bottom: 14, right: 14, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 },
  scanCaption: { textAlign: 'center', marginTop: 16, fontSize: 16 },
  quiet: { textAlign: 'center', marginTop: 8, fontSize: 15 },
  orRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 22 },
  orLine: { flex: 1, height: 1 },
  orText: { marginHorizontal: 12, fontSize: 14 },
  field: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, minHeight: 56 },
  fieldMark: { fontSize: 18, marginRight: 10 },
  fieldInput: { flex: 1, fontSize: 16, paddingVertical: 14 },
  loadButton: { borderRadius: 18, minHeight: 56, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  loadText: { fontSize: 18, fontWeight: '700' },
  trust: { textAlign: 'center', marginTop: 16, fontSize: 14 },
  note: { borderRadius: 18, padding: 16 },
  noteText: { fontSize: 15, lineHeight: 22 },
  link: { fontWeight: '700', marginTop: 12, fontSize: 16 },
  catalogBlock: { marginTop: 28 },
  catalogCard: { borderRadius: 18, padding: 16, marginBottom: 12 },
  catalogButton: { alignSelf: 'flex-start', marginTop: 10, borderRadius: 12, overflow: 'hidden' },
  catalogButtonText: { fontWeight: '700', paddingHorizontal: 14, paddingVertical: 8 },
  settingRow: { borderRadius: 16, paddingHorizontal: 16, paddingVertical: 16, marginBottom: 10 },
  settingText: { fontSize: 16, fontWeight: '600' },
  toolbarButton: { paddingVertical: 8, paddingHorizontal: 4 },
  toolbarButtonText: { color: '#A3E635', fontSize: 16, fontWeight: '700' },
  navWrap: { position: 'absolute', left: 0, right: 0, bottom: 22, alignItems: 'center' },
  navPill: { flexDirection: 'row', borderRadius: 28, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 10, minWidth: 220, justifyContent: 'space-between' },
  navItem: { width: 56, alignItems: 'center', paddingVertical: 4 },
  navUnderline: { marginTop: 6, height: 2, width: 18, borderRadius: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.55)', justifyContent: 'center', alignItems: 'center' },
  modalContainer: { borderRadius: 18, padding: 20, width: '84%' },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  modalInput: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 16 },
  modalButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modalButtonCancel: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12, marginTop: 8 },
  modalButtonCreate: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12, marginTop: 8 },
  modalButtonText: { textAlign: 'center', fontSize: 15, fontWeight: '700' },
  sheet: { borderRadius: 18, padding: 18, width: '88%' },
  sheetUrl: { fontSize: 13, padding: 8, borderRadius: 8, marginBottom: 8 },
  sheetRow: { paddingVertical: 12 },
});
