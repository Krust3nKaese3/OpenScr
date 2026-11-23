import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Dark is the default. Light stays available from the settings tab. */
export type AppearanceMode = 'dark' | 'light';

export interface ContainerTokens {
  bg: string;
  card: string;
  text: string;
  muted: string;
  lime: string;
  ink: string;
  line: string;
  danger: string;
  nav: string;
  input: string;
}

export const darkTokens: ContainerTokens = {
  bg: '#0B0B0F',
  card: '#17171C',
  text: '#F4F4F5',
  muted: '#8E8E93',
  lime: '#A3E635',
  ink: '#0B0B0F',
  line: '#2A2A32',
  danger: '#F07167',
  nav: '#141418',
  input: '#141418',
};

export const lightTokens: ContainerTokens = {
  bg: '#F4F4F6',
  card: '#FFFFFF',
  text: '#141416',
  muted: '#6B6B73',
  lime: '#A3E635',
  ink: '#0B0B0F',
  line: '#E2E2E6',
  danger: '#C62828',
  nav: '#FFFFFF',
  input: '#FFFFFF',
};

const KEY = '@openscr_appearance';
let mode: AppearanceMode = 'dark';
const listeners = new Set<() => void>();

export function appearanceMode(): AppearanceMode {
  return mode;
}

export function containerTokens(): ContainerTokens {
  return mode === 'light' ? lightTokens : darkTokens;
}

function publish(): void {
  listeners.forEach((listener) => listener());
}

export async function loadAppearance(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark') mode = stored;
  } catch {
    mode = 'dark';
  }
  publish();
}

export async function setAppearance(next: AppearanceMode): Promise<void> {
  mode = next;
  publish();
  try {
    await AsyncStorage.setItem(KEY, next);
  } catch {
    /* The choice still applies for this session. */
  }
}

export function useContainerTheme(): ContainerTokens {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((value) => value + 1);
    listeners.add(listener);
    void loadAppearance();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return containerTokens();
}
