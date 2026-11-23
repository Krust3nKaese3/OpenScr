import { Alert, Platform } from 'react-native';

type Button = { text?: string; style?: string; onPress?: () => void };

/** Alert.alert is a no-op on react-native-web. The browser gets a real dialog. */
export function notify(title: string, message?: string, buttons?: Button[]): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons as any);
    return;
  }
  const body = [title, message].filter(Boolean).join('\n\n');
  const list = buttons || [];
  if (list.length <= 1) {
    showWebNotice(body);
    list[0]?.onPress?.();
    return;
  }
  const ok = window.confirm(`${body}\n\nOK = ${[...list].reverse().find((button) => button.style !== 'cancel')?.text || 'Weiter'}`);
  const cancel = list.find((button) => button.style === 'cancel');
  const accept = [...list].reverse().find((button) => button.style !== 'cancel') || list[list.length - 1];
  (ok ? accept : cancel || list[0])?.onPress?.();
}

/** Cursor's browser swallows window.alert, so the notice lives in the page. */
function showWebNotice(body: string) {
  const id = 'openscr-notice';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:16px;right:16px;top:16px;z-index:99999;background:#17171C;color:#F4F4F5;border:1px solid #A3E635;border-radius:12px;padding:14px 16px;font:600 15px/1.4 sans-serif;white-space:pre-wrap';
    document.body.appendChild(el);
  }
  el.textContent = body;
  window.setTimeout(() => {
    if (el && el.textContent === body) el.remove();
  }, 4500);
}
