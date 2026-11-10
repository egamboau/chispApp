import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PhaseScoringResponseSchema, PhaseStandingsResponseSchema } from '@jupas/shared'
import type { MatchResponse } from '@jupas/shared'
import { loadDisplay, subscribeDisplay } from '../src/api/display.ts'

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('.module.css')) return { format: 'module', shortCircuit: true, source: 'export default new Proxy({}, { get: (_, name) => name })' }
  return nextLoad(url, context)
} })
const { Calendar, calendarMatches, resultMatches } = await import('../src/pages/Calendar.tsx')
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

test('results retain final scores, server order and date filtering without leaking hidden lines', () => {
  const finished = { ...match, status: 'FINISHED' as const }
  const matches = [match, { ...finished, id: 2, date: '2026-10-19' }, { ...finished, id: 3 }, { ...finished, id: 4 }]
  assert.deepEqual(resultMatches(matches, '').map(item => item.id), [2, 3, 4])
  assert.deepEqual(resultMatches(matches, '2026-10-20').map(item => item.id), [3, 4])
  const html = renderToStaticMarkup(createElement(Calendar, { results: true, matches: resultMatches(matches, ''), empty: 'Sin resultados' }))
  assert.ok(html.indexOf('20 de octubre') < html.indexOf('19 de octubre'))
  assert.equal((html.match(/FINAL/g) ?? []).length, 3)
  assert.match(html, /Marcador 2 a 0/)
  assert.match(html, /Por publicar/)
  assert.doesNotMatch(html, /Línea secreta/)
  assert.match(renderToStaticMarkup(createElement(Calendar, { results: true, matches: resultMatches(matches, '2026-10-18'), empty: 'Sin resultados' })), /Sin resultados/)
})

test('standings display authoritative rank, points, sanctions and unresolved destinations', () => {
  const row = { teamId: 1, teamName: 'Equipo <A>', played: 4, wins: 2, draws: 1, losses: 1, goalsFor: 9, goalsAgainst: 5, goalDifference: 4, points: -7, yellowCards: 3, redCards: 1, sanctioned: true, sanctionReason: 'Falta <grave>', position: 3, requiresTiebreaker: true, destination: null, possibleDestinations: ['Final', 'Tercer lugar'], tiebreakerRule: null }
  const data = PhaseStandingsResponseSchema.parse({ phase, hasStandings: true, rules: [{ id: 1, phaseId: 1, startPosition: 1, endPosition: 2, positions: [1, 2], label: 'Finalistas' }], groups: [{ id: 1, phaseId: 1, name: 'Grupo A', standings: [row, { ...row, teamId: 2, teamName: 'Equipo B', position: 4, destination: 'Final', requiresTiebreaker: false, sanctioned: false }] }] })
  const html = renderToStaticMarkup(createElement(Standings, { data }))
  assert.match(html, /1\.º, 2\.º: Finalistas/)
  assert.match(html, /3\.º\*/)
  assert.match(html, /<strong>-7<\/strong>/)
  assert.match(html, /Equipo &lt;A&gt;/)
  assert.match(html, /title="Falta &lt;grave&gt;">Sancionado/)
  assert.match(html, /Pendiente: Final \/ Tercer lugar/)
  assert.match(html, /class="rangeStart"/)
  assert.match(html, /dos tiempos de 5 minutos/)
  assert.ok(html.indexOf('Equipo &lt;A&gt;') < html.indexOf('Equipo B'))
})

