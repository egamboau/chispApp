import DBConnection from "../db/db_connection";
import { MatchPlayerScoring, MatchPlayerScoringInput } from "../models/match_player_scoring";

const scoringSelect = `SELECT s.*,p.teamId,p.number playerNumber
    FROM match_player_scoring s JOIN players p ON p.id=s.playerId`;

export class MatchPlayerScoringRepository {
    constructor(private readonly dbConnection: DBConnection) {}

    getForMatch(matchId: number): MatchPlayerScoring[] {
        return this.dbConnection.fetchAllFromParameterizedQuery<MatchPlayerScoring>(`${scoringSelect} WHERE s.matchId=? ORDER BY p.number`, matchId)
    }

    save(scoring: MatchPlayerScoringInput): MatchPlayerScoring {
        this.dbConnection.executeNamedQuery(`INSERT INTO match_player_scoring(matchId,playerId,directGoals,horquetas,pepitas)
            VALUES(@matchId,@playerId,@directGoals,@horquetas,@pepitas)
            ON CONFLICT(matchId,playerId) DO UPDATE SET directGoals=excluded.directGoals,horquetas=excluded.horquetas,pepitas=excluded.pepitas`, scoring)
        return this.dbConnection.fetchOneFromQuery<MatchPlayerScoring>(`${scoringSelect} WHERE s.matchId=? AND s.playerId=?`, scoring.matchId, scoring.playerId)!
    }

    delete(matchId: number, playerId: number): boolean {
        return this.dbConnection.executeQuery('DELETE FROM match_player_scoring WHERE matchId=? AND playerId=?', matchId, playerId).changes > 0
    }
}
