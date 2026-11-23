/** Dateien der geöffneten OpenScrapp, die der Browser-Server ausliefert. */
export interface GuestFile {
  mime: string;
  body: Uint8Array;
}

export interface GuestContent {
  entry: string;
  read(rel: string): Promise<GuestFile | null>;
}

const files = new Map<string, GuestContent>();

export function setGuestContent(appId: string, content: GuestContent | null): void {
  if (!content) files.delete(appId);
  else files.set(appId, content);
}

export function guestContent(appId: string): GuestContent | null {
  return files.get(appId) || null;
}

export function clearGuestContent(): void {
  files.clear();
}
