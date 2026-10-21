import * as S from '@jupas/shared'
import type { AdminData } from '../api/admin'
import { adminMutation } from '../api/admin'
import { Field, Form, Row, Select } from './Forms'
import type { Run } from './Forms'

/** Shows authoritative assignment previews and requires confirmation before freezing or reopening positions. */
export function Positions({ preview, groups, run }: { preview: S.PhasePositionsResponse; groups: S.GroupResponse[]; run: Run }) {
  return <section><h3>Cierre y asignación de posiciones</h3><p>{preview.confirmedAt ? `Confirmado: ${preview.confirmedAt}` : 'Posiciones sin confirmar.'} Las correcciones no cambian automáticamente los equipos asignados.</p>
    {preview.errors.map((error, index) => <p className="error" key={index}>{error}</p>)}
    {preview.assignments.map(item => <Row key={`${item.matchId}-${item.role}`}><span>Partido {item.matchId} · {({ teamA: 'Local', teamB: 'Visitante', lineTeam: 'Línea' })[item.role]} · {item.position}.º {groups.find(group => group.id === item.sourceGroupId)?.name} → {item.teamName ?? 'Sin resolver'}{item.resolvedTeamId !== null && item.resolvedTeamId !== item.teamId ? ' (cambiaría el equipo asignado)' : ''}</span></Row>)}
    <button disabled={!preview.canConfirm} onClick={() => { if (confirm('¿Confirmar la clasificación y congelar los equipos previsualizados?')) void run(() => adminMutation(`/phases/${preview.phaseId}/positions/confirm`, 'POST')) }}>CONFIRMAR Y CONGELAR</button>
    {preview.confirmedAt && <button onClick={() => { if (confirm('¿Reabrir asignaciones? Los equipos se conservan; los partidos pendientes no podrán iniciar hasta reconfirmar. Los iniciados o terminados no pueden cambiar de equipo.')) void run(() => adminMutation(`/phases/${preview.phaseId}/positions/reopen`, 'POST')) }}>REABRIR ASIGNACIONES</button>}
  </section>
}

/** Provides tournament, phase, group and classification CRUD with server-owned assignment confirmation. */
export function Tournaments({ data: d, run }: { data: AdminData; run: Run }) {
  const t = d.tournament, p = d.phase
  return <><section className="panel"><h2>Torneos</h2>
    <Form title="Nuevo torneo" save="CREAR TORNEO" submit={v => run(() => adminMutation('/tournaments', 'POST', S.CreateTournamentInputSchema.parse(v)))}><Field label="Nombre" name="name" maxLength={100} /></Form>
    {t ? <><Form key={`${t.id}-${t.currentPhaseId}-${d.phases.length}`} title="Editar torneo" disabled={!d.phases.length} submit={v => run(() => adminMutation(`/tournaments/${t.id}`, 'PUT', S.UpdateTournamentInputSchema.parse({ ...v, currentPhaseId: Number(v.currentPhaseId), active: v.active === 'true' })))}>
      <Field label="Nombre" name="name" defaultValue={t.name} maxLength={100} /><Select label="Estado" name="active" value={String(t.active)} items={[{ id: 'true', name: 'Activo' }, { id: 'false', name: 'Inactivo' }]} /><Select label="Fase actual" name="currentPhaseId" value={t.currentPhaseId ?? p?.id ?? ''} items={d.phases} />
    </Form>{!d.phases.length && <p>Crea una fase antes de editar o activar el torneo.</p>}<button className="danger" onClick={() => { if (confirm('¿Eliminar este torneo?')) void run(() => adminMutation(`/tournaments/${t.id}`, 'DELETE')) }}>ELIMINAR TORNEO</button></> : <p>Crea un torneo para comenzar.</p>}
    <Form title="Nueva fase" save="CREAR FASE" disabled={!t} submit={v => run(() => adminMutation(`/tournaments/${t!.id}/phases`, 'POST', S.CreatePhaseInputSchema.parse(v)))}><PhaseFields order={d.phases.length + 1} /></Form>
  </section><section className="panel"><h2>Fases y grupos</h2>
    {p && <><Form key={p.id} title="Editar fase" submit={v => run(() => adminMutation(`/phases/${p.id}`, 'PUT', S.UpdatePhaseInputSchema.parse(v)))}><PhaseFields phase={p} order={p.sortOrder} /></Form><button className="danger" onClick={() => { if (confirm('¿Eliminar esta fase?')) void run(() => adminMutation(`/phases/${p.id}`, 'DELETE')) }}>ELIMINAR FASE</button></>}
    {d.positions && <Positions preview={d.positions} groups={d.groups} run={run} />}
    <Form title="Añadir grupo" disabled={!p} submit={v => run(() => adminMutation(`/phases/${p!.id}/groups`, 'POST', S.CreateGroupSchema.parse(v)))}><Field label="Nombre" name="name" maxLength={100} /></Form>
    {d.groups.map(group => <section key={group.id}><Form title={`Editar grupo ${group.name}`} submit={v => run(() => adminMutation(`/groups/${group.id}`, 'PUT', S.CreateGroupSchema.parse(v)))}><Field label="Nombre" name="name" defaultValue={group.name} /></Form><button className="danger" onClick={() => { if (confirm('¿Eliminar este grupo?')) void run(() => adminMutation(`/groups/${group.id}`, 'DELETE')) }}>ELIMINAR GRUPO</button></section>)}
    {p?.type === 'TABLE' && <><RuleForm run={run} phaseId={p.id} />{d.rules.map(rule => <section key={rule.id}><RuleForm run={run} phaseId={p.id} rule={rule} /><button className="danger" onClick={() => { if (confirm('¿Eliminar esta regla?')) void run(() => adminMutation(`/phases/${p.id}/classification-rules/${rule.id}`, 'DELETE')) }}>ELIMINAR REGLA</button></section>)}</>}
  </section></>
}

/** Edits the existing phase name, category, format and explicit ordering without client business calculations. */
function PhaseFields({ phase, order }: { phase?: S.PhaseResponse; order: number }) {
  return <><Field label="Nombre" name="name" defaultValue={phase?.name} maxLength={100} /><Select label="Tipo" name="type" value={phase?.type ?? 'TABLE'} items={[{ id: 'TABLE', name: 'Tabla' }, { id: 'ELIMINATION', name: 'Eliminatoria' }]} /><Select label="Categoría" name="tournamentType" value={phase?.tournamentType ?? 'MALE'} items={[{ id: 'MALE', name: 'Masculino' }, { id: 'FEMALE', name: 'Femenino' }]} /><Field label="Orden" name="sortOrder" type="number" min={1} step={1} defaultValue={order} /></>
}

/** Parses explicit qualification positions with shared validation for both creation and replacement. */
function RuleForm({ run, phaseId, rule }: { run: Run; phaseId: number; rule?: S.ClassificationRuleResponse }) {
  return <Form title={rule ? `Editar regla ${rule.label}` : 'Añadir regla de clasificación'} submit={v => run(() => adminMutation(`/phases/${phaseId}/classification-rules${rule ? `/${rule.id}` : ''}`, rule ? 'PUT' : 'POST', S.ClassificationRuleInputSchema.parse({ positions: v.positions!.split(',').map(Number), label: v.label })))}><Field label="Posiciones separadas por coma" name="positions" defaultValue={rule?.positions.join(', ')} /><Field label="Destino" name="label" defaultValue={rule?.label} /></Form>
}
