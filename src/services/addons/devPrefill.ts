/** Dev-only GitHub URLs already filled into the add-on sheet. Not used in production. */
export const DEV_ADDON_PREFILL: Record<string, string> = {
  github_com_krust3nkaese3_imposterdancescrapp: 'https://github.com/Krust3nKaese3/ImpostorDanceYoutube',
};

export function devAddonPrefill(scrappId: string, dev?: boolean): string {
  const variant = typeof process !== 'undefined' ? String(process.env.APP_VARIANT || '').trim().toLowerCase() : '';
  const enabled = typeof dev === 'boolean'
    ? dev
    : variant === 'dev' || variant === 'development' || (typeof __DEV__ !== 'undefined' && __DEV__);
  if (!enabled) return '';
  return DEV_ADDON_PREFILL[scrappId] || '';
}
