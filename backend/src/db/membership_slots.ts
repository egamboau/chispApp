import type Database from 'better-sqlite3';

/** Adds reference-backed places without rebuilding or changing historical team memberships. */
export function migrateMembershipSlots(database: Database.Database): void {
    database.exec(`CREATE TABLE IF NOT EXISTS membership_slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phaseId INTEGER NOT NULL REFERENCES phases(id) ON DELETE RESTRICT,
        groupId INTEGER NOT NULL REFERENCES groups_table(id) ON DELETE RESTRICT,
        kind TEXT NOT NULL CHECK(kind IN ('GROUP_POSITION','MATCH_WINNER','MATCH_LOSER')),
        sourcePhaseId INTEGER REFERENCES phases(id) ON DELETE RESTRICT,
        sourceGroupId INTEGER REFERENCES groups_table(id) ON DELETE RESTRICT,
        position INTEGER CHECK(position IS NULL OR (typeof(position)='integer' AND position>0)),
        sourceMatchId INTEGER REFERENCES matches(id) ON DELETE RESTRICT,
        resolvedTeamId INTEGER REFERENCES teams(id) ON DELETE RESTRICT,
        CHECK((kind='GROUP_POSITION' AND sourcePhaseId IS NOT NULL AND sourceGroupId IS NOT NULL AND position IS NOT NULL AND sourceMatchId IS NULL)
           OR (kind IN ('MATCH_WINNER','MATCH_LOSER') AND sourceMatchId IS NOT NULL AND sourcePhaseId IS NULL AND sourceGroupId IS NULL AND position IS NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS membership_slot_position ON membership_slots(phaseId,sourcePhaseId,sourceGroupId,position) WHERE kind='GROUP_POSITION';
    CREATE UNIQUE INDEX IF NOT EXISTS membership_slot_winner ON membership_slots(phaseId,kind,sourceMatchId) WHERE kind IN ('MATCH_WINNER','MATCH_LOSER');
    CREATE UNIQUE INDEX IF NOT EXISTS membership_slot_team ON membership_slots(phaseId,resolvedTeamId) WHERE resolvedTeamId IS NOT NULL;
    CREATE VIEW IF NOT EXISTS invalid_membership_slots AS
        SELECT r.id FROM membership_slots r
        LEFT JOIN phases destination ON destination.id=r.phaseId
        LEFT JOIN groups_table target ON target.id=r.groupId
        LEFT JOIN matches m ON m.id=r.sourceMatchId
        LEFT JOIN phases source ON source.id=CASE r.kind WHEN 'GROUP_POSITION' THEN r.sourcePhaseId ELSE m.phaseId END
        LEFT JOIN groups_table g ON g.id=r.sourceGroupId
        WHERE source.id IS NULL OR destination.id IS NULL OR target.phaseId<>destination.id
           OR source.tournamentId<>destination.tournamentId OR source.tournamentType IS NOT destination.tournamentType
           OR source.sortOrder>=destination.sortOrder
           OR (r.kind='GROUP_POSITION' AND (source.type<>'TABLE' OR g.phaseId<>source.id
               OR r.position>(SELECT COUNT(*) FROM phase_memberships pm WHERE pm.phaseId=source.id AND pm.groupId=g.id)))
           OR (r.kind IN ('MATCH_WINNER','MATCH_LOSER') AND (source.type<>'ELIMINATION' OR m.tournamentType IS NOT source.tournamentType));`);
    const guard = `SELECT RAISE(ABORT,'Referencia de cupo inválida: revisa origen, torneo, categoría y orden de fase.') WHERE EXISTS(SELECT 1 FROM invalid_membership_slots);`;
    for (const [name, event, table] of [
        ['slot_insert', 'INSERT', 'membership_slots'], ['slot_update', 'UPDATE', 'membership_slots'],
        ['phase', 'UPDATE', 'phases'], ['group', 'UPDATE', 'groups_table'],
        ['match', 'UPDATE OF phaseId,tournamentType', 'matches'],
        ['member_delete', 'DELETE', 'phase_memberships'], ['member_update', 'UPDATE', 'phase_memberships'],
    ]) database.exec(`CREATE TRIGGER IF NOT EXISTS membership_slot_guard_${name} AFTER ${event} ON ${table} BEGIN ${guard} END;`);
}
