/* c8 ignore start */
import { randomBytes } from 'crypto';

/** A fresh CSP nonce for each webview load. */
export function getNonce(): string {
/* c8 ignore stop */
  return randomBytes(16).toString('base64');
}
