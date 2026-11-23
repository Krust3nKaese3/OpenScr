import * as FileSystem from 'expo-file-system/legacy';

/** Browser stand-in for expo-file-system. Phones keep the native module. */

type FileNode = { dir: true } | { dir: false; text: string; base64: string; size: number };

const STORE = 'openscr-web-files-v1';
const ROOT = 'web://miniapps/';
const nodes = new Map<string, FileNode>();

export function usesWebFiles(): boolean {
  return !FileSystem.documentDirectory;
}

export function appsDirectory(): string {
  return usesWebFiles() ? ROOT : `${FileSystem.documentDirectory}miniapps/`;
}

function norm(uri: string): string {
  const raw = String(uri || '');
  const web = raw.startsWith('web://');
  const body = web ? raw.slice('web://'.length) : raw;
  const out: string[] = [];
  for (const part of body.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `${web ? 'web://' : ''}${out.join('/')}${raw.endsWith('/') ? '/' : ''}`;
}

function load() {
  if (!usesWebFiles() || typeof localStorage === 'undefined' || nodes.size) return;
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, FileNode>;
    Object.entries(saved).forEach(([path, node]) => nodes.set(path, node));
  } catch {
    /* a full store just stays in memory */
  }
}

function persist() {
  if (typeof localStorage === 'undefined') return;
  try {
    const saved: Record<string, FileNode> = {};
    nodes.forEach((node, path) => { saved[path] = node; });
    localStorage.setItem(STORE, JSON.stringify(saved));
  } catch {
    /* quota: this session still has the files */
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function getInfoAsync(uri: string): Promise<{ exists: boolean; isDirectory: boolean; size?: number }> {
  if (!usesWebFiles()) return FileSystem.getInfoAsync(uri);
  load();
  const path = norm(uri);
  const node = nodes.get(path) || nodes.get(path.replace(/\/$/, '')) || nodes.get(`${path.replace(/\/$/, '')}/`);
  if (!node) return { exists: false, isDirectory: false };
  if (node.dir) return { exists: true, isDirectory: true };
  return { exists: true, isDirectory: false, size: node.size };
}

export async function listAppFiles(root: string): Promise<string[]> {
  if (!usesWebFiles()) return [];
  load();
  const prefix = `${norm(root).replace(/\/$/, '')}/`;
  const rels: string[] = [];
  nodes.forEach((node, key) => {
    if (!node.dir && key.startsWith(prefix)) rels.push(key.slice(prefix.length));
  });
  return rels;
}

export async function readDirectoryAsync(uri: string): Promise<string[]> {
  if (!usesWebFiles()) return FileSystem.readDirectoryAsync(uri);
  load();
  const path = norm(uri).replace(/\/$/, '');
  const prefix = `${path}/`;
  const names = new Set<string>();
  nodes.forEach((_node, key) => {
    if (!key.startsWith(prefix)) return;
    const rest = key.slice(prefix.length);
    const name = rest.split('/')[0];
    if (name) names.add(name);
  });
  return [...names];
}

export async function makeDirectoryAsync(uri: string, _opts?: { intermediates?: boolean }): Promise<void> {
  if (!usesWebFiles()) return FileSystem.makeDirectoryAsync(uri, _opts);
  load();
  const path = norm(uri).replace(/\/$/, '');
  const bits = path.replace(/^web:\/\//, '').split('/');
  let acc = 'web://';
  for (const bit of bits) {
    acc += (acc.endsWith('/') ? '' : '/') + bit;
    if (!nodes.has(acc)) nodes.set(acc, { dir: true });
  }
  persist();
}

export async function deleteAsync(uri: string, opts?: { idempotent?: boolean }): Promise<void> {
  if (!usesWebFiles()) return FileSystem.deleteAsync(uri, opts);
  load();
  const path = norm(uri).replace(/\/$/, '');
  let removed = false;
  [...nodes.keys()].forEach((key) => {
    if (key === path || key.startsWith(`${path}/`)) {
      nodes.delete(key);
      removed = true;
    }
  });
  if (!removed && !opts?.idempotent) throw new Error(`Datei fehlt: ${uri}`);
  persist();
}

export async function moveAsync(opts: { from: string; to: string }): Promise<void> {
  if (!usesWebFiles()) return FileSystem.moveAsync(opts);
  load();
  const from = norm(opts.from).replace(/\/$/, '');
  const to = norm(opts.to).replace(/\/$/, '');
  const moved: [string, FileNode][] = [];
  [...nodes.entries()].forEach(([key, node]) => {
    if (key === from || key.startsWith(`${from}/`)) moved.push([key, node]);
  });
  moved.forEach(([key]) => nodes.delete(key));
  moved.forEach(([key, node]) => nodes.set(to + key.slice(from.length), node));
  persist();
}

export async function readAsStringAsync(uri: string, opts?: { encoding?: string }): Promise<string> {
  if (!usesWebFiles()) return FileSystem.readAsStringAsync(uri, opts as any);
  load();
  const info = await getInfoAsync(uri);
  const path = norm(uri).replace(/\/$/, '');
  const node = nodes.get(path);
  if (!node || node.dir) throw new Error(`Datei fehlt: ${uri}`);
  if (!info.exists) throw new Error(`Datei fehlt: ${uri}`);
  return opts?.encoding === FileSystem.EncodingType.Base64 || opts?.encoding === 'base64' ? node.base64 : node.text;
}

export async function downloadAsync(url: string, dest: string, opts?: { headers?: Record<string, string> }): Promise<{ status: number; uri: string }> {
  if (!usesWebFiles()) return FileSystem.downloadAsync(url, dest, opts);
  const response = await fetch(url, { headers: opts?.headers });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const path = norm(dest).replace(/\/$/, '');
  await makeDirectoryAsync(path.slice(0, path.lastIndexOf('/')), { intermediates: true });
  nodes.set(path, {
    dir: false,
    text: new TextDecoder().decode(bytes),
    base64: bytesToBase64(bytes),
    size: bytes.length,
  });
  persist();
  return { status: response.status, uri: dest };
}
