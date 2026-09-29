import { Tournament } from "../models/tournament";
import { TournamentRepository } from "../repository/tournament_repository";


export class TournamentService {



    private readonly repository: TournamentRepository;

    constructor(repository:TournamentRepository) {
        this.repository = repository
    }

    getAllTournaments(activeOnly:boolean): Tournament[] {
        return this.repository.findAll(activeOnly)
    }


    insertTournament(name: string, active: boolean): Tournament|undefined {
        return this.repository.insertTournament(name, active)

    }

    getTournamentById(id: number) {
        return this.repository.getTournament(id)
    }

    getTournamentByLegacyType(legacyType: string): Tournament | undefined {
        return this.repository.getTournamentByLegacyType(legacyType)
    }

    updateTournament(tournamentId: number, name: string, active: boolean, currentPhaseId: number) : Tournament|undefined {
        return this.repository.updateTournament(tournamentId, name, active, currentPhaseId)
    }

    deleteTournamentById(tournamentId: number): boolean {
        return this.repository.deleteTournament(tournamentId)
    }

}
