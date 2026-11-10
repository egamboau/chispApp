import { matchDisplayLabel } from '@jupas/shared';
import { Match } from "../models/match";
import { ClassificationRule, Membership, PhaseScoring, PhaseStandings, RuleInput, Sanction, ScoringRankingRow, ScoringRow, ScoringTable, Standing, TeamCards } from "../models/phase_details";
import { Team } from "../models/team";
import { PhaseDetailRepository } from "../repository/phase_detail_repository";
import { PhaseService } from "./phase_service";
import { DatabaseConnectionError } from "../db/db_connection";

type StandingBase = Omit<Standing, 'position' | 'requiresTiebreaker' | 'destination' | 'possibleDestinations' | 'tiebreakerRule'>;
type StandingRule = Pick<ClassificationRule, 'label'> & Partial<Pick<ClassificationRule, 'startPosition' | 'endPosition' | 'positions'>>;
type StandingMatch = Pick<Match, 'teamAId' | 'teamBId' | 'scoreA' | 'scoreB' | 'yellowCardsA' | 'redCardsA' | 'yellowCardsB' | 'redCardsB'>;

export class PhaseDetailService {
    constructor(
        private readonly repository: PhaseDetailRepository,
        private readonly phaseService: PhaseService,
    ) {}

    getMemberships(phaseId: number): Membership[] {
        return this.repository.getMemberships(phaseId)
    }

    insertMembership(membership: Membership): Membership {
        return this.repository.insertMembership(membership)
    }

    teamHasMatches(phaseId: number, teamId: number): boolean {
        return this.repository.teamHasMatches(phaseId, teamId)
    }

    updateMembership(phaseId: number, teamId: number, groupId: number): Membership | undefined {
        return this.repository.updateMembership(phaseId, teamId, groupId)
    }

    deleteMembership(phaseId: number, teamId: number): boolean {
        return this.repository.deleteMembership(phaseId, teamId)
    }

    /** Returns current group-place status and retains historical assignments when the source changes. */
    getSlots(phaseId: number) {
        return this.repository.getSlots(phaseId).map(slot => {
            const reference = this.slotReference(slot)
            const teamId = this.resolveReference(reference)
            const source = reference.kind === 'GROUP_POSITION' ? this.phaseService.getPhaseById(reference.sourcePhaseId) : this.phaseService.getPhaseById(this.repository.getMatch(reference.sourceMatchId).phaseId!)
            const group = reference.kind === 'GROUP_POSITION' ? this.repository.getGroup(reference.sourceGroupId) : undefined
            const team = this.repository.getGroupMembers(slot.phaseId, slot.groupId).find(team => team.id === slot.resolvedTeamId)
            return { id: slot.id, phaseId: slot.phaseId, groupId: slot.groupId, reference, resolvedTeamId: slot.resolvedTeamId,
                teamName: team?.name ?? null, label: reference.kind === 'GROUP_POSITION' ? `${reference.position}.º del Grupo ${group?.name}` : `${reference.kind === 'MATCH_LOSER' ? 'Perdedor' : 'Ganador'} de ${matchDisplayLabel({ ...this.repository.getMatch(reference.sourceMatchId), phaseName: source?.name })}`,
                status: teamId !== null && teamId === slot.resolvedTeamId ? 'CONFIRMED' as const : slot.resolvedTeamId !== null ? 'STALE' as const : 'PENDING' as const }
        })
    }

    /** Adds or edits an unused place; compatibility, duplicate and materialization failures roll back together. */
    saveSlot(phaseId: number, groupId: number, reference: import('../models/match').MatchParticipant, id?: number) {
        return this.repository.transaction(() => {
            if (id !== undefined) this.releaseSlot(phaseId, id)
            const saved = this.repository.saveSlot(phaseId, groupId, reference, id)
            this.refreshReferences()
            return this.getSlots(phaseId).find(slot => slot.id === saved)!
        })
    }

    /** Removes an unused reference and its materialized membership without affecting direct memberships. */
    deleteSlot(phaseId: number, id: number): void {
        this.repository.transaction(() => { this.releaseSlot(phaseId, id); this.repository.deleteSlot(id) })
    }

