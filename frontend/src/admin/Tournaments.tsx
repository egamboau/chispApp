import * as S from '@jupas/shared'
import type { AdminData } from '../api/admin'
import { adminMutation } from '../api/admin'
import { Field, Form, Row, Select } from './Forms'
import type { Run } from './Forms'

export const tournamentSections = ['General', 'Fases', 'Grupos', 'Clasificación'] as const

/** Native disclosure keeps the less frequent tournament tasks under one navigation item. */
export function TournamentMenu({ current, query, onSelect }: { current?: string; query: string; onSelect: (section: string) => void }) {
  return <details className="tournament-menu"><summary className={current ? 'active' : undefined}>Torneos</summary><div className="tournament-submenu">{tournamentSections.map(section => <a key={section} href={`/admin/?${query}${query ? '&' : ''}section=${encodeURIComponent(section)}`} aria-current={current === section ? 'page' : undefined} className={current === section ? 'active' : undefined} onClick={event => {
    if (current) { event.preventDefault(); onSelect(section) }
    event.currentTarget.closest('details')?.removeAttribute('open')
  }}>{section}</a>)}</div></details>
}

/** Shows authoritative assignment previews and requires confirmation before freezing or reopening positions. */
export function Positions({ preview, groups, run }: { preview: S.PhasePositionsResponse; groups: S.GroupResponse[]; run: Run }) {
  return <section><h3>Cierre y asignación de posiciones</h3><p>{preview.confirmedAt ? `Confirmado: ${preview.confirmedAt}` : 'Posiciones sin confirmar.'} Las correcciones no cambian automáticamente los equipos asignados.</p>
    {preview.errors.map((error, index) => <p className="error" key={index}>{error}</p>)}
    {preview.assignments.map(item => <Row key={`${item.matchId}-${item.role}`}><span>Partido {item.matchId} · {({ teamA: 'Local', teamB: 'Visitante', lineTeam: 'Línea' })[item.role]} · {item.position}.º {groups.find(group => group.id === item.sourceGroupId)?.name} → {item.teamName ?? 'Sin resolver'}{item.resolvedTeamId !== null && item.resolvedTeamId !== item.teamId ? ' (cambiaría el equipo asignado)' : ''}</span></Row>)}
    <button disabled={!preview.canConfirm} onClick={() => { if (confirm('¿Confirmar la clasificación y congelar los equipos previsualizados?')) void run(() => adminMutation(`/phases/${preview.phaseId}/positions/confirm`, 'POST')) }}>CONFIRMAR Y CONGELAR</button>
    {preview.confirmedAt && <button onClick={() => { if (confirm('¿Reabrir asignaciones? Los equipos se conservan; los partidos pendientes no podrán iniciar hasta reconfirmar. Los iniciados o terminados no pueden cambiar de equipo.')) void run(() => adminMutation(`/phases/${preview.phaseId}/positions/reopen`, 'POST')) }}>REABRIR ASIGNACIONES</button>}
  </section>
}

