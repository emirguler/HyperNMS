import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Ağır ve kararlı bağımlılıkları ayrı chunk'lara böl → daha iyi tarayıcı cache'i
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          reactflow: ['reactflow', 'dagre'],
          recharts: ['recharts'],
          xterm: ['xterm', 'xterm-addon-fit'],
        },
      },
    },
  },
})