    /** Rejects editing places used by a match or disciplinary history; deleting dependent data is never implicit. */
    private releaseSlot(phaseId: number, id: number): void {
        const slot = this.repository.getSlots(phaseId).find(slot => slot.id === id)
        if (!slot) throw new DatabaseConnectionError('PositionResolutionError', 'Cupo no encontrado.', undefined)
        const reference = this.slotReference(slot)
        const used = this.repository.getMatchReferences().some(row => this.repository.getMatch(row.matchId).phaseId === phaseId &&
            (reference.kind === 'GROUP_POSITION' ? row.kind === reference.kind && row.sourcePhaseId === reference.sourcePhaseId && row.sourceGroupId === reference.sourceGroupId && row.position === reference.position
                : row.kind === reference.kind && row.sourceMatchId === reference.sourceMatchId))
        if (used || (slot.resolvedTeamId !== null && (this.repository.teamHasMatches(phaseId, slot.resolvedTeamId)
            || this.repository.getSanctions(phaseId).some(row => row.teamId === slot.resolvedTeamId)
            || this.repository.getTeamCards(phaseId).some(row => row.teamId === slot.resolvedTeamId)))) {
            throw new DatabaseConnectionError('PositionResolutionError', 'El cupo tiene partidos o historial asociado.', undefined)
        }
        this.repository.assignSlot(slot, null)
    }

    /** Reuses confirmed standings and finished unequal-score elimination results; unresolved/cyclic chains stay pending. */
    resolveReference(reference: import('../models/match').MatchParticipant, visiting = new Set<number>()): number | null {
        if (reference.kind === 'TEAM') return reference.teamId
        if (reference.kind === 'GROUP_POSITION') {
            const preview = this.previewPositions(reference.sourcePhaseId)
            if (!preview?.confirmedAt || preview.stale || !preview.canConfirm) return null
            return this.getStandings(reference.sourcePhaseId, false)?.groups.find(group => group.id === reference.sourceGroupId)?.standings.find(row => row.position === reference.position && !row.requiresTiebreaker)?.teamId ?? null
        }
        if (visiting.has(reference.sourceMatchId)) return null
        visiting.add(reference.sourceMatchId)
        const match = this.repository.getMatch(reference.sourceMatchId)
        if (!match || match.status !== 'FINISHED' || match.scoreA === match.scoreB || match.teamAId === null || match.teamBId === null) return null
        for (const row of this.repository.getMatchReferences().filter(row => row.matchId === match.id)) {
            const source = row.kind === 'GROUP_POSITION' ? { kind: 'GROUP_POSITION' as const, sourcePhaseId: row.sourcePhaseId!, sourceGroupId: row.sourceGroupId!, position: row.position! }
                : { kind: row.kind as 'MATCH_WINNER' | 'MATCH_LOSER', sourceMatchId: row.sourceMatchId! }
            if (this.resolveReference(source, new Set(visiting)) !== match[`${row.role}Id`]) return null
        }
        return (match.scoreA > match.scoreB) === (reference.kind === 'MATCH_WINNER') ? match.teamAId : match.teamBId
    }

    /** Refreshes scheduled outcomes and real memberships atomically; started/history-bearing assignments remain stale. */
    refreshReferences(): void {
        this.repository.transaction(() => {
            for (const row of this.repository.getMatchReferences().filter(row => (row.kind === 'MATCH_WINNER' || row.kind === 'MATCH_LOSER'))) {
                const match = this.repository.getMatch(row.matchId)
                const teamId = this.resolveReference({ kind: row.kind as 'MATCH_WINNER' | 'MATCH_LOSER', sourceMatchId: row.sourceMatchId! })
                if (match.status === 'SCHEDULED' && match[`${row.role}Id`] !== teamId) this.repository.assignWinner(match.id, row.role, teamId)
            }
            const changes = []
            for (const slot of this.repository.getSlots()) {
                const teamId = this.resolveReference(this.slotReference(slot))
                if (slot.resolvedTeamId === teamId) continue
                if (slot.resolvedTeamId !== null && (this.repository.teamHasMatches(slot.phaseId, slot.resolvedTeamId)
                    || this.repository.getSanctions(slot.phaseId).some(row => row.teamId === slot.resolvedTeamId)
                    || this.repository.getTeamCards(slot.phaseId).some(row => row.teamId === slot.resolvedTeamId))) continue
                changes.push({ slot, teamId })
            }
            // Release changing memberships first so winner/loser swaps do not violate uniqueness.
            for (const { slot } of changes) this.repository.assignSlot(slot, null)
            for (const { slot, teamId } of changes) this.repository.assignSlot({ ...slot, resolvedTeamId: null }, teamId)
        })
    }

