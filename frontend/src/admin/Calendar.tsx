import { useEffect, useRef, useState } from 'react'
import * as S from '@jupas/shared'
import type { AdminData } from '../api/admin'
import { adminMutation, adminRequest, loadAdmin } from '../api/admin'
import { confirmDiscard, ErrorNotice, Field, Form, Select } from './Forms'
import type { Run } from './Forms'
import { Positions } from './Tournaments'

const roles = { teamA: 'Local', teamB: 'Visitante', lineTeam: 'Línea' } as const
export type Role = keyof typeof roles

/** Builds all three typed references from visible fields; optional line stays null and incomplete sources fail validation. */
export function participantValues(values: Record<string, string>): S.MatchParticipants {
  const reference = (role: Role): S.MatchParticipant => {
    const kind = values[`${role}-kind`]
    if (kind === 'SLOT') return S.MatchParticipantSchema.parse(JSON.parse(values[`${role}-slot`] ?? 'null'))
    if (kind === 'GROUP_POSITION') return { kind, sourcePhaseId: Number(values[`${role}-phase`]), sourceGroupId: Number(values[`${role}-group`]), position: Number(values[`${role}-position`]) }
    if (kind === 'MATCH_WINNER' || kind === 'MATCH_LOSER') return { kind, sourceMatchId: Number(values[`${role}-match`]) }
    return { kind: 'TEAM', teamId: Number(values[`${role}-team`]) }
  }
  return S.MatchParticipantsSchema.parse({ teamA: reference('teamA'), teamB: reference('teamB'), lineTeam: values['lineTeam-kind'] === 'TEAM' && !values['lineTeam-team'] ? null : reference('lineTeam') })
}

/** Finds valid elimination sources using server phase/category rules; excludes self and every descendant when editing. */
export function winnerSources(data: AdminData, matchId?: number): S.MatchResponse[] {
  const phase = data.phase
  if (!phase) return []
  const phases = data.phases.filter(source => source.type === 'ELIMINATION' && source.tournamentId === phase.tournamentId && source.tournamentType === phase.tournamentType && (source.id === phase.id || source.sortOrder < phase.sortOrder))
  const blocked = new Set(matchId === undefined ? [] : [matchId])
  let changed = true
  while (changed) {
    changed = false
    for (const match of data.matches) {
      if (!blocked.has(match.id) && Object.values(match.participants).some(item => (item?.reference.kind === 'MATCH_WINNER' || item?.reference.kind === 'MATCH_LOSER') && blocked.has(item.reference.sourceMatchId))) {
        blocked.add(match.id); changed = true
      }
    }
  }
  return data.matches.filter(match => !blocked.has(match.id) && match.tournamentType === phase.tournamentType && phases.some(source => source.id === match.phaseId))
}

