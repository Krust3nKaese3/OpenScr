import { appsDirectory, deleteAsync, downloadAsync, getInfoAsync, makeDirectoryAsync, moveAsync, readAsStringAsync } from './appFiles';
import { MiniAppManifest, MiniApp } from '../types';
import {
  listMiniAppFiles,
  MANIFEST_FALLBACK,
  MANIFEST_FILE,
  MINIAPP_LIMITS,
  normalizeEntrypoint,
  parseGitHubRepo,
} from './miniAppFiles';
import { githubApiGet, rawGithubHeaders } from './githubApi';
import { commitApiUrl, githubRawUrlAtRef, parseCommitSha, treeApiUrl } from './githubPin';

const appsDir = () => appsDirectory();

async function firstExistingManifest(staging: string): Promise<string> {
  for (const name of [MANIFEST_FILE, MANIFEST_FALLBACK]) {
    const info = await getInfoAsync(`${staging}${name}`);
    if (info.exists && !info.isDirectory) return name;
  }
  throw new Error('openscr.json not found in repository');
}

type GitTreeResponse = {
  truncated?: boolean;
  message?: string;
  tree?: { path: string; mode: string; type: string; size?: number }[];
};

export class GitRepoService {
  static async fetchRepo(repoUrl: string, options?: { token?: string }): Promise<MiniApp> {
    const { owner, repo } = parseGitHubRepo(repoUrl);
    const appId = this.generateAppId(repoUrl);
    const token = options?.token;
    const commitSha = await this.fetchCommitSha(owner, repo, token);
    const tree = await this.fetchTree(owner, repo, commitSha, token);
    if (tree.truncated) {
      throw new Error('Repository tree is too large to install. Keep the OpenScrapp in a smaller repository.');
    }
    const { files } = listMiniAppFiles(tree.tree || []);

    const root = appsDir();
    const staging = `${root}${appId}.staging/`;
    const backup = `${root}${appId}.backup/`;
    const finalPath = `${root}${appId}/`;
    await deleteAsync(staging, { idempotent: true });
    await makeDirectoryAsync(staging, { intermediates: true });

    try {
      await mapPool(files, 4, async (file) => {
        const dest = `${staging}${file.rel}`;
        const parent = dest.slice(0, dest.lastIndexOf('/'));
        await makeDirectoryAsync(parent, { intermediates: true });
        await deleteAsync(dest, { idempotent: true });
        // SHA URL: raw.githubusercontent.com caches /main/ and ignores ?t= cache busters.
        const result = await downloadAsync(
          githubRawUrlAtRef(owner, repo, commitSha, file.path),
          dest,
          { headers: rawGithubHeaders(token) },
        );
        if (result.status < 200 || result.status >= 300) {
          throw new Error(`Failed to download ${file.rel} (${result.status})`);
        }
      });

      let total = 0;
      for (const file of files) {
        const info = await getInfoAsync(`${staging}${file.rel}`);
        const size = info.exists && !info.isDirectory && typeof info.size === 'number' ? info.size : 0;
        if (size > MINIAPP_LIMITS.maxFileBytes) {
          throw new Error(`A file exceeds the ${MINIAPP_LIMITS.maxFileBytes} byte limit.`);
        }
        total += size;
      }
      if (total > MINIAPP_LIMITS.maxTotalBytes) {
        throw new Error(`OpenScrapp exceeds the ${MINIAPP_LIMITS.maxTotalBytes} byte download limit.`);
      }

      const manifestName = await firstExistingManifest(staging);
      const manifestRaw = await readAsStringAsync(`${staging}${manifestName}`);
      let manifest: MiniAppManifest;
      try {
        manifest = JSON.parse(manifestRaw);
      } catch {
        throw new Error(`${manifestName} is not valid JSON`);
      }
      if (!manifest || typeof manifest !== 'object' || typeof manifest.entrypoint !== 'string') {
        throw new Error(`Entrypoint missing in ${manifestName}`);
      }
      const entryRel = normalizeEntrypoint(manifest.entrypoint);
      const entryInfo = await getInfoAsync(`${staging}${entryRel}`);
      if (!entryInfo.exists || entryInfo.isDirectory) {
        throw new Error(`Entrypoint ${manifest.entrypoint} not found in repository`);
      }

      await deleteAsync(backup, { idempotent: true });
      const existing = await getInfoAsync(finalPath);
      if (existing.exists) await moveAsync({ from: finalPath, to: backup });
      try {
        await moveAsync({ from: staging, to: finalPath });
      } catch (moveError) {
        const rolled = await getInfoAsync(finalPath);
        if (!rolled.exists) {
          const backupInfo = await getInfoAsync(backup);
          if (backupInfo.exists) await moveAsync({ from: backup, to: finalPath });
        }
        throw moveError;
      }
      await deleteAsync(backup, { idempotent: true });

      return {
        id: appId,
        repoUrl,
        manifest,
        localPath: finalPath,
        addedAt: Date.now(),
        folderId: null,
        commitSha,
      };
    } catch (error) {
      await deleteAsync(staging, { idempotent: true });
      throw error;
    }
  }

  /** Latest commit on `main`. Used by install, update, and the update check. */
  static async latestCommit(repoUrl: string, options?: { token?: string }): Promise<string> {
    const { owner, repo } = parseGitHubRepo(repoUrl);
    return this.fetchCommitSha(owner, repo, options?.token);
  }

  private static async fetchCommitSha(owner: string, repo: string, token?: string): Promise<string> {
    const response = await githubApiGet(commitApiUrl(owner, repo), token);
    if (response.status === 404) {
      throw new Error('Repository oder Branch main nicht gefunden. Nur öffentliche GitHub-Repositories mit Branch main.');
    }
    return parseCommitSha(JSON.parse(response.body));
  }

  private static async fetchTree(owner: string, repo: string, sha: string, token?: string): Promise<GitTreeResponse> {
    const response = await githubApiGet(treeApiUrl(owner, repo, sha), token);
    if (response.status === 404) {
      throw new Error('Repository oder Branch main nicht gefunden. Nur öffentliche GitHub-Repositories mit Branch main.');
    }
    return JSON.parse(response.body) as GitTreeResponse;
  }

  private static generateAppId(repoUrl: string): string {
    return repoUrl
      .replace(/https?:\/\//, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toLowerCase();
  }

  static async getLocalEntrypointPath(app: MiniApp): Promise<string> {
    return `${app.localPath}${app.manifest.entrypoint}`;
  }

  static async deleteApp(app: MiniApp): Promise<void> {
    await this.deleteStoredApp(app.id);
    if (app.localPath) await deleteAsync(app.localPath, { idempotent: true });
  }

  /** Installed copy plus the staging and backup directories used during download. */
  static async deleteStoredApp(appId: string): Promise<void> {
    const root = appsDir();
    await deleteAsync(`${root}${appId}/`, { idempotent: true });
    await deleteAsync(`${root}${appId}.staging/`, { idempotent: true });
    await deleteAsync(`${root}${appId}.backup/`, { idempotent: true });
  }
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  let failure: unknown = null;
  const worker = async () => {
    while (failure == null && next < items.length) {
      const index = next++;
      try {
        await fn(items[index]);
      } catch (error) {
        failure = error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  if (failure) throw failure;
}
