/** Merkt sich die letzte Einladung, solange der Raum in diesem Prozess läuft. */
export interface InviteDraft {
  link: 'wlan' | 'hotspot';
  ssid: string;
  password: string;
}

let draft: InviteDraft | null = null;

export function getInviteDraft(): InviteDraft | null {
  return draft ? { ...draft } : null;
}

export function setInviteDraft(next: InviteDraft | null): void {
  draft = next ? { ...next } : null;
}

export function clearInviteDraft(): void {
  draft = null;
}
