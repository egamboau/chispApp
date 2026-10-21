import { Router } from "express";
import { PhaseController } from "../controller/phase_controller";

export class PhaseRoute {
    private readonly phaseController: PhaseController;
    public readonly router: Router;

    constructor(phaseController:PhaseController) {
        this.phaseController = phaseController
        this.router = Router()
        this.initRoutes()
    }

    private initRoutes() {
        this.router.get("/api/tournaments/:id/phases", this.phaseController.getPhasesForTournament)
        this.router.post('/api/tournaments/:id/phases', this.phaseController.insertPhase)
        this.router.put('/api/phases/:id', this.phaseController.updatePhase)
        this.router.delete('/api/phases/:id', this.phaseController.deletePhase)
    }
}
