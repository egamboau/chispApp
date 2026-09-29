import { Phase } from "./phases";

export interface Membership {
    phaseId: number;
    groupId: number;
    teamId: number;
    teamName?: string;
    groupName?: string;
}

export interface ClassificationRule {
    id: number;
    phaseId: number;
    startPosition: number;
    endPosition: number;
    positions: string | number[] | null;
    label: string;
}

export interface RuleInput {
    startPosition: number;
    endPosition: number;
    positions: number[];
    label: string;
}

export interface Sanction {
    phaseId: number;
    teamId: number;
    reason: string;
    teamName?: string;
}

export interface Standing {
    teamId: number;
    teamName: string;
    played: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
    points: number;
    yellowCards: number;
    redCards: number;
    sanctioned: boolean;
    sanctionReason: string | null;
    position: number;
    requiresTiebreaker: boolean;
    destination: string | null;
    possibleDestinations: string[];
    tiebreakerRule: string | null;
}

export interface PhaseStandings {
    phase: Phase;
    hasStandings: boolean;
    message?: string;
    rules: ClassificationRule[];
    groups: Array<{ id: number; phaseId: number; name: string; standings: Standing[] }>;
}
