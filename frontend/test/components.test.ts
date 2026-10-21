import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MatchResponse } from '@jupas/shared'

// Node does not load CSS; keep class names visible while exercising real component markup.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.module.css')) return { format: 'module', shortCircuit: true, source: 'export default new Proxy({}, { get: (_, name) => name })' }
    return nextLoad(url, context)
  },
})
const { MatchCard } = await import('../src/components/MatchCard.tsx')
const { MatchList } = await import('../src/components/MatchList.tsx')
const { Layout } = await import('../src/components/Layout.tsx')
const { Navigation } = await import('../src/components/Navigation.tsx')

const participant = { reference: { kind: 'TEAM', teamId: 1 }, resolvedTeamId: 1, resolvedTeam: { id: 1, name: 'Equipo resuelto' }, status: 'CONFIRMED' } as const
const match: MatchResponse = {
  id: 1, tournamentType: 'MALE', date: '2026-10-20', jornada: 'MORNING',
  teamA: 'Equipo A', teamB: 'Equipo B', lineTeam: 'Línea secreta', court: 1,
  sortOrder: null, scoreA: 2, scoreB: 0, status: 'LIVE',
  createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z',
  phaseId: 1, groupId: 1, teamAId: 1, teamBId: 2, lineTeamId: 3,
  yellowCardsA: 0, redCardsA: 0, yellowCardsB: 0, redCardsB: 0,
  tournamentName: 'Copa', phaseName: 'Fase', groupName: 'Grupo', lineVisible: false,
  participants: { teamA: participant, teamB: { ...participant, resolvedTeam: { id: 2, name: 'Equipo B' } }, lineTeam: participant },
}

test('match cards display resolved teams and accessible scores, never hidden lines', () => {
  const html = renderToStaticMarkup(createElement(MatchCard, { match }))
  assert.match(html, /Equipo resuelto/)
  assert.match(html, /Marcador 2 a 0/)
  assert.match(html, /EN JUEGO/)
  assert.match(html, /Mañana/)
  assert.match(html, /Por publicar/)
  assert.doesNotMatch(html, /Línea secreta/)
})

test('scheduled group participants stay pending until confirmed and show no score', () => {
  const pending: MatchResponse = { ...match, status: 'SCHEDULED', lineVisible: true, participants: {
    ...match.participants, teamA: { ...participant, status: 'RESOLVED', reference: { kind: 'GROUP_POSITION', sourcePhaseId: 1, sourceGroupId: 1, position: 1 } },
  } }
  const html = renderToStaticMarkup(createElement(MatchCard, { match: pending }))
  assert.match(html, /Equipo A/)
  assert.match(html, /Por definir/)
  assert.match(html, />vs</)
  assert.doesNotMatch(html, /Marcador/)
  assert.match(renderToStaticMarkup(createElement(MatchCard, { match: { ...pending, participants: { ...pending.participants, teamA: participant } } })), /Equipo resuelto/)
})

test('list announces loading and empty states and renders supplied matches', () => {
  assert.match(renderToStaticMarkup(createElement(MatchList, { loading: true })), /role="status".*Cargando/)
  assert.match(renderToStaticMarkup(createElement(MatchList, { matches: [] })), /role="status".*No hay partidos/)
  assert.match(renderToStaticMarkup(createElement(MatchList, { matches: [match] })), /Partido 1/)
})

test('layout has a skip target and navigation identifies only the current link', () => {
  const navigation = createElement(Navigation, { currentHref: '/display/', items: [{ href: '/display/', label: 'Torneo' }, { href: '/admin/', label: 'Administración' }] })
  const html = renderToStaticMarkup(createElement(Layout, { navigation, children: 'Contenido' }))
  assert.match(html, /href="#main-content"/)
  assert.match(html, /<main id="main-content" tabindex="-1"/)
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1)
  assert.match(html, /href="\/display\/"/)
})
