import { useEffect, useState } from 'react'
import * as S from '@jupas/shared'
import type { AdminData } from '../api/admin'
import { adminMutation, adminRequest } from '../api/admin'
import { confirmDiscard, Field, Form, Row, Select, Tabs } from './Forms'
import type { Run } from './Forms'

/** Separates registration, existing totals and table settings while retaining valid match/team/table context.
 * Loads rosters and scoring together; aborts stale selections and keeps server totals authoritative. */
export function Scoring({ data: d, run, revision }: { data: AdminData; run: Run; revision: number }) {
  const [tab, setTab] = useState('Registro')
  const [matchId, setMatchId] = useState(new URLSearchParams(location.search).get('matchId') ?? '')
  const match = d.matches.find(item => item.id === Number(matchId)) ?? d.matches[0]
  const [details, setDetails] = useState<{ players: S.PlayerResponse[]; scoring: S.MatchScoringListResponse }>()
  const [error, setError] = useState('')
  const [teamId, setTeamId] = useState(''), [playerId, setPlayerId] = useState(''), [tableId, setTableId] = useState('')
  const [editingId, setEditingId] = useState<number>()
  useEffect(() => {
    const controller = new AbortController(); setDetails(undefined); setError('')
    history.replaceState(null, '', `/admin/scoring.html${match ? `?matchId=${match.id}` : ''}`)
    if (match) void Promise.all([
      adminRequest(`/teams/${match.teamAId}/players`, S.PlayerListResponseSchema, { signal: controller.signal }),
      adminRequest(`/teams/${match.teamBId}/players`, S.PlayerListResponseSchema, { signal: controller.signal }),
      adminRequest(`/matches/${match.id}/scoring`, S.MatchScoringListResponseSchema, { signal: controller.signal }),
    ]).then(([a, b, scoring]) => { if (!controller.signal.aborted) setDetails({ players: [...a, ...b], scoring }) }, failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [match?.id, match?.teamAId, match?.teamBId, revision])
  const teams = match ? [{ id: match.teamAId!, name: match.teamA }, { id: match.teamBId!, name: match.teamB }] : []
  const team = teams.find(item => item.id === Number(teamId)) ?? teams[0]
  const entry = details?.scoring.find(item => item.playerId === editingId)
  const available = details?.players.filter(item => item.teamId === team?.id && (item.id === entry?.playerId || item.status === 'REGISTERED' && !details.scoring.some(row => row.playerId === item.id))) ?? []
  const player = available.find(item => item.id === Number(playerId)) ?? available[0]
  const table = d.tables.find(item => item.id === Number(tableId)) ?? d.tables[0]
  /** Opens an existing record in registration with its exact player, team, table and counts. */
  function edit(item: S.MatchScoringResponse) {
    if (!confirmDiscard()) return
    setEditingId(item.playerId); setTeamId(String(item.teamId)); setPlayerId(String(item.playerId)); setTableId(String(d.tables.find(table => table.name === item.scoringTable)?.id ?? '')); setTab('Registro')
  }
  return <section className="panel task-workspace"><h2>Informe de goleo</h2><p>{d.tournament?.name ?? 'Sin torneo'} · {d.phase?.name ?? 'Sin fase'}</p>
    <Select label="Partido finalizado" value={match?.id ?? ''} onChange={value => { if (confirmDiscard()) { setMatchId(value); setEditingId(undefined); setPlayerId('') } }} items={d.matches.map(item => ({ id: item.id, name: `${item.date} · ${item.jornada === 'MORNING' ? 'Mañana' : 'Tarde'} · Cancha ${item.court} · ${item.teamA} ${item.scoreA}–${item.scoreB} ${item.teamB}` }))} />
    {match ? <h3>{match.teamA} {match.scoreA}–{match.scoreB} {match.teamB}</h3> : <p>No hay partidos finalizados en esta fase.</p>}{error && <p className="error" role="alert">{error}</p>}
    <Tabs labels={['Registro', 'Goleadores', 'Tablas']} value={tab} onChange={setTab} />
    <section id="panel-Registro" role="tabpanel" aria-labelledby="tab-Registro" hidden={tab !== 'Registro'}>
      <Select label="Equipo del registro" items={teams} value={team?.id ?? ''} onChange={value => { if (confirmDiscard()) { setTeamId(value); setPlayerId(''); setEditingId(undefined) } }} />
      <Select label="Jugador" value={player?.id ?? ''} onChange={value => { if (confirmDiscard()) { setPlayerId(value); setEditingId(undefined) } }} items={available.map(item => ({ id: item.id, name: `#${item.number} · ${item.name ?? 'Sin nombre'}` }))} />
      {details && !available.length && <p>No hay jugadores pendientes de registro en este equipo. Edita los registros desde Goleadores.</p>}
      <ScoringForm key={`${match?.id}-${player?.id}-${entry?.playerId}-${revision}`} match={match} player={player} entry={entry} tables={d.tables} tableId={table?.id ?? ''} setTableId={setTableId} run={run} saved={() => { setEditingId(undefined); setPlayerId('') }} />
    </section>
    <section id="panel-Goleadores" role="tabpanel" aria-labelledby="tab-Goleadores" hidden={tab !== 'Goleadores'}>
      {!details?.scoring.length && <p>No hay registros en este partido.</p>}
      {details?.scoring.map(item => <Row key={item.playerId} className={details.players.find(player => player.id === item.playerId)?.status === 'UNREGISTERED' ? 'unregistered' : undefined}><span><strong>{item.teamId === match?.teamAId ? match.teamA : match?.teamB} · #{item.playerNumber} {details.players.find(player => player.id === item.playerId)?.name ?? 'Sin nombre'}</strong><small>Tabla: {item.scoringTable} · Directos: {item.directGoals} · Pepitas: {item.pepitas} · Horquetas: {item.horquetas}{item.pepitas > 0 && item.horquetas > 0 ? ' · Pepita + horqueta' : ''} · Total: {item.total}</small></span><button onClick={() => edit(item)}>EDITAR</button><button className="danger" onClick={() => { if (confirm(`¿Eliminar goleo del jugador #${item.playerNumber}?`)) void run(() => adminMutation(`/matches/${match!.id}/scoring/${item.playerId}`, 'DELETE')) }}>ELIMINAR</button></Row>)}
    </section>
    <section id="panel-Tablas" role="tabpanel" aria-labelledby="tab-Tablas" hidden={tab !== 'Tablas'}>
      <Form disclosure title="Crear tabla de goleo" disabled={!d.phase} submit={v => run(() => adminMutation(`/phases/${d.phase!.id}/scoring-tables`, 'POST', S.ScoringTableInputSchema.parse(v)))}><Field label="Nombre" name="name" maxLength={100} /></Form>
      {d.tables.map(table => <Form key={`${table.id}-${table.name}`} title={`Renombrar ${table.name}`} submit={v => run(() => adminMutation(`/phases/${d.phase!.id}/scoring-tables/${table.id}`, 'PUT', S.ScoringTableInputSchema.parse(v)))}><Field label="Nombre" name="name" maxLength={100} defaultValue={table.name} /></Form>)}
    </section>
  </section>
}

/** Validates selected IDs, then sends the table name required by the existing scoring API. */
export function scoringPayload(values: Record<string, string>, tables: AdminData['tables'], playerId?: number) {
  const { scoringTableId, ...counts } = playerId === undefined ? S.ScoringSchema.parse(values) : S.NewScoringSchema.parse({ ...values, playerId })
  const table = tables.find(item => item.id === scoringTableId)
  if (!table) throw new Error('Selecciona una tabla de goleo válida.')
  return { ...counts, scoringTable: table.name }
}

/** Validates positive scoring counts and previews the established weighted total.
 * Successful entry resets counts/player through the caller while preserving selected match/team/table. */
export function ScoringForm({ match, player, entry, tables, tableId, setTableId, run, saved }: {
  match?: S.MatchResponse; player?: S.PlayerResponse; entry?: S.MatchScoringResponse; tables: AdminData['tables']; tableId: number | string; setTableId: (value: string) => void; run: Run; saved: () => void
}) {
  const [counts, setCounts] = useState({ directGoals: entry?.directGoals ?? 0, pepitas: entry?.pepitas ?? 0, horquetas: entry?.horquetas ?? 0 })
  return <Form title={entry ? 'Editar goleo' : 'Registrar goleo'} disabled={!match || !player || !tables.length} submit={async v => {
    const success = await run(() => {
      if (Number(v.directGoals) + Number(v.pepitas) + Number(v.horquetas) === 0) throw new Error('Registra al menos una anotación.')
      const body = scoringPayload(v, tables, entry ? undefined : player!.id)
      return adminMutation(`/matches/${match!.id}/scoring${entry ? `/${player!.id}` : ''}`, entry ? 'PUT' : 'POST', body)
    })
    if (success) saved()
    return success
  }}><Select label="Tabla de goleo" name="scoringTableId" items={tables} value={tableId} onChange={setTableId} />
    {(['directGoals', 'pepitas', 'horquetas'] as const).map(key => <Field key={key} label={({ directGoals: 'Goles directos', pepitas: 'Pepitas', horquetas: 'Horquetas' })[key]} name={key} type="number" min={0} step={1} value={counts[key]} onChange={event => setCounts({ ...counts, [key]: Number(event.target.value) })} />)}
    <p role="status">Total: <strong>{counts.directGoals + 2 * counts.pepitas + 3 * counts.horquetas}</strong></p>
    {entry && <button type="button" onClick={() => setCounts({ directGoals: entry.directGoals, pepitas: entry.pepitas, horquetas: entry.horquetas })}>RESTABLECER</button>}
  </Form>
}
