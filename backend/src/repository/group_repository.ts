import DBConnection from "../db/db_connection";
import { Group } from "../models/group";

export class GroupRepository {
    constructor(private readonly dbConnection: DBConnection) {}

    getGroupsForPhase(phaseId: number): Group[] {
        return this.dbConnection.fetchGroupsForPhase(phaseId)
    }

    getGroup(id: number): Group | undefined {
        return this.dbConnection.fetchOneElementFromTable<Group>('groups_table', id)
    }

    insertGroup(phaseId: number, name: string): Group | undefined {
        return this.dbConnection.insertGroup(phaseId, name)
    }

    updateGroup(id: number, name: string): Group | undefined {
        return this.dbConnection.updateGroup(id, name)
    }

    deleteGroup(id: number): boolean {
        return this.dbConnection.guardedDelete('groups_table', id)
    }
}
