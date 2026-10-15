import DBConnection from "../db/db_connection"
import { Tournament } from "../models/tournament"

export class TournamentRepository {


    private readonly dbConnection:DBConnection

    constructor(dbConnection:DBConnection) {
        this.dbConnection = dbConnection
    }

    findAll(activeOnly:boolean):Tournament[] {
        return this.dbConnection.fetchAllFromQuery<Tournament>(`SELECT * FROM tournaments ${activeOnly ? 'WHERE active=1' : ''} ORDER BY name`)
    }

    insertTournament(name: string, active: boolean): Tournament|undefined {
        return this.dbConnection.insertTournamentInDatabase(name, active)
    }

    getTournament(id: number):Tournament | undefined {
        return this.dbConnection.fetchOneElementFromTable('tournaments', id)
    }

    getTournamentByLegacyType(legacyType: string): Tournament | undefined {
        return this.dbConnection.getTournamentByLegacyType(legacyType)
    }

    updateTournament(tournamentId: number, name: string, active: boolean, currentPhaseId: number) : Tournament|undefined{
        return this.dbConnection.updateTournament(tournamentId, name, active, currentPhaseId)
    }

    deleteTournament(tournamentId: number): boolean {
       return  this.dbConnection.guardedDelete('tournaments', tournamentId)
    }
}
