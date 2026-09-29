import { Router } from "express";
import { PhaseDetailController } from "../controller/phase_detail_controller";

export class PhaseDetailRoute {
    public readonly router = Router();

    constructor(controller: PhaseDetailController) {
        this.router.get('/api/phases/:id/memberships', controller.getMemberships)
        this.router.post('/api/phases/:id/memberships', controller.insertMembership)
        this.router.put('/api/phases/:id/memberships/:teamId', controller.updateMembership)
        this.router.delete('/api/phases/:id/memberships/:teamId', controller.deleteMembership)
        this.router.get('/api/phases/:id/classification-rules', controller.getRules)
        this.router.post('/api/phases/:id/classification-rules', controller.insertRule)
        this.router.put('/api/phases/:id/classification-rules/:ruleId', controller.updateRule)
        this.router.delete('/api/phases/:id/classification-rules/:ruleId', controller.deleteRule)
        this.router.get('/api/phases/:id/sanctions', controller.getSanctions)
        this.router.put('/api/phases/:id/teams/:teamId/sanction', controller.upsertSanction)
        this.router.delete('/api/phases/:id/teams/:teamId/sanction', controller.deleteSanction)
        this.router.get('/api/phases/:id/standings', controller.getStandings)
        this.router.get('/api/phases/:id/scoring', controller.getScoring)
        this.router.post('/api/phases/:id/scoring-tables', controller.insertScoringTable)
        this.router.put('/api/phases/:id/scoring-tables/:tableId', controller.updateScoringTable)
    }
}
