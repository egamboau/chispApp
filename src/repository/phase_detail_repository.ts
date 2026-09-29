import Database from "better-sqlite3";
import DBConnection, { DatabaseConnectionError } from "../db/db_connection";
import { Group } from "../models/group";
import { Match } from "../models/match";
import { ClassificationRule, Membership, RuleInput, Sanction } from "../models/phase_details";
import { Team } from "../models/team";

export class PhaseDetailRepository {
    constructor(private readonly dbConnection: DBConnection) {}

    getMemberships(phaseId: number): Membership[] {
        return this.dbConnection.fetchAllFromParameterizedQuery<Membership>('SELECT pm.*,t.name teamName,g.name groupName FROM phase_memberships pm JOIN teams t ON t.id=pm.teamId JOIN groups_table g ON g.id=pm.groupId WHERE pm.phaseId=? ORDER BY g.name,t.name', phaseId)
    }

    insertMembership(membership: Membership): Membership {
        try {
            this.dbConnection.executeNamedQuery('INSERT INTO phase_memberships VALUES(@phaseId,@groupId,@teamId)', membership)
            return membership
        } catch (error) {
            if (error instanceof Database.SqliteError && error.code?.startsWith('SQLITE_CONSTRAINT')) {
                throw new DatabaseConnectionError('DuplicateMembershipError', 'El equipo ya pertenece a un grupo de esta fase.', error)
            }
            throw error
        }
    }

    teamHasMatches(phaseId: number, teamId: number): boolean {
        return Boolean(this.dbConnection.fetchOneFromQuery('SELECT 1 FROM matches WHERE phaseId=? AND(teamAId=? OR teamBId=?)', phaseId, teamId, teamId))
    }

    updateMembership(phaseId: number, teamId: number, groupId: number): Membership | undefined {
        const result = this.dbConnection.executeQuery('UPDATE phase_memberships SET groupId=? WHERE phaseId=? AND teamId=?', groupId, phaseId, teamId)
        return result.changes ? { phaseId, groupId, teamId } : undefined
    }

    deleteMembership(phaseId: number, teamId: number): boolean {
        return this.dbConnection.executeQuery('DELETE FROM phase_memberships WHERE phaseId=? AND teamId=?', phaseId, teamId).changes > 0
    }

    getRules(phaseId: number): ClassificationRule[] {
        return this.dbConnection.fetchAllFromParameterizedQuery<ClassificationRule>('SELECT * FROM classification_rules WHERE phaseId=? ORDER BY startPosition', phaseId)
    }

    getRule(id: number): ClassificationRule | undefined {
        return this.dbConnection.fetchOneElementFromTable<ClassificationRule>('classification_rules', id)
    }

    insertRule(phaseId: number, rule: RuleInput): ClassificationRule | undefined {
        const result = this.dbConnection.executeQuery('INSERT INTO classification_rules(phaseId,startPosition,endPosition,positions,label) VALUES(?,?,?,?,?)', phaseId, rule.startPosition, rule.endPosition, JSON.stringify(rule.positions), rule.label)
        return this.getRule(Number(result.lastInsertRowid))
    }

    updateRule(id: number, rule: RuleInput): ClassificationRule | undefined {
        this.dbConnection.executeQuery('UPDATE classification_rules SET startPosition=?,endPosition=?,positions=?,label=? WHERE id=?', rule.startPosition, rule.endPosition, JSON.stringify(rule.positions), rule.label, id)
        return this.getRule(id)
    }

    deleteRule(id: number, phaseId: number): boolean {
        return this.dbConnection.executeQuery('DELETE FROM classification_rules WHERE id=? AND phaseId=?', id, phaseId).changes > 0
    }

    getSanctions(phaseId: number): Sanction[] {
        return this.dbConnection.fetchAllFromParameterizedQuery<Sanction>('SELECT s.*,t.name teamName FROM sanctions s JOIN teams t ON t.id=s.teamId WHERE s.phaseId=? ORDER BY t.name', phaseId)
    }

    hasMembership(phaseId: number, teamId: number): boolean {
        return Boolean(this.dbConnection.fetchOneFromQuery('SELECT 1 FROM phase_memberships WHERE phaseId=? AND teamId=?', phaseId, teamId))
    }

    upsertSanction(phaseId: number, teamId: number, reason: string): Sanction {
        this.dbConnection.executeQuery('INSERT INTO sanctions VALUES(?,?,?) ON CONFLICT(phaseId,teamId) DO UPDATE SET reason=excluded.reason', phaseId, teamId, reason)
        return this.dbConnection.fetchOneFromQuery<Sanction>('SELECT * FROM sanctions WHERE phaseId=? AND teamId=?', phaseId, teamId)!
    }

    deleteSanction(phaseId: number, teamId: number): boolean {
        return this.dbConnection.executeQuery('DELETE FROM sanctions WHERE phaseId=? AND teamId=?', phaseId, teamId).changes > 0
    }

    getFinishedMatches(phaseId: number): Match[] {
        return this.dbConnection.fetchAllFromParameterizedQuery<Match>("SELECT * FROM matches WHERE phaseId=? AND status='FINISHED'", phaseId)
    }

    getGroups(phaseId: number): Group[] {
        return this.dbConnection.fetchGroupsForPhase(phaseId)
    }

    getGroupMembers(phaseId: number, groupId: number): Team[] {
        return this.dbConnection.fetchAllFromParameterizedQuery<Team>('SELECT t.* FROM phase_memberships pm JOIN teams t ON t.id=pm.teamId WHERE pm.phaseId=? AND pm.groupId=?', phaseId, groupId)
    }
}
