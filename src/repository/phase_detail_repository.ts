import Database from "better-sqlite3";
import DBConnection, { DatabaseConnectionError } from "../db/db_connection";
import { Group } from "../models/group";
import { Match } from "../models/match";
import { ClassificationRule, Membership, RuleInput, Sanction, ScoringRow, ScoringTable } from "../models/phase_details";
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

    getScoring(tournamentId: number, tournamentType: string): ScoringRow[] {
        return this.dbConnection.fetchAllFromParameterizedQuery<ScoringRow>(`SELECT s.scoringTable,p.id playerId,p.teamId,t.name teamName,p.number playerNumber,p.name playerName,
            SUM(s.directGoals) directGoals,SUM(s.pepitas) pepitas,SUM(s.horquetas) horquetas,SUM(s.total) total
            FROM match_player_scoring s
            JOIN matches m ON m.id=s.matchId
            JOIN phases ph ON ph.id=m.phaseId
            JOIN players p ON p.id=s.playerId
            JOIN teams t ON t.id=p.teamId
            WHERE ph.tournamentId=? AND m.tournamentType=? AND m.status='FINISHED'
            GROUP BY s.scoringTable,p.id,p.teamId,t.name,p.number,p.name`, tournamentId, tournamentType)
    }

    getScoringTables(tournamentId: number, tournamentType: string): ScoringTable[] {
        return this.dbConnection.fetchAllFromParameterizedQuery<ScoringTable>('SELECT * FROM scoring_tables WHERE tournamentId=? AND tournamentType=? ORDER BY name COLLATE NOCASE', tournamentId, tournamentType)
    }

    insertScoringTable(tournamentId: number, tournamentType: string, name: string): ScoringTable {
        const result = this.dbConnection.executeQuery('INSERT INTO scoring_tables(tournamentId,tournamentType,name) VALUES(?,?,?)', tournamentId, tournamentType, name)
        return this.dbConnection.fetchOneElementFromTable<ScoringTable>('scoring_tables', result.lastInsertRowid)!
    }

    updateScoringTable(id: number, tournamentId: number, tournamentType: string, name: string): ScoringTable | undefined {
        const current = this.dbConnection.fetchOneFromQuery<ScoringTable>('SELECT * FROM scoring_tables WHERE id=? AND tournamentId=? AND tournamentType=?', id, tournamentId, tournamentType)
        if (!current) return undefined
        return this.dbConnection.transaction(() => {
            this.dbConnection.executeQuery('UPDATE scoring_tables SET name=? WHERE id=?', name, current.id)
            this.dbConnection.executeQuery(`UPDATE match_player_scoring SET scoringTable=? WHERE scoringTable=? COLLATE NOCASE AND matchId IN
                (SELECT m.id FROM matches m JOIN phases p ON p.id=m.phaseId WHERE p.tournamentId=? AND m.tournamentType=?)`, name, current.name, tournamentId, tournamentType)
            return this.dbConnection.fetchOneElementFromTable<ScoringTable>('scoring_tables', current.id)!
        })
    }

    getGroups(phaseId: number): Group[] {
        return this.dbConnection.fetchGroupsForPhase(phaseId)
    }

    getGroupMembers(phaseId: number, groupId: number): Team[] {
        return this.dbConnection.fetchAllFromParameterizedQuery<Team>('SELECT t.* FROM phase_memberships pm JOIN teams t ON t.id=pm.teamId WHERE pm.phaseId=? AND pm.groupId=?', phaseId, groupId)
    }
}
