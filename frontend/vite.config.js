import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5300,
    host: true, // Required for Railway and Docker
  },
  preview: {
    port: 5300,
    host: true,
  },
})
