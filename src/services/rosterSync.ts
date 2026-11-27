/** Fired after the shared name list on this device changes. */
let hook: (() => void) | null = null;

export function setRosterHook(next: () => void): void {
  hook = next;
}

export function notifyRoster(): void {
  hook?.();
}