    /** Reconstructs the calendar contract from the normalized persisted source columns. */
    private slotReference(slot: import('../models/phase_details').MembershipSlot): Exclude<import('../models/match').MatchParticipant, { kind: 'TEAM' }> {
        return slot.kind === 'GROUP_POSITION' ? { kind: slot.kind, sourcePhaseId: slot.sourcePhaseId!, sourceGroupId: slot.sourceGroupId!, position: slot.position! }
            : { kind: slot.kind, sourceMatchId: slot.sourceMatchId! }
    }

    getRules(phaseId: number): ClassificationRule[] {
        return this.repository.getRules(phaseId).map(rule => ({ ...rule, positions: PhaseDetailService.rulePositions(rule) }))
    }

    getRule(id: number): ClassificationRule | undefined {
        return this.repository.getRule(id)
    }

    overlaps(phaseId: number, rule: RuleInput, except = 0): boolean {
        return this.getRules(phaseId).some(current => current.id !== except && PhaseDetailService.rulePositions(current).some(position => rule.positions.includes(position)))
    }

    insertRule(phaseId: number, rule: RuleInput): ClassificationRule | undefined {
        return this.publicRule(this.repository.insertRule(phaseId, rule))
    }

    updateRule(id: number, rule: RuleInput): ClassificationRule | undefined {
        return this.publicRule(this.repository.updateRule(id, rule))
    }

    deleteRule(id: number, phaseId: number): boolean {
        return this.repository.deleteRule(id, phaseId)
    }

    getSanctions(phaseId: number): Sanction[] {
        return this.repository.getSanctions(phaseId)
    }

    hasMembership(phaseId: number, teamId: number): boolean {
        return this.repository.hasMembership(phaseId, teamId)
    }

    upsertSanction(phaseId: number, teamId: number, reason: string): Sanction {
        return this.repository.upsertSanction(phaseId, teamId, reason)
    }

    deleteSanction(phaseId: number, teamId: number): boolean {
        return this.repository.deleteSanction(phaseId, teamId)
    }

    getTeamCards(phaseId: number): TeamCards[] {
        return this.repository.getTeamCards(phaseId)
    }

    upsertTeamCards(cards: TeamCards): TeamCards {
        return this.repository.upsertTeamCards(cards)
    }

    deleteTeamCards(phaseId: number, teamId: number): boolean {
        return this.repository.deleteTeamCards(phaseId, teamId)
    }

    getStandings(phaseId: number, includeLive = true): PhaseStandings | undefined {
        const phase = this.phaseService.getPhaseById(phaseId)
        if (!phase) return undefined
        if (phase.type !== 'TABLE') return { phase, hasStandings: false, message: 'Esta fase eliminatoria no tiene tabla.', rules: [], groups: [] }

        const rules = this.getRules(phase.id)
        const sanctions = new Map(this.repository.getSanctions(phase.id).map(item => [item.teamId, item.reason]))
        const teamCards = new Map(this.repository.getTeamCards(phase.id).map(item => [item.teamId, item]))
        const matches = this.repository.getStandingsMatches(phase.id, includeLive)
        const groups = this.repository.getGroups(phase.id).map(group => ({
            ...group,
            standings: PhaseDetailService.calculateGroupStandings(this.repository.getGroupMembers(phase.id, group.id), matches, rules, sanctions, teamCards),
        }))
        return { phase, hasStandings: true, rules, groups }
    }

