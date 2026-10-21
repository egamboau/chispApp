import * as S from '@jupas/shared'
import { request } from './client'
import type { ResponseParser } from './client'

export type AdminPage = 'tournaments' | 'teams' | 'calendar' | 'scoring'
export interface AdminSelection { tournamentId?: number; phaseId?: number }

/** Sends validated administrative requests through the protected same-origin namespace. */
export function adminRequest<T>(path: string, schema: ResponseParser<T>, options?: Omit<RequestInit, 'body'> & { body?: unknown }) {
  return request(`/api/admin${path}`, schema, options)
}

/** Mutates only the protected API; server validation, conflicts and lifecycle errors remain visible. */
export function adminMutation(path: string, method: string, body?: unknown) {
  return request(`/api/admin${path}`, undefined, { method, body })
}

/** Loads a page's validated data, retaining available selections and current phase fallback.
 * All dependent reads share cancellation; required-data failures reject instead of showing partial CRUD state. */
export async function loadAdmin(page: AdminPage, selection: AdminSelection, signal: AbortSignal) {
  const get = <T,>(path: string, schema: ResponseParser<T>) => adminRequest(path, schema, { signal })
  const tournaments = await get('/tournaments', S.TournamentListResponseSchema)
  const tournament = tournaments.find(item => item.id === selection.tournamentId) ?? tournaments[0]
  const phases = tournament ? await get(`/tournaments/${tournament.id}/phases`, S.PhaseListResponseSchema) : []
  const phase = phases.find(item => item.id === selection.phaseId) ?? phases.find(item => item.id === tournament?.currentPhaseId) ?? phases[0]
  const teams = tournament && page !== 'tournaments' ? await get(`/teams?tournamentId=${tournament.id}`, S.TeamListResponseSchema) : []
  const [groups, rules, memberships, sanctions, teamCards, matches, ranking, positions] = await Promise.all([
    phase ? get(`/phases/${phase.id}/groups`, S.GroupListResponseSchema) : [],
    phase && page === 'tournaments' ? get(`/phases/${phase.id}/classification-rules`, S.ClassificationRuleListResponseSchema) : [],
    phase && ['teams', 'calendar'].includes(page) ? get(`/phases/${phase.id}/memberships`, S.MembershipListResponseSchema) : [],
    phase && page === 'teams' ? get(`/phases/${phase.id}/sanctions`, S.SanctionListResponseSchema) : [],
    phase && page === 'teams' ? get(`/phases/${phase.id}/team-cards`, S.TeamCardsListResponseSchema) : [],
    phase && ['calendar', 'scoring'].includes(page) ? get(`/matches?phaseId=${phase.id}${page === 'scoring' ? '&status=FINISHED' : ''}`, S.MatchListResponseSchema) : [],
    phase && page === 'scoring' ? get(`/phases/${phase.id}/scoring`, S.PhaseScoringResponseSchema) : undefined,
    phase?.type === 'TABLE' && page === 'tournaments' ? get(`/phases/${phase.id}/positions`, S.PhasePositionsResponseSchema) : undefined,
  ])
  const sourcePhases = page === 'calendar' ? phases.filter(item => item.type === 'TABLE' && item.sortOrder < phase!.sortOrder && item.tournamentType === phase!.tournamentType) : []
  const sourceGroups = Object.fromEntries(await Promise.all(sourcePhases.map(async item => [item.id, await get(`/phases/${item.id}/groups`, S.GroupListResponseSchema)]))) as Record<number, S.GroupResponse[]>
  return { tournaments, tournament, phases, phase, teams, groups, rules, memberships, sanctions, teamCards, matches, tables: ranking?.tables ?? [], positions, sourcePhases, sourceGroups }
}
export type AdminData = Awaited<ReturnType<typeof loadAdmin>>

/** Resolves a finished-match deep link to its owning tournament/phase; rejects unavailable matches. */
export async function scoringSelection(matchId: number, signal: AbortSignal): Promise<AdminSelection> {
  const match = await adminRequest(`/matches/${matchId}`, S.MatchResponseSchema, { signal })
  if (match.status !== 'FINISHED') throw new Error('El partido no está disponible para cargar goleo.')
  const tournaments = await adminRequest('/tournaments', S.TournamentListResponseSchema, { signal })
  const phaseLists = await Promise.all(tournaments.map(item => adminRequest(`/tournaments/${item.id}/phases`, S.PhaseListResponseSchema, { signal })))
  const phase = phaseLists.flat().find(item => item.id === match.phaseId)
  if (!phase) throw new Error('La fase del partido no está disponible.')
  return { tournamentId: phase.tournamentId, phaseId: phase.id }
}
