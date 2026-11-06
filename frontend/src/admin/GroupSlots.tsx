import { useState } from 'react'
import * as S from '@jupas/shared'
import type { AdminData } from '../api/admin'
import { adminMutation } from '../api/admin'
import { Field, Form, Select } from './Forms'
import type { Run } from './Forms'

/** Edits one pending place using the same source contracts as the calendar; changing kind unmounts obsolete fields. */
function SlotForm({ data: d, groupId, slot, run }: { data: AdminData; groupId: number; slot?: S.MembershipSlotResponse; run: Run }) {
  const original = slot?.reference
  const [kind, setKind] = useState(original?.kind ?? 'GROUP_POSITION')
  const [phaseId, setPhaseId] = useState(original?.kind === 'GROUP_POSITION' ? original.sourcePhaseId : d.winnerMatches.find(match => original?.kind === 'MATCH_WINNER' && match.id === original.sourceMatchId)?.phaseId ?? undefined)
  const sources = kind === 'MATCH_WINNER' ? d.winnerPhases : d.sourcePhases
  const selected = sources.find(phase => phase.id === phaseId)?.id ?? sources[0]?.id
  const matches = d.winnerMatches.filter(match => match.phaseId === selected)
  return <Form disclosure={!slot} title={slot ? 'Editar cupo' : 'Añadir cupo pendiente'} submit={values => run(() => {
    const reference = kind === 'MATCH_WINNER' ? { kind, sourceMatchId: values.sourceMatchId } : { kind, sourcePhaseId: values.sourcePhaseId, sourceGroupId: values.sourceGroupId, position: values.position }
    return adminMutation(`/phases/${d.phase!.id}/membership-slots${slot ? `/${slot.id}` : ''}`, slot ? 'PUT' : 'POST', S.MembershipSlotInputSchema.parse({ groupId, reference }))
  })}>
    <Select label="Tipo de cupo" value={kind} onChange={value => { setKind(value as typeof kind); setPhaseId(undefined) }} items={[{ id: 'GROUP_POSITION', name: 'Posición de grupo' }, { id: 'MATCH_WINNER', name: 'Ganador de partido' }]} />
    <Select label="Fase origen" name="sourcePhaseId" value={selected ?? ''} onChange={value => setPhaseId(Number(value))} items={sources} />
    {kind === 'GROUP_POSITION' ? <><Select key={`${kind}-${selected}`} label="Grupo origen" name="sourceGroupId" value={original?.kind === kind && original.sourcePhaseId === selected ? original.sourceGroupId : ''} items={d.sourceGroups[selected!] ?? []} /><Field label="Posición" name="position" type="number" min={1} step={1} defaultValue={original?.kind === kind ? original.position : 1} /></> : <Select key={`${kind}-${selected}`} label="Partido origen" name="sourceMatchId" value={original?.kind === 'MATCH_WINNER' && matches.some(match => match.id === original.sourceMatchId) ? original.sourceMatchId : ''} items={matches.map(match => ({ id: match.id, name: `${match.phaseName} · partido ${match.id} · ${match.teamA} contra ${match.teamB}` }))} />}
    {(!sources.length || (kind === 'MATCH_WINNER' && !matches.length)) && <p role="status">No hay fuentes de origen elegibles.</p>}
  </Form>
}

/** Manages retained source references beside their destination group and exposes stale assignments explicitly. */
export function GroupSlots({ data, groupId, run }: { data: AdminData; groupId: number; run: Run }) {
  return <><SlotForm data={data} groupId={groupId} run={run} />{data.slots.filter(slot => slot.groupId === groupId).map(slot => <details key={slot.id}><summary>{slot.label} → {slot.teamName ?? 'Por resolver'} · {({ PENDING: 'Pendiente', CONFIRMED: 'Confirmado', STALE: 'Desactualizado: revisar origen' })[slot.status]}</summary><SlotForm data={data} groupId={groupId} slot={slot} run={run} /><button className="danger" onClick={() => { if (confirm('¿Quitar este cupo?')) void run(() => adminMutation(`/phases/${data.phase!.id}/membership-slots/${slot.id}`, 'DELETE')) }}>QUITAR CUPO</button></details>)}</>
}
