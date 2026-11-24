import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { appearanceMode, useContainerTheme } from './src/theme/containerTheme';
import { installScrollbarStyle } from './src/theme/scrollbar';
import { initBackgroundTasks } from './src/services/BackgroundTasks';
import { HomeScreen } from './src/screens/HomeScreen';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { WebDevPanel } from './src/components/WebDevPanel';
import { Platform } from 'react-native';

function Shell() {
  const tokens = useContainerTheme();
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.style.backgroundColor = tokens.bg;
    document.body.style.backgroundColor = tokens.bg;
    document.body.style.margin = '0';
    installScrollbarStyle();
  }, [tokens.bg]);
  return (
    <>
      <StatusBar style={appearanceMode() === 'light' ? 'dark' : 'light'} />
      <HomeScreen />
      <WebDevPanel />
    </>
  );
}

export default function App() {
  useEffect(() => { initBackgroundTasks(true); }, []);
  useEffect(() => {
    if (Platform.OS === 'android') {
      const BleManager = require('react-native-ble-manager').default;
      BleManager.start({ showAlert: false }).catch((error: unknown) => {
        console.error('BleManager start error:', error);
      });
    }
  }, []);

  return (
    <ErrorBoundary>
      <Shell />
    </ErrorBoundary>
  );
}
