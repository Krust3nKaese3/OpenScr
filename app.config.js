// Extends app.json. APP_VARIANT=dev (alias "development") builds "OpenScr Dev":
// package com.openscr.app.dev and scheme openscrdev. Unset is production OpenScr.
// The Expo dev-client link stays exp+<slug> (exp+openscr).
// CATALOG_ONLY / EXPO_PUBLIC_CATALOG_ONLY=1 is an Android build switch.
// iOS ignores it and runs own repositories only. That choice is in src/services/iosPolicy.ts.
const VARIANT = String(process.env.APP_VARIANT || '').trim().toLowerCase();
const IS_DEV = VARIANT === 'dev' || VARIANT === 'development';
const flagOn = (value) => ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
const CATALOG_ONLY = flagOn(process.env.CATALOG_ONLY) || flagOn(process.env.EXPO_PUBLIC_CATALOG_ONLY);
if (CATALOG_ONLY) process.env.EXPO_PUBLIC_CATALOG_ONLY = process.env.EXPO_PUBLIC_CATALOG_ONLY || '1';
// Public GitHub OAuth client id (Device Flow). Not a secret. Metro inherits this when the env var is unset.
const DEFAULT_GITHUB_CLIENT_ID = 'Ov23liZBUKxpmryUJW1a';
if (!String(process.env.EXPO_PUBLIC_GITHUB_CLIENT_ID || '').trim()) {
  process.env.EXPO_PUBLIC_GITHUB_CLIENT_ID = DEFAULT_GITHUB_CLIENT_ID;
}

module.exports = ({ config }) => {
  const fromEnv = process.env.SPOTIFY_CLIENT_ID;
  const fromConfig = config.extra && config.extra.spotifyClientId;
  return {
    ...config,
    name: IS_DEV ? 'OpenScr Dev' : 'OpenScr',
    scheme: IS_DEV ? 'openscrdev' : (config.scheme || 'openscr'),
    android: {
      ...config.android,
      package: IS_DEV ? `${config.android.package}.dev` : config.android.package,
      // Lokaler Mehrspieler: Internet (Sockets) plus Netzstatus, um die WLAN-Adresse zu lesen.
      permissions: ['INTERNET', 'ACCESS_NETWORK_STATE', 'ACCESS_WIFI_STATE'].reduce((list, name) => {
        const next = Array.isArray(list) ? list.slice() : [];
        if (!next.includes(name)) next.push(name);
        return next;
      }, config.android && config.android.permissions),
    },
    ios: {
      ...config.ios,
      bundleIdentifier: IS_DEV ? `${config.ios.bundleIdentifier}.dev` : config.ios.bundleIdentifier,
    },
    plugins: [...(config.plugins || []), 'with-react-native-tcp-socket'],
    // Optional prefill only. Empty is normal; the settings screen is the source of truth.
    extra: {
      ...config.extra,
      spotifyClientId: fromEnv || fromConfig || '',
      catalogOnly: CATALOG_ONLY,
      githubClientId: process.env.EXPO_PUBLIC_GITHUB_CLIENT_ID || DEFAULT_GITHUB_CLIENT_ID,
    },
  };
};
