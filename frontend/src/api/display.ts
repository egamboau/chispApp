import {
  MatchListResponseSchema, PhaseListResponseSchema, PhaseScoringResponseSchema,
  PhaseStandingsResponseSchema, TournamentListResponseSchema,
} from '@jupas/shared'
import type { MatchResponse, PhaseResponse, PhaseScoringResponse, PhaseStandingsResponse, TournamentResponse } from '@jupas/shared'
import { request } from './client'

export interface DisplaySelection { tournamentId?: number; phaseId?: number }
export interface DisplayData {
  tournaments: TournamentResponse[]
  tournament?: TournamentResponse
  phases: PhaseResponse[]
  phase?: PhaseResponse
  matches: MatchResponse[]
  standings?: PhaseStandingsResponse
  scoring?: PhaseScoringResponse
  standingsError?: string
  scoringError?: string
}

/** Reloads public data, retaining available selections or preferring the tournament's current phase.
 * Server match order, visibility, standings and scoring remain authoritative. Ranking failures do
 * not prevent score updates; required-data failures reject. Aborting cancels every request. */
export async function loadDisplay(selection: DisplaySelection, signal: AbortSignal): Promise<DisplayData> {
  const tournaments = await request('/api/tournaments?active=true', TournamentListResponseSchema, { signal })
  const tournament = tournaments.find(item => item.id === selection.tournamentId) ?? tournaments[0]
  const phases = tournament ? await request(`/api/tournaments/${tournament.id}/phases`, PhaseListResponseSchema, { signal }) : []
  const phase = phases.find(item => item.id === selection.phaseId) ?? phases.find(item => item.id === tournament?.currentPhaseId) ?? phases[0]
  const matchesRequest = request(`/api/matches${phase ? `?phaseId=${phase.id}` : ''}`, MatchListResponseSchema, { signal })
  const [matches, standings, scoring] = await Promise.all([
    matchesRequest,
    phase ? request(`/api/phases/${phase.id}/standings`, PhaseStandingsResponseSchema, { signal }).then(data => ({ data }), error => ({ error: String(error.message) })) : undefined,
    phase ? request(`/api/phases/${phase.id}/scoring`, PhaseScoringResponseSchema, { signal }).then(data => ({ data }), error => ({ error: String(error.message) })) : undefined,
  ])
  return {
    tournaments, tournament, phases, phase, matches,
    standings: standings && 'data' in standings ? standings.data : undefined,
    standingsError: standings && 'error' in standings ? standings.error : undefined,
    scoring: scoring && 'data' in scoring ? scoring.data : undefined,
    scoringError: scoring && 'error' in scoring ? scoring.error : undefined,
  }
}

/** Subscribes to public updates, syncing on open and reconnecting after errors or 45s without
 * heartbeat. Returns cleanup that closes the stream and clears both timers, including on unmount. */
export function subscribeDisplay(refresh: () => void, connection: (message: string) => void): () => void {
  let events: EventSource
  let retry: ReturnType<typeof setTimeout> | undefined
  let heartbeat: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  /** Closes the failed stream and schedules one replacement after three seconds. */
  function reconnect() {
    events.close()
    clearTimeout(heartbeat)
    clearTimeout(retry)
    connection('Reconectando…')
    retry = setTimeout(connect, 3000)
  }
  /** Restarts the heartbeat watchdog after a successful open or server heartbeat. */
  function watch() {
    clearTimeout(heartbeat)
    heartbeat = setTimeout(reconnect, 45_000)
  }
  /** Opens the public event stream and attaches update, health and failure handlers. */
  function connect() {
    if (stopped) return
    events = new EventSource('/api/events')
    events.onopen = () => { connection(''); watch(); refresh() }
    events.addEventListener('matches', refresh)
    events.addEventListener('heartbeat', watch)
    events.onerror = reconnect
  }
  connect()
  return () => {
    stopped = true
    events.close()
    clearTimeout(retry)
    clearTimeout(heartbeat)
  }
}
