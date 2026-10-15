import DBConnection, { DatabaseConnectionError } from "../db/db_connection";
import { Player, PlayerStatus } from "../models/player";

const playerQuery = `SELECT p.*,CASE WHEN p.name IS NULL THEN 'Equipo '||t.name||' - Número '||p.number ELSE p.name END displayName
    FROM players p JOIN teams t ON t.id=p.teamId`;

export class PlayerRepository {
    constructor(private readonly dbConnection: DBConnection) {}

    getPlayersForTeam(teamId: number): Player[] {
        return this.dbConnection.fetchAllFromParameterizedQuery<Player>(`${playerQuery} WHERE p.teamId=? ORDER BY p.status,p.number`, teamId)
    }

    getPlayer(id: number): Player | undefined {
        return this.dbConnection.fetchOneFromQuery<Player>(`${playerQuery} WHERE p.id=?`, id)
    }

    insertPlayer(teamId: number, number: string, name: string | null): Player | undefined {
        try {
            const result = this.dbConnection.executeQuery('INSERT INTO players(teamId,number,name) VALUES(?,?,?)', teamId, number, name)
            return this.getPlayer(Number(result.lastInsertRowid))
        } catch (error) {
            this.throwDuplicate(error)
        }
    }

    updatePlayer(id: number, number: string, name: string | null): Player | undefined {
        try {
            this.dbConnection.executeQuery('UPDATE players SET number=?,name=? WHERE id=?', number, name, id)
            return this.getPlayer(id)
        } catch (error) {
            this.throwDuplicate(error)
        }
    }

    updateStatus(id: number, status: PlayerStatus): Player | undefined {
        this.dbConnection.executeQuery('UPDATE players SET status=? WHERE id=?', status, id)
        return this.getPlayer(id)
    }

    private throwDuplicate(error: unknown): never {
        if (error instanceof DatabaseConnectionError && error.name === 'UniqueConstraintError') {
            throw new DatabaseConnectionError('DuplicatePlayerError', 'Ese número ya está inscrito en el equipo.', error)
        }
        throw error
    }
}