    /** Previews current standings, match assignments and group places; reports conflicts and changes since confirmation. */
    previewPositions(phaseId: number) {
        const table = this.getStandings(phaseId, false)
        if (!table) return undefined
        const errors: string[] = []
        if (!table.hasStandings) errors.push('Solo se pueden confirmar posiciones de una fase de tabla.')
        if (!table.groups.length) errors.push('La fase no tiene grupos.')
        const matches = this.repository.getPhaseMatches(phaseId)
        if (matches.some(match => match.status !== 'FINISHED')) errors.push('La fase tiene partidos pendientes.')
        for (const group of table.groups) {
            const rows = group.standings
            // shortcut: exige una vuelta completa; ampliar si se configura otro formato de tabla.
            const complete = rows.length >= 2 && rows.every((a, index) => rows.slice(index + 1).every(b =>
                matches.some(match => match.status === 'FINISHED' &&
                    ((match.teamAId === a.teamId && match.teamBId === b.teamId) || (match.teamAId === b.teamId && match.teamBId === a.teamId)))))
            if (!complete) errors.push(`Grupo ${group.name} incompleto: faltan enfrentamientos finalizados.`)
            if (rows.some(row => row.requiresTiebreaker)) errors.push(`Grupo ${group.name}: hay empates sin resolver.`)
        }
        if (this.repository.hasInvalidPositionReferences(phaseId)) errors.push('Hay referencias de participantes inválidas.')
        const assignments = this.repository.getPositionReferences(phaseId).map(reference => {
            const row = table.groups.find(group => group.id === reference.sourceGroupId)?.standings.find(row => row.position === reference.position && !row.requiresTiebreaker)
            if (!row) errors.push(`Partido ${reference.matchId}: posición ${reference.position} sin resolver.`)
            const match = this.repository.getMatch(reference.matchId)
            const resolvedTeamId = match[`${reference.role}Id`]
            if (match.status !== 'SCHEDULED' && row?.teamId !== resolvedTeamId) errors.push(`Partido ${match.id} iniciado o terminado: no se pueden cambiar sus participantes.`)
            return { ...reference, resolvedTeamId, teamId: row?.teamId ?? null, teamName: row?.teamName ?? null }
        })
        for (const matchId of new Set(assignments.map(item => item.matchId))) {
            const match = this.repository.getMatch(matchId)
            const ids = (['teamA', 'teamB', 'lineTeam'] as const).map(role => {
                const assignment = assignments.find(item => item.matchId === matchId && item.role === role)
                return assignment ? assignment.teamId : match[`${role}Id`]
            }).filter(id => id !== null)
            if (new Set(ids).size !== ids.length) errors.push(`Partido ${matchId}: los participantes resueltos deben ser diferentes.`)
        }
        const membershipAssignments = this.repository.getSlots().filter(slot => slot.kind === 'GROUP_POSITION' && slot.sourcePhaseId === phaseId).map(slot => {
            const row = table.groups.find(group => group.id === slot.sourceGroupId)?.standings.find(row => row.position === slot.position && !row.requiresTiebreaker)
            if (!row) errors.push(`Cupo ${slot.id}: posición sin resolver.`)
            const conflict = row && this.repository.getMemberships(slot.phaseId).some(member => member.teamId === row.teamId && member.teamId !== slot.resolvedTeamId)
            if (conflict) errors.push(`Cupo ${slot.id}: el equipo ya pertenece a la fase destino.`)
            if (slot.resolvedTeamId !== null && slot.resolvedTeamId !== row?.teamId && this.repository.teamHasMatches(slot.phaseId, slot.resolvedTeamId)) errors.push(`Cupo ${slot.id}: el equipo tiene partidos existentes.`)
            return { slotId: slot.id, phaseId: slot.phaseId, groupId: slot.groupId, sourceGroupId: slot.sourceGroupId!, position: slot.position!, resolvedTeamId: slot.resolvedTeamId, teamId: row?.teamId ?? null, teamName: row?.teamName ?? null }
        })
        for (const phase of new Set(membershipAssignments.map(item => item.phaseId))) {
            const ids = membershipAssignments.filter(item => item.phaseId === phase).map(item => item.teamId).filter(id => id !== null)
            if (new Set(ids).size !== ids.length) errors.push('Los cupos resueltos deben pertenecer a equipos diferentes.')
        }
        const snapshot = JSON.stringify(table)
        const confirmation = this.repository.getPositionConfirmation(phaseId)
        const stale = Boolean(confirmation && (confirmation.snapshot !== snapshot || errors.length))
        if (stale) errors.push('La clasificación cambió después de confirmar. Reabre y revisa las asignaciones antes de reconfirmar.')
        return { phaseId, confirmedAt: confirmation?.confirmedAt ?? null, stale, canConfirm: errors.length === 0, errors, assignments, ...(membershipAssignments.length ? { membershipAssignments } : {}), snapshot }
    }

    /** Atomically freezes a valid classification and resolves its match participants and destination group places. */
    confirmPositions(phaseId: number) {
        return this.repository.transaction(() => {
            const preview = this.previewPositions(phaseId)
            if (!preview) return undefined
            if (!preview.canConfirm) throw new DatabaseConnectionError('PositionResolutionError', preview.errors.join(' '), undefined)
            for (const assignment of preview.assignments) {
                if (assignment.resolvedTeamId !== assignment.teamId) this.repository.assignPosition(assignment, assignment.teamId!, assignment.teamName!)
            }
            this.repository.confirmPositions(phaseId, preview.snapshot)
            this.refreshReferences()
            return this.previewPositions(phaseId)
        })
    }

