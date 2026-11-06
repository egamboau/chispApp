import type { MatchResponse } from '@jupas/shared'
import { TeamLabel } from '../components/TeamLabel'
import styles from './PublicDisplay.module.css'

/** Selects finished results for an optional exact date, retaining the server's match order. */
export function resultMatches(matches: readonly MatchResponse[], date: string): MatchResponse[] {
  return matches.filter(match => match.status === 'FINISHED' && (!date || match.date === date))
}

/** Selects unfinished matches, preserving the server's official order across categories. */
export function calendarMatches(matches: readonly MatchResponse[]): MatchResponse[] {
  return matches.filter(match => match.status !== 'FINISHED')
}

/** Formats a calendar date at local noon so timezone conversion cannot change its day. */
function shortDate(date: string): string {
  return new Intl.DateTimeFormat('es-GT', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00`))
}

/** Groups calendar matches by date and jornada, retaining server order within each jornada.
 * Results retain server order within each day and reverse date groups. */
export function Calendar({ matches, results = false, empty }: { matches: readonly MatchResponse[]; results?: boolean; empty: string }) {
  const groups = new Map<string, MatchResponse[]>()
  for (const match of matches) {
    const day = groups.get(match.date)
    if (day) day.push(match)
    else groups.set(match.date, [match])
  }
  const days = [...groups]
  if (results) days.reverse()
  if (!days.length) return <p className={styles.empty} role="status">{empty}</p>
  return <>{days.map(([date, day]) => <section key={date} className={styles.day}>
    <h2>{shortDate(date)}</h2>
    {(results ? day : ['MORNING', 'AFTERNOON'].flatMap(jornada => day.filter(match => match.jornada === jornada))).map(match => <article key={match.id} className={`${styles.match} ${match.tournamentType === 'MALE' ? styles.male : styles.female}`}>
      <span className={styles.jornada} role="img" aria-label={match.jornada === 'MORNING' ? 'Mañana' : 'Tarde'}>{match.jornada === 'MORNING' ? '☀️' : '🌇'}</span>
      <div><span className={styles.badge}>{match.tournamentType === 'MALE' ? 'Masculino' : 'Femenino'}</span> <strong>CANCHA {match.court}</strong>
        <p>{match.groupName}</p>
        <h3><TeamLabel match={match} role="teamA" /> {match.status === 'SCHEDULED' ? <small>vs</small> : <b aria-label={`Marcador ${match.scoreA} a ${match.scoreB}`}>{match.scoreA} – {match.scoreB}</b>} <TeamLabel match={match} role="teamB" /></h3>
        <p>Línea: <TeamLabel match={match} role="lineTeam" /></p>
      </div>
      <span className={`${styles.status} ${styles[match.status.toLowerCase()]}`}>{({ SCHEDULED: 'PROGRAMADO', LIVE: 'EN JUEGO', FINISHED: 'FINAL' })[match.status]}</span>
    </article>)}
  </section>)}</>
}
