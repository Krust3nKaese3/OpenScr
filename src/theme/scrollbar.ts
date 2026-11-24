/** Shared web scrollbar. Injected into the OpenScr document and every mini-app frame. */
export const SCROLLBAR_CSS = [
  '* { scrollbar-width: thin; scrollbar-color: #3a3a44 transparent; }',
  '*::-webkit-scrollbar { width: 8px; height: 8px; }',
  '*::-webkit-scrollbar-thumb { background: #3a3a44; border-radius: 8px; }',
  '*::-webkit-scrollbar-track { background: transparent; }',
].join('\n');

export function installScrollbarStyle(): void {
  if (typeof document === 'undefined') return;
  const id = 'openscr-scroll-style';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = SCROLLBAR_CSS;
  document.head.appendChild(style);
}
