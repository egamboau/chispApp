import type { MatchResponse } from '@jupas/shared'
import { MatchCard } from './MatchCard'
import styles from './display.module.css'

export type MatchListProps =
  | { loading: true; matches?: never }
  | { loading?: false; matches: readonly MatchResponse[] }

/** Announces loading or an empty list, otherwise renders the supplied matches in a responsive grid. */
export function MatchList(props: MatchListProps) {
  if (props.loading) return <p role="status" className={styles.empty}>Cargando partidos…</p>
  if (props.matches.length === 0) return <p role="status" className={styles.empty}>No hay partidos disponibles.</p>
  return <div className={styles.grid}>{props.matches.map(match => <MatchCard key={match.id} match={match} />)}</div>
}
