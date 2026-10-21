import { useEffect, useState } from 'react'
import * as S from '@jupas/shared'
import type { AdminData } from '../api/admin'
import { adminMutation, adminRequest } from '../api/admin'
import { Field, Form, Row, Select } from './Forms'
import type { Run } from './Forms'

/** Loads one finished match's rosters and scoring together; stale selections are aborted before state updates. */
export function Scoring({ data: d, run, revision }: { data: AdminData; run: Run; revision: number }) {
  const [matchId, setMatchId] = useState(new URLSearchParams(location.search).get('matchId') ?? '')
  const match = d.matches.find(item => item.id === Number(matchId)) ?? d.matches[0]
  const [details, setDetails] = useState<{ players: S.PlayerResponse[]; scoring: S.MatchScoringListResponse }>()
  const [error, setError] = useState('')
  const [playerId, setPlayerId] = useState('')
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
  const available = details?.players.filter(item => item.status === 'REGISTERED' || details.scoring.some(row => row.playerId === item.id)) ?? []
  const player = available.find(item => item.id === Number(playerId)) ?? available[0]
  const entry = details?.scoring.find(item => item.playerId === player?.id)
  return <><section className="panel"><h2>Informe de goleo</h2>
    <Form title="Crear tabla de goleo" disabled={!d.phase} submit={v => run(() => adminMutation(`/phases/${d.phase!.id}/scoring-tables`, 'POST', S.ScoringTableInputSchema.parse(v)))}><Field label="Nombre" name="name" maxLength={100} /></Form>
    {d.tables.map(table => <Form key={`${table.id}-${revision}`} title={`Renombrar ${table.name}`} submit={v => run(() => adminMutation(`/phases/${d.phase!.id}/scoring-tables/${table.id}`, 'PUT', S.ScoringTableInputSchema.parse(v)))}><Field label="Nombre" name="name" maxLength={100} defaultValue={table.name} /></Form>)}
    <Select label="Partido finalizado" value={match?.id ?? ''} onChange={setMatchId} items={d.matches.map(item => ({ id: item.id, name: `${item.date} · ${item.jornada === 'MORNING' ? 'Mañana' : 'Tarde'} · Cancha ${item.court} · ${item.teamA} ${item.scoreA}–${item.scoreB} ${item.teamB}` }))} />
    {match ? <h3>{match.teamA} {match.scoreA}–{match.scoreB} {match.teamB}</h3> : <p>No hay partidos finalizados en esta fase.</p>}{error && <p className="error" role="alert">{error}</p>}
  </section><section className="panel"><h2>Goleadores</h2>
    <Select label="Jugador y equipo" value={player?.id ?? ''} onChange={setPlayerId} items={available.map(item => ({ id: item.id, name: `${item.teamId === match?.teamAId ? match.teamA : match?.teamB} · #${item.number} · ${item.name ?? 'Sin nombre'}` }))} />
    <ScoringForm key={`${match?.id}-${player?.id}-${revision}`} match={match} player={player} entry={entry} tables={d.tables} run={run} />
    {details?.scoring.map(item => <Row key={item.playerId} className={details.players.find(player => player.id === item.playerId)?.status === 'UNREGISTERED' ? 'unregistered' : undefined}><span><strong>{item.teamId === match?.teamAId ? match.teamA : match?.teamB} · #{item.playerNumber} {details.players.find(player => player.id === item.playerId)?.name ?? 'Sin nombre'}</strong><small>Tabla: {item.scoringTable} · Directos: {item.directGoals} · Pepitas: {item.pepitas} · Horquetas: {item.horquetas}{item.pepitas > 0 && item.horquetas > 0 ? ' · Pepita + horqueta' : ''} · Total: {item.total}</small></span><button onClick={() => setPlayerId(String(item.playerId))}>EDITAR</button><button className="danger" onClick={() => { if (confirm(`¿Eliminar goleo del jugador #${item.playerNumber}?`)) void run(() => adminMutation(`/matches/${match!.id}/scoring/${item.playerId}`, 'DELETE')) }}>ELIMINAR</button></Row>)}
  </section></>
}

/** Validates positive scoring counts with shared schemas and table IDs; previews the established weighted total. */
function ScoringForm({ match, player, entry, tables, run }: { match?: S.MatchResponse; player?: S.PlayerResponse; entry?: S.MatchScoringResponse; tables: AdminData['tables']; run: Run }) {
  const [counts, setCounts] = useState({ directGoals: entry?.directGoals ?? 0, pepitas: entry?.pepitas ?? 0, horquetas: entry?.horquetas ?? 0 })
  return <Form title={entry ? 'Editar goleo' : 'Registrar goleo'} disabled={!match || !player || !tables.length} submit={v => run(() => {
    if (Number(v.directGoals) + Number(v.pepitas) + Number(v.horquetas) === 0) throw new Error('Registra al menos una anotación.')
    const body = entry ? S.ScoringSchema.parse(v) : S.NewScoringSchema.parse({ ...v, playerId: player!.id })
    return adminMutation(`/matches/${match!.id}/scoring${entry ? `/${player!.id}` : ''}`, entry ? 'PUT' : 'POST', body)
  })}><Select label="Tabla de goleo" name="scoringTableId" items={tables} value={tables.find(item => item.name === entry?.scoringTable)?.id ?? tables[0]?.id ?? ''} />
    {(['directGoals', 'pepitas', 'horquetas'] as const).map(key => <Field key={key} label={({ directGoals: 'Goles directos', pepitas: 'Pepitas', horquetas: 'Horquetas' })[key]} name={key} type="number" min={0} step={1} value={counts[key]} onChange={event => setCounts({ ...counts, [key]: Number(event.target.value) })} />)}
    <p>Total: <strong>{counts.directGoals + 2 * counts.pepitas + 3 * counts.horquetas}</strong></p>
    {entry && <button type="button" onClick={() => setCounts({ directGoals: entry.directGoals, pepitas: entry.pepitas, horquetas: entry.horquetas })}>RESTABLECER</button>}
  </Form>
}
