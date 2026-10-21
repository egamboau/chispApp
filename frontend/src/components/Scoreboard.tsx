import type { MatchResponse } from '@jupas/shared'
import { TeamLabel } from './TeamLabel'
import styles from './display.module.css'

export interface ScoreboardProps { match: MatchResponse }

/** Shows both participants and their scores, or “vs” before a scheduled match starts. */
export function Scoreboard({ match }: ScoreboardProps) {
  return <div className={styles.score}>
    <span><TeamLabel match={match} role="teamA" /></span>
    {match.status === 'SCHEDULED' ? <span>vs</span> :
      <strong aria-label={`Marcador ${match.scoreA} a ${match.scoreB}`}>{match.scoreA} – {match.scoreB}</strong>}
    <span><TeamLabel match={match} role="teamB" /></span>
  </div>
}
