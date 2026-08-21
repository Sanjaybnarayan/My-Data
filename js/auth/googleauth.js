/**
 * Which Google sign-in this device can actually use.
 *
 * There are two, and the difference is not a preference. A browser gets the
 * implicit flow in a popup, which is what `auth/google.js` has always done and
 * what every existing deployment depends on. A native shell cannot use any part
 * of it — Google refuses the WebView, refuses the redirect URI, and there is no
 * popup to postMessage — so it gets the authorization-code flow with PKCE
 * through the system browser.
 *
 * Every caller asks here instead of choosing, because the six places that build
 * one are screens and services that have no business knowing which platform
 * they are on. In a browser this returns exactly what it always returned.
 *
 * A native shell with no `googleNativeClientId` configured falls back to the web
 * implementation deliberately. It will fail at the point of signing in, and it
 * will fail *saying* the client id is missing — which is the true reason —
 * rather than being unavailable with no explanation at all.
 */

import { config } from '../core/config.js';
import { isNative } from '../core/native.js';
import { GoogleAuth } from './google.js';
import { NativeGoogleAuth } from './googlenative.js';

export function googleAuth(options = {}) {
  const nativeClientId = options.nativeClientId ?? config().googleNativeClientId;

  if (isNative() && nativeClientId) {
    return new NativeGoogleAuth({ ...options, clientId: nativeClientId });
  }
  return new GoogleAuth(options);
}
