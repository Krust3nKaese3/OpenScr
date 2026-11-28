import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
  type ScrollViewInstance,
  type ScrollViewProps,
  type StyleProp,
  type TextInputInstance,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { emitInputFocus, onInputFocus, scrollDeltaForInput } from '../services/keyboardScroll';

/**
 * Keyboard handling for the whole host app.
 * Android is edge-to-edge (the window does not resize for the keyboard), so every screen,
 * modal and sheet that can show an input sits inside a KeyboardSafeView, and scrolling
 * content uses KeyboardScrollView which also scrolls the focused input into view.
 */

/** Wrapper that lifts its content above the keyboard. Use it as the root of a screen or Modal. */
export function KeyboardSafeView({
  style,
  children,
  offset = 0,
}: {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  offset?: number;
}) {
  if (Platform.OS === 'web') return <View style={[{ flex: 1 }, style]}>{children}</View>;
  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={offset} style={{ flex: 1 }}>
      <View style={[{ flex: 1 }, style]}>{children}</View>
    </KeyboardAvoidingView>
  );
}

/** True while the software keyboard is open. */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return visible;
}

/** TextInput that tells surrounding KeyboardScrollViews to bring it into view when focused. */
export const AppTextInput = forwardRef<TextInputInstance, TextInputProps>(function AppTextInput(props, ref) {
  const { onFocus, ...rest } = props;
  return (
    <TextInput
      ref={ref}
      {...rest}
      onFocus={(event) => {
        emitInputFocus();
        onFocus?.(event);
      }}
    />
  );
});

/**
 * ScrollView that keeps taps working with the keyboard open and scrolls the focused input
 * into the visible area (after the keyboard has opened and the view has shrunk).
 */
export const KeyboardScrollView = forwardRef<ScrollViewInstance, ScrollViewProps>(function KeyboardScrollView(props, ref) {
  const { onScroll, onLayout, ...rest } = props;
  const inner = useRef<ScrollViewInstance>(null);
  const offsetY = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useImperativeHandle(ref, () => inner.current as ScrollViewInstance);

  const reveal = useCallback(() => {
    const scroll = inner.current;
    const input: any = TextInput.State.currentlyFocusedInput?.();
    if (!scroll || !input || typeof input.measureInWindow !== 'function') return;
    const host: any = typeof (scroll as any).measureInWindow === 'function' ? scroll : (scroll as any).getNativeScrollRef?.();
    if (!host || typeof host.measureInWindow !== 'function') return;
    input.measureInWindow((ix: number, iy: number, iw: number, ih: number) => {
      host.measureInWindow((sx: number, sy: number, sw: number, sh: number) => {
        // Only react if the focused input lives inside this scroll view.
        if (!(sh > 0) || ix < sx - 2 || ix > sx + sw) return;
        if (iy + ih < sy - 2000 || iy > sy + sh + 2000) return;
        const delta = scrollDeltaForInput({ y: iy, height: ih }, { y: sy, height: sh });
        if (Math.abs(delta) > 1) inner.current?.scrollTo({ y: Math.max(0, offsetY.current + delta), animated: true });
      });
    });
  }, []);

  const schedule = useCallback(() => {
    timers.current.forEach(clearTimeout);
    // The keyboard animates in and the view shrinks afterwards, so check a few times.
    timers.current = [120, 350, 700].map((ms) => setTimeout(reveal, ms));
  }, [reveal]);

  useEffect(() => {
    const unsubscribeFocus = onInputFocus(schedule);
    const shown = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', schedule);
    return () => {
      unsubscribeFocus();
      shown.remove();
      timers.current.forEach(clearTimeout);
    };
  }, [schedule]);

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      {...rest}
      ref={inner}
      scrollEventThrottle={rest.scrollEventThrottle ?? 16}
      onScroll={(event) => {
        offsetY.current = event.nativeEvent.contentOffset.y;
        onScroll?.(event);
      }}
      onLayout={(event) => {
        onLayout?.(event);
        // The view just changed size (keyboard opened/closed): keep the input visible.
        if (TextInput.State.currentlyFocusedInput?.()) schedule();
      }}
    />
  );
});
