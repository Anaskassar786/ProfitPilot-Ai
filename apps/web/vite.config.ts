import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    proxy: {
      '/sync': 'http://127.0.0.1:3000',
      '/analytics': 'http://127.0.0.1:3000',
      '/catalog': 'http://127.0.0.1:3000',
      '/live': 'http://127.0.0.1:3000',
      '/ready': 'http://127.0.0.1:3000',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
})
