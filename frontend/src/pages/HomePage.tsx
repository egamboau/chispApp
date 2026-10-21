import { Layout } from '../components/Layout'
import { MatchList } from '../components/MatchList'
import { Navigation } from '../components/Navigation'

/** Renders the React landing shell and its empty match state until data migration. */
export function HomePage() {
  return <Layout navigation={<Navigation currentHref="/react/" items={[{ href: '/react/', label: 'INICIO' }, { href: '/display/', label: 'TORNEO' }]} />}>
    <h2>Partidos</h2>
    <MatchList matches={[]} />
  </Layout>
}
