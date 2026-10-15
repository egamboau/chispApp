import { Router } from "express";
import { PlayerController } from "../controller/player_controller";

export class PlayerRoute {
    public readonly router = Router();

    constructor(controller: PlayerController) {
        this.router.get('/api/teams/:teamId/players', controller.getPlayersForTeam)
        this.router.post('/api/teams/:teamId/players', controller.insertPlayer)
        this.router.put('/api/players/:id', controller.updatePlayer)
        this.router.patch('/api/players/:id/status', controller.updateStatus)
    }
}
