import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { chatPlugin } from './src/chatPlugin'

export default defineConfig({
  plugins: [react(), chatPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com'],
  },
})
