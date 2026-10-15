import DBConnection from "../db/db_connection";
import { MatchPlayerScoring, MatchPlayerScoringInput } from "../models/match_player_scoring";

const scoringSelect = `SELECT s.*,p.teamId,p.number playerNumber
    FROM match_player_scoring s JOIN players p ON p.id=s.playerId`;

export class MatchPlayerScoringRepository {
    constructor(private readonly dbConnection: DBConnection) {}

    getForMatch(matchId: number): MatchPlayerScoring[] {
        return this.dbConnection.fetchAllFromParameterizedQuery<MatchPlayerScoring>(`${scoringSelect} WHERE s.matchId=? ORDER BY p.number`, matchId)
    }

    get(matchId: number, playerId: number): MatchPlayerScoring | undefined {
        return this.dbConnection.fetchOneFromQuery<MatchPlayerScoring>(`${scoringSelect} WHERE s.matchId=? AND s.playerId=?`, matchId, playerId)
    }

    insert(scoring: MatchPlayerScoringInput): MatchPlayerScoring {
        this.dbConnection.executeNamedQuery(`INSERT INTO match_player_scoring(matchId,playerId,directGoals,horquetas,pepitas,scoringTable)
            VALUES(@matchId,@playerId,@directGoals,@horquetas,@pepitas,@scoringTable)`, { scoringTable: 'Torneo Regular', ...scoring })
        return this.get(scoring.matchId, scoring.playerId)!
    }

    update(scoring: MatchPlayerScoringInput): MatchPlayerScoring {
        this.dbConnection.executeNamedQuery(`UPDATE match_player_scoring
            SET directGoals=@directGoals,horquetas=@horquetas,pepitas=@pepitas,scoringTable=COALESCE(@scoringTable,scoringTable)
            WHERE matchId=@matchId AND playerId=@playerId`, { scoringTable: null, ...scoring })
        return this.get(scoring.matchId, scoring.playerId)!
    }

    delete(matchId: number, playerId: number): boolean {
        return this.dbConnection.executeQuery('DELETE FROM match_player_scoring WHERE matchId=? AND playerId=?', matchId, playerId).changes > 0
    }
}
