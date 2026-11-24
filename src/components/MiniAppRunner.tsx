import React, { useState, useRef, useEffect, useLayoutEffect, createElement } from 'react';
import { View, StyleSheet, StatusBar, BackHandler, ActivityIndicator, Text, ScrollView, TouchableOpacity, Platform, Dimensions, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import * as ScreenOrientation from 'expo-screen-orientation';
import { getInfoAsync, listAppFiles, readAsStringAsync } from '../services/appFiles';
import { devFolderFor, listDevFiles, readDevAsset } from '../services/devFolder';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import { MiniApp, Permission } from '../types';
import { NavGlyph, ScrappGlyph } from './ScrappGlyph';
import { useContainerTheme } from '../theme/containerTheme';
import { isPermission } from '../bridge/permissionInfo';
import { StorageService } from '../services/StorageService';
import { PermissionRequestModal } from './PermissionRequestModal';
import { BridgeMessageHandler } from '../bridge/BridgeMessageHandler';
import { NativeCapabilities } from '../bridge/NativeCapabilities';
import { takeDeepLink, onDeepLinkQueued, deepLinkInjection } from '../services/deepLinks';
import { setupGlobalErrorHandler, removeGlobalErrorHandler } from '../utils/errorHandler';
import { MultiplayerOverlay } from './MultiplayerOverlay';
import { SourceCodeModal } from './SourceCodeModal';
import { CameraCaptureOverlay } from './CameraCaptureOverlay';
import { cancelCameraCapture } from '../services/cameraCapture';
import { learningPaneHeights, permissionsOfferedOnPlatform, showsLearningChrome } from '../services/iosPolicy';
import { cancelMpScan, detachMultiplayer, dismissMpUi, endRoom, submitMpScan, subscribeMpUi, subscribeHostPresence, approveJoin, denyJoin, resumeMultiplayer, showMultiplayerQr, type HostPresence, type MpUiState } from '../services/multiplayer/session';
import { setGuestContent } from '../services/multiplayer/guestContent';
import { applyShowOverLock, publishOverLockNotice, readShowOverLockMap, shouldShowOverLock, showOverLockEnabled, SHOW_OVER_LOCK_KEY } from '../services/showOverLock';
import { stableWebViewHtml } from '../services/webViewSource';
import { spotifyReconnectQuiet } from '../services/spotifySettings';
import { shouldResumeSpotifyRemote } from '../services/spotifyClientId';
import {
  assetRuntimeSource,
  assetUri,
  isStoredRelPath,
  isTextMime,
  mimeForPath,
  normalizeEntrypoint,
  parentDir,
  resolveAssetPath,
  rewriteHtmlAssets,
  virtualHost,
} from '../services/miniAppFiles';

interface MiniAppRunnerProps {
  app: MiniApp;
  onClose: () => void;
  onLeave?: (tab: 'home' | 'add' | 'settings') => void;
}

const MiniAppRunnerBase: React.FC<MiniAppRunnerProps> = ({ app, onClose, onLeave }) => {
  const tokens = useContainerTheme();
  const [shellPage, setShellPage] = useState<'index' | 'qr' | 'options'>('index');
  const webViewRef = useRef<{ injectJavaScript: (js: string) => void } | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  if (Platform.OS === 'web') {
    webViewRef.current = {
      injectJavaScript: (js: string) => {
        (frameRef.current?.contentWindow as (Window & { eval: (code: string) => unknown }) | null)?.eval(js);
      },
    };
  }
  const [loading, setLoading] = useState(true);
  const [html, setHtml] = useState<string>('');
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [installPermissions, setInstallPermissions] = useState<Permission[]>([]);
  const [runtimeConsent, setRuntimeConsent] = useState<Permission[] | null>(null);
  const [grantedPermissions, setGrantedPermissions] = useState<Permission[]>([]);
  const [mpUi, setMpUi] = useState<MpUiState | null>(null);
  const [hostPresence, setHostPresence] = useState<HostPresence | null>(null);
  const grantedRef = useRef<Permission[]>([]);
  const deniedRef = useRef<Permission[]>([]);
  const consentChain = useRef<Promise<unknown>>(Promise.resolve());
  const consentResolve = useRef<((ok: boolean) => void) | null>(null);
  const capabilitiesRef = useRef<NativeCapabilities | null>(null);
  const [error, setError] = useState<{ message: string; stack?: string } | null>(null);
  const [showSource, setShowSource] = useState(false);
  const learning = showsLearningChrome(Platform.OS);
  // One-shot height. A live window subscription would re-render when the keyboard opens.
  const panes = learningPaneHeights(Dimensions.get('window').height);
  const htmlSource = useRef<{ html: string } | null>(null);
  const openShellPage = (page: 'index' | 'qr' | 'options') => {
    setShellPage(page);
    webViewRef.current?.injectJavaScript(
      `window.dispatchEvent(new CustomEvent('openscr-shell',{detail:${JSON.stringify(page)}})); true;`
    );
  };
  const leaveTo = (tab: 'home' | 'add' | 'settings') => {
    applyShowOverLock(false);
    if (onLeave) onLeave(tab);
    else onClose();
  };
  const leaveScrapp = () => leaveTo('home');

  useLayoutEffect(() => {
    let live = true;
    void (async () => {
      const raw = await AsyncStorage.getItem(SHOW_OVER_LOCK_KEY);
      if (!live) return;
      const enabled = showOverLockEnabled(readShowOverLockMap(raw), app.id);
      if (shouldShowOverLock(Platform.OS, enabled, true)) {
        applyShowOverLock(true);
        void publishOverLockNotice(app.id, app.manifest.name);
      }
    })();
    return () => {
      live = false;
      applyShowOverLock(false);
    };
  }, [app.id]);

  const webLoadedRef = useRef(false);
  const onBridgeMessage = useRef<(event: WebViewMessageEvent) => void>(() => {});
  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const onMsg = (event: MessageEvent) => {
      const payload = event.data;
      if (payload && payload.source === 'openscr-log') {
        console.error(String(payload.message || ''));
        return;
      }
      if (!payload || payload.source !== 'openscr-miniapp' || typeof payload.data !== 'string') return;
      onBridgeMessage.current({ nativeEvent: { data: payload.data } } as WebViewMessageEvent);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const deliverDeepLink = () => {
    if (!webLoadedRef.current) return;
    const link = takeDeepLink(app.id);
    if (link) webViewRef.current?.injectJavaScript(deepLinkInjection(link));
  };
  useEffect(() => onDeepLinkQueued((id) => { if (id === app.id) deliverDeepLink(); }), [app.id]);

  useEffect(() => {
    setupGlobalErrorHandler((error, isFatal) => {
      setError({
        message: error.message || 'Unknown error',
        stack: error.stack,
      });
    });

    initApp().catch((error) => {
      setError({
        message: `Failed to initialize app: ${error.message || 'Unknown error'}`,
        stack: error.stack,
      });
      setLoading(false);
    });

    if (Platform.OS !== 'web') ScreenOrientation.unlockAsync().catch(() => {});

    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      applyShowOverLock(false);
      onClose();
      return true;
    });
    
    return () => {
      backSub.remove();
      removeGlobalErrorHandler();
      if (Platform.OS !== 'web') ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      cancelCameraCapture('Die OpenScrapp wurde geschlossen.');
      if (capabilitiesRef.current) {
        capabilitiesRef.current.cleanup();
      }
      void detachMultiplayer(app.id);
    };
  }, []);

  useEffect(() => subscribeMpUi(setMpUi), []);
  useEffect(() => subscribeHostPresence(setHostPresence), []);
  useEffect(() => {
    if (Platform.OS !== 'android' && Platform.OS !== 'web') return undefined;
    let entry = 'index.html';
    try { entry = normalizeEntrypoint(app.manifest.entrypoint); } catch { entry = 'index.html'; }
    setGuestContent(app.id, {
      entry,
      list: async () => (await listDevFiles(app.id))?.files || listAppFiles(app.localPath),
      read: async (rel) => {
        const file = await readMiniAppAsset(app.id, app.localPath, rel || entry);
        if (!file) return null;
        const body = file.text != null ? new TextEncoder().encode(file.text) : decodeBase64(file.base64);
        return { mime: file.mime, body };
      },
    });
    return undefined;
  }, [app.id, app.localPath, app.manifest.entrypoint]);

  const declaredPermissions = () => (app.manifest.permissions || []).filter(isPermission);

  const resumeSpotify = () => {
    if (!shouldResumeSpotifyRemote({
      platform: Platform.OS,
      granted: grantedRef.current.includes('spotify'),
      remembered: true,
      stopped: false,
    })) return;
    void spotifyReconnectQuiet();
  };

  const initApp = async () => {
    const existingPermissions = await StorageService.getAppPermissions(app.id);
    const deniedPermissions = await StorageService.getDeniedPermissions(app.id);
    grantedRef.current = existingPermissions;
    deniedRef.current = deniedPermissions;
    setGrantedPermissions(existingPermissions);
    const undecided = permissionsOfferedOnPlatform(Platform.OS, declaredPermissions()).filter((permission) => !existingPermissions.includes(permission) && !deniedPermissions.includes(permission));
    if (undecided.length > 0) {
      setInstallPermissions(undecided);
      setShowPermissionModal(true);
    } else {
      await loadApp(existingPermissions);
      resumeSpotify();
    }
  };

  const handleGrantPermissions = async () => {
    const selected = installPermissions;
    for (const permission of selected) {
      await StorageService.setPermissionDecision(app.id, permission, 'granted');
    }
    const next = Array.from(new Set([...grantedRef.current, ...selected]));
    grantedRef.current = next;
    deniedRef.current = deniedRef.current.filter((permission) => !selected.includes(permission));
    setGrantedPermissions(next);
    setShowPermissionModal(false);
    await loadApp(next);
    resumeSpotify();
  };

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') resumeSpotify();
    });
    return () => sub.remove();
  }, [app.id]);

  const handleDenyPermissions = async () => {
    for (const permission of installPermissions) {
      await StorageService.setPermissionDecision(app.id, permission, 'denied');
    }
    deniedRef.current = Array.from(new Set([...deniedRef.current, ...installPermissions]));
    setShowPermissionModal(false);
    await loadApp(grantedRef.current);
  };

  const askConsent = (category: Permission): Promise<boolean> => {
    const run = () => {
      if (grantedRef.current.includes(category)) return Promise.resolve(true);
      if (deniedRef.current.includes(category)) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        consentResolve.current = resolve;
        setRuntimeConsent([category]);
      });
    };
    const pending = consentChain.current.then(run, run);
    consentChain.current = pending.then(() => undefined, () => undefined);
    return pending;
  };

  const finishConsent = async (ok: boolean) => {
    const category = runtimeConsent?.[0];
    const resolve = consentResolve.current;
    consentResolve.current = null;
    setRuntimeConsent(null);
    if (category) {
      await StorageService.setPermissionDecision(app.id, category, ok ? 'granted' : 'denied');
      if (ok) {
        grantedRef.current = Array.from(new Set([...grantedRef.current, category]));
        deniedRef.current = deniedRef.current.filter((permission) => permission !== category);
      } else {
        deniedRef.current = Array.from(new Set([...deniedRef.current, category]));
        grantedRef.current = grantedRef.current.filter((permission) => permission !== category);
      }
      setGrantedPermissions(grantedRef.current);
    }
    resolve?.(ok);
  };

  const baseDirRef = useRef('');
  const docRef = useRef('');

  const loadApp = async (permissions: Permission[], entryOverride?: string, hash?: string) => {
    try {
      const entryRel = entryOverride || normalizeEntrypoint(app.manifest.entrypoint);
      if (!isStoredRelPath(entryRel)) throw new Error('Entrypoint is outside the mini-app');
      const entryUri = assetUri(app.localPath, entryRel);
      if (!entryUri) throw new Error('Entrypoint is outside the mini-app');
      const entryDir = parentDir(entryRel);
      baseDirRef.current = entryDir;
      docRef.current = entryRel;
      console.log('[openscr] lade', app.manifest.name, devFolderFor(app.id) ? 'aus Ordner ' + devFolderFor(app.id) : 'aus der Installation', entryRel);
      const fromFolder = await readDevAsset(app.id, entryRel);
      console.log('[openscr] Einstieg', fromFolder?.text != null ? 'Ordner' : 'Installation', 'Länge', (fromFolder?.text || '').length);
      const htmlContent = fromFolder?.text != null ? fromFolder.text : await readAsStringAsync(entryUri);
      const cache = new Map<string, Promise<{ mime: string; base64: string; text: string | null } | null>>();
      const host = virtualHost(app.id);
      const rewritten = await rewriteHtmlAssets(htmlContent, entryDir, host, (rel) => {
        if (!isStoredRelPath(rel)) return Promise.resolve(null);
        const pending = cache.get(rel) || readMiniAppAsset(app.id, app.localPath, rel);
        cache.set(rel, pending);
        return pending;
      });

      if (!capabilitiesRef.current) {
        capabilitiesRef.current = new NativeCapabilities(app.id);
        if (grantedRef.current.includes('multiplayer')) {
          void resumeMultiplayer(app.id, (event, data) => capabilitiesRef.current?.eventEmitter.emit(event, data));
        }
      }
      const bridgeHandler = new BridgeMessageHandler(app.id, grantedRef.current, capabilitiesRef.current);
      const bridgeScript = bridgeHandler.generateBridgeScript();
      const hashLine = hash ? `location.hash=${JSON.stringify(hash)};` : '';

      const webBridge = Platform.OS === 'web'
        ? `window.ReactNativeWebView=window.ReactNativeWebView||{postMessage:function(data){parent.postMessage({source:'openscr-miniapp',data:String(data)},'*');}};`
        : '';
      const fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
          <style>
            html, body { margin: 0; padding: 0; height: 100%; }
            html { overflow-x: hidden; }
            * { -webkit-tap-highlight-color: transparent; }
          </style>
        </head>
        <body>
          <script>${webBridge}${bridgeScript}
          ${assetRuntimeSource(host)}
          ${hashLine}</script>
          ${rewritten}
        </body>
        </html>
      `;

      setHtml(fullHtml);
      setLoading(false);
    } catch (error: any) {
      console.error('Failed to load mini-app:', error);
      setError({
        message: `Failed to load mini-app: ${error.message || 'Unknown error'}`,
        stack: error.stack,
      });
      setLoading(false);
    }
  };

  const reloadRef = useRef(loadApp);
  reloadRef.current = loadApp;
  useEffect(() => {
    if (!devFolderFor(app.id)) return undefined;
    let seen = '';
    let stop = false;
    const tick = async () => {
      try {
        const listed = await listDevFiles(app.id);
        if (stop || !listed || listed.stamp === seen) return;
        const first = seen === '';
        seen = listed.stamp;
        if (!first) await reloadRef.current(grantedRef.current);
      } catch (error) {
        console.warn('[openscr-dev]', error instanceof Error ? error.message : error);
      }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [app.id]);

  const navigateLocal = async (raw: string) => {
    const hashAt = raw.indexOf('#');
    const before = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
    const hash = hashAt >= 0 ? raw.slice(hashAt) : '';
    if (!before) {
      if (hash) webViewRef.current?.injectJavaScript(`location.hash=${JSON.stringify(hash)}; true;`);
      return;
    }
    const rel = resolveAssetPath(before, baseDirRef.current, virtualHost(app.id));
    if (!rel || !isStoredRelPath(rel) || !/\.html?$/i.test(rel)) return;
    if (rel === docRef.current) {
      if (hash) webViewRef.current?.injectJavaScript(`location.hash=${JSON.stringify(hash)}; true;`);
      return;
    }
    await loadApp(grantedPermissions, rel, hash || undefined);
  };

  const handleMessage = async (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);

      if (message?.type === 'shell-page' && (message.page === 'index' || message.page === 'qr' || message.page === 'options')) {
        setShellPage(message.page);
        return;
      }

      if (message?.type === 'navigate' && typeof message.url === 'string') {
        await navigateLocal(message.url);
        return;
      }

      if (message?.method === '__asset.read') {
        const rel = resolveAssetPath(String(message.args?.[0] ?? ''), baseDirRef.current, virtualHost(app.id));
        if (!rel || !isStoredRelPath(rel)) {
          webViewRef.current?.injectJavaScript(`window.handleBridgeResponse(${JSON.stringify({ id: message.id, success: false, error: 'Asset path is outside the mini-app' })}); true;`);
          return;
        }
        const file = await readMiniAppAsset(app.id, app.localPath, rel);
        const payload = file
          ? { id: message.id, success: true, result: { mime: file.mime, base64: file.base64 } }
          : { id: message.id, success: false, error: 'Asset not found' };
        const json = JSON.stringify(payload).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
        webViewRef.current?.injectJavaScript(`window.handleBridgeResponse(${json}); true;`);
        return;
      }
      
      if (!capabilitiesRef.current) {
        capabilitiesRef.current = new NativeCapabilities(app.id);
      }

      const bridgeHandler = new BridgeMessageHandler(
        app.id,
        grantedRef.current,
        capabilitiesRef.current,
        (js) => webViewRef.current?.injectJavaScript(js),
        { denied: deniedRef.current, ask: askConsent },
      );
      const response = await bridgeHandler.handleMessage(message);
      
      if (response) {
        webViewRef.current?.injectJavaScript(
          `window.handleBridgeResponse(${JSON.stringify(response)}); true;`
        );
      }
    } catch (error: any) {
      console.error('Bridge message error:', error);
      setError({
        message: `Bridge error: ${error.message || 'Unknown error'}`,
        stack: error.stack,
      });
    }
  };
  onBridgeMessage.current = handleMessage;

  const handleWebViewError = (event: any) => {
    console.error('WebView error:', event.nativeEvent);
    setError({
      message: `WebView error: ${event.nativeEvent?.description || 'Unknown error'}`,
      stack: `URL: ${event.nativeEvent?.url || 'N/A'}\nCode: ${event.nativeEvent?.code || 'N/A'}`,
    });
  };

  const handleHttpError = (event: any) => {
    console.error('WebView HTTP error:', event.nativeEvent);
    setError({
      message: `HTTP error: ${event.nativeEvent?.statusCode || 'Unknown'} ${event.nativeEvent?.description || ''}`,
      stack: `URL: ${event.nativeEvent?.url || 'N/A'}`,
    });
  };

  const handleRenderProcessGone = () => {
    console.error('WebView render process gone');
    setError({
      message: 'WebView render process crashed',
      stack: 'The WebView rendering process has terminated unexpectedly',
    });
  };

  const handleCopyError = async () => {
    if (error) {
      const errorText = `${error.message}\n\n${error.stack || 'No stack trace available'}`;
      await Clipboard.setStringAsync(errorText);
    }
  };

  if (error) {
    return (
      <View style={styles.container}>
        <StatusBar hidden />
        <View style={styles.errorHeader}>
          <Text style={styles.errorTitle}>Error</Text>
          <Text style={styles.errorSubtitle}>{app.manifest.name}</Text>
        </View>
        <ScrollView style={styles.errorContainer}>
          <Text style={styles.errorText} selectable>
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
          </Text>
        </ScrollView>
        <View style={styles.errorButtons}>
          <TouchableOpacity style={styles.errorButton} onPress={handleCopyError}>
            <Text style={styles.errorButtonText}>Copy Error</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.errorButton, styles.closeButton]} onPress={leaveScrapp}>
            <Text style={styles.errorButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const codePane = learning ? { height: panes.code, maxHeight: '80%' as const } : { flex: 1 };
  return (
    <View style={styles.container}>
      <StatusBar hidden={!learning} />
      {learning ? (
        <View style={[styles.devBar, { height: panes.bar }]}>
          <Text style={styles.devBarTitle}>Entwicklungsumgebung · eigener Code</Text>
          <View style={styles.devBarActions}>
            <TouchableOpacity style={styles.devBarButton} onPress={leaveScrapp} accessibilityLabel="Zurück">
              <Text style={styles.devBarButtonText}>Zurück</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.devBarButton} onPress={() => setShowSource(true)} accessibilityLabel="Quelltext">
              <Text style={styles.devBarButtonText}>Quelltext</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      <View style={[codePane, learning ? null : styles.scrappStage]}>
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2196F3" />
        </View>
      ) : Platform.OS === 'web' ? (
        createElement('iframe', {
          ref: frameRef,
          title: app.manifest.name,
          srcDoc: html,
          style: { border: 0, width: '100%', height: '100%', background: '#0B0B0F' },
          onLoad: () => { webLoadedRef.current = true; setLoading(false); setTimeout(deliverDeepLink, 300); },
        })
      ) : (
        <WebView
          ref={(node) => { webViewRef.current = node; }}
          source={(htmlSource.current = stableWebViewHtml(htmlSource.current, html))}
          style={styles.webview}
          onMessage={handleMessage}
          onLoadEnd={() => { webLoadedRef.current = true; setTimeout(deliverDeepLink, 300); }}
          onError={handleWebViewError}
          onHttpError={handleHttpError}
          onRenderProcessGone={handleRenderProcessGone}
          originWhitelist={['http://*', 'https://*']}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          onShouldStartLoadWithRequest={(request) => {
            const url = request?.url || '';
            if (/^(file|content):/i.test(url)) return false;
            const rel = resolveAssetPath(url, baseDirRef.current, virtualHost(app.id));
            if (rel) {
              void navigateLocal(url);
              return false;
            }
            return true;
          }}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          scrollEnabled
          nestedScrollEnabled
          overScrollMode="content"
          bounces={false}
          setSupportMultipleWindows={false}
          onLoad={() => setLoading(false)}
        />
      )}

      {learning ? null : (
        <View style={styles.navWrap} pointerEvents="box-none">
          <View style={styles.navRow}>
            <View style={[styles.navPill, { backgroundColor: tokens.nav, borderColor: tokens.line }]}>
              <TouchableOpacity style={styles.navItem} onPress={() => leaveTo('home')} accessibilityLabel="Start">
                <NavGlyph name="home" color={tokens.muted} />
                <View style={[styles.navUnderline, { backgroundColor: 'transparent' }]} />
              </TouchableOpacity>
            </View>
            <View style={[styles.navPill, styles.subPill, { backgroundColor: tokens.nav, borderColor: tokens.line }]}>
              {([
                ['index', app.manifest.name, 'app'],
                ['qr', 'QR-Code', 'qr'],
                ['options', 'Optionen', 'settings'],
              ] as const).map(([id, label, glyph]) => {
                const active = shellPage === id;
                const color = active ? tokens.lime : tokens.muted;
                return (
                  <TouchableOpacity key={id} style={styles.navItem} onPress={() => openShellPage(id)} accessibilityLabel={label}>
                    {glyph === 'app'
                      ? <ScrappGlyph name={app.manifest.name} color={color} size={22} />
                      : <NavGlyph name={glyph} color={color} />}
                    <View style={[styles.navUnderline, { backgroundColor: active ? tokens.lime : 'transparent' }]} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      )}
      {Platform.OS === 'android' && hostPresence && !mpUi ? (
        <TouchableOpacity
          onPress={() => { try { showMultiplayerQr(app.id); } catch { /* Der Raum ist schon zu. */ } }}
          style={{ position: 'absolute', left: 12, bottom: 16, borderRadius: 16, backgroundColor: 'rgba(15,17,21,0.82)', paddingVertical: 8, paddingHorizontal: 12, zIndex: 12 }}
        >
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{hostPresence.batteryWarning ? 'Einladen · Akku' : 'Einladen'}</Text>
        </TouchableOpacity>
      ) : null}
      {Platform.OS === 'web' ? null : <CameraCaptureOverlay />}
      </View>

      <PermissionRequestModal
        visible={showPermissionModal}
        appName={app.manifest.name}
        requestedPermissions={installPermissions}
        onGrant={handleGrantPermissions}
        onDeny={handleDenyPermissions}
      />
      <PermissionRequestModal
        visible={!!runtimeConsent}
        appName={app.manifest.name}
        requestedPermissions={runtimeConsent || []}
        title="Zugriff erlauben?"
        intro="Die OpenScrapp möchte diese Funktion jetzt zum ersten Mal nutzen."
        grantLabel="Einmal erlauben"
        denyLabel="Nicht erlauben"
        onGrant={() => { void finishConsent(true); }}
        onDeny={() => { void finishConsent(false); }}
      />
      {learning ? (
        <SourceCodeModal app={app} visible={showSource} onClose={() => setShowSource(false)} />
      ) : Platform.OS === 'ios' ? null : (
      <MultiplayerOverlay
        state={mpUi}
        onDone={dismissMpUi}
        onEnd={() => { void endRoom(app.id); }}
        onScanned={submitMpScan}
        onCancel={cancelMpScan}
        onApprove={(id) => { void approveJoin(app.id, id); }}
        onDeny={(id) => { void denyJoin(app.id, id); }}
      />
      )}
    </View>
  );
};

export const MiniAppRunner = React.memo(MiniAppRunnerBase);

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function readMiniAppAsset(appId: string, localPath: string, rel: string): Promise<{ mime: string; base64: string; text: string | null } | null> {
  if (devFolderFor(appId)) {
    const fromFolder = await readDevAsset(appId, rel);
    return fromFolder ? { mime: fromFolder.mime, base64: fromFolder.base64, text: fromFolder.text } : null;
  }
  const uri = assetUri(localPath, rel);
  if (!uri) return null;
  const info = await getInfoAsync(uri);
  if (!info.exists || info.isDirectory) return null;
  const mime = mimeForPath(rel);
  const base64 = await readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const text = isTextMime(mime) ? await readAsStringAsync(uri) : null;
  return { mime, base64, text };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0B0F',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrappStage: {
    flex: 1,
    paddingBottom: 92,
    backgroundColor: '#0B0B0F',
  },
  navWrap: { position: 'absolute', left: 0, right: 0, bottom: 22, alignItems: 'center', zIndex: 20 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  navPill: { flexDirection: 'row', borderRadius: 28, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 10, justifyContent: 'space-between' },
  subPill: { borderWidth: 1, paddingHorizontal: 8 },
  navItem: { width: 56, alignItems: 'center', paddingVertical: 4 },
  navUnderline: { marginTop: 6, height: 2, width: 18, borderRadius: 1 },
  devBar: {
    backgroundColor: '#0d47a1',
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  devBarTitle: {
    color: 'white',
    fontWeight: '700',
    fontSize: 15,
  },
  devBarActions: {
    flexDirection: 'row',
    marginTop: 8,
  },
  devBarButton: {
    backgroundColor: 'white',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
  },
  devBarButtonText: {
    color: '#0d47a1',
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorHeader: {
    padding: 20,
    backgroundColor: '#d32f2f',
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  errorSubtitle: {
    fontSize: 14,
    color: '#ffebee',
  },
  errorContainer: {
    flex: 1,
    padding: 16,
    backgroundColor: '#1a1a1a',
  },
  errorText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#fff',
    lineHeight: 18,
  },
  errorButtons: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    backgroundColor: '#1a1a1a',
  },
  errorButton: {
    flex: 1,
    backgroundColor: '#424242',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  closeButton: {
    backgroundColor: '#2196F3',
  },
  errorButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
