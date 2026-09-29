import { Router } from "express";
import { MatchController } from "../controller/match_controller";

export class MatchRoute {
    public readonly router = Router();

    constructor(controller: MatchController) {
        this.router.put('/api/line-visibility/:date', controller.setLineVisibility)
        this.router.get('/api/matches', controller.getMatches)
        this.router.get('/api/matches/:id', controller.getMatch)
        this.router.post('/api/matches', controller.insertMatch)
        this.router.put('/api/matches/:id', controller.updateMatch)
        this.router.delete('/api/matches/:id', controller.deleteMatch)
        this.router.post('/api/matches/:id/start', controller.startMatch)
        this.router.post('/api/matches/:id/finish', controller.finishMatch)
        this.router.post('/api/matches/:id/reopen', controller.reopenMatch)
        this.router.patch('/api/matches/:id/score', controller.changeScore)
        this.router.patch('/api/matches/:id/result', controller.setResult)
        this.router.post('/api/matches/:id/reset', controller.resetScore)
        this.router.patch('/api/matches/:id/cards', controller.setCards)
    }
}
