import { Router } from "express";
import { TeamController } from "../controller/team_controller";

export class TeamRoute {
    public readonly router = Router();

    constructor(controller: TeamController) {
        this.router.get('/api/teams', controller.getTeams)
        this.router.post('/api/teams', controller.insertTeam)
        this.router.put('/api/teams/:id', controller.updateTeam)
        this.router.delete('/api/teams/:id', controller.deleteTeam)
    }
}
