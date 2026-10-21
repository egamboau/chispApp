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
    teamAId:number | null;
    teamBId:number | null;
    lineTeamId:number | null;
    yellowCardsA:number;
    redCardsA:number;
    yellowCardsB:number
    redCardsB:number
    tournamentName?: string;
    phaseName?: string;
    groupName?: string;
    lineVisible?: number;
    participants?: MatchParticipantDetails;
}

export type MatchParticipant =
    | { kind: 'TEAM'; teamId: number }
    | { kind: 'GROUP_POSITION'; sourcePhaseId: number; sourceGroupId: number; position: number }
    | { kind: 'MATCH_WINNER'; sourceMatchId: number };

export type MatchParticipants = Record<'teamA' | 'teamB' | 'lineTeam', MatchParticipant>;

export type ParticipantMatchInput = Pick<MatchInput, 'phaseId' | 'groupId' | 'date' | 'jornada' | 'court' | 'sortOrder'> & {
    participants: MatchParticipants;
};

export type StoredMatchParticipants = Record<keyof MatchParticipants, {
    reference: MatchParticipant;
    resolvedTeamId: number | null;
}>;

export type ParticipantResolutionStatus = 'PENDING' | 'RESOLVED' | 'CONFIRMED';

export type MatchParticipantDetails = Record<keyof MatchParticipants, {
    reference: MatchParticipant;
    resolvedTeamId: number | null;
    resolvedTeam: { id: number; name: string } | null;
    status: ParticipantResolutionStatus;
} | null>;

export interface MatchInput {
    phaseId: number;
    groupId: number;
    teamAId: number | null;
    teamBId: number | null;
    lineTeamId: number | null;
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