/** Edits fixed teams, group positions or eligible elimination outcomes; changing assignment clears obsolete fields. */
function Participant({ role, data: d, match, groupId }: { role: Role; data: AdminData; match?: S.MatchResponse; groupId: number }) {
  const original = match?.participants[role]?.reference
  const [kind, setKind] = useState<S.MatchParticipant['kind'] | 'SLOT'>(original?.kind ?? 'TEAM')
  const [keepOriginal, setKeepOriginal] = useState(true)
  const winners = winnerSources(d, match?.id)
  const winnerPhases = d.phases.filter(phase => winners.some(item => item.phaseId === phase.id))
  const [sourceId, setSourceId] = useState(original?.kind === 'GROUP_POSITION' ? original.sourcePhaseId : (original?.kind === 'MATCH_WINNER' || original?.kind === 'MATCH_LOSER') ? winners.find(item => item.id === original.sourceMatchId)?.phaseId : undefined)
  const phases = (kind === 'MATCH_WINNER' || kind === 'MATCH_LOSER') ? winnerPhases : d.sourcePhases
  const selected = phases.find(phase => phase.id === sourceId)?.id ?? phases[0]?.id
  const sources = winners.filter(item => item.phaseId === selected)
  const allowed = d.memberships.filter(item => role === 'lineTeam' || item.groupId === groupId).map(item => item.teamId)
  return <fieldset><legend>{roles[role]}</legend><Select label="Asignación" name={`${role}-kind`} value={kind} onChange={value => { setKind(value as typeof kind); setKeepOriginal(false); setSourceId(undefined) }} items={[{ id: 'TEAM', name: 'Equipo fijo' }, { id: 'GROUP_POSITION', name: 'Posición de grupo/fase' }, ...((d.slots ?? []).length ? [{ id: 'SLOT', name: 'Cupo del grupo' }] : []), { id: 'MATCH_WINNER', name: 'Ganador de partido' }, { id: 'MATCH_LOSER', name: 'Perdedor de partido' }]} />
    {kind === 'SLOT' && <Select label="Cupo" name={`${role}-slot`} items={(d.slots ?? []).filter(slot => role === 'lineTeam' || slot.groupId === groupId).map(slot => ({ id: JSON.stringify(slot.reference), name: slot.label }))} />}
    {kind === 'TEAM' && <Select label="Equipo" optional={role === 'lineTeam'} name={`${role}-team`} value={keepOriginal && original?.kind === 'TEAM' ? original.teamId : ''} items={d.teams.filter(item => role === 'lineTeam' || allowed.includes(item.id))} />}
    {(kind === 'GROUP_POSITION' || kind === 'MATCH_WINNER' || kind === 'MATCH_LOSER') && <Select label="Fase origen" name={`${role}-phase`} value={selected ?? ''} onChange={value => { setSourceId(Number(value)); setKeepOriginal(false) }} items={phases} />}
    {kind === 'GROUP_POSITION' && <><Select key={`${kind}-${selected}`} label="Grupo origen" name={`${role}-group`} value={keepOriginal && original?.kind === 'GROUP_POSITION' && original.sourcePhaseId === selected ? original.sourceGroupId : ''} items={d.sourceGroups[selected!] ?? []} /><Field label="Posición" name={`${role}-position`} type="number" min={1} step={1} defaultValue={keepOriginal && original?.kind === 'GROUP_POSITION' ? original.position : 1} /></>}
    {(kind === 'MATCH_WINNER' || kind === 'MATCH_LOSER') && <><Select key={`${kind}-${selected}`} label="Partido origen" name={`${role}-match`} value={keepOriginal && (original?.kind === 'MATCH_WINNER' || original?.kind === 'MATCH_LOSER') && sources.some(source => source.id === original.sourceMatchId) ? original.sourceMatchId : ''} items={sources.map(source => ({ id: source.id, name: `${kind === 'MATCH_LOSER' ? 'Perdedor' : 'Ganador'} de ${S.matchDisplayLabel(source)} · ${source.teamA} contra ${source.teamB}` }))} />{!sources.length && <p role="status">No hay partidos eliminatorios de origen elegibles.</p>}</>}
  </fieldset>
}

