import Database from "better-sqlite3";
import DBConnection, { DatabaseConnectionError } from "../db/db_connection";
import { Team } from "../models/team";

export class TeamRepository {
    constructor(private readonly dbConnection: DBConnection) {}

    getTeams(): Team[] {
        return this.dbConnection.getAllTeams()

    }

    getTeamByTournament(tournamentId:number): Team[]{
        return this.dbConnection.getTeamsByTournament(tournamentId)
    }

    getTeamByTournamentType(tournamentType: string): Team[] {
        return this.dbConnection.getTeamsByTournamentType(tournamentType)
    }


    getTeam(id: number): Team | undefined {
        return this.dbConnection.fetchOneElementFromTable<Team>('teams', id)
    }

    insertTeam(tournamentType: string, tournamentId: number, name: string): Team | undefined {
        try {
            return this.dbConnection.insertTeam(tournamentType, tournamentId, name)
        } catch (error) {
            this.throwDuplicate(error)
        }
    }

    updateTeam(id: number, name: string): Team | undefined {
        try {
            this.dbConnection.updateTeam(id, name)
            return this.getTeam(id)
        } catch (error) {
            this.throwDuplicate(error)
        }
    }

    deleteTeam(id: number): boolean {
        return this.dbConnection.guardedDelete('teams', id)
    }

    private throwDuplicate(error: unknown): never {
        if (error instanceof Database.SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            throw new DatabaseConnectionError('DuplicateTeamError', 'Ese equipo ya existe en el torneo.', error)
        }
        throw error
    }
}
