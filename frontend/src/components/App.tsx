import { lazy, Suspense } from 'react'
import { PublicDisplay } from '../pages/PublicDisplay'

const Admin = lazy(() => import('../admin/Admin').then(module => ({ default: module.Admin })))

/** Chooses public display or administration from the preserved URL, using one HTML/React entry.
 * Loads administrative code and styles only for /admin routes; server middleware owns authorization. */
export function App() {
  const path = location.pathname
  return path === '/admin' || path.startsWith('/admin/')
    ? <Suspense fallback={<p role="status">Cargando administración…</p>}><Admin /></Suspense>
    : <PublicDisplay />
}
