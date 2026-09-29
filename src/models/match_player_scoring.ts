export interface MatchPlayerScoring {
    matchId: number;
    playerId: number;
    directGoals: number;
    horquetas: number;
    pepitas: number;
    scoringTable: string;
    total: number;
    teamId: number;
    playerNumber: string;
}

export type MatchPlayerScoringInput = Pick<MatchPlayerScoring, 'matchId' | 'playerId' | 'directGoals' | 'horquetas' | 'pepitas'> & Partial<Pick<MatchPlayerScoring, 'scoringTable'>>;