/** Schedules or edits references in one column; successful saves return to the list, cancellation warns on drafts. */
export function MatchForm({ data: d, match, run, cancel }: { data: AdminData; match?: S.MatchResponse; run: Run; cancel: () => void }) {
  const [groupId, setGroupId] = useState(match?.groupId ?? d.groups[0]?.id)
  const confirmed = match && Object.values(match.participants).some(item => item?.reference.kind !== 'TEAM' && item?.status === 'CONFIRMED')
  return <><Form title={match ? 'Editar partido' : 'Programar partido'} disabled={!d.phase || !d.groups.length} submit={v => {
    if (confirmed && !confirm('¿Guardar cambios con asignaciones confirmadas? Revisa y confirma otra vez la fase origen.')) return Promise.resolve(false)
    return run(async () => {
    const body = S.ParticipantMatchInputSchema.parse({ label: v.label, phaseId: d.phase!.id, groupId: v.groupId, date: v.date, jornada: v.jornada, court: v.court, sortOrder: v.sortOrder, participants: participantValues(v) })
    await adminMutation(`/matches${match ? `/${match.id}` : ''}`, match ? 'PUT' : 'POST', body)
    cancel()
  })
  }}><h4 className="form-section">Programación</h4><Field label="Etiqueta del partido (opcional)" name="label" maxLength={80} required={false} defaultValue={match?.label ?? ''} /><Select label="Grupo" name="groupId" items={d.groups} value={groupId ?? ''} onChange={value => setGroupId(Number(value))} />
    <Field label="Fecha" name="date" type="date" defaultValue={match?.date} /><Select label="Jornada" name="jornada" value={match?.jornada ?? 'MORNING'} items={[{ id: 'MORNING', name: 'Mañana' }, { id: 'AFTERNOON', name: 'Tarde' }]} /><Field label="Cancha" name="court" type="number" min={1} step={1} defaultValue={match?.court ?? 1} /><Field label="Orden oficial opcional" name="sortOrder" type="number" min={1} step={1} required={false} defaultValue={match?.sortOrder ?? ''} />
    <h4 className="form-section">Participantes</h4><div className="participant-fields">{(Object.keys(roles) as Role[]).map(role => <Participant key={`${role}-${role === 'lineTeam' ? '' : groupId}`} role={role} data={d} match={match} groupId={groupId!} />)}</div>{confirmed && <p>Asignaciones confirmadas: cambiar referencias requiere revisar y confirmar otra vez fase origen.</p>}
    <button type="button" onClick={() => { if (confirmDiscard()) cancel() }}>VOLVER AL CALENDARIO</button>
  </Form></>
}

