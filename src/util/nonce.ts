/* c8 ignore next */
import { randomBytes } from 'crypto';

/** A fresh CSP nonce for each webview load. */
/* c8 ignore next */
export function getNonce(): string {
  return randomBytes(16).toString('base64');
}
