import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    vueDevTools(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webp}'],
        // The FCM SW manages its own lifecycle (browser fetches it directly
        // for SW update checks); precaching it here would be wasteful.
        globIgnores: ['**/firebase-messaging-sw.js'],
        // Let Firebase OAuth helper paths fall through to the network so
        // Vercel's /__/auth/* rewrite to track-navitag-com.firebaseapp.com
        // can serve the auth widget. Without this, Workbox's navigation
        // fallback returns index.html and breaks signInWithRedirect.
        navigateFallbackDenylist: [/^\/__\//]
      }
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'xendit-components-web': fileURLToPath(new URL('./node_modules/xendit-components-web/sdk/dist/index.umd.js', import.meta.url))
    },
  },
  build: {
    chunkSizeWarningLimit: 500, 
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // 1. Group Vue ecosystem
            if (id.includes('vue') || id.includes('pinia')) {
              return 'vue-vendor';
            }
            // 2. Group ALL Capacitor stuff (Core + Plugins + Capacitor-Firebase)
            // Checking this BEFORE firebase ensures plugins stay with the core
            if (id.includes('@capacitor')) {
              return 'capacitor-vendor';
            }
            // 3. Group pure Firebase SDK
            if (id.includes('firebase')) {
              return 'firebase';
            }
            // 4. Everything else
            return 'vendor';
          }
        }
      }
    }
  }
})