/** Loads the owning phase before editing, independently of the tournament-wide match list. */
export function MatchEditor({ data: d, match, run, cancel }: { data: AdminData; match?: S.MatchResponse; run: Run; cancel: () => void }) {
  const [phaseId, setPhaseId] = useState(match?.phaseId ?? d.phase?.id)
  const [result, setResult] = useState<{ phaseId: number | undefined; data: AdminData }>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    void loadAdmin('calendar', { tournamentId: d.tournament?.id, phaseId }, controller.signal).then(data => {
      if (match && data.phase?.id !== match.phaseId) throw new Error('La fase del partido ya no está disponible.')
      if (!controller.signal.aborted) setResult({ phaseId, data })
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [d.tournament?.id, phaseId, retry, match])
  const data = result && result.phaseId === phaseId ? result.data : undefined
  return <>
    <fieldset disabled={!!match}><Select label="Fase del partido" items={d.phases.map(phase => ({ ...phase, name: `${phase.tournamentType === 'FEMALE' ? 'Femenino' : 'Masculino'} · ${phase.name}` }))} value={phaseId ?? ''} onChange={value => { if (confirmDiscard()) setPhaseId(Number(value)) }} /></fieldset>
    {error ? <ErrorNotice message={error}><button onClick={() => setRetry(value => value + 1)}>REINTENTAR</button></ErrorNotice> : data ? <MatchForm key={data.phase?.id} data={data} match={match} run={run} cancel={cancel} /> : <p role="status">Cargando fase del partido…</p>}
    {(!data || error) && <button onClick={cancel}>VOLVER AL CALENDARIO</button>}
  </>
}

/** Renders lifecycle controls permitted by match state; every mutation still passes server transition validation. */
export function AdminMatch({ match: m, run, edit }: { match: S.MatchResponse; run: Run; edit: () => void }) {
  const path = `/matches/${m.id}`
  const action = (name: string, question?: string) => { if (!question || confirm(question)) void run(() => adminMutation(`${path}/${name}`, 'POST')) }
  return <article className={`match-card ${m.tournamentType.toLowerCase()}`}><div className="meta"><span className="badge">{m.tournamentType === 'FEMALE' ? 'Femenino' : 'Masculino'}</span><strong>{m.phaseName} · {m.groupName} · Cancha {m.court}</strong><span>{m.date} · {m.jornada === 'MORNING' ? 'Mañana' : 'Tarde'} · Orden {m.sortOrder ?? 'sin definir'}</span><span>{({ SCHEDULED: 'Programado', LIVE: 'En juego', FINISHED: 'Final' })[m.status]}</span></div>{m.label && <h4>{m.label}</h4>}<h3>{m.teamA} {m.scoreA}–{m.scoreB} {m.teamB}</h3><p>Línea: {m.lineTeam ?? (m.participants.lineTeam ? 'Por resolver' : 'Sin asignar')}</p>{m.status !== 'SCHEDULED' && <p>Partido iniciado o terminado: las asignaciones de participantes están bloqueadas.</p>}
    {m.status === 'LIVE' && <div className="score-controls">{(['A', 'B'] as const).map(side => <div key={side}><strong>{m[`team${side}`]}</strong><span><button aria-label={`Restar gol ${m[`team${side}`]}`} disabled={m[`score${side}`] === 0} onClick={() => void run(() => adminMutation(`${path}/score`, 'PATCH', S.ScoreSchema.parse({ team: side, delta: -1 })))}>−</button><b>{m[`score${side}`]}</b><button aria-label={`Sumar gol ${m[`team${side}`]}`} onClick={() => void run(() => adminMutation(`${path}/score`, 'PATCH', S.ScoreSchema.parse({ team: side, delta: 1 })))}>+</button></span></div>)}</div>}
    {m.status === 'FINISHED' && <Form key={`result-${m.scoreA}-${m.scoreB}`} title="Corregir resultado" submit={v => confirm('¿Guardar la corrección del resultado final?') ? run(() => adminMutation(`${path}/result`, 'PATCH', S.ResultSchema.parse(v))) : Promise.resolve(false)}>{(['A', 'B'] as const).map(side => <Field key={side} label={m[`team${side}`]} name={`score${side}`} type="number" min={0} step={1} defaultValue={m[`score${side}`]} />)}</Form>}
    <details><summary>Más · Etiqueta, tarjetas y orden</summary><Form key={`label-${m.label}`} title="Etiqueta del partido" submit={v => run(() => adminMutation(`${path}/label`, 'PATCH', { label: S.MatchLabelSchema.parse(v.label) }))}><Field label="Etiqueta (opcional)" name="label" maxLength={80} required={false} defaultValue={m.label ?? ''} /></Form><Form key={`cards-${m.yellowCardsA}-${m.redCardsA}-${m.yellowCardsB}-${m.redCardsB}`} title="Tarjetas del partido" submit={v => run(() => adminMutation(`${path}/cards`, 'PATCH', S.CardsSchema.parse(v)))}>{(['yellowCardsA', 'redCardsA', 'yellowCardsB', 'redCardsB'] as const).map(key => <Field key={key} label={`${key.endsWith('A') ? m.teamA : m.teamB} ${key.startsWith('yellow') ? '🟨' : '🟥'}`} name={key} type="number" min={0} step={1} defaultValue={m[key]} />)}</Form>
    <Form key={`order-${m.sortOrder}`} title="Orden oficial" submit={v => run(() => adminMutation(`${path}/order`, 'PATCH', S.UpdateSortOrderSchema.parse({ sortOrder: v.sortOrder || null })))}><Field label="Orden (vacío para quitar)" name="sortOrder" type="number" min={1} step={1} defaultValue={m.sortOrder ?? ''} required={false} /></Form>
    </details><div className="actions">{m.status === 'SCHEDULED' && <><button onClick={edit}>EDITAR</button><button className="danger" onClick={() => { if (confirm(`¿Eliminar ${m.teamA} vs ${m.teamB}?`)) void run(() => adminMutation(path, 'DELETE')) }}>ELIMINAR</button><button className="primary" onClick={() => action('start')}>INICIAR</button></>}
      {m.status === 'LIVE' && <><button className="danger" onClick={() => action('reset', '¿Reiniciar marcador a 0–0?')}>REINICIAR MARCADOR</button><button className="finish" onClick={() => action('finish')}>FINALIZAR PARTIDO</button></>}
      {m.status === 'FINISHED' && <><button onClick={() => action('reopen', '¿Reabrir partido conservando marcador?')}>REABRIR PARTIDO</button><a className="primary" href={`/admin/scoring.html?matchId=${m.id}`}>ADMINISTRAR GOLEO</a></>}
    </div></article>
}

/** Combines calendar filters without changing the server's official match order. */
export function adminCalendarMatches(matches: readonly S.MatchResponse[], date: string, court: string, status: string): S.MatchResponse[] {
  return matches.filter(item => (!date || item.date === date) && (!court || item.court === Number(court)) && (!status || item.status === status))
}

/** Maintains calendar filters and edit drafts across live refreshes; date visibility and previews remain server-owned. */
export function Calendar({ data: d, run }: { data: AdminData; run: Run }) {
  const [editing, setEditing] = useState<S.MatchResponse>(), [creating, setCreating] = useState(false)
  const listScroll = useRef(0)
  /** Opens the shared editor while retaining the mounted list, filters and prior page position. */
  function openEditor(match?: S.MatchResponse) { listScroll.current = window.scrollY; setEditing(match); setCreating(!match); window.scrollTo(0, 0) }
  /** Returns after save/cancel and restores the prior list position after React renders it. */
  function returnToList() { setEditing(undefined); setCreating(false); requestAnimationFrame(() => window.scrollTo(0, listScroll.current)) }
  const showEditor = creating || !!editing
  const [date, setDate] = useState(''), [court, setCourt] = useState(''), [status, setStatus] = useState('')
  const [sourceId, setSourceId] = useState('')
  const positionPhases = d.phases.filter(item => item.type === 'TABLE')
  const source = positionPhases.find(item => item.id === Number(sourceId)) ?? positionPhases[0]
  const [preview, setPreview] = useState<S.PhasePositionsResponse>()
  const [positionGroups, setPositionGroups] = useState<S.GroupResponse[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController(); setPreview(undefined); setError('')
    if (source) void Promise.all([adminRequest(`/phases/${source.id}/positions`, S.PhasePositionsResponseSchema, { signal: controller.signal }), adminRequest(`/phases/${source.id}/groups`, S.GroupListResponseSchema, { signal: controller.signal })]).then(([item, groups]) => { if (!controller.signal.aborted) { setPreview(item); setPositionGroups(groups) } }, failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [source?.id, d.matches])
  const dateMatches = d.matches.filter(item => item.date === date)
  const visible = dateMatches.some(item => item.lineVisible)
  const filtered = adminCalendarMatches(d.matches, date, court, status)
  return <section className="task-workspace"><h2>Calendario</h2>
    {showEditor && <section className="panel calendar-editor"><MatchEditor key={editing?.id ?? 'new'} data={d} match={editing} run={run} cancel={returnToList} /></section>}
    <section hidden={showEditor}>
      <div className="panel list-heading"><h3>Partidos · {d.tournament?.name ?? 'Sin torneo'}</h3><button className="primary" disabled={!d.phases.length} onClick={() => openEditor()}>+ Partido</button></div>
      <div className="panel filters"><label>Fecha<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><label>Cancha<input type="number" min={1} value={court} onChange={event => setCourt(event.target.value)} /></label><label>Estado<select aria-label="Estado" value={status} onChange={event => setStatus(event.target.value)}><option value="">Todos</option><option value="SCHEDULED">Programados</option><option value="LIVE">En juego</option><option value="FINISHED">Finalizados</option></select></label><button disabled={!dateMatches.length} onClick={() => void run(() => adminMutation(`/line-visibility/${date}`, 'PUT', S.LineVisibilitySchema.parse({ visible: !visible })))}>{visible ? 'OCULTAR LÍNEAS' : 'PUBLICAR LÍNEAS'}</button></div>
      <div id="matches">{filtered.map(item => <AdminMatch key={item.id} match={item} run={run} edit={() => openEditor(item)} />)}{!filtered.length && <p className="empty">No hay partidos para este torneo y filtros.</p>}</div>
      <details className="panel"><summary>Más · Posiciones de fases anteriores</summary><Select label="Fase origen para posiciones" items={positionPhases.map(phase => ({ ...phase, name: `${phase.tournamentType === 'FEMALE' ? 'Femenino' : 'Masculino'} · ${phase.name}` }))} value={source?.id ?? ''} onChange={setSourceId} />{error && <p role="alert" className="error">{error}</p>}{preview && <Positions preview={preview} groups={positionGroups} run={run} />}</details>
    </section>
  </section>
}
