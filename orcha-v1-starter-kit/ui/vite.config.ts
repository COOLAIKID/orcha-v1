import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { chatPlugin } from './src/chatPlugin.ts'

export default defineConfig({
  plugins: [react(), chatPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/v1': 'http://127.0.0.1:8080',
      // chatPlugin handles this first in development; the proxy keeps the
      // same client contract available when the Vite middleware is removed.
      '/api/chat': 'http://127.0.0.1:8080',
      '/api/feedback': 'http://127.0.0.1:8080',
    },
  },
})