    /** Reopens a classification and refreshes safe dependent places while retaining assignments with history. */
    reopenPositions(phaseId: number) {
        return this.repository.transaction(() => {
            if (!this.phaseService.getPhaseById(phaseId)) return undefined
            this.repository.reopenPositions(phaseId)
            this.refreshReferences()
            return this.previewPositions(phaseId)
        })
    }

    getScoring(phaseId: number): PhaseScoring | undefined {
        const phase = this.phaseService.getPhaseById(phaseId)
        if (!phase) return undefined
        const rows = this.repository.getScoring(phase.tournamentId, phase.tournamentType)
        const tables = this.repository.getScoringTables(phase.tournamentId, phase.tournamentType)
        return {
            phase,
            tables: tables.map(table => {
                const tableRows = rows.filter(row => row.scoringTable.toLocaleLowerCase('es') === table.name.toLocaleLowerCase('es'))
                return { id: table.id, name: table.name, rankings: {
                    total: PhaseDetailService.rankScoring(tableRows, 'total'),
                    pepitas: PhaseDetailService.rankScoring(tableRows, 'pepitas'),
                    horquetas: PhaseDetailService.rankScoring(tableRows, 'horquetas'),
                } }
            }),
        }
    }

    insertScoringTable(phaseId: number, name: string): ScoringTable | undefined {
        const phase = this.phaseService.getPhaseById(phaseId)
        return phase && this.repository.insertScoringTable(phase.tournamentId, phase.tournamentType, name)
    }

    updateScoringTable(phaseId: number, id: number, name: string): ScoringTable | undefined {
        const phase = this.phaseService.getPhaseById(phaseId)
        return phase && this.repository.updateScoringTable(id, phase.tournamentId, phase.tournamentType, name)
    }

    private static rankScoring(rows: ScoringRow[], metric: 'total' | 'pepitas' | 'horquetas'): ScoringRankingRow[] {
        let previous: number | undefined, position = 0
        return rows.filter(row => row[metric] > 0).sort((a, b) =>
            b[metric] - a[metric]
            || a.teamName.localeCompare(b.teamName, 'es', { sensitivity: 'base' })
            || a.playerNumber.localeCompare(b.playerNumber, 'es', { numeric: true })
            || a.playerId - b.playerId
        ).map((row, index) => {
            if (row[metric] !== previous) position = index + 1
            previous = row[metric]
            return { ...row, position }
        })
    }

    private publicRule(rule: ClassificationRule | undefined): ClassificationRule | undefined {
        return rule && { ...rule, positions: PhaseDetailService.rulePositions(rule) }
    }

    private static rulePositions(rule: StandingRule): number[] {
        if (Array.isArray(rule.positions)) return rule.positions
        if (rule.positions) {
            try {
                const parsed: unknown = JSON.parse(rule.positions)
                if (Array.isArray(parsed) && parsed.every(position => typeof position === 'number')) return parsed
            } catch {}
        }
        const start = rule.startPosition ?? 0, end = rule.endPosition ?? start
        return Array.from({ length: end - start + 1 }, (_, index) => start + index)
    }

    private static destinationAt(rules: StandingRule[], position: number): string | null {
        return rules.find(rule => PhaseDetailService.rulePositions(rule).includes(position))?.label || null
    }

