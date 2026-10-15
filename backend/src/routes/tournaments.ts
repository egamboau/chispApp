import { Router } from "express";
import { TournamentController } from "../controller/tournament_controller";

export class TournamentRoute {
    private readonly tournamentController: TournamentController;
    public readonly router: Router;

    constructor(tournamentController:TournamentController) {
        this.tournamentController = tournamentController
        this.router = Router()
        this.initRoutes()
    }

    private initRoutes() {
        this.router.get("/api/tournaments", this.tournamentController.getTournaments)
        this.router.post('/api/tournaments',this.tournamentController.insertTournament)
        this.router.put('/api/tournaments/:id', this.tournamentController.getTournamentById)
        this.router.delete("/api/tournaments/:id", this.tournamentController.deleteTournamentById)
    }


}
