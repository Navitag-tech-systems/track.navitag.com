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
            // Split Firebase into its own chunk
            if (id.includes('firebase')) {
              return 'firebase';
            }
            // Split Vue ecosystem into its own chunk
            if (id.includes('vue') || id.includes('pinia')) {
              return 'vue-vendor';
            }
            // Split Capacitor into its own chunk
            if (id.includes('@capacitor')) {
              return 'capacitor-vendor';
            }
            // Put everything else (like html5-qrcode, fontawesome) in a vendor chunk
            return 'vendor';
          }
        }
      }
    }
  }
})