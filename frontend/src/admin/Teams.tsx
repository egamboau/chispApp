import { useEffect, useState } from 'react'
import * as S from '@jupas/shared'
import type { AdminData } from '../api/admin'
import { adminMutation, adminRequest } from '../api/admin'
import { confirmDiscard, Field, Form, Row, Select, Tabs } from './Forms'
import type { Run } from './Forms'

/** Groups teams by phase membership and keeps one selected team across roster/discipline tasks; server enforces all writes. */
export function Teams({ data: d, run, revision }: { data: AdminData; run: Run; revision: number }) {
  const [teamId, setTeamId] = useState(''), [tab, setTab] = useState('Equipos')
  const [players, setPlayers] = useState<S.PlayerResponse[]>([])
  const [error, setError] = useState('')
  const team = d.teams.find(item => item.id === Number(teamId))
  const p = d.phase, t = d.tournament
  const memberTeams = d.teams.filter(item => d.memberships.some(member => member.teamId === item.id))
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    if (team) void adminRequest(`/teams/${team.id}/players`, S.PlayerListResponseSchema, { signal: controller.signal }).then(items => { if (!controller.signal.aborted) setPlayers(items) }, failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [team?.id, revision])
  const roster = players.filter(player => player.teamId === team?.id)
  /** Changes the active team only after acknowledging drafts that would be discarded. */
  function selectTeam(value: string) { if (confirmDiscard()) setTeamId(value) }
  return <section className="panel task-workspace"><h2>Equipos</h2><p>{t?.name ?? 'Sin torneo'} · {p?.name ?? 'Sin fase'}</p><Tabs labels={['Equipos', 'Jugadores', 'Disciplina']} value={tab} onChange={setTab} />
    <section id="panel-Equipos" role="tabpanel" aria-labelledby="tab-Equipos" hidden={tab !== 'Equipos'}><p>{p ? `Asignando equipos a ${p.name}.` : 'El torneo no tiene fases.'}</p>
    <details className="form-disclosure"><summary>Agregar equipo</summary><Form title="Crear equipo" disabled={!t} submit={v => run(async () => {
      const created = await adminRequest('/teams', S.TeamResponseSchema, { method: 'POST', body: S.CreateTeamInputSchema.parse({ name: v.name, tournamentId: t!.id }) })
      setTeamId(String(created.id))
      if (p && v.groupId) {
        try { await adminMutation(`/phases/${p.id}/memberships`, 'POST', S.MembershipInputSchema.parse({ teamId: created.id, groupId: v.groupId })) }
        catch (failure) { throw new Error(`Equipo creado; no se pudo asignar al grupo. Usa «Asignar equipo existente». ${failure instanceof Error ? failure.message : ''}`, { cause: failure }) }
      }
    })}><Field label="Nombre" name="name" maxLength={100} /><Select label="Grupo opcional" name="groupId" items={d.groups} optional /></Form>
    <Form title="Asignar equipo existente" disabled={!p || !d.groups.length} submit={v => run(() => adminMutation(`/phases/${p!.id}/memberships`, 'POST', S.MembershipInputSchema.parse(v)))}><Select label="Equipo" name="teamId" items={d.teams.filter(item => !memberTeams.includes(item))} /><Select label="Grupo" name="groupId" items={d.groups} /></Form>
    </details>
    {[...d.groups.map(group => ({ id: group.id, name: group.name })), { id: 0, name: 'Sin grupo en esta fase' }].map(group => <section key={group.id} className="team-group"><h3>{group.name}</h3>{d.teams.filter(item => (d.memberships.find(member => member.teamId === item.id)?.groupId ?? 0) === group.id).map(item => <Row key={item.id}><span>{item.name}</span><button aria-pressed={team?.id === item.id} onClick={() => selectTeam(String(item.id))}>Ver {item.name}</button></Row>)}</section>)}
    {team && <section><h3>Detalle · {team.name}</h3><button className="primary" onClick={() => setTab('Jugadores')}>VER NÓMINA</button><Form key={team.id} title={`Editar ${team.name}`} submit={v => run(() => adminMutation(`/teams/${team.id}`, 'PUT', S.UpdateTeamInputSchema.parse(v)))}><Field label="Nombre" name="name" defaultValue={team.name} maxLength={100} /></Form><details><summary>Más · Equipo</summary>
      {memberTeams.includes(team) && <button onClick={() => { if (confirm(`¿Quitar a ${team.name} de esta fase?`)) void run(() => adminMutation(`/phases/${p!.id}/memberships/${team.id}`, 'DELETE')) }}>QUITAR DE FASE</button>}
      <button className="danger" onClick={() => { if (confirm(`¿Eliminar a ${team.name} del torneo?`)) void run(() => adminMutation(`/teams/${team.id}`, 'DELETE')) }}>ELIMINAR EQUIPO</button></details></section>}
    </section>
    <section id="panel-Jugadores" role="tabpanel" aria-labelledby="tab-Jugadores" hidden={tab !== 'Jugadores'}><h3>Nómina de jugadores</h3><Select label="Equipo de la nómina" items={d.teams} value={team?.id ?? ''} onChange={selectTeam} />{error && <p role="alert" className="error">{error}</p>}
    <Form disclosure key={team?.id} title="Agregar jugador" disabled={!team || !!error} submit={v => run(() => adminMutation(`/teams/${team!.id}/players`, 'POST', S.PlayerInputSchema.parse(v)))}><PlayerFields /></Form>
    {roster.map(player => <details key={`${player.id}-${player.number}-${player.name}-${player.status}`} className={player.status === 'UNREGISTERED' ? 'unregistered' : ''}><summary>{player.displayName}</summary><Form title={player.displayName} submit={v => run(() => adminMutation(`/players/${player.id}`, 'PUT', S.PlayerInputSchema.parse(v)))}><PlayerFields player={player} /></Form><button onClick={() => void run(() => adminMutation(`/players/${player.id}/status`, 'PATCH', S.UpdatePlayerStatusInputSchema.parse({ status: player.status === 'REGISTERED' ? 'UNREGISTERED' : 'REGISTERED' })))}>{player.status === 'REGISTERED' ? 'DESINSCRIBIR' : 'REINSCRIBIR'}</button></details>)}
    </section><section id="panel-Disciplina" role="tabpanel" aria-labelledby="tab-Disciplina" hidden={tab !== 'Disciplina'}><h3>Disciplina · {p?.name ?? 'Sin fase'}</h3><Select label="Equipo de disciplina" items={memberTeams} value={memberTeams.some(item => item.id === team?.id) ? team?.id : ''} onChange={selectTeam} />
    <Form key={`sanction-${team?.id}`} title="Sanción de fase" disabled={!team || !memberTeams.includes(team)} submit={v => run(() => adminMutation(`/phases/${p!.id}/teams/${team!.id}/sanction`, 'PUT', S.SanctionInputSchema.parse({ reason: v.reason })))}><Field label="Motivo" name="reason" maxLength={200} /></Form>
    {d.sanctions.filter(item => item.teamId === team?.id).map(item => <Row key={item.teamId}><span>{item.teamName}: {item.reason}</span><button className="danger" onClick={() => void run(() => adminMutation(`/phases/${p!.id}/teams/${item.teamId}/sanction`, 'DELETE'))}>QUITAR SANCIÓN</button></Row>)}
    <Form key={`cards-${team?.id}`} title="Tarjetas fuera de partido" disabled={!team || !memberTeams.includes(team)} submit={v => run(() => adminMutation(`/phases/${p!.id}/teams/${team!.id}/cards`, 'PUT', S.TeamCardsInputSchema.parse({ yellowCards: v.yellowCards, redCards: v.redCards })))}><CardFields /></Form>
    {d.teamCards.filter(item => item.teamId === team?.id).map(item => <section key={`${item.teamId}-${item.yellowCards}-${item.redCards}`}><Form title={`Tarjetas: ${item.teamName}`} submit={v => run(() => adminMutation(`/phases/${p!.id}/teams/${item.teamId}/cards`, 'PUT', S.TeamCardsInputSchema.parse(v)))}><CardFields cards={item} /></Form><button className="danger" onClick={() => void run(() => adminMutation(`/phases/${p!.id}/teams/${item.teamId}/cards`, 'DELETE'))}>ELIMINAR TARJETAS</button></section>)}
  </section></section>
}

/** Keeps jersey numbers as strings so leading zeros survive create/edit. */
function PlayerFields({ player }: { player?: S.PlayerResponse }) {
  return <><Field label="Número" name="number" inputMode="numeric" pattern="[0-9]+" defaultValue={player?.number} /><Field label="Nombre opcional" name="name" maxLength={100} required={false} defaultValue={player?.name ?? ''} /></>
}

/** Captures nonnegative independent phase-card counts; shared schema rejects an empty total. */
function CardFields({ cards }: { cards?: S.TeamCardsResponse }) {
  return <><Field label="Amarillas" name="yellowCards" type="number" min={0} step={1} defaultValue={cards?.yellowCards ?? 0} /><Field label="Rojas" name="redCards" type="number" min={0} step={1} defaultValue={cards?.redCards ?? 0} /></>
}
