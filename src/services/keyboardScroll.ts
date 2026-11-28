// Pure helpers for keeping a focused input visible above the keyboard.

export type Span = { y: number; height: number };

/**
 * How far a scroll view must scroll (positive = further down) so the input is fully inside
 * the visible part of the view, with `margin` px of air. Returns 0 when it is already visible.
 * Both spans must use the same coordinate system (window coordinates).
 */
export function scrollDeltaForInput(input: Span, view: Span, margin = 24): number {
  const viewTop = view.y;
  const viewBottom = view.y + view.height;
  const inputTop = input.y;
  const inputBottom = input.y + input.height;
  if (input.height + margin * 2 > view.height) {
    // Input does not fit with margins: align its top.
    return inputTop - viewTop - Math.min(margin, 4);
  }
  if (inputBottom + margin > viewBottom) return inputBottom + margin - viewBottom;
  if (inputTop - margin < viewTop) return inputTop - margin - viewTop;
  return 0;
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Called by AppTextInput when any input gets focus. */
export function emitInputFocus(): void {
  listeners.forEach((listener) => { try { listener(); } catch { /* ignore */ } });
}

export function onInputFocus(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
