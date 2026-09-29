import { Group } from "../models/group";
import { GroupRepository } from "../repository/group_repository";

export class GroupService {
    constructor(private readonly groupRepository: GroupRepository) {}

    getGroupsForPhase(phaseId: number): Group[] {
        return this.groupRepository.getGroupsForPhase(phaseId)
    }

    getGroup(id: number): Group | undefined {
        return this.groupRepository.getGroup(id)
    }

    insertGroup(phaseId: number, name: string): Group | undefined {
        return this.groupRepository.insertGroup(phaseId, name)
    }

    updateGroup(id: number, name: string): Group | undefined {
        return this.groupRepository.updateGroup(id, name)
    }

    deleteGroup(id: number): boolean {
        return this.groupRepository.deleteGroup(id)
    }
}
