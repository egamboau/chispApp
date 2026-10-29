import { useEffect, useState } from 'react'
import * as S from '@jupas/shared'
import type { AdminData } from '../api/admin'
import { adminMutation, adminRequest } from '../api/admin'
import { Field, Form, Row, Select } from './Forms'
import type { Run } from './Forms'

/** Manages tournament teams and phase membership, sanctions and independent cards; server enforces constraints. */
export function Teams({ data: d, run, revision }: { data: AdminData; run: Run; revision: number }) {
  const [teamId, setTeamId] = useState('')
  const [players, setPlayers] = useState<S.PlayerResponse[]>([])
  const [error, setError] = useState('')
  const team = d.teams.find(item => item.id === Number(teamId)) ?? d.teams[0]
  const p = d.phase, t = d.tournament
  const memberTeams = d.teams.filter(item => d.memberships.some(member => member.teamId === item.id))
  useEffect(() => {
    const controller = new AbortController()
    setPlayers([]); setError('')
    if (team) void adminRequest(`/teams/${team.id}/players`, S.PlayerListResponseSchema, { signal: controller.signal }).then(items => { if (!controller.signal.aborted) setPlayers(items) }, failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [team?.id, revision])
  return <><section className="panel"><h2>Inscribir equipos</h2><p>{p ? `Asignando equipos a ${p.name}.` : 'El torneo no tiene fases.'}</p>
    <Form disclosure title="Crear equipo" disabled={!t} submit={v => run(async () => {
      const created = await adminRequest('/teams', S.TeamResponseSchema, { method: 'POST', body: S.CreateTeamInputSchema.parse({ name: v.name, tournamentId: t!.id }) })
      if (p && v.groupId) {
        try { await adminMutation(`/phases/${p.id}/memberships`, 'POST', S.MembershipInputSchema.parse({ teamId: created.id, groupId: v.groupId })) }
        catch (failure) { throw new Error(`Equipo creado; no se pudo asignar al grupo. Usa «Asignar equipo existente». ${failure instanceof Error ? failure.message : ''}`, { cause: failure }) }
      }
    })}><Field label="Nombre" name="name" maxLength={100} /><Select label="Grupo opcional" name="groupId" items={d.groups} optional /></Form>
    <Form disclosure title="Asignar equipo existente" disabled={!p || !d.groups.length} submit={v => run(() => adminMutation(`/phases/${p!.id}/memberships`, 'POST', S.MembershipInputSchema.parse(v)))}><Select label="Equipo" name="teamId" items={d.teams.filter(item => !memberTeams.includes(item))} /><Select label="Grupo" name="groupId" items={d.groups} /></Form>
    {d.teams.map(item => <section key={item.id}><Form title={`Editar ${item.name}`} submit={v => run(() => adminMutation(`/teams/${item.id}`, 'PUT', S.UpdateTeamInputSchema.parse(v)))}><Field label="Nombre" name="name" defaultValue={item.name} maxLength={100} /></Form><Row><span>{d.memberships.find(member => member.teamId === item.id)?.groupName ?? 'Sin grupo en esta fase'}</span>
      {memberTeams.includes(item) && <button onClick={() => { if (confirm(`¿Quitar a ${item.name} de esta fase?`)) void run(() => adminMutation(`/phases/${p!.id}/memberships/${item.id}`, 'DELETE')) }}>QUITAR DE FASE</button>}
      <button className="danger" onClick={() => { if (confirm(`¿Eliminar a ${item.name} del torneo?`)) void run(() => adminMutation(`/teams/${item.id}`, 'DELETE')) }}>ELIMINAR</button></Row></section>)}
  </section><section className="panel"><h2>Nómina de jugadores</h2><Select label="Equipo" items={d.teams} value={team?.id ?? ''} onChange={setTeamId} />{error && <p role="alert" className="error">{error}</p>}
    <Form key={team?.id} title="Agregar jugador" disabled={!team || !!error} submit={v => run(() => adminMutation(`/teams/${team!.id}/players`, 'POST', S.PlayerInputSchema.parse(v)))}><PlayerFields /></Form>
    {players.map(player => <section key={`${player.id}-${revision}`} className={player.status === 'UNREGISTERED' ? 'unregistered' : ''}><Form title={player.displayName} submit={v => run(() => adminMutation(`/players/${player.id}`, 'PUT', S.PlayerInputSchema.parse(v)))}><PlayerFields player={player} /></Form><button onClick={() => void run(() => adminMutation(`/players/${player.id}/status`, 'PATCH', S.UpdatePlayerStatusInputSchema.parse({ status: player.status === 'REGISTERED' ? 'UNREGISTERED' : 'REGISTERED' })))}>{player.status === 'REGISTERED' ? 'DESINSCRIBIR' : 'REINSCRIBIR'}</button></section>)}
    <Form title="Sanción de fase" disabled={!memberTeams.length} submit={v => run(() => adminMutation(`/phases/${p!.id}/teams/${v.teamId}/sanction`, 'PUT', S.SanctionInputSchema.parse({ reason: v.reason })))}><Select label="Equipo" name="teamId" items={memberTeams} /><Field label="Motivo" name="reason" maxLength={200} /></Form>
    {d.sanctions.map(item => <Row key={item.teamId}><span>{item.teamName}: {item.reason}</span><button className="danger" onClick={() => void run(() => adminMutation(`/phases/${p!.id}/teams/${item.teamId}/sanction`, 'DELETE'))}>QUITAR SANCIÓN</button></Row>)}
    <Form title="Tarjetas fuera de partido" disabled={!memberTeams.length} submit={v => run(() => adminMutation(`/phases/${p!.id}/teams/${v.teamId}/cards`, 'PUT', S.TeamCardsInputSchema.parse({ yellowCards: v.yellowCards, redCards: v.redCards })))}><Select label="Equipo" name="teamId" items={memberTeams} /><CardFields /></Form>
    {d.teamCards.map(item => <section key={`${item.teamId}-${revision}`}><Form title={`Tarjetas: ${item.teamName}`} submit={v => run(() => adminMutation(`/phases/${p!.id}/teams/${item.teamId}/cards`, 'PUT', S.TeamCardsInputSchema.parse(v)))}><CardFields cards={item} /></Form><button className="danger" onClick={() => void run(() => adminMutation(`/phases/${p!.id}/teams/${item.teamId}/cards`, 'DELETE'))}>ELIMINAR TARJETAS</button></section>)}
  </section></>
}

/** Keeps jersey numbers as strings so leading zeros survive create/edit. */
function PlayerFields({ player }: { player?: S.PlayerResponse }) {
  return <><Field label="Número" name="number" inputMode="numeric" pattern="[0-9]+" defaultValue={player?.number} /><Field label="Nombre opcional" name="name" maxLength={100} required={false} defaultValue={player?.name ?? ''} /></>
}

/** Captures nonnegative independent phase-card counts; shared schema rejects an empty total. */
function CardFields({ cards }: { cards?: S.TeamCardsResponse }) {
  return <><Field label="Amarillas" name="yellowCards" type="number" min={0} step={1} defaultValue={cards?.yellowCards ?? 0} /><Field label="Rojas" name="redCards" type="number" min={0} step={1} defaultValue={cards?.redCards ?? 0} /></>
}
