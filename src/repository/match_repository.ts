import DBConnection from "../db/db_connection";
import { Group } from "../models/group";
import { Match, MatchFilters, MatchInput } from "../models/match";
import { Phase } from "../models/phases";
import { Team } from "../models/team";

const matchSelect = `SELECT m.*,t.name tournamentName,p.name phaseName,g.name groupName,
    EXISTS(SELECT 1 FROM published_line_dates d WHERE d.date=m.date) lineVisible
    FROM matches m
    LEFT JOIN phases p ON p.id=m.phaseId
    LEFT JOIN tournaments t ON t.id=p.tournamentId
    LEFT JOIN groups_table g ON g.id=m.groupId`;

export class MatchRepository {
    constructor(private readonly dbConnection: DBConnection) {}

    getMatch(id: number): Match | undefined {
        return this.dbConnection.fetchOneFromQuery<Match>(`${matchSelect} WHERE m.id=?`, id)
    }

    getMatches(filters: MatchFilters): Match[] {
        const clauses: string[] = []
        const params: Record<string, number | string> = {}
        for (const key of ['phaseId', 'groupId'] as const) {
            if (filters[key]) { clauses.push(`m.${key}=@${key}`); params[key] = filters[key] }
        }
        for (const key of ['tournamentType', 'status', 'date'] as const) {
            if (filters[key]) { clauses.push(`m.${key}=@${key}`); params[key] = filters[key] }
        }
        const query = `${matchSelect}${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY m.date,m.sortOrder IS NULL,m.sortOrder,CASE m.jornada WHEN 'MORNING' THEN 0 ELSE 1 END,m.court,m.id`
        return clauses.length ? this.dbConnection.fetchAllFromNamedQuery<Match>(query, params) : this.dbConnection.fetchAllFromQuery<Match>(query)
    }

    getCurrentPhase(tournamentType: string): Phase | undefined {
        return this.dbConnection.fetchOneFromQuery<Phase>('SELECT p.* FROM phases p JOIN tournaments t ON t.currentPhaseId=p.id WHERE t.legacyType=?', tournamentType)
    }

    getFirstGroup(phaseId: number): Group | undefined {
        return this.dbConnection.fetchOneFromQuery<Group>('SELECT * FROM groups_table WHERE phaseId=? ORDER BY id LIMIT 1', phaseId)
    }

    findTeam(tournamentId: number, name: string): Team | undefined {
        return this.dbConnection.fetchOneFromQuery<Team>('SELECT * FROM teams WHERE tournamentId=? AND name=? COLLATE NOCASE', tournamentId, name)
    }

    insertTeam(tournamentType: string, tournamentId: number, name: string): Team {
        return this.dbConnection.insertTeam(tournamentType, tournamentId, name)!
    }

    insertMembership(phaseId: number, groupId: number, teamId: number): void {
        this.dbConnection.executeQuery('INSERT OR IGNORE INTO phase_memberships VALUES(?,?,?)', phaseId, groupId, teamId)
    }

    hasMembership(phaseId: number, teamId: number, groupId?: number): boolean {
        const sql = `SELECT 1 FROM phase_memberships WHERE phaseId=?${groupId ? ' AND groupId=?' : ''} AND teamId=?`
        return Boolean(groupId
            ? this.dbConnection.fetchOneFromQuery(sql, phaseId, groupId, teamId)
            : this.dbConnection.fetchOneFromQuery(sql, phaseId, teamId))
    }

    insertMatch(match: MatchInput): Match {
        const result = this.dbConnection.executeNamedQuery('INSERT INTO matches(tournamentType,date,jornada,teamA,teamB,lineTeam,court,sortOrder,phaseId,groupId,teamAId,teamBId,lineTeamId) VALUES(@tournamentType,@date,@jornada,@teamA,@teamB,@lineTeam,@court,@sortOrder,@phaseId,@groupId,@teamAId,@teamBId,@lineTeamId)', match)
        return this.getMatch(Number(result.lastInsertRowid))!
    }

    updateMatch(id: number, match: MatchInput): Match {
        this.dbConnection.executeNamedQuery('UPDATE matches SET tournamentType=@tournamentType,date=@date,jornada=@jornada,teamA=@teamA,teamB=@teamB,lineTeam=@lineTeam,court=@court,sortOrder=@sortOrder,phaseId=@phaseId,groupId=@groupId,teamAId=@teamAId,teamBId=@teamBId,lineTeamId=@lineTeamId,updatedAt=CURRENT_TIMESTAMP WHERE id=@id', { ...match, id })
        return this.getMatch(id)!
    }

    updateSortOrder(id: number, sortOrder: number | null): Match | undefined {
        return this.dbConnection.executeQuery('UPDATE matches SET sortOrder=?,updatedAt=CURRENT_TIMESTAMP WHERE id=?', sortOrder, id).changes ? this.getMatch(id) : undefined
    }

    deleteMatch(id: number): boolean {
        return this.dbConnection.executeQuery('DELETE FROM matches WHERE id=?', id).changes > 0
    }

    setLineVisibility(date: string, visible: boolean): void {
        if (visible) this.dbConnection.executeQuery('INSERT OR IGNORE INTO published_line_dates(date) VALUES(?)', date)
        else this.dbConnection.executeQuery('DELETE FROM published_line_dates WHERE date=?', date)
    }

    changeStatus(id: number, from: string, to: string): boolean {
        return this.dbConnection.executeQuery('UPDATE matches SET status=?,updatedAt=CURRENT_TIMESTAMP WHERE id=? AND status=?', to, id, from).changes > 0
    }

    changeScore(id: number, team: 'A' | 'B', delta: number): boolean {
        const column = team === 'A' ? 'scoreA' : 'scoreB'
        return this.dbConnection.executeQuery(`UPDATE matches SET ${column}=${column}+?,updatedAt=CURRENT_TIMESTAMP WHERE id=? AND status='LIVE' AND ${column}+?>=0`, delta, id, delta).changes > 0
    }

    setResult(id: number, scoreA: number, scoreB: number): boolean {
        return this.dbConnection.executeQuery("UPDATE matches SET scoreA=?,scoreB=?,updatedAt=CURRENT_TIMESTAMP WHERE id=? AND status='FINISHED'", scoreA, scoreB, id).changes > 0
    }

    resetScore(id: number): boolean {
        return this.dbConnection.executeQuery("UPDATE matches SET scoreA=0,scoreB=0,updatedAt=CURRENT_TIMESTAMP WHERE id=? AND status='LIVE'", id).changes > 0
    }

    setCards(id: number, cards: Record<string, number>): boolean {
        return this.dbConnection.executeNamedQuery('UPDATE matches SET yellowCardsA=@yellowCardsA,redCardsA=@redCardsA,yellowCardsB=@yellowCardsB,redCardsB=@redCardsB,updatedAt=CURRENT_TIMESTAMP WHERE id=@id', { ...cards, id }).changes > 0
    }
}
