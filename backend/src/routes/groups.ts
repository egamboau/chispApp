import { Router } from "express";
import { GroupController } from "../controller/group_controller";

export class GroupRoute {
    public readonly router = Router();

    constructor(private readonly groupController: GroupController) {
        this.router.get('/api/phases/:id/groups', this.groupController.getGroupsForPhase)
        this.router.post('/api/phases/:id/groups', this.groupController.insertGroup)
        this.router.put('/api/groups/:id', this.groupController.updateGroup)
        this.router.delete('/api/groups/:id', this.groupController.deleteGroup)
    }
}
