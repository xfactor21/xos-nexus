import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
