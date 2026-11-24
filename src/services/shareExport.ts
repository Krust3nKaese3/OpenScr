/** Cache file name for the system share sheet. No path can leave the cache folder. */

export function safeExportFileName(name: string): string {
  const base = String(name || '').split(/[/\\]/).pop() || '';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  if (!cleaned || cleaned.length > 80) throw new Error('Dateiname ist ungültig.');
  return cleaned;
}

export const EXPORT_MIME_DEFAULT = 'text/plain';
