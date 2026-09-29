import { Match } from "../models/match";
import { ClassificationRule, Membership, PhaseStandings, RuleInput, Sanction, Standing } from "../models/phase_details";
import { Team } from "../models/team";
import { PhaseDetailRepository } from "../repository/phase_detail_repository";
import { PhaseService } from "./phase_service";

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

    getStandings(phaseId: number): PhaseStandings | undefined {
        const phase = this.phaseService.getPhaseById(phaseId)
        if (!phase) return undefined
        if (phase.type !== 'TABLE') return { phase, hasStandings: false, message: 'Esta fase eliminatoria no tiene tabla.', rules: [], groups: [] }

        const rules = this.getRules(phase.id)
        const sanctions = new Map(this.repository.getSanctions(phase.id).map(item => [item.teamId, item.reason]))
        const matches = this.repository.getFinishedMatches(phase.id)
        const groups = this.repository.getGroups(phase.id).map(group => ({
            ...group,
            standings: PhaseDetailService.calculateGroupStandings(this.repository.getGroupMembers(phase.id, group.id), matches, rules, sanctions),
        }))
        return { phase, hasStandings: true, rules, groups }
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

    static calculateGroupStandings(members: Pick<Team, 'id' | 'name'>[], matches: StandingMatch[], rules: StandingRule[], sanctions: Map<number, string>): Standing[] {
        const rows = new Map<number, StandingBase>(members.map(team => [team.id, {
            teamId: team.id, teamName: team.name, played: 0, wins: 0, draws: 0, losses: 0,
            goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, yellowCards: 0, redCards: 0,
            sanctioned: sanctions.has(team.id), sanctionReason: sanctions.get(team.id) || null,
        }]))

        for (const match of matches) {
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
