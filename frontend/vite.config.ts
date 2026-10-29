import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pageRoute } from './src/routes.ts'

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : '/display/',
  plugins: [react(), {
    name: 'page-routes',
    configureServer(server) {
      return () => server.middlewares.use((req, res, next) => {
        if (!['GET', 'HEAD'].includes(req.method ?? '')) return next()
        const url = req.originalUrl ?? req.url ?? '/'
        const path = url.split('?')[0]!
        if (path.startsWith('/api/')) return next()
        if (path === '/') {
          res.writeHead(302, { Location: '/display/' }).end()
        } else if (pageRoute(path)) {
          req.url = url.replace(path, '/index.html')
          next()
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Página no encontrada.')
        }
      })
    },
  }],
  resolve: {
    alias: { '@jupas/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
}))