    static calculateGroupStandings(members: Pick<Team, 'id' | 'name'>[], matches: StandingMatch[], rules: StandingRule[], sanctions: Map<number, string>, teamCards = new Map<number, Pick<TeamCards, 'yellowCards' | 'redCards'>>()): Standing[] {
        const rows = new Map<number, StandingBase>(members.map(team => [team.id, {
            teamId: team.id, teamName: team.name, played: 0, wins: 0, draws: 0, losses: 0,
            goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, yellowCards: teamCards.get(team.id)?.yellowCards || 0, redCards: teamCards.get(team.id)?.redCards || 0,
            sanctioned: sanctions.has(team.id), sanctionReason: sanctions.get(team.id) || null,
        }]))

        for (const match of matches) {
            if (match.teamAId === null || match.teamBId === null) continue
            const a = rows.get(match.teamAId), b = rows.get(match.teamBId), draw = match.scoreA === match.scoreB
            if (a) {
                a.played++; a.goalsFor += match.scoreA; a.goalsAgainst += match.scoreB; a.yellowCards += match.yellowCardsA; a.redCards += match.redCardsA
                if (draw) { a.draws++; a.points++ } else if (match.scoreA > match.scoreB) { a.wins++; a.points += 3 } else a.losses++
            }
            if (b) {
                b.played++; b.goalsFor += match.scoreB; b.goalsAgainst += match.scoreA; b.yellowCards += match.yellowCardsB; b.redCards += match.redCardsB
                if (draw) { b.draws++; b.points++ } else if (match.scoreB > match.scoreA) { b.wins++; b.points += 3 } else b.losses++
            }
        }
        for (const row of rows.values()) row.goalDifference = row.goalsFor - row.goalsAgainst

        const split = <T>(items: T[], value: (item: T) => number | boolean): T[][] => {
            const groups: Array<{ key: number | boolean; items: T[] }> = []
            for (const item of items) {
                const key = value(item), last = groups.at(-1)
                if (!last || last.key !== key) groups.push({ key, items: [item] })
                else last.items.push(item)
            }
            return groups.map(group => group.items)
        }
        const direct = (items: StandingBase[]) => {
            const stats = new Map(items.map(item => [item.teamId, { points: 0, goalDifference: 0, goalsFor: 0 }]))
            for (const match of matches) {
                if (match.teamAId === null || match.teamBId === null) continue
                const a = stats.get(match.teamAId), b = stats.get(match.teamBId)
                if (!a || !b) continue
                a.goalsFor += match.scoreA; a.goalDifference += match.scoreA - match.scoreB
                b.goalsFor += match.scoreB; b.goalDifference += match.scoreB - match.scoreA
                if (match.scoreA === match.scoreB) { a.points++; b.points++ }
                else stats.get(match.scoreA > match.scoreB ? match.teamAId : match.teamBId)!.points += 3
            }
            return stats
        }
        const resolve = (items: StandingBase[], criterion = 0): StandingBase[][] => {
            if (items.length < 2 || criterion > 5) return [items]
            let value: (row: StandingBase) => number
            let ascending = false
            if (criterion === 0) value = row => row.goalDifference
            else if (criterion === 1) value = row => row.goalsFor
            else if (criterion <= 4) {
                const head = direct(items)
                value = criterion === 2 ? row => head.get(row.teamId)!.points
                    : criterion === 3 ? row => head.get(row.teamId)!.goalDifference
                    : row => head.get(row.teamId)!.goalsFor
            } else {
                value = row => row.redCards * 1_000_000 + row.yellowCards
                ascending = true
            }
            const sorted = [...items].sort((a, b) => ascending ? value(a) - value(b) : value(b) - value(a))
            return split(sorted, value).flatMap(group => resolve(group, criterion + 1))
        }

        const ordered: StandingBase[][] = []
        for (const tied of split([...rows.values()].sort((a, b) => b.points - a.points), row => row.points)) {
            const start = ordered.reduce((total, group) => total + group.length, 0) + 1
            const crosses = new Set(tied.map((_row, index) => PhaseDetailService.destinationAt(rules, start + index) || '__none__')).size > 1
            const sanctionGroups = crosses ? split([...tied].sort((a, b) => Number(a.sanctioned) - Number(b.sanctioned)), row => row.sanctioned) : [tied]
            for (const group of sanctionGroups) ordered.push(...resolve(group))
        }

        const result: Standing[] = []
        let position = 1
        for (const tied of ordered) {
            const destinations = Array.from({ length: tied.length }, (_, index) => PhaseDetailService.destinationAt(rules, position + index))
            const same = destinations.every(item => item === destinations[0])
            const possibleDestinations = [...new Set(destinations.filter((item): item is string => Boolean(item)))]
            for (const row of tied) result.push({
                ...row, position, requiresTiebreaker: tied.length > 1,
                destination: same ? destinations[0] ?? null : null,
                possibleDestinations: same ? [] : possibleDestinations,
                tiebreakerRule: tied.length > 1 ? 'Dos tiempos de 5 minutos y penales si persiste el empate.' : null,
            })
            position += tied.length
        }
        return result
    }
}

export const calculateGroupStandings = PhaseDetailService.calculateGroupStandings
