import { lazy, Suspense } from 'react'
import { PublicDisplay } from '../pages/PublicDisplay'
import { pageRoute } from '../routes'

const Admin = lazy(() => import('../admin/Admin').then(module => ({ default: module.Admin })))

/** Chooses public display or administration from the preserved URL, using one HTML/React entry.
 * Loads administrative code and styles only for /admin routes; server middleware owns authorization. */
export function App() {
  const route = pageRoute(location.pathname)
  if (!route) return <main><h1>404</h1><p>Página no encontrada.</p></main>
  return route === 'admin'
    ? <Suspense fallback={<p role="status">Cargando administración…</p>}><Admin /></Suspense>
    : <PublicDisplay />
}