test('scoring prefers regular table and displays each server ranking without recalculation', () => {
  const row = { scoringTable: 'Torneo Regular', playerId: 1, teamId: 1, teamName: 'Equipo <A>', playerNumber: '07', playerName: null, directGoals: 1, pepitas: 2, horquetas: 3, total: 99, position: 4 }
  const data = PhaseScoringResponseSchema.parse({ phase, tables: [
    { id: 2, name: 'Final', rankings: { total: [], pepitas: [], horquetas: [] } },
    { id: 1, name: 'Torneo Regular', rankings: { total: [row], pepitas: [{ ...row, playerId: 2, playerName: 'Pepita líder', position: 2 }], horquetas: [{ ...row, playerId: 3, playerName: 'Horqueta líder', position: 1 }] } },
  ] })
  const html = renderToStaticMarkup(createElement(Scoring, { data }))
  assert.match(html, /selected="">Torneo Regular/)
  assert.match(html, /4\.º/)
  assert.match(html, /<strong>99<\/strong>/)
  assert.match(html, /#07/)
  assert.match(html, /Sin nombre/)
  assert.match(html, /Equipo &lt;A&gt;/)
  assert.match(html, /Pepita líder/)
  assert.match(html, /<strong>2<\/strong>/)
  assert.match(html, /Horqueta líder/)
  assert.match(html, /<strong>3<\/strong>/)
  assert.match(html, /Directo = 1 · Pepita = 2 · Horqueta = 3/)
  const fallback = renderToStaticMarkup(createElement(Scoring, { data: { ...data, tables: [data.tables[0]!] } }))
  assert.match(fallback, /selected="">Final/)
  assert.equal((fallback.match(/Sin anotaciones/g) ?? []).length, 3)
})

test('calendar groups morning before afternoon and preserves each jornada order across categories', () => {
  const matches = [
    { ...match, id: 4, teamA: 'Tarde primero', jornada: 'AFTERNOON' },
    { ...match, id: 3, teamA: 'Mañana primero' },
    { ...match, id: 2, teamA: 'Mañana segundo', status: 'SCHEDULED' },
    { ...match, id: 5, tournamentType: 'FEMALE', teamA: 'Mañana femenino' },
    { ...match, id: 8, tournamentType: 'FEMALE', teamA: 'Tarde femenino', jornada: 'AFTERNOON' },
    { ...match, id: 6, status: 'FINISHED' },
    { ...match, id: 7, date: '2026-10-21' },
  ] as MatchResponse[]
  const selected = calendarMatches(matches)
  assert.deepEqual(selected.map(item => item.id), [4, 3, 2, 5, 8, 7])
  const html = renderToStaticMarkup(createElement(Calendar, { matches: selected.map(item => ({ ...item, participants: { ...item.participants, teamA: { ...participant, resolvedTeam: { id: 1, name: item.teamA } } } })), empty: 'Vacío' }))
  assert.match(html, /Mañana primero[\s\S]*Mañana segundo[\s\S]*Mañana femenino[\s\S]*Tarde primero[\s\S]*Tarde femenino/)
  assert.match(html, /Por publicar/)
  assert.doesNotMatch(html, /Línea secreta/)
  assert.match(html, /Marcador 2 a 0/)
  const results = renderToStaticMarkup(createElement(Calendar, { results: true, matches: [{ ...match, date: '2026-10-19' }, match], empty: 'Vacío' }))
  assert.ok(results.indexOf('20 de octubre') < results.indexOf('19 de octubre'))
})

test('public data reload validates responses, chooses current phase and preserves selections', async t => {
  const tournament = { id: 1, name: 'Copa', active: 1, currentPhaseId: 2, currentMalePhaseId: 2, currentFemalePhaseId: null, legacyType: null }
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
  const failures = new Set<string>()
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push(url)
    assert.ok(options.signal)
    assert.equal(options.credentials, 'same-origin')
    if (failures.has(url)) return new Response(JSON.stringify({ error: 'Servicio no disponible' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
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
  failures.add('/api/phases/2/standings')
  const failedStandings = await loadDisplay({}, new AbortController().signal)
  assert.equal(failedStandings.standings, undefined)
  assert.match(failedStandings.standingsError!, /Servicio no disponible/)
  assert.equal(failedStandings.matches[0]?.scoreA, 5)
  failures.clear()
  routes['/api/phases/2/scoring'] = routes['/api/phases/1/scoring']
  failures.add('/api/phases/2/scoring')
  const failedScoring = await loadDisplay({}, new AbortController().signal)
  assert.equal(failedScoring.scoring, undefined)
  assert.ok(failedScoring.standings)
  assert.match(failedScoring.scoringError!, /Servicio no disponible/)
  failures.add('/api/matches?phaseId=2')
  await assert.rejects(loadDisplay({}, new AbortController().signal), /Servicio no disponible/)
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

test('phase categories isolate selection, dependent reads and empty categories', async t => {
  const female = { ...phase, id: 3, tournamentType: 'FEMALE' } as const
  let phases = [phase, female]
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    calls.push(path)
    if (path === '/api/tournaments?active=true') return Response.json([{ id: 1, name: 'Copa', active: true, currentPhaseId: 1, currentMalePhaseId: 1, currentFemalePhaseId: null, legacyType: null }])
    if (path === '/api/tournaments/1/phases') return Response.json(phases)
    if (path === '/api/matches?phaseId=3') return Response.json([])
    if (path === '/api/phases/3/standings') return Response.json({ phase: female, hasStandings: false, rules: [], groups: [] })
    if (path === '/api/phases/3/scoring') return Response.json({ phase: female, tables: [] })
    assert.fail(`Unexpected request: ${path}`)
  })
  const selected = await loadDisplay({ phaseId: 1, category: 'FEMALE' }, new AbortController().signal)
  assert.equal(selected.phase?.id, 3)
  assert.deepEqual(selected.phases, [female])
  const refreshed = await loadDisplay({ phaseId: 3 }, new AbortController().signal)
  assert.equal(refreshed.phase?.id, 3)
  assert.deepEqual(refreshed.phases, [female])
  phases = [phase]
  calls.length = 0
  const empty = await loadDisplay({ category: 'FEMALE' }, new AbortController().signal)
  assert.equal(empty.phase, undefined)
  assert.deepEqual(empty.phases, [])
  assert.deepEqual(empty.matches, [])
  assert.deepEqual(calls, ['/api/tournaments?active=true', '/api/tournaments/1/phases'])
})

test('each public category defaults to its own current phase while explicit history remains available', async t => {
  const phases = [phase, { ...phase, id: 2 }, { ...phase, id: 3, tournamentType: 'FEMALE' }, { ...phase, id: 4, tournamentType: 'FEMALE' }];
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    if (path === '/api/tournaments?active=true') return Response.json([{ id: 1, name: 'Copa', active: true, currentPhaseId: 1, currentMalePhaseId: 2, currentFemalePhaseId: 4, legacyType: null }]);
    if (path === '/api/tournaments/1/phases') return Response.json(phases);
    if (path.startsWith('/api/matches?')) return Response.json([]);
    const selected = phases.find(item => path.includes(`/phases/${item.id}/`))!;
    if (path.endsWith('/standings')) return Response.json({ phase: selected, hasStandings: false, rules: [], groups: [] });
    return Response.json({ phase: selected, tables: [] });
  });
  const signal = new AbortController().signal;
  assert.equal((await loadDisplay({ category: 'MALE' }, signal)).phase?.id, 2);
  assert.equal((await loadDisplay({ category: 'FEMALE' }, signal)).phase?.id, 4);
  assert.equal((await loadDisplay({ category: 'FEMALE', phaseId: 3 }, signal)).phase?.id, 3);
});

test('live view shows both categories across phases in only the selected tournament and refreshes', async t => {
  const female = { ...phase, id: 3, tournamentType: 'FEMALE' }
  const tournament = { id: 1, name: 'Copa', active: true, currentPhaseId: 1, currentMalePhaseId: 1, currentFemalePhaseId: 3, legacyType: null }
  let matches = [match, { ...match, id: 2, phaseId: 3, tournamentType: 'FEMALE' }, { ...match, id: 3, phaseId: 9 }]
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    calls.push(path)
    if (path === '/api/tournaments?active=true') return Response.json([tournament, { ...tournament, id: 2 }])
    if (path === '/api/tournaments/1/phases') return Response.json([phase, female])
    if (path === '/api/tournaments/2/phases') return Response.json([{ ...phase, id: 9, tournamentId: 2 }])
    if (path === '/api/matches?status=LIVE' || path === '/api/matches') return Response.json(matches)
    if (path === '/api/matches?status=FINISHED') return Response.json(matches.filter(item => item.status === 'FINISHED'))
    assert.fail(`Unexpected request: ${path}`)
  })
  const signal = new AbortController().signal
  const selection = { tournamentId: 1, category: 'MALE' as const, phaseId: 1 }
  const initial = await loadDisplay(selection, signal, 'live')
  assert.deepEqual(initial.matches.map(item => item.id), [1, 2])
  assert.equal(initial.phase, undefined)
  assert.ok(calls.every(path => !path.includes('/standings') && !path.includes('/scoring')))
  assert.deepEqual((await loadDisplay({ tournamentId: 2 }, signal, 'live')).matches.map(item => item.id), [3])
  matches = matches.map(item => ({ ...item, scoreA: 7 }))
  assert.equal((await loadDisplay(selection, signal, 'live')).matches[1]?.scoreA, 7)
  matches = [
    { ...match, id: 1, status: 'SCHEDULED', sortOrder: 1 },
    { ...match, id: 2, phaseId: 3, tournamentType: 'FEMALE', status: 'SCHEDULED', sortOrder: 1 },
    { ...match, id: 3, sortOrder: 2 },
    { ...match, id: 4, phaseId: 9, status: 'SCHEDULED' },
    { ...match, id: 5, status: 'FINISHED' },
  ]
  const calendar = await loadDisplay(selection, signal, 'calendar')
  assert.deepEqual(calendarMatches(calendar.matches).map(item => item.id), [1, 2, 3])
  assert.equal(calendar.phase, undefined)
  assert.deepEqual((await loadDisplay({ tournamentId: 2 }, signal, 'calendar')).matches.map(item => item.id), [4])
  matches = [
    { ...match, id: 1, status: 'FINISHED', date: '2026-10-19' },
    { ...match, id: 2, phaseId: 3, tournamentType: 'FEMALE', status: 'FINISHED' },
    { ...match, id: 3, status: 'FINISHED' },
    { ...match, id: 4, phaseId: 9, status: 'FINISHED' },
    { ...match, id: 5, status: 'LIVE' },
  ]
  const results = await loadDisplay(selection, signal, 'results')
  assert.deepEqual(results.matches.map(item => item.id), [1, 2, 3])
  assert.deepEqual(resultMatches(results.matches, '2026-10-20').map(item => item.id), [2, 3])
  assert.equal(results.phase, undefined)
  const html = renderToStaticMarkup(createElement(Calendar, { matches: results.matches, results: true, empty: 'Sin resultados' }))
  assert.ok(html.indexOf('20 de octubre') < html.indexOf('19 de octubre'))
  assert.match(html, /Femenino/)
  assert.match(html, /Masculino/)
  assert.deepEqual((await loadDisplay({ tournamentId: 2 }, signal, 'results')).matches.map(item => item.id), [4])
  matches = []
  assert.deepEqual((await loadDisplay(selection, signal, 'results')).matches, [])
  assert.deepEqual((await loadDisplay(selection, signal, 'live')).matches, [])
  assert.deepEqual((await loadDisplay(selection, signal, 'calendar')).matches, [])
})

