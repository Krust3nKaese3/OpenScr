import { getInfoAsync, readAsStringAsync, readDirectoryAsync } from './appFiles';
import { assetUri, isStoredRelPath } from './miniAppFiles';
import { selectSourceFiles } from './iosPolicy';

const MAX_CHARS = 300_000;

async function walk(dir: string, prefix: string, out: string[]): Promise<void> {
  const names = await readDirectoryAsync(dir);
  for (const name of names) {
    if (name === '.git' || name === 'node_modules') continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    if (!isStoredRelPath(rel)) continue;
    const uri = `${dir.replace(/\/$/, '')}/${name}`;
    const info = await getInfoAsync(uri);
    if (!info.exists) continue;
    if (info.isDirectory) await walk(uri, rel, out);
    else out.push(rel);
  }
}

/** Read-only HTML and JavaScript that were downloaded with the OpenScrapp. */
export async function loadSourceFiles(localPath: string, entrypoint: string): Promise<{ path: string; text: string }[]> {
  const root = localPath.replace(/\/$/, '');
  const rels: string[] = [];
  await walk(root, '', rels);
  const files: { path: string; text: string }[] = [];
  for (const rel of selectSourceFiles(rels, entrypoint)) {
    const uri = assetUri(`${root}/`, rel);
    if (!uri) continue;
    const info = await getInfoAsync(uri);
    if (!info.exists || info.isDirectory) continue;
    let text = await readAsStringAsync(uri);
    if (text.length > MAX_CHARS) {
      text = `${text.slice(0, MAX_CHARS)}\n\n… Die Datei ist länger. Angezeigt wird der Anfang.`;
    }
    files.push({ path: rel, text });
  }
  return files;
}
