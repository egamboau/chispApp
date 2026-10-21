import type { MatchResponse } from '@jupas/shared'
import styles from './display.module.css'

export interface TeamLabelProps {
  match: MatchResponse
  role: 'teamA' | 'teamB' | 'lineTeam'
}

/** Displays a resolved or pending participant; unpublished line assignments never render. */
export function TeamLabel({ match, role }: TeamLabelProps) {
  if (role === 'lineTeam' && !match.lineVisible) return <>Por publicar</>
  const participant = match.participants[role]
  const pending = participant?.status === 'PENDING' ||
    (match.status === 'SCHEDULED' && participant?.reference.kind === 'GROUP_POSITION' && participant.status !== 'CONFIRMED')
  return <span className={pending ? styles.pending : undefined}>
    {pending ? match[role] : participant?.resolvedTeam?.name ?? match[role]}
    {pending && <small> Por definir</small>}
  </span>
}
