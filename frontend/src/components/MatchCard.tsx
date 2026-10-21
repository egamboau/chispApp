import type { MatchResponse } from '@jupas/shared'
import { Scoreboard } from './Scoreboard'
import { TeamLabel } from './TeamLabel'
import styles from './display.module.css'

const statusLabels = { SCHEDULED: 'PROGRAMADO', LIVE: 'EN JUEGO', FINISHED: 'FINAL' }

export interface MatchCardProps { match: MatchResponse }

/** Renders public match metadata and score without exposing unpublished line assignments. */
export function MatchCard({ match }: MatchCardProps) {
  return <article className={`${styles.card} ${match.tournamentType === 'MALE' ? styles.male : styles.female}`} aria-label={`Partido ${match.id}`}>
    <div className={styles.metadata}>
      <span className={styles.badge}>{match.tournamentType === 'MALE' ? 'MASCULINO' : 'FEMENINO'}</span>
      <strong>CANCHA {match.court}</strong>
      <span>{statusLabels[match.status]}</span>
    </div>
    <p>{match.date} · {match.jornada === 'MORNING' ? 'Mañana' : 'Tarde'}</p>
    <p>{match.groupName}</p>
    <Scoreboard match={match} />
    <p>Línea: <TeamLabel match={match} role="lineTeam" /></p>
  </article>
}
