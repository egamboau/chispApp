import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MatchResponse } from '@jupas/shared'
import { loadDisplay, subscribeDisplay } from '../src/api/display.ts'

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('.module.css')) return { format: 'module', shortCircuit: true, source: 'export default new Proxy({}, { get: (_, name) => name })' }
  return nextLoad(url, context)
} })
const { Calendar, calendarMatches } = await import('../src/pages/Calendar.tsx')
const { Standings, Scoring } = await import('../src/pages/Rankings.tsx')
const participant = { reference: { kind: 'TEAM', teamId: 1 }, resolvedTeamId: 1, resolvedTeam: { id: 1, name: 'Equipo resuelto' }, status: 'CONFIRMED' } as const
const match: MatchResponse = {
  id: 1, tournamentType: 'MALE', date: '2026-10-20', jornada: 'MORNING',
  teamA: 'Equipo A', teamB: 'Equipo B', lineTeam: 'Línea secreta', court: 1, sortOrder: null, scoreA: 2, scoreB: 0, status: 'LIVE',
  createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z', phaseId: 1, groupId: 1, teamAId: 1, teamBId: 2, lineTeamId: 3,
  yellowCardsA: 0, redCardsA: 0, yellowCardsB: 0, redCardsB: 0, tournamentName: 'Copa', phaseName: 'Fase', groupName: 'Grupo', lineVisible: false,
  participants: { teamA: participant, teamB: { ...participant, resolvedTeam: { id: 2, name: 'Equipo B' } }, lineTeam: participant },
}
const phase = { id: 1, tournamentId: 1, name: 'Fase', type: 'TABLE', sortOrder: 1, tournamentType: 'MALE' } as const

test('calendar filters exclude finished matches and preserve server order within jornadas', () => {
  const matches = [
    { ...match, id: 4, teamA: 'Tarde primero', jornada: 'AFTERNOON' },
    { ...match, id: 3, teamA: 'Mañana primero' },
    { ...match, id: 2, teamA: 'Mañana segundo', status: 'SCHEDULED' },
    { ...match, id: 5, tournamentType: 'FEMALE' },
    { ...match, id: 6, status: 'FINISHED' },
    { ...match, id: 7, date: '2026-10-21' },
  ] as MatchResponse[]
  const selected = calendarMatches(matches, { category: 'MALE', date: '2026-10-20', status: '' })
  assert.deepEqual(selected.map(item => item.id), [4, 3, 2])
  assert.deepEqual(calendarMatches(matches, { category: 'ALL', date: '', status: 'SCHEDULED' }).map(item => item.id), [2])
  const html = renderToStaticMarkup(createElement(Calendar, { matches: selected.map(item => ({ ...item, participants: { ...item.participants, teamA: { ...participant, resolvedTeam: { id: 1, name: item.teamA } } } })), empty: 'Vacío' }))
  assert.match(html, /Mañana primero[\s\S]*Mañana segundo[\s\S]*Tarde primero/)
  assert.match(html, /Por publicar/)
  assert.doesNotMatch(html, /Línea secreta/)
  assert.match(html, /Marcador 2 a 0/)
  const results = renderToStaticMarkup(createElement(Calendar, { results: true, matches: [{ ...match, date: '2026-10-19' }, match], empty: 'Vacío' }))
  assert.ok(results.indexOf('20 de octubre') < results.indexOf('19 de octubre'))
})

test('public data reload validates responses, chooses current phase and preserves selections', async t => {
  const tournament = { id: 1, name: 'Copa', active: 1, currentPhaseId: 2, legacyType: null }
  const routes: Record<string, unknown> = {
    '/api/tournaments?active=true': [tournament],
    '/api/tournaments/1/phases': [phase, { ...phase, id: 2 }],
    '/api/matches?phaseId=2': [{ ...match, phaseId: 2, scoreA: 5 }],
    '/api/matches?phaseId=1': [match],
    '/api/phases/1/standings': { phase, hasStandings: false, message: 'Eliminación', rules: [], groups: [] },
    '/api/phases/2/standings': { phase: { ...phase, id: 2 }, hasStandings: false, message: 'Eliminación', rules: [], groups: [] },
    '/api/phases/1/scoring': { phase, tables: [] },
    '/api/phases/2/scoring': { phase: { ...phase, id: 2 }, tables: [] },
  }
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push(url)
    assert.ok(options.signal)
    assert.equal(options.credentials, 'same-origin')
    return new Response(JSON.stringify(routes[url]), { headers: { 'Content-Type': 'application/json' } })
  })
  const initial = await loadDisplay({}, new AbortController().signal)
  assert.equal(initial.tournament?.active, true)
  assert.equal(initial.phase?.id, 2)
  assert.equal(initial.matches[0]?.scoreA, 5)
  assert.equal((await loadDisplay({ tournamentId: 1, phaseId: 1 }, new AbortController().signal)).phase?.id, 1)
  assert.equal((await loadDisplay({ tournamentId: 999, phaseId: 999 }, new AbortController().signal)).phase?.id, 2)
  routes['/api/phases/2/scoring'] = { invalid: true }
  const partial = await loadDisplay({}, new AbortController().signal)
  assert.equal(partial.matches[0]?.scoreA, 5)
  assert.match(partial.scoringError!, /Respuesta del servidor inválida/)
  assert.ok(calls.every(url => !url.includes('/admin/')))
  assert.match(renderToStaticMarkup(createElement(Standings, { data: initial.standings! })), /Eliminación/)
  assert.match(renderToStaticMarkup(createElement(Scoring, { data: initial.scoring! })), /Sin tablas de goleo/)
})

test('SSE refreshes scores, watches heartbeats, retries errors and cleans up on unmount', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  class Events {
    static instances: Events[] = []
    onopen?: () => void
    onerror?: () => void
    listeners: Record<string, () => void> = {}
    closed = false
    constructor(public url: string) { Events.instances.push(this) }
    addEventListener(name: string, callback: () => void) { this.listeners[name] = callback }
    close() { this.closed = true }
  }
  const original = globalThis.EventSource
  globalThis.EventSource = Events as unknown as typeof EventSource
  t.after(() => { globalThis.EventSource = original })
  let refreshes = 0
  let connection = ''
  const cleanup = subscribeDisplay(() => refreshes++, message => { connection = message })
  const first = Events.instances[0]!
  assert.equal(first.url, '/api/events')
  first.onopen!()
  first.listeners.matches!()
  assert.equal(refreshes, 2)
  t.mock.timers.tick(44_000)
  first.listeners.heartbeat!()
  t.mock.timers.tick(44_000)
  assert.equal(first.closed, false)
  t.mock.timers.tick(1000)
  assert.equal(first.closed, true)
  assert.equal(connection, 'Reconectando…')
  t.mock.timers.tick(3000)
  assert.equal(Events.instances.length, 2)
  const second = Events.instances[1]!
  second.onopen!()
  assert.equal(connection, '')
  second.onerror!()
  cleanup()
  t.mock.timers.tick(60_000)
  assert.equal(second.closed, true)
  assert.equal(Events.instances.length, 2)
})
