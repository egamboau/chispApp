import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MatchResponse } from '@jupas/shared'
import { adminMutation, loadAdmin, scoringSelection } from '../src/api/admin.ts'
import { AdminMatch, Calendar, participantValues } from '../src/admin/Calendar.tsx'
import type { AdminData } from '../src/api/admin.ts'
import { Positions } from '../src/admin/Tournaments.tsx'

const phase = { id: 2, tournamentId: 1, name: 'Final', type: 'ELIMINATION', sortOrder: 2, tournamentType: 'MALE' } as const
const source = { ...phase, id: 1, name: 'Tabla', type: 'TABLE', sortOrder: 1 } as const
const tournament = { id: 1, name: 'Copa', active: false, currentPhaseId: 2, legacyType: null }
const reference = { kind: 'TEAM', teamId: 1 } as const
const participant = { reference, resolvedTeamId: 1, resolvedTeam: { id: 1, name: 'A' }, status: 'CONFIRMED' } as const
const match: MatchResponse = {
  id: 5, tournamentType: 'MALE', date: '2026-10-20', jornada: 'MORNING', teamA: 'A', teamB: 'B', lineTeam: 'C', court: 1, sortOrder: null,
  scoreA: 0, scoreB: 0, status: 'SCHEDULED', createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z', phaseId: 2, groupId: 2,
  teamAId: 1, teamBId: 2, lineTeamId: 3, yellowCardsA: 0, redCardsA: 0, yellowCardsB: 0, redCardsB: 0, tournamentName: 'Copa', phaseName: 'Final', groupName: 'Grupo', lineVisible: false,
  participants: { teamA: { ...participant, reference: { kind: 'GROUP_POSITION', sourcePhaseId: 1, sourceGroupId: 1, position: 1 } }, teamB: { ...participant, reference: { kind: 'MATCH_WINNER', sourceMatchId: 4 } }, lineTeam: participant },
}

test('participant forms preserve confirmed group positions and existing API winner references', () => {
  assert.deepEqual(participantValues({ 'teamA-kind': 'GROUP_POSITION', 'teamA-phase': '1', 'teamA-group': '1', 'teamA-position': '3', 'teamB-kind': 'MATCH_WINNER', 'lineTeam-kind': 'TEAM', 'lineTeam-team': '3' }, match), {
    teamA: { kind: 'GROUP_POSITION', sourcePhaseId: 1, sourceGroupId: 1, position: 3 }, teamB: { kind: 'MATCH_WINNER', sourceMatchId: 4 }, lineTeam: { kind: 'TEAM', teamId: 3 },
  })
  assert.throws(() => participantValues({ 'teamA-kind': 'MATCH_WINNER' }, match), /Referencia de ganador/)
  assert.throws(() => participantValues({ 'teamA-kind': 'TEAM', 'teamA-team': '0' }, match))
})

test('React match controls follow lifecycle and retain corrections, order and scoring deep links', () => {
  const render = (status: MatchResponse['status']) => renderToStaticMarkup(createElement(AdminMatch, { match: { ...match, status }, run: async () => false, edit() {} }))
  const scheduled = render('SCHEDULED'), live = render('LIVE'), finished = render('FINISHED')
  assert.match(scheduled, /INICIAR/); assert.match(scheduled, /ELIMINAR/)
  assert.doesNotMatch(scheduled, /REABRIR|FINALIZAR/)
  assert.match(live, /REINICIAR MARCADOR/); assert.match(live, /FINALIZAR PARTIDO/)
  assert.doesNotMatch(live, /ELIMINAR|>EDITAR</)
  assert.match(live, /aria-label="Restar gol A" disabled/)
  assert.match(finished, /Corregir resultado/); assert.match(finished, /REABRIR PARTIDO/)
  assert.match(finished, /href="\/admin\/scoring.html\?matchId=5"/)
  for (const html of [scheduled, live, finished]) { assert.match(html, /Tarjetas del partido/); assert.match(html, /Orden oficial/) }
})

test('position preview exposes server blockers and permits reopening only confirmed assignments', () => {
  const preview = { phaseId: 1, confirmedAt: null, stale: false, canConfirm: false, errors: ['Partidos pendientes'], assignments: [] }
  const render = (value: typeof preview | (Omit<typeof preview, 'confirmedAt'> & { confirmedAt: string })) => renderToStaticMarkup(createElement(Positions, { preview: value, groups: [], run: async () => false }))
  assert.match(render(preview), /Partidos pendientes/)
  assert.match(render(preview), /disabled="">CONFIRMAR Y CONGELAR/)
  assert.doesNotMatch(render(preview), /REABRIR ASIGNACIONES/)
  assert.match(render({ ...preview, confirmedAt: '2026-10-20T00:00:00Z' }), /REABRIR ASIGNACIONES/)
})

test('admin reads include inactive tournaments, typed references and same-category earlier phase groups', async t => {
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    calls.push(path)
    const data: Record<string, unknown> = {
      '/api/admin/tournaments': [tournament], '/api/admin/tournaments/1/phases': [source, phase, { ...source, id: 3, tournamentType: 'FEMALE' }],
      '/api/admin/teams?tournamentId=1': [], '/api/admin/phases/2/groups': [], '/api/admin/phases/2/memberships': [], '/api/admin/matches?phaseId=2': [match], '/api/admin/phases/1/groups': [{ id: 1, phaseId: 1, name: 'Origen' }],
    }
    assert.ok(path in data, path)
    return Response.json(data[path])
  })
  const data = await loadAdmin('calendar', {}, new AbortController().signal)
  assert.equal(data.phase?.id, 2); assert.equal(data.tournament?.active, false)
  assert.deepEqual(data.sourcePhases, [source]); assert.equal(data.sourceGroups[1]?.[0]?.name, 'Origen')
  assert.deepEqual(data.matches[0]?.participants, match.participants)
  assert.ok(calls.every(path => path.startsWith('/api/admin/')))
})

test('critical writes use protected API, same-origin credentials and JSON while exposing conflicts', async t => {
  const calls: { path: string; options: RequestInit }[] = []
  t.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    calls.push({ path, options })
    return path.endsWith('/start') ? Response.json({ error: 'Confirma las posiciones primero.' }, { status: 409 }) : new Response(null, { status: 204 })
  })
  await adminMutation('/matches/5/score', 'PATCH', { team: 'A', delta: 1 })
  await adminMutation('/matches/5', 'DELETE')
  await assert.rejects(adminMutation('/matches/5/start', 'POST'), /Confirma las posiciones primero/)
  assert.equal(calls[0]?.path, '/api/admin/matches/5/score')
  assert.equal(calls[0]?.options.credentials, 'same-origin')
  assert.equal(calls[0]?.options.body, '{"team":"A","delta":1}')
  assert.equal(calls[1]?.options.method, 'DELETE')
})

test('scoring deep links resolve tournament/phase with supported API routes and reject live matches', async t => {
  let status = 'FINISHED'
  t.mock.method(globalThis, 'fetch', async (path: string) => Response.json(path === '/api/admin/matches/5' ? { ...match, status } : path === '/api/admin/tournaments' ? [tournament] : [source, phase]))
  assert.deepEqual(await scoringSelection(5, new AbortController().signal), { tournamentId: 1, phaseId: 2 })
  status = 'LIVE'
  await assert.rejects(scoringSelection(5, new AbortController().signal), /no está disponible/)
})

test('invalid payloads and cancelled administrative reads cannot become editable data', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([{ id: 'invalid' }]))
  await assert.rejects(loadAdmin('teams', {}, new AbortController().signal), /Respuesta del servidor inválida/)
  const controller = new AbortController(); controller.abort()
  t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => { init.signal?.throwIfAborted(); return Response.json([]) })
  await assert.rejects(loadAdmin('teams', {}, controller.signal), { name: 'AbortError' })
})


test('fixed-team editors restrict local group, visitor phase and line tournament independently', () => {
  const data: AdminData = {
    tournaments: [tournament], tournament, phases: [source, phase], phase, groups: [{ id: 2, phaseId: 2, name: 'Grupo A' }],
    teams: [1, 2, 3].map(id => ({ id, name: `Equipo ${id}`, tournamentId: 1, tournamentType: 'MALE' })),
    memberships: [{ phaseId: 2, groupId: 2, teamId: 1 }, { phaseId: 2, groupId: 3, teamId: 2 }],
    rules: [], sanctions: [], teamCards: [], matches: [], tables: [], positions: undefined, sourcePhases: [source], sourceGroups: {},
  }
  const html = renderToStaticMarkup(createElement(Calendar, { data, run: async () => false, revision: 0 }))
  const role = (name: string) => html.split(`<legend>${name}</legend>`)[1]!.split('</fieldset>')[0]!
  assert.match(role('Local'), /Equipo 1/); assert.doesNotMatch(role('Local'), /Equipo [23]/)
  assert.match(role('Visitante'), /Equipo 2/); assert.doesNotMatch(role('Visitante'), /Equipo 3/)
  assert.match(role('Línea'), /Equipo 3/)
})

test('position buttons confirm before writing and use the source phase for both lifecycle actions', async t => {
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
    calls.push(`${init.method} ${path}`); return new Response(null, { status: 204 })
  })
  let accepted = false
  const original = Object.getOwnPropertyDescriptor(globalThis, 'confirm')
  Object.defineProperty(globalThis, 'confirm', { configurable: true, value: () => accepted })
  t.after(() => { if (original) Object.defineProperty(globalThis, 'confirm', original); else Reflect.deleteProperty(globalThis, 'confirm') })
  const pending: Promise<unknown>[] = []
  const element = Positions({ preview: { phaseId: 7, confirmedAt: '2026-10-20T00:00:00Z', stale: false, canConfirm: true, errors: [], assignments: [] }, groups: [], run: operation => { const promise = operation(); pending.push(promise); return promise.then(() => true) } })
  const children = element.props.children.flat().filter(Boolean)
  const confirmButton = children.find((child: { type?: string; props?: { children?: unknown } }) => child.type === 'button' && child.props?.children === 'CONFIRMAR Y CONGELAR')
  const reopenButton = children.find((child: { type?: string; props?: { children?: unknown } }) => child.type === 'button' && child.props?.children === 'REABRIR ASIGNACIONES')
  confirmButton.props.onClick(); assert.deepEqual(calls, [])
  accepted = true; confirmButton.props.onClick(); reopenButton.props.onClick(); await Promise.all(pending)
  assert.deepEqual(calls, ['POST /api/admin/phases/7/positions/confirm', 'POST /api/admin/phases/7/positions/reopen'])
})

test('line assignment can be omitted or cleared without relaxing required rivals', () => {
  const values = { 'teamA-kind': 'TEAM', 'teamA-team': '1', 'teamB-kind': 'TEAM', 'teamB-team': '2', 'lineTeam-kind': 'TEAM', 'lineTeam-team': '' }
  assert.equal(participantValues(values, match).lineTeam, null)
  assert.throws(() => participantValues({ ...values, 'teamA-team': '' }, match))
  const html = renderToStaticMarkup(createElement(AdminMatch, { match: { ...match, lineTeam: null, lineTeamId: null, participants: { ...match.participants, lineTeam: null } }, run: async () => false, edit() {} }))
  assert.match(html, /Sin asignar/)
})
