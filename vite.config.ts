import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Terminal room (Step 7 Room C): StackBlitz WebContainers needs
  // SharedArrayBuffer, which browsers only expose to a cross-origin-isolated
  // page (COOP/COEP headers). Set here for `npm run dev`; the packaged
  // Tauri build gets the same two headers via
  // src-tauri/tauri.conf.json's app.security.headers. The static
  // surge.sh web-preview build has no equivalent (plain static hosting,
  // no custom response headers) — Terminal's JS execution is flagged as
  // Tauri-desktop-only there, same precedent as the Browser room's native
  // webview and the system tray/poppable-widget work before it.
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  build: {
    // Poppable Quick Capture widget: a real second Tauri window with its
    // own webview, so it needs its own HTML entry point (widget.html →
    // widget-main.tsx) alongside the main app — not a route inside the
    // single-page Shell, since Tauri's WebviewWindowBuilder loads it as an
    // independent page load, not a client-side navigation.
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        widget: resolve(__dirname, 'widget.html'),
      },
    },
  },
})
