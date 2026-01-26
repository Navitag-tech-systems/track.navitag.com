import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
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