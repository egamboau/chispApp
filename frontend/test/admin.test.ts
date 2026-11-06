import { GroupSlots } from '../src/admin/GroupSlots.tsx'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MatchResponse } from '@jupas/shared'
import { adminMutation, loadAdmin, scoringSelection } from '../src/api/admin.ts'
import { adminCalendarMatches, AdminMatch, Calendar, MatchEditor, MatchForm, participantValues, winnerSources } from '../src/admin/Calendar.tsx'
import type { AdminData } from '../src/api/admin.ts'
import { Positions } from '../src/admin/Tournaments.tsx'

const phase = { id: 2, tournamentId: 1, name: 'Final', type: 'ELIMINATION', sortOrder: 2, tournamentType: 'MALE' } as const
const source = { ...phase, id: 1, name: 'Tabla', type: 'TABLE', sortOrder: 1 } as const
const tournament = { id: 1, name: 'Copa', active: false, currentPhaseId: 2, currentMalePhaseId: 2, currentFemalePhaseId: null, legacyType: null }
const reference = { kind: 'TEAM', teamId: 1 } as const
const participant = { reference, resolvedTeamId: 1, resolvedTeam: { id: 1, name: 'A' }, status: 'CONFIRMED' } as const
const match: MatchResponse = {
  id: 5, tournamentType: 'MALE', date: '2026-10-20', jornada: 'MORNING', teamA: 'A', teamB: 'B', lineTeam: 'C', court: 1, sortOrder: null,
  scoreA: 0, scoreB: 0, status: 'SCHEDULED', createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z', phaseId: 2, groupId: 2,
  teamAId: 1, teamBId: 2, lineTeamId: 3, yellowCardsA: 0, redCardsA: 0, yellowCardsB: 0, redCardsB: 0, tournamentName: 'Copa', phaseName: 'Final', groupName: 'Grupo', lineVisible: false,
  participants: { teamA: { ...participant, reference: { kind: 'GROUP_POSITION', sourcePhaseId: 1, sourceGroupId: 1, position: 1 } }, teamB: { ...participant, reference: { kind: 'MATCH_WINNER', sourceMatchId: 4 } }, lineTeam: participant },
}

test('participant forms preserve confirmed group positions and existing API winner references', () => {
  assert.deepEqual(participantValues({ 'teamA-kind': 'GROUP_POSITION', 'teamA-phase': '1', 'teamA-group': '1', 'teamA-position': '3', 'teamB-kind': 'MATCH_WINNER', 'teamB-match': '4', 'lineTeam-kind': 'TEAM', 'lineTeam-team': '3' }), {
    teamA: { kind: 'GROUP_POSITION', sourcePhaseId: 1, sourceGroupId: 1, position: 3 }, teamB: { kind: 'MATCH_WINNER', sourceMatchId: 4 }, lineTeam: { kind: 'TEAM', teamId: 3 },
  })
  assert.throws(() => participantValues({ 'teamA-kind': 'MATCH_WINNER' }))
  assert.throws(() => participantValues({ 'teamA-kind': 'TEAM', 'teamA-team': '0' }))
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
      '/api/admin/phases/2/membership-slots': [], '/api/admin/phases/3/membership-slots': [], '/api/admin/phases/3/groups': [], '/api/admin/phases/3/memberships': [], '/api/admin/teams?tournamentId=1': [], '/api/admin/phases/2/groups': [], '/api/admin/phases/2/memberships': [], '/api/admin/matches': [match, { ...match, id: 6, phaseId: 3, tournamentType: 'FEMALE', status: 'LIVE' }, { ...match, id: 7, phaseId: 99 }], '/api/admin/phases/1/groups': [{ id: 1, phaseId: 1, name: 'Origen' }],
    }
    assert.ok(path in data, path)
    return Response.json(data[path])
  })
  const data = await loadAdmin('calendar', {}, new AbortController().signal)
  assert.equal(data.phase?.id, 2); assert.equal(data.tournament?.active, false)
  assert.deepEqual(data.sourcePhases, [source]); assert.equal(data.sourceGroups[1]?.[0]?.name, 'Origen')
  assert.deepEqual(data.matches[0]?.participants, match.participants)
  assert.deepEqual(data.matches.map(item => item.id), [5, 6])
  const html = renderToStaticMarkup(createElement(Calendar, { data: { ...data, matches: data.matches.map(item => ({ ...item, status: 'LIVE' })) }, run: async () => false }))
  assert.equal((html.match(/aria-label="Sumar gol A"/g) ?? []).length, 2)
  assert.match(html, /Masculino/)
  assert.match(html, /Femenino/)

  const otherPhase = await loadAdmin('calendar', { phaseId: 3 }, new AbortController().signal)
  assert.deepEqual(otherPhase.matches.map(item => item.id), [5, 6])
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
    slots: [], winnerPhases: [], winnerMatches: [], rules: [], sanctions: [], teamCards: [], matches: [], tables: [], positions: undefined, sourcePhases: [source], sourceGroups: {},
  }
  const list = renderToStaticMarkup(createElement(Calendar, { data, run: async () => false }))
  assert.match(list, /\+ Partido/)
  assert.match(list, /aria-label="Estado"[\s\S]*<option value="" selected="">Todos<\/option><option value="SCHEDULED">Programados<\/option><option value="LIVE">En juego<\/option><option value="FINISHED">Finalizados<\/option>/)
  assert.doesNotMatch(list, /Programar partido|name="teamA-kind"/)
  assert.match(list, /Partidos · Copa/)
  const editor = renderToStaticMarkup(createElement(MatchEditor, { data, match: { ...match, phaseId: 1 }, run: async () => false, cancel() {} }))
  assert.match(editor, /fieldset disabled=""[\s\S]*Fase del partido/)
  assert.match(editor, /value="1" selected=""/)
  assert.match(editor, /Cargando fase del partido/)
  assert.doesNotMatch(editor, /name="teamA-kind"/)

  const html = renderToStaticMarkup(createElement(MatchForm, { data, run: async () => false, cancel() {} }))
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
  assert.equal(participantValues(values).lineTeam, null)
  assert.throws(() => participantValues({ ...values, 'teamA-team': '' }))
  const html = renderToStaticMarkup(createElement(AdminMatch, { match: { ...match, lineTeam: null, lineTeamId: null, participants: { ...match.participants, lineTeam: null } }, run: async () => false, edit() {} }))
  assert.match(html, /Sin asignar/)
})

test('shared creation forms stay mounted behind native disclosures with labelled required controls', async () => {
  const { Form, Field } = await import('../src/admin/Forms.tsx')
  const html = renderToStaticMarkup(createElement(Form, { title: 'Nuevo torneo', disclosure: true, submit: async () => false }, createElement(Field, { label: 'Nombre', name: 'name' })))
  assert.match(html, /<details class="form-disclosure"><summary>Agregar/)
  assert.doesNotMatch(html, /<details[^>]* open/)
  assert.match(html, /<label>Nombre<input required="" aria-label="Nombre" name="name"/)
})

test('task tabs expose selected state, roving focus and associated panels', async () => {
  const { Tabs } = await import('../src/admin/Forms.tsx')
  const html = renderToStaticMarkup(createElement(Tabs, { labels: ['General', 'Fases'], value: 'General', onChange() {} }))
  assert.match(html, /role="tablist"/)
  assert.match(html, /id="tab-General" role="tab" aria-selected="true" aria-controls="panel-General" tabindex="0"/)
  assert.match(html, /id="tab-Fases" role="tab" aria-selected="false" aria-controls="panel-Fases" tabindex="-1"/)
})

test('teams open with grouped membership lists and task panels rather than every team editor', async () => {
  const { Teams } = await import('../src/admin/Teams.tsx')
  const data: AdminData = {
    tournaments: [tournament], tournament, phases: [phase], phase,
    teams: [{ id: 1, name: 'Inscrito', tournamentId: 1, tournamentType: 'MALE' }, { id: 2, name: 'Disponible', tournamentId: 1, tournamentType: 'MALE' }],
    groups: [{ id: 2, phaseId: 2, name: 'Grupo A' }], memberships: [{ phaseId: 2, groupId: 2, teamId: 1 }],
    slots: [], winnerPhases: [], winnerMatches: [], rules: [], sanctions: [], teamCards: [], matches: [], tables: [], positions: undefined, sourcePhases: [], sourceGroups: {},
  }
  const html = renderToStaticMarkup(createElement(Teams, { data, run: async () => false, revision: 0 }))
  assert.match(html, /Grupo A[\s\S]*Ver Inscrito[\s\S]*Sin grupo en esta fase[\s\S]*Ver Disponible/)
  assert.doesNotMatch(html, /Editar Inscrito|Editar Disponible/)
  assert.match(html, /id="panel-Jugadores" role="tabpanel" aria-labelledby="tab-Jugadores" hidden=""/)
  assert.match(html, /id="panel-Disciplina" role="tabpanel" aria-labelledby="tab-Disciplina" hidden=""/)
})

test('scoring registration previews existing weighted totals and retains the controlled table', async () => {
  const { ScoringForm } = await import('../src/admin/Scoring.tsx')
  const html = renderToStaticMarkup(createElement(ScoringForm, {
    match: { ...match, status: 'FINISHED' }, player: { id: 7, teamId: 1, number: '07', name: 'Ana', displayName: '07 Ana', status: 'REGISTERED' },
    entry: { playerId: 7, playerNumber: '07', teamId: 1, matchId: 5, scoringTable: 'Copa', directGoals: 1, pepitas: 2, horquetas: 3, total: 14 },
    tables: [{ id: 4, name: 'Copa', tournamentId: 1, tournamentType: 'MALE' }], tableId: 4, setTableId() {}, run: async () => false, saved() {},
  }))
  assert.match(html, /Editar goleo/)
  assert.match(html, /<option value="4" selected="">Copa/)
  assert.match(html, /Total: <strong>14<\/strong>/)
  assert.match(html, /name="directGoals"[^>]*value="1"/)
})


test('scoring payload translates validated table IDs to the existing API name for create and edit', async () => {
  const { scoringPayload } = await import('../src/admin/Scoring.tsx')
  const tables = [{ id: 4, name: 'Copa', tournamentId: 1, tournamentType: 'MALE' as const }]
  const values = { directGoals: '1', pepitas: '2', horquetas: '0', scoringTableId: '4' }
  assert.deepEqual(scoringPayload(values, tables, 7), { playerId: 7, directGoals: 1, pepitas: 2, horquetas: 0, scoringTable: 'Copa' })
  assert.deepEqual(scoringPayload(values, tables), { directGoals: 1, pepitas: 2, horquetas: 0, scoringTable: 'Copa' })
  assert.throws(() => scoringPayload({ ...values, scoringTableId: '99' }, tables), /tabla de goleo válida/)
})

test('tournament General lists every tournament and opens editing in the chosen context', async () => {
  const { Tournaments } = await import('../src/admin/Tournaments.tsx')
  const data: AdminData = {
    tournaments: [tournament, { ...tournament, id: 9, name: 'Otra copa', active: true }], tournament, phases: [phase], phase,
    teams: [], groups: [], memberships: [], slots: [], winnerPhases: [], winnerMatches: [], rules: [], sanctions: [], teamCards: [], matches: [], tables: [], positions: undefined, sourcePhases: [], sourceGroups: {},
  }
  let selected: number | undefined
  const props = { data, run: async () => false, tab: 'General', setTab() {}, selectPhase() {}, selectTournament(id: number) { selected = id } }
  const element = Tournaments(props)
  const html = renderToStaticMarkup(element)
  assert.match(html, /Copa · Inactivo/)
  assert.match(html, /Otra copa · Activo/)
  assert.match(html, /aria-pressed="true">Editar Copa/)
  assert.match(html, /aria-pressed="false">Editar Otra copa/)
  assert.match(html, /Editar torneo Copa/)
  assert.match(html, /<p hidden="">Copa → Final/)
  const general = element.props.children.find((child: { props?: { id?: string } }) => child?.props?.id === 'panel-General')
  general.props.children[1][1].props.children[1].props.onClick()
  assert.equal(selected, 9)
  const other = data.tournaments[1]!
  const updated = renderToStaticMarkup(createElement(Tournaments, { ...props, data: { ...data, tournament: other }, tab: 'Fases' }))
  assert.match(updated, /Editar torneo Otra copa/)
  assert.match(updated, /id="panel-General"[^>]*hidden=""/)
  assert.doesNotMatch(updated, /id="panel-Fases"[^>]*hidden/)
})


test('tournament navigation groups sections in a disclosure and preserves tournament context', async () => {
  const { TournamentMenu } = await import('../src/admin/Tournaments.tsx')
  let selected = ''
  const element = TournamentMenu({ current: 'Grupos', query: 'tournamentId=9&phaseId=2', onSelect(section) { selected = section } })
  const html = renderToStaticMarkup(element)
  assert.match(html, /<details class="tournament-menu"><summary class="active">Torneos/)
  assert.match(html, /href="\/admin\/\?tournamentId=9&amp;phaseId=2&amp;section=Grupos" aria-current="page"/)
  for (const name of ['General', 'Fases', 'Grupos', 'Clasificación']) assert.ok(html.includes(`>${name}</a>`))
  let prevented = false, closed = false
  element.props.children[1].props.children[0].props.onClick({ preventDefault() { prevented = true }, currentTarget: { closest() { return { removeAttribute() { closed = true } } } } })
  assert.equal(selected, 'General'); assert.equal(prevented, true); assert.equal(closed, true)
})

test('current phase form separates categories and saves both selections including unassigned', async t => {
  const { Tournaments } = await import('../src/admin/Tournaments.tsx')
  const female = { ...phase, id: 8, name: 'Grupos femeninos', tournamentType: 'FEMALE' as const }
  const data: AdminData = {
    tournaments: [tournament], tournament: { ...tournament, currentFemalePhaseId: 8 }, phases: [phase, female], phase,
    teams: [], groups: [], memberships: [], slots: [], winnerPhases: [], winnerMatches: [], rules: [], sanctions: [], teamCards: [], matches: [], tables: [], positions: undefined, sourcePhases: [], sourceGroups: {},
  }
  let payload: unknown
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { payload = JSON.parse(init.body as string); return new Response(null, { status: 204 }) })
  const element = Tournaments({ data, run: async operation => { await operation(); return true }, tab: 'Fases', setTab() {}, selectPhase() {}, selectTournament() {} })
  const panel = element.props.children.find((child: { props?: { id?: string } }) => child?.props?.id === 'panel-Fases')
  const panelHtml = renderToStaticMarkup(panel)
  assert.match(panelHtml, /Editar fase<\/h3>[\s\S]*aria-label="Fase a editar"/)
  const form = panel.props.children[0]
  const html = renderToStaticMarkup(form)
  assert.doesNotMatch(html, /Fase a editar/)
  const maleSelect = html.split('aria-label="Fase vigente masculina"')[1]!.split('</select>')[0]!
  const femaleSelect = html.split('aria-label="Fase vigente femenina"')[1]!.split('</select>')[0]!
  assert.match(maleSelect, /Final/); assert.doesNotMatch(maleSelect, /Grupos femeninos/)
  assert.match(femaleSelect, /Grupos femeninos/); assert.doesNotMatch(femaleSelect, /Final/)
  await form.props.submit({ currentMalePhaseId: '', currentFemalePhaseId: '8' })
  assert.deepEqual(payload, { name: tournament.name, active: tournament.active, currentMalePhaseId: null, currentFemalePhaseId: 8 })
})


test('admin calendar combines status, date and court filters while preserving match order', () => {
  const matches: MatchResponse[] = [
    match,
    { ...match, id: 6, status: 'LIVE' },
    { ...match, id: 7, status: 'FINISHED' },
    { ...match, id: 8, status: 'FINISHED', date: '2026-10-21' },
    { ...match, id: 9, status: 'FINISHED', court: 2 },
  ]
  assert.deepEqual(adminCalendarMatches(matches, '', '', ''), matches)
  for (const status of ['SCHEDULED', 'LIVE', 'FINISHED']) {
    assert.deepEqual(adminCalendarMatches(matches, '', '', status), matches.filter(item => item.status === status))
  }
  assert.deepEqual(adminCalendarMatches(matches, match.date, '1', 'FINISHED').map(item => item.id), [7])
  assert.deepEqual(adminCalendarMatches(matches, match.date, '2', 'LIVE'), [])
  assert.deepEqual(adminCalendarMatches([], '', '', 'FINISHED'), [])
})


test('admin errors render the API message as a focusable alert and retain retry actions', async () => {
  const { ErrorNotice } = await import('../src/admin/Forms.tsx')
  const message = 'El equipo debe pertenecer al torneo y categoría del partido.'
  const html = renderToStaticMarkup(createElement(ErrorNotice, { message }, createElement('button', null, 'REINTENTAR')))
  assert.match(html, /role="alert" tabindex="-1" class="error error-notice"/)
  assert.ok(html.includes(message))
  assert.match(html, /<button>REINTENTAR<\/button>/)
  assert.equal(renderToStaticMarkup(createElement(ErrorNotice, { message: '' })), '')
})

test('issue 62: calendar uses group-place references without inventing teams', () => {
  const slot = { kind: 'MATCH_WINNER', sourceMatchId: 17 } as const
  assert.deepEqual(participantValues({ 'teamA-kind': 'SLOT', 'teamA-slot': JSON.stringify(slot), 'teamB-kind': 'TEAM', 'teamB-team': '2', 'lineTeam-kind': 'TEAM', 'lineTeam-team': '' }), {
    teamA: slot, teamB: { kind: 'TEAM', teamId: 2 }, lineTeam: null,
  })
  assert.throws(() => participantValues({ 'teamA-kind': 'SLOT', 'teamA-slot': '{}' }))
})


test('issue 62: groups expose pending references, origin formats and stale places beside each group', () => {
  const data: AdminData = { tournaments: [tournament], tournament, phases: [source, phase], phase, teams: [], groups: [{ id: 2, phaseId: 2, name: 'Destino' }], rules: [], memberships: [], sanctions: [], teamCards: [], matches: [], tables: [], positions: undefined, sourcePhases: [source], sourceGroups: { 1: [{ id: 1, phaseId: 1, name: 'A' }] }, winnerPhases: [], winnerMatches: [], slots: [{ id: 1, phaseId: 2, groupId: 2, reference: { kind: 'GROUP_POSITION', sourcePhaseId: 1, sourceGroupId: 1, position: 1 }, resolvedTeamId: 1, teamName: 'A', label: '1.º del Grupo A', status: 'STALE' }] }
  const html = renderToStaticMarkup(createElement(GroupSlots, { data, groupId: 2, run: async () => false }))
  assert.match(html, /Añadir cupo pendiente/)
  assert.match(html, /Ganador de partido/)
  assert.match(html, /1.º del Grupo A/)
  assert.match(html, /Desactualizado: revisar origen/)
  assert.match(html, /QUITAR CUPO/)
})

/** Supplies two semifinals using the actual admin DTOs. */
function winnerData(): AdminData {
  const semifinal = { ...phase, id: 4, name: 'Semifinal', sortOrder: 1 }
  const fixed = { teamA: participant, teamB: { ...participant, reference: { kind: 'TEAM' as const, teamId: 2 }, resolvedTeamId: 2 }, lineTeam: null }
  const first = { ...match, id: 10, phaseId: 4, phaseName: 'Semifinal', teamA: '1.º Grupo A', teamB: '2.º Grupo B', participants: fixed }
  return { tournaments: [tournament], tournament, phases: [semifinal, phase], phase, teams: [], groups: [{ id: 2, phaseId: 2, name: 'Final' }], memberships: [], slots: [], winnerPhases: [], winnerMatches: [], rules: [], sanctions: [], teamCards: [], matches: [first, { ...first, id: 11 }], tables: [], positions: undefined, sourcePhases: [], sourceGroups: {} }
}

test('issue 63: explicit winner IDs create a final, change all roles and reject incomplete references', () => {
  const values = { 'teamA-kind': 'MATCH_WINNER', 'teamA-match': '10', 'teamB-kind': 'MATCH_WINNER', 'teamB-match': '11', 'lineTeam-kind': 'TEAM', 'lineTeam-team': '' }
  assert.deepEqual(participantValues(values), { teamA: { kind: 'MATCH_WINNER', sourceMatchId: 10 }, teamB: { kind: 'MATCH_WINNER', sourceMatchId: 11 }, lineTeam: null })
  assert.deepEqual(participantValues({ ...values, 'teamA-match': '12', 'lineTeam-kind': 'MATCH_WINNER', 'lineTeam-match': '13' }), { teamA: { kind: 'MATCH_WINNER', sourceMatchId: 12 }, teamB: { kind: 'MATCH_WINNER', sourceMatchId: 11 }, lineTeam: { kind: 'MATCH_WINNER', sourceMatchId: 13 } })
  assert.deepEqual(participantValues({ ...values, 'teamA-kind': 'TEAM', 'teamA-team': '7' }).teamA, { kind: 'TEAM', teamId: 7 })
  assert.throws(() => participantValues({ ...values, 'teamA-match': '' }))
  assert.throws(() => participantValues({ ...values, 'lineTeam-kind': 'MATCH_WINNER', 'lineTeam-match': '' }))
})

test('issue 63: source eligibility excludes other tournaments/categories, future phases, self and indirect cycles', () => {
  const data = winnerData(), same = { ...data.matches[0]!, id: 12, phaseId: phase.id }
  const dependent = (id: number, sourceMatchId: number) => ({ ...same, id, participants: { ...same.participants, teamA: { ...participant, reference: { kind: 'MATCH_WINNER' as const, sourceMatchId } } } })
  data.phases.push({ ...phase, id: 8, tournamentType: 'FEMALE' }, { ...phase, id: 9, sortOrder: 9 }, { ...phase, id: 15, tournamentId: 99, sortOrder: 1 })
  data.matches.push(same, dependent(13, 12), dependent(14, 13), { ...same, id: 20, phaseId: 8, tournamentType: 'FEMALE' }, { ...same, id: 21, phaseId: 9 }, { ...same, id: 22, phaseId: 15 })
  assert.deepEqual(winnerSources(data).map(item => item.id), [10, 11, 12, 13, 14])
  assert.deepEqual(winnerSources(data, 12).map(item => item.id), [10, 11])
})

test('issue 63: editing/reloading preserves explicit winners and displays readable sources and empty feedback', () => {
  const data = winnerData()
  const final = { ...match, participants: { teamA: { ...participant, reference: { kind: 'MATCH_WINNER' as const, sourceMatchId: 10 } }, teamB: { ...participant, reference: { kind: 'MATCH_WINNER' as const, sourceMatchId: 11 } }, lineTeam: { ...participant, reference: { kind: 'MATCH_WINNER' as const, sourceMatchId: 10 } } } }
  const render = (selected: MatchResponse, sourceData = data) => renderToStaticMarkup(createElement(MatchForm, { data: sourceData, match: selected, run: async () => false, cancel() {} }))
  const html = render(JSON.parse(JSON.stringify(final)))
  assert.equal((html.match(/name="(?:teamA|teamB|lineTeam)-match"/g) ?? []).length, 3)
  assert.match(html, /value="10" selected/); assert.match(html, /value="11" selected/)
  assert.match(html, /Ganador de Semifinal/); assert.match(html, /1.º Grupo A/)
  assert.match(render({ ...final, participants: { ...final.participants, teamA: { ...participant, reference: { kind: 'MATCH_WINNER', sourceMatchId: 11 } } } }), /name="teamA-match"[^]*?value="11" selected/)
  assert.match(render(final, { ...data, matches: [] }), /No hay partidos eliminatorios de origen elegibles/)
  const create = renderToStaticMarkup(createElement(MatchForm, { data, run: async () => false, cancel() {} }))
  assert.equal((create.match(/value="MATCH_WINNER"/g) ?? []).length, 3)
})

test('calendar exposes editable public match labels instead of source database IDs', () => {
  const labelled = { ...match, label: 'Semifinal 1' };
  const html = renderToStaticMarkup(createElement(AdminMatch, { match: labelled, run: async () => true, edit() {} }));
  assert.match(html, /Semifinal 1/);
  assert.match(html, /Etiqueta \(opcional\)/);
  assert.match(html, /maxLength="80"/i);
  const data = winnerData();
  data.matches[0]!.label = 'Semifinal 1';
  const final = { ...match, participants: { ...match.participants, teamA: { ...participant, reference: { kind: 'MATCH_WINNER' as const, sourceMatchId: 10 } } } };
  const form = renderToStaticMarkup(createElement(MatchForm, { data, match: final, run: async () => false, cancel() {} }));
  assert.match(form, /Ganador de Semifinal 1/);
  assert.doesNotMatch(form, /partido 10/);
});
