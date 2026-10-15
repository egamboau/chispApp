import { Team } from "../models/team";
import { TeamRepository } from "../repository/team_repository";

export class TeamService {
    constructor(private readonly teamRepository: TeamRepository) {}

    getTeams(): Team[] {
        return this.teamRepository.getTeams()

    }
    getTeamByTournament(tournamentId:number): Team[]{
        return this.teamRepository.getTeamByTournament(tournamentId)
    }

    getTeamByTournamentType(tournamentType: string): Team[] {
        return this.teamRepository.getTeamByTournamentType(tournamentType)
    }

    getTeam(id: number): Team | undefined {
        return this.teamRepository.getTeam(id)
    }

    insertTeam(tournamentType: string, tournamentId: number, name: string): Team | undefined {
        return this.teamRepository.insertTeam(tournamentType, tournamentId, name)
    }

    updateTeam(id: number, name: string): Team | undefined {
        return this.teamRepository.updateTeam(id, name)
    }

    deleteTeam(id: number): boolean {
        return this.teamRepository.deleteTeam(id)
    }
}
