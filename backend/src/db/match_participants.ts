import type Database from 'better-sqlite3';

export function createMatchReferences(database: Database.Database): void {
    database.exec(`CREATE TABLE IF NOT EXISTS phase_position_confirmations (
        phaseId INTEGER PRIMARY KEY REFERENCES phases(id) ON DELETE CASCADE,
        snapshot TEXT NOT NULL,
        confirmedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS match_participant_references (
        matchId INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('teamA','teamB','lineTeam')),
        kind TEXT NOT NULL CHECK(kind IN ('GROUP_POSITION','MATCH_WINNER')),
        sourcePhaseId INTEGER REFERENCES phases(id) ON DELETE RESTRICT,
        sourceGroupId INTEGER REFERENCES groups_table(id) ON DELETE RESTRICT,
        position INTEGER CHECK(position IS NULL OR (typeof(position)='integer' AND position>0)),
        sourceMatchId INTEGER REFERENCES matches(id) ON DELETE RESTRICT,
        PRIMARY KEY(matchId,role),
        CHECK((kind='GROUP_POSITION' AND sourcePhaseId IS NOT NULL AND sourceGroupId IS NOT NULL AND position IS NOT NULL AND sourceMatchId IS NULL)
           OR (kind='MATCH_WINNER' AND sourceMatchId IS NOT NULL AND sourcePhaseId IS NULL AND sourceGroupId IS NULL AND position IS NULL))
    );
    CREATE INDEX IF NOT EXISTS match_reference_phase ON match_participant_references(sourcePhaseId);
    CREATE INDEX IF NOT EXISTS match_reference_group ON match_participant_references(sourceGroupId);
    CREATE INDEX IF NOT EXISTS match_reference_match ON match_participant_references(sourceMatchId);`);
}

export function migrateMatchParticipants(database: Database.Database): void {
    database.transaction(() => {
        // Legacy rows may have names only; never interpret a reference label as a team.
        for (const role of ['teamA', 'teamB', 'lineTeam']) {
            database.exec(`UPDATE matches SET ${role}Id=(SELECT id FROM teams
                WHERE teams.name=matches.${role} COLLATE NOCASE AND teams.tournamentType=matches.tournamentType)
                WHERE ${role}Id IS NULL AND NOT EXISTS(SELECT 1 FROM match_participant_references r WHERE r.matchId=matches.id AND r.role='${role}')`);
        }

        database.exec(`CREATE VIEW IF NOT EXISTS invalid_match_references AS
            SELECT r.matchId FROM match_participant_references r
            JOIN matches m ON m.id=r.matchId
            LEFT JOIN phases destination ON destination.id=m.phaseId
            LEFT JOIN matches sourceMatch ON sourceMatch.id=r.sourceMatchId
            LEFT JOIN phases source ON source.id=CASE r.kind WHEN 'GROUP_POSITION' THEN r.sourcePhaseId ELSE sourceMatch.phaseId END
            LEFT JOIN groups_table g ON g.id=r.sourceGroupId
            WHERE destination.id IS NULL OR source.id IS NULL
                OR source.tournamentId<>destination.tournamentId OR source.tournamentType IS NOT destination.tournamentType
                OR m.tournamentType IS NOT destination.tournamentType
                OR (r.kind='GROUP_POSITION' AND (source.type<>'TABLE' OR g.phaseId<>source.id
                    OR source.sortOrder>=destination.sortOrder
                    OR r.position>(SELECT COUNT(*) FROM phase_memberships pm WHERE pm.phaseId=source.id AND pm.groupId=g.id)))
                OR (r.kind='MATCH_WINNER' AND (source.type<>'ELIMINATION'
                    OR sourceMatch.tournamentType IS NOT source.tournamentType
                    OR (source.id<>destination.id AND source.sortOrder>=destination.sortOrder)));
        `);

        const validReferences = `SELECT RAISE(ABORT,'La configuración invalida una referencia de participante.')
            WHERE EXISTS(SELECT 1 FROM invalid_match_references);`;
        for (const event of ['INSERT', 'UPDATE']) {
            database.exec(`CREATE TRIGGER IF NOT EXISTS match_reference_${event.toLowerCase()} AFTER ${event} ON match_participant_references BEGIN
                ${validReferences}
                SELECT RAISE(ABORT,'Las referencias de partidos no pueden formar ciclos.') WHERE EXISTS(
                    WITH RECURSIVE dependencies(id) AS (
                        SELECT NEW.sourceMatchId WHERE NEW.kind='MATCH_WINNER'
                        UNION SELECT r.sourceMatchId FROM match_participant_references r JOIN dependencies d ON r.matchId=d.id WHERE r.kind='MATCH_WINNER'
                    ) SELECT 1 FROM dependencies WHERE id=NEW.matchId
                );
                SELECT RAISE(ABORT,'Los participantes deben ser diferentes.') WHERE EXISTS(
                    SELECT 1 FROM match_participant_references r WHERE r.matchId=NEW.matchId AND r.role<>NEW.role
                    AND r.kind=NEW.kind AND r.sourcePhaseId IS NEW.sourcePhaseId AND r.sourceGroupId IS NEW.sourceGroupId
                    AND r.position IS NEW.position AND r.sourceMatchId IS NEW.sourceMatchId
                );
            END;`);
        }
        for (const [name, event, table] of [
            ['phase', 'UPDATE OF type,tournamentId,tournamentType,sortOrder', 'phases'],
            ['group', 'UPDATE OF phaseId', 'groups_table'],
            ['match', 'UPDATE OF phaseId,tournamentType', 'matches'],
            ['membership_update', 'UPDATE', 'phase_memberships'],
            ['membership_delete', 'DELETE', 'phase_memberships'],
        ]) {
            database.exec(`CREATE TRIGGER IF NOT EXISTS match_reference_guard_${name} AFTER ${event} ON ${table} BEGIN ${validReferences} END;`);
        }
    })();
}
