import { Match, MatchFilters, MatchInput } from "../models/match";
import { MatchPlayerScoring, MatchPlayerScoringInput } from "../models/match_player_scoring";
import { MatchPlayerScoringRepository } from "../repository/match_player_scoring_repository";
import { Team } from "../models/team";
import { MatchRepository } from "../repository/match_repository";
import { GroupService } from "./group_service";
import { PhaseService } from "./phase_service";
import { TeamService } from "./team_service";
import { TournamentService } from "./tournament_service";

export class MatchService {
    constructor(
        private readonly repository: MatchRepository,
        private readonly phaseService: PhaseService,
        private readonly groupService: GroupService,
        private readonly teamService: TeamService,
        private readonly tournamentService: TournamentService,
        private readonly scoringRepository: MatchPlayerScoringRepository,
    ) {}

    getMatches(filters: MatchFilters, isAdmin = false): Match[] {
        const matches = [...this.repository.getMatches(filters)]
        if (!isAdmin) this.shuffleUnpublishedDates(matches)
        return matches.map(match => this.publicMatch(match, isAdmin))
    }

    getMatch(id: number, isAdmin = false): Match | undefined {
        const match = this.repository.getMatch(id)
        return match && this.publicMatch(match, isAdmin)
    }

    buildInput(body: Record<string, unknown>): { match: MatchInput; errors: string[] } {
        const phase = body.phaseId
            ? this.phaseService.getPhaseById(Number(body.phaseId))
            : typeof body.tournamentType === 'string' ? this.repository.getCurrentPhase(body.tournamentType) : undefined
        const group = body.groupId
            ? this.groupService.getGroup(Number(body.groupId))
            : phase ? this.repository.getFirstGroup(phase.id) : undefined
        const tournament = phase && this.tournamentService.getTournamentById(phase.tournamentId)

        const findTeam = (teamId: unknown, name: unknown): Team | undefined => {
            if (teamId) return this.teamService.getTeam(Number(teamId))
            const teamName = this.clean(name)
            if (!tournament || !teamName) return undefined
            let team = this.repository.findTeam(tournament.id, teamName)
            if (!team) {
                const tournamentType = tournament.legacyType || (tournament.id % 2 ? 'MALE' : 'FEMALE')
                team = this.repository.insertTeam(tournamentType, tournament.id, teamName)
                if (phase && group) this.repository.insertMembership(phase.id, group.id, team.id)
            }
            return team
        }

        const a = findTeam(body.teamAId, body.teamA)
        const b = findTeam(body.teamBId, body.teamB)
        const line = findTeam(body.lineTeamId, body.lineTeam)
        const match: MatchInput = {
            phaseId: phase?.id || 0,
            groupId: group?.id || 0,
            teamAId: a?.id || 0,
            teamBId: b?.id || 0,
            lineTeamId: line?.id || 0,
            tournamentType: phase?.tournamentType || '',
            teamA: a?.name || '',
            teamB: b?.name || '',
            lineTeam: line?.name || '',
            date: this.clean(body.date),
            jornada: typeof body.jornada === 'string' ? body.jornada : '',
            court: Number(body.court),
            sortOrder: body.sortOrder === '' || body.sortOrder == null ? null : Number(body.sortOrder),
        }
        const errors: string[] = []
        if (!phase || !group || group.phaseId !== phase.id) errors.push('Fase o grupo inválido.')
        if (!this.validDate(match.date)) errors.push('Fecha inválida.')
        if (!['MORNING', 'AFTERNOON'].includes(match.jornada)) errors.push('Jornada inválida.')
        if (!Number.isInteger(match.court) || match.court < 1) errors.push('Cancha inválida.')
        if (match.sortOrder !== null && (!Number.isInteger(match.sortOrder) || match.sortOrder < 1)) errors.push('Orden inválido.')
        if (!a || !b || !line || new Set([a?.id, b?.id, line?.id]).size !== 3) errors.push('Los tres equipos deben existir y ser diferentes.')
        if (phase && group && a && !this.repository.hasMembership(phase.id, a.id, group.id)) errors.push('El equipo A debe pertenecer al grupo seleccionado.')
        if (phase && b && !this.repository.hasMembership(phase.id, b.id)) errors.push('El equipo B debe pertenecer a la fase.')
        return { match, errors }
    }

    insertMatch(match: MatchInput): Match {
        return this.repository.insertMatch(match)
    }

    updateMatch(id: number, match: MatchInput): Match {
        return this.repository.updateMatch(id, match)
    }

    updateSortOrder(id: number, sortOrder: number | null): Match | undefined {
        return this.repository.updateSortOrder(id, sortOrder)
    }

    deleteMatch(id: number): boolean {
        return this.repository.deleteMatch(id)
    }

    setLineVisibility(date: string, visible: boolean): void {
        this.repository.setLineVisibility(date, visible)
    }

    changeStatus(id: number, from: string, to: string): Match | undefined {
        return this.repository.changeStatus(id, from, to) ? this.repository.getMatch(id) : undefined
    }

    changeScore(id: number, team: 'A' | 'B', delta: number): Match | undefined {
        return this.repository.changeScore(id, team, delta) ? this.repository.getMatch(id) : undefined
    }

    setResult(id: number, scoreA: number, scoreB: number): Match | undefined {
        return this.repository.setResult(id, scoreA, scoreB) ? this.repository.getMatch(id) : undefined
    }

    resetScore(id: number): Match | undefined {
        return this.repository.resetScore(id) ? this.repository.getMatch(id) : undefined
    }

    setCards(id: number, cards: Record<string, number>): Match | undefined {
        return this.repository.setCards(id, cards) ? this.repository.getMatch(id) : undefined
    }

    getScoring(matchId: number): MatchPlayerScoring[] {
        return this.scoringRepository.getForMatch(matchId)
    }

    getPlayerScoring(matchId: number, playerId: number): MatchPlayerScoring | undefined {
        return this.scoringRepository.get(matchId, playerId)
    }

    insertScoring(scoring: MatchPlayerScoringInput): MatchPlayerScoring {
        return this.scoringRepository.insert(scoring)
    }

    updateScoring(scoring: MatchPlayerScoringInput): MatchPlayerScoring {
        return this.scoringRepository.update(scoring)
    }

    deleteScoring(matchId: number, playerId: number): boolean {
        return this.scoringRepository.delete(matchId, playerId)
    }

    validDate(value: string): boolean {
        return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    }

    private clean(value: unknown): string {
        return typeof value === 'string' ? value.trim() : ''
    }

    private publicMatch(match: Match, isAdmin: boolean): Match {
        return isAdmin || match.lineVisible ? match : { ...match, lineTeam: null, lineTeamId: null }
    }

    private shuffleUnpublishedDates(matches: Match[]): void {
        const dates = new Map<string, number[]>()
        matches.forEach((match, index) => {
            const indexes = dates.get(match.date)
            if (indexes) indexes.push(index)
            else dates.set(match.date, [index])
        })
        for (const indexes of dates.values()) {
            if (indexes.some(index => matches[index]!.lineVisible)) continue
            for (let index = indexes.length - 1; index > 0; index--) {
                const randomIndex = Math.floor(Math.random() * (index + 1))
                const left = indexes[index]!, right = indexes[randomIndex]!
                const match = matches[left]!
                matches[left] = matches[right]!
                matches[right] = match
            }
        }
    }
}
