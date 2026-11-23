/** Same HTML keeps the same object so the Android WebView does not reload. */
export function stableWebViewHtml(
  previous: { html: string } | null,
  html: string,
): { html: string } {
  if (previous && previous.html === html) return previous;
  return { html };
}