/** Keeps tournament tasks in mounted panels so tab changes preserve drafts and selected context. */
export function Tournaments({ data: d, run, tab, setTab, selectTournament, selectPhase }: { data: AdminData; run: Run; tab: string; setTab: (tab: string) => void; selectTournament: (id: number) => void; selectPhase: (id: number) => void }) {
  const t = d.tournament, p = d.phase
  return <section className="panel task-workspace"><h2>Torneos · {tab}</h2><p hidden={tab === 'General'}>{t?.name ?? 'Sin torneo'}{p ? ` → ${p.name}` : ''} <button onClick={() => setTab('General')}>Cambiar torneo</button></p>
    <section id="panel-General" aria-label="General" hidden={tab !== 'General'}>
      <Form disclosure title="Nuevo torneo" save="CREAR TORNEO" submit={v => run(() => adminMutation('/tournaments', 'POST', S.CreateTournamentInputSchema.parse(v)))}><Field label="Nombre" name="name" maxLength={100} /></Form>
      {d.tournaments.map(tournament => <Row key={tournament.id}><span>{tournament.name} · {tournament.active ? 'Activo' : 'Inactivo'}</span><button aria-pressed={tournament.id === t?.id} onClick={() => selectTournament(tournament.id)}>Editar {tournament.name}</button></Row>)}
      {t ? <><Form key={`${t.id}-${t.currentMalePhaseId}-${t.currentFemalePhaseId}`} title={`Editar torneo ${t.name}`} submit={v => run(() => adminMutation(`/tournaments/${t.id}`, 'PUT', S.UpdateTournamentInputSchema.parse({ ...v, currentMalePhaseId: t.currentMalePhaseId, currentFemalePhaseId: t.currentFemalePhaseId, active: v.active === 'true' })))}>
        <Field label="Nombre" name="name" defaultValue={t.name} maxLength={100} /><Select label="Estado" name="active" value={String(t.active)} items={[{ id: 'true', name: 'Activo' }, { id: 'false', name: 'Inactivo' }]} />
      </Form><details><summary>Más · Torneo</summary><button className="danger" onClick={() => { if (confirm('¿Eliminar este torneo?')) void run(() => adminMutation(`/tournaments/${t.id}`, 'DELETE')) }}>ELIMINAR TORNEO</button></details></> : <p>Crea un torneo para comenzar.</p>}
    </section>
    <section id="panel-Fases" aria-label="Fases" hidden={tab !== 'Fases'}>
      {t && <Form key={`${t.id}-${t.currentMalePhaseId}-${t.currentFemalePhaseId}`} title="Fases vigentes por categoría" submit={v => run(() => adminMutation(`/tournaments/${t.id}`, 'PUT', S.UpdateTournamentInputSchema.parse({ name: t.name, active: t.active, currentMalePhaseId: v.currentMalePhaseId ? Number(v.currentMalePhaseId) : null, currentFemalePhaseId: v.currentFemalePhaseId ? Number(v.currentFemalePhaseId) : null })))}>
        <Select optional label="Fase vigente masculina" name="currentMalePhaseId" value={t.currentMalePhaseId ?? ''} items={d.phases.filter(phase => phase.tournamentType === 'MALE')} />
        <Select optional label="Fase vigente femenina" name="currentFemalePhaseId" value={t.currentFemalePhaseId ?? ''} items={d.phases.filter(phase => phase.tournamentType === 'FEMALE')} />
      </Form>}
      <Form disclosure title="Nueva fase" save="CREAR FASE" disabled={!t} submit={v => run(() => adminMutation(`/tournaments/${t!.id}/phases`, 'POST', S.CreatePhaseInputSchema.parse(v)))}><PhaseFields order={d.phases.length + 1} /></Form>
      {p && <><Form key={p.id} title="Editar fase" submit={v => run(() => adminMutation(`/phases/${p.id}`, 'PUT', S.UpdatePhaseInputSchema.parse(v)))}><Select label="Fase a editar" items={d.phases.map(phase => ({ ...phase, name: `${phase.tournamentType === 'FEMALE' ? 'Femenino' : 'Masculino'} · ${phase.name}` }))} value={p.id} onChange={value => selectPhase(Number(value))} /><PhaseFields phase={p} order={p.sortOrder} /></Form><details><summary>Más · Fase</summary><button className="danger" onClick={() => { if (confirm('¿Eliminar esta fase?')) void run(() => adminMutation(`/phases/${p.id}`, 'DELETE')) }}>ELIMINAR FASE</button></details></>}
    </section>
    <section id="panel-Grupos" aria-label="Grupos" hidden={tab !== 'Grupos'}>
      <Form disclosure title="Añadir grupo" disabled={!p} submit={v => run(() => adminMutation(`/phases/${p!.id}/groups`, 'POST', S.CreateGroupSchema.parse(v)))}><Field label="Nombre" name="name" maxLength={100} /></Form>
      {!d.groups.length && <p>No hay grupos en esta fase.</p>}
      {d.groups.map(group => <details key={group.id}><summary>{group.name} · Administrar</summary><Form title={`Editar grupo ${group.name}`} submit={v => run(() => adminMutation(`/groups/${group.id}`, 'PUT', S.CreateGroupSchema.parse(v)))}><Field label="Nombre" name="name" defaultValue={group.name} /></Form><button className="danger" onClick={() => { if (confirm('¿Eliminar este grupo?')) void run(() => adminMutation(`/groups/${group.id}`, 'DELETE')) }}>ELIMINAR GRUPO</button></details>)}
    </section>
    <section id="panel-Clasificación" aria-label="Clasificación" hidden={tab !== 'Clasificación'}>
      {p?.type === 'TABLE' ? <><RuleForm run={run} phaseId={p.id} />{d.rules.map(rule => <details key={rule.id}><summary>{rule.label} · Posiciones {rule.positions.join(', ')}</summary><RuleForm run={run} phaseId={p.id} rule={rule} /><button className="danger" onClick={() => { if (confirm('¿Eliminar esta regla?')) void run(() => adminMutation(`/phases/${p.id}/classification-rules/${rule.id}`, 'DELETE')) }}>ELIMINAR REGLA</button></details>)}{d.positions && <Positions preview={d.positions} groups={d.groups} run={run} />}</> : <p>Selecciona una fase de tabla para administrar clasificación.</p>}
    </section>
  </section>
}

/** Edits the existing phase name, category, format and explicit ordering without client business calculations. */
function PhaseFields({ phase, order }: { phase?: S.PhaseResponse; order: number }) {
  return <><Field label="Nombre" name="name" defaultValue={phase?.name} maxLength={100} /><Select label="Tipo" name="type" value={phase?.type ?? 'TABLE'} items={[{ id: 'TABLE', name: 'Tabla' }, { id: 'ELIMINATION', name: 'Eliminatoria' }]} /><Select label="Categoría" name="tournamentType" value={phase?.tournamentType ?? 'MALE'} items={[{ id: 'MALE', name: 'Masculino' }, { id: 'FEMALE', name: 'Femenino' }]} /><Field label="Orden" name="sortOrder" type="number" min={1} step={1} defaultValue={order} /></>
}

/** Parses explicit qualification positions with shared validation for both creation and replacement. */
function RuleForm({ run, phaseId, rule }: { run: Run; phaseId: number; rule?: S.ClassificationRuleResponse }) {
  return <Form disclosure={!rule} title={rule ? `Editar regla ${rule.label}` : 'Añadir regla de clasificación'} submit={v => run(() => adminMutation(`/phases/${phaseId}/classification-rules${rule ? `/${rule.id}` : ''}`, rule ? 'PUT' : 'POST', S.ClassificationRuleInputSchema.parse({ positions: v.positions!.split(',').map(Number), label: v.label })))}><Field label="Posiciones separadas por coma" name="positions" defaultValue={rule?.positions.join(', ')} /><Field label="Destino" name="label" defaultValue={rule?.label} /></Form>
}
