import DBConnection, { DatabaseConnectionError } from "../db/db_connection";
import { Group } from "../models/group";
import { Match, MatchFilters, MatchInput, MatchParticipant, MatchParticipants, StoredMatchParticipants, MatchParticipantDetails } from "../models/match";
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

    getMatch(id: number, includeParticipants = true): Match | undefined {
        const match = this.dbConnection.fetchOneFromQuery<Match>(`${matchSelect} WHERE m.id=?`, id)
        return match && (includeParticipants ? this.withParticipants(match) : match)
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
        const matches = clauses.length ? this.dbConnection.fetchAllFromNamedQuery<Match>(query, params) : this.dbConnection.fetchAllFromQuery<Match>(query)
        return matches.map(match => this.withParticipants(match))
    }

    getCurrentPhase(tournamentType: string): Phase | undefined {
        return this.dbConnection.fetchOneFromQuery<Phase>("SELECT p.* FROM phases p JOIN tournaments t ON p.id=CASE WHEN p.tournamentType='MALE' THEN t.currentMalePhaseId ELSE t.currentFemalePhaseId END WHERE t.legacyType=? AND p.tournamentType=t.legacyType", tournamentType)
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

    insertMatch(match: MatchInput, includeParticipants = true): Match {
        const result = this.dbConnection.executeNamedQuery('INSERT INTO matches(tournamentType,date,jornada,teamA,teamB,lineTeam,court,sortOrder,phaseId,groupId,teamAId,teamBId,lineTeamId) VALUES(@tournamentType,@date,@jornada,@teamA,@teamB,@lineTeam,@court,@sortOrder,@phaseId,@groupId,@teamAId,@teamBId,@lineTeamId)', match)
        return this.getMatch(Number(result.lastInsertRowid), includeParticipants)!
    }

    updateMatch(id: number, match: MatchInput, includeParticipants = true): Match {
        if (this.hasParticipantReferences(id)) throw new DatabaseConnectionError('ParticipantReferenceError', 'Este partido requiere editar sus referencias de participantes.', undefined)
        this.dbConnection.executeNamedQuery('UPDATE matches SET tournamentType=@tournamentType,date=@date,jornada=@jornada,teamA=@teamA,teamB=@teamB,lineTeam=@lineTeam,court=@court,sortOrder=@sortOrder,phaseId=@phaseId,groupId=@groupId,teamAId=@teamAId,teamBId=@teamBId,lineTeamId=@lineTeamId,updatedAt=CURRENT_TIMESTAMP WHERE id=@id', { ...match, id })
        return this.getMatch(id, includeParticipants)!
    }

    hasParticipantReferences(id: number): boolean {
        return Boolean(this.dbConnection.fetchOneFromQuery('SELECT 1 FROM match_participant_references WHERE matchId=?', id))
    }

    getMatchParticipants(id: number): StoredMatchParticipants | undefined {
        const match = this.dbConnection.fetchOneFromQuery<Match>(`${matchSelect} WHERE m.id=?`, id)
        if (!match) return undefined
        type ReferenceRow = Exclude<MatchParticipant, { kind: 'TEAM' }> & { role: keyof MatchParticipants }
        const references = this.dbConnection.fetchAllFromParameterizedQuery<ReferenceRow>('SELECT * FROM match_participant_references WHERE matchId=?', id)
        const participant = (role: keyof MatchParticipants): StoredMatchParticipants[keyof StoredMatchParticipants] => {
            const row = references.find(reference => reference.role === role)
            const resolvedTeamId = match[`${role}Id`]
            let reference: MatchParticipant
            if (row?.kind === 'GROUP_POSITION') reference = { kind: row.kind, sourcePhaseId: row.sourcePhaseId, sourceGroupId: row.sourceGroupId, position: row.position }
            else if (row?.kind === 'MATCH_WINNER') reference = { kind: row.kind, sourceMatchId: row.sourceMatchId }
            else {
                if (role === 'lineTeam' && resolvedTeamId === null) return null
                if (resolvedTeamId === null) throw new DatabaseConnectionError('ParticipantReferenceError', 'El equipo fijo no tiene un ID válido.', undefined)
                reference = { kind: 'TEAM', teamId: resolvedTeamId }
            }
            return { reference, resolvedTeamId }
        }
        return { teamA: participant('teamA')!, teamB: participant('teamB')!, lineTeam: participant('lineTeam') }
    }

    private withParticipants(match: Match): Match {
        const stored = this.getMatchParticipants(match.id)!
        const displayed = { ...match, lineTeam: match.lineTeam || null }
        const participants = {} as MatchParticipantDetails
        for (const role of ['teamA', 'teamB', 'lineTeam'] as const) {
            const item = stored[role]
            if (!item) { participants[role] = null; continue }
            const { reference, resolvedTeamId } = item
            const confirmed = reference.kind === 'TEAM' || (reference.kind === 'GROUP_POSITION' && Boolean(
                this.dbConnection.fetchOneFromQuery('SELECT 1 FROM phase_position_confirmations WHERE phaseId=?', reference.sourcePhaseId)))
            participants[role] = {
                reference, resolvedTeamId,
                resolvedTeam: resolvedTeamId === null ? null : { id: resolvedTeamId, name: match[role]! },
                status: resolvedTeamId === null ? 'PENDING' : confirmed ? 'CONFIRMED' : 'RESOLVED',
            }
            if (match.status === 'SCHEDULED' && reference.kind === 'GROUP_POSITION' && !confirmed) {
                const phase = this.dbConnection.fetchOneFromQuery<Phase>('SELECT * FROM phases WHERE id=?', reference.sourcePhaseId)!
                const group = this.dbConnection.fetchOneFromQuery<Group>('SELECT * FROM groups_table WHERE id=?', reference.sourceGroupId)!
                displayed[role] = `${phase.name} · ${reference.position}.º ${group.name}`
            }
        }
        return { ...displayed, participants }
    }

    saveParticipantMatch(match: MatchInput, participants: MatchParticipants, id?: number): Match {
        return this.dbConnection.transaction(() => {
            if (id !== undefined) {
                const existing = this.getMatch(id)
                if (!existing || existing.status !== 'SCHEDULED') throw new DatabaseConnectionError('ParticipantReferenceError', 'Solo se puede editar un partido programado existente.', undefined)
                this.dbConnection.executeQuery('DELETE FROM match_participant_references WHERE matchId=?', id)
            }
            const saved = id === undefined ? this.insertMatch(match, false) : this.updateMatch(id, match, false)
            for (const role of ['teamA', 'teamB', 'lineTeam'] as const) {
                const reference = participants[role]
                if (!reference || reference.kind === 'TEAM') continue
                this.dbConnection.executeQuery(`INSERT INTO match_participant_references(matchId,role,kind,sourcePhaseId,sourceGroupId,position,sourceMatchId)
                    VALUES(?,?,?,?,?,?,?)`, saved.id, role, reference.kind,
                    reference.kind === 'GROUP_POSITION' ? reference.sourcePhaseId : null,
                    reference.kind === 'GROUP_POSITION' ? reference.sourceGroupId : null,
                    reference.kind === 'GROUP_POSITION' ? reference.position : null,
                    reference.kind === 'MATCH_WINNER' ? reference.sourceMatchId : null)
            }
            return this.getMatch(saved.id)!
        })
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
        if (to === 'LIVE' && from === 'SCHEDULED') {
            const match = this.getMatch(id)
            if (!match || Object.values(match.participants!).some(item => item !== null && item.resolvedTeamId === null)) return false
            if (this.dbConnection.fetchOneFromQuery(`SELECT 1 FROM match_participant_references r
                LEFT JOIN phase_position_confirmations c ON c.phaseId=r.sourcePhaseId
                WHERE r.matchId=? AND r.kind='GROUP_POSITION' AND c.phaseId IS NULL`, id)) return false
        }
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
