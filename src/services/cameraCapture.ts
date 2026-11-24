/**
 * One full-screen camera session at a time. The runner draws the preview.
 * Nothing here writes to the photo library.
 */

export type CameraCaptureMode = 'photo' | 'qr';

export interface CameraCaptureRequest {
  mode: CameraCaptureMode;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

type Listener = (request: CameraCaptureRequest | null) => void;

let current: CameraCaptureRequest | null = null;
const listeners = new Set<Listener>();

function publish(): void {
  for (const listener of listeners) listener(current);
}

export function subscribeCameraCapture(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

export function requestCameraCapture(mode: CameraCaptureMode): Promise<string> {
  if (current) return Promise.reject(new Error('Die Kamera ist schon geöffnet.'));
  return new Promise((resolve, reject) => {
    current = { mode, resolve, reject };
    publish();
  });
}

export function finishCameraCapture(value: string): void {
  const request = current;
  current = null;
  publish();
  request?.resolve(value);
}

export function cancelCameraCapture(message = 'Kamera abgebrochen.'): void {
  const request = current;
  current = null;
  publish();
  request?.reject(new Error(message));
}
