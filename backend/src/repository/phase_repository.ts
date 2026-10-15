import DBConnection from "../db/db_connection";
import { Phase } from "../models/phases";

export class PhaseRepository {
    private readonly dbConnection:DBConnection

    constructor(dbConnection:DBConnection) {
        this.dbConnection = dbConnection
    }

    getPhaseByTournamentIdAndPhaseID(currentPhaseId: number, tournamentId: number): Phase | undefined {
        return this.dbConnection.fetchPhaseByTournamentAndPhaseId(currentPhaseId, tournamentId)
    }

    getPhaseById(id: number): Phase | undefined {
        return this.dbConnection.fetchOneElementFromTable<Phase>('phases', id)
    }

    getPhasesForTournament(tournamentId: number): Phase[] {
        return this.dbConnection.fetchAllPhasesForTournamentId(tournamentId)
    }

    insertPhase(phase: Omit<Phase, 'id'>): Phase | undefined {
        return this.dbConnection.insertPhase(phase)
    }

    updatePhase(id: number, phase: Pick<Phase, 'name' | 'type' | 'tournamentType' | 'sortOrder'>): Phase | undefined {
        return this.dbConnection.updatePhase(id, phase)
    }

    deletePhase(id: number): boolean {
        return this.dbConnection.deletePhase(id)
    }
}
