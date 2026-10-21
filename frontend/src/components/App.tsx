import { HomePage } from '../pages/HomePage'
import { PublicDisplay } from '../pages/PublicDisplay'

/** Routes public display URLs to the tournament view, retaining the React landing page. */
export function App() {
  return /^\/display(?:\/|$)/.test(window.location.pathname) ? <PublicDisplay /> : <HomePage />
}
