export type PlayerStatus = 'REGISTERED' | 'UNREGISTERED';

export interface Player {
    id: number;
    teamId: number;
    number: string;
    name: string | null;
    status: PlayerStatus;
    displayName: string;
}
