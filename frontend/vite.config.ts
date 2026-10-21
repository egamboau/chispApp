import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/display/',
  plugins: [react()],
  build: { rolldownOptions: { input: { display: 'index.html', admin: 'admin.html' } } },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
