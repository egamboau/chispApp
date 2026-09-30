export interface Match {
    id: number;
    tournamentType:string;
    date:string;
    jornada:string;
    teamA:string;
    teamB:string;
    lineTeam:string | null;
    court:number;
    sortOrder:number | null;
    scoreA:number;
    scoreB:number;
    status:'SCHEDULED' | 'LIVE' | 'FINISHED';
    createdAt:string;
    updatedAt:string;
    phaseId:number;
    groupId:number;
    teamAId:number;
    teamBId:number;
    lineTeamId:number | null;
    yellowCardsA:number;
    redCardsA:number;
    yellowCardsB:number
    redCardsB:number
    tournamentName?: string;
    phaseName?: string;
    groupName?: string;
    lineVisible?: number;
}

export interface MatchInput {
    phaseId: number;
    groupId: number;
    teamAId: number;
    teamBId: number;
    lineTeamId: number;
    tournamentType: string;
    teamA: string;
    teamB: string;
    lineTeam: string;
    date: string;
    jornada: string;
    court: number;
    sortOrder: number | null;
}

export interface MatchFilters {
    phaseId?: number;
    groupId?: number;
    tournamentType?: string;
    status?: string;
    date?: string;
}
