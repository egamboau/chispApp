import { Player, PlayerStatus } from "../models/player";
import { PlayerRepository } from "../repository/player_repository";

export class PlayerService {
    constructor(private readonly playerRepository: PlayerRepository) {}

    getPlayersForTeam(teamId: number): Player[] {
        return this.playerRepository.getPlayersForTeam(teamId)
    }

    getPlayer(id: number): Player | undefined {
        return this.playerRepository.getPlayer(id)
    }

    insertPlayer(teamId: number, number: string, name: string | null): Player | undefined {
        return this.playerRepository.insertPlayer(teamId, number, name)
    }

    updatePlayer(id: number, number: string, name: string | null): Player | undefined {
        return this.playerRepository.updatePlayer(id, number, name)
    }

    updateStatus(id: number, status: PlayerStatus): Player | undefined {
        return this.playerRepository.updateStatus(id, status)
    }
}