test('live navigation exposes only the tournament selector', async () => {
  const { PublicDisplay } = await import('../src/pages/PublicDisplay.tsx')
  const html = renderToStaticMarkup(createElement(PublicDisplay))
  assert.match(html, /Torneo activo/)
  assert.doesNotMatch(html, /Categoría de las fases|aria-label="Fase"/)
  assert.match(html, /aria-pressed="true">EN JUEGO/)
})

test('matches SSE reloads live standings while retaining tournament, category and phase', async t => {
  const selected = { ...phase, id: 3, tournamentType: 'FEMALE' } as const
  let points = 1
  let onMatches: () => void = () => {}
  class Events {
    addEventListener(name: string, callback: () => void) { if (name === 'matches') onMatches = callback }
    close() {}
  }
  const original = globalThis.EventSource
  globalThis.EventSource = Events as unknown as typeof EventSource
  t.after(() => { globalThis.EventSource = original })
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    if (path === '/api/tournaments?active=true') return Response.json([
      { id: 1, name: 'Otra copa', active: true, currentPhaseId: 1, currentMalePhaseId: 1, currentFemalePhaseId: null, legacyType: null },
      { id: 2, name: 'Copa elegida', active: true, currentPhaseId: 1, currentMalePhaseId: 1, currentFemalePhaseId: 3, legacyType: null },
    ])
    if (path === '/api/tournaments/2/phases') return Response.json([phase, selected])
    if (path === '/api/matches?phaseId=3') return Response.json([])
    if (path === '/api/phases/3/scoring') return Response.json({ phase: selected, tables: [] })
    if (path === '/api/phases/3/standings') return Response.json({
      phase: selected, hasStandings: true, rules: [], groups: [{ id: 1, phaseId: 3, name: 'A', standings: [{
        teamId: 1, teamName: 'Equipo en vivo', played: 1, wins: points === 3 ? 1 : 0,
        draws: points === 1 ? 1 : 0, losses: 0, goalsFor: points === 3 ? 2 : 0, goalsAgainst: 0,
        goalDifference: points === 3 ? 2 : 0, points, yellowCards: 0, redCards: 0,
        sanctioned: false, sanctionReason: null, position: 1, requiresTiebreaker: false,
        destination: null, possibleDestinations: [], tiebreakerRule: null,
      }] }],
    })
    assert.fail(`Unexpected request: ${path}`)
  })
  const selection = { tournamentId: 2, phaseId: 3, category: 'FEMALE' as const }
  const signal = new AbortController().signal
  const initial = await loadDisplay(selection, signal)
  assert.equal(initial.standings?.groups[0]?.standings[0]?.points, 1)
  let pending = Promise.resolve(initial)
  const cleanup = subscribeDisplay(() => { pending = loadDisplay(selection, signal) }, () => {})
  t.after(cleanup)
  points = 3
  onMatches()
  const refreshed = await pending
  assert.equal(refreshed.tournament?.id, 2)
  assert.equal(refreshed.phase?.id, 3)
  assert.equal(refreshed.phase?.tournamentType, 'FEMALE')
  assert.equal(refreshed.standings?.groups[0]?.standings[0]?.goalsFor, 2)
  const html = renderToStaticMarkup(createElement(Standings, { data: refreshed.standings! }))
  assert.match(html, /Equipo en vivo/)
  assert.match(html, /<strong>3<\/strong>/)
})
