import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor.
 *
 * The application is native ES modules served as files, with no bundler and no
 * build step, and none of that changes here. Capacitor takes a *directory* and
 * puts it in a WebView; this names the directory and then stays out of the way.
 *
 * TypeScript rather than JSON only because a configuration file with reasons in
 * it is worth more than one without, and the Capacitor CLI reads `.ts` itself.
 * Nothing compiles this and nothing ships it — `tsconfig.json` does not even
 * include it.
 */
const config: CapacitorConfig = {
  appId: 'com.familyos.app',
  appName: 'Family OS',

  /*
   * Not `dist/`.
   *
   * `npm run build` produces `dist/familyos.html`, a single-file *preview*
   * that deliberately has no service worker. Pointing this at it would ship
   * the preview as the product. `dist/web` is what `tools/webroot.mjs`
   * assembles: the same files the deploy workflow publishes, checked against
   * the worker's own precache list.
   */
  webDir: 'dist/web',

  /*
   * No `server.url`.
   *
   * A remote URL would make an offline-first application fetch itself over the
   * network before it could start, and would put a household's records behind
   * someone else's uptime. The bundled files are the app.
   *
   * `androidScheme` is `https` — Capacitor's default, and load-bearing. On
   * `http` the WebView treats the origin as insecure and withholds WebCrypto,
   * which is the whole encryption layer, and IndexedDB persistence.
   */
  server: {
    androidScheme: 'https',
  },

  android: {
    /*
     * Off. The app talks to Google over TLS or to nothing at all, and a
     * WebView that will load plaintext is one that can be downgraded into it.
     */
    allowMixedContent: false,

    /*
     * Off in what ships. A debuggable WebView lets anything with adb attach to
     * a process holding a decrypted data key. Turn it on locally when you need
     * it; do not commit it on.
     */
    webContentsDebuggingEnabled: false,
  },

  ios: {
    /*
     * `viewport-fit=cover` is already in `index.html` and the stylesheet uses
     * the safe-area insets, so the web layer handles the notch. `never` stops
     * WebKit adding a second inset on top of the one the CSS already applied.
     */
    contentInset: 'never',
  },
};

export default config;
