import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        options: resolve(__dirname, 'options.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        interstitial: resolve(__dirname, 'interstitial.html'),
      },
      output: {
        entryFileNames: chunk => {
          return chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'
        }
      }
    }
  }
})
