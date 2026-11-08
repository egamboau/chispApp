import type Database from 'better-sqlite3';
import { createMatchReferences, migrateMatchParticipants } from './match_participants';
import { migrateMembershipSlots } from './membership_slots';

/** Rebuilds legacy CHECK constraints and guards atomically, retaining every reference and slot ID. */
export function migrateMatchOutcomes(database: Database.Database): void {
    database.transaction(() => {
        const tables = ['match_participant_references', 'membership_slots'];
        const legacy = tables.flatMap(name => {
            const row = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name) as { sql: string } | undefined;
            return row && !row.sql.includes('MATCH_LOSER') ? [{ name, sql: row.sql }] : [];
        });
        if (!legacy.length) return;
        // Reinstall the views and triggers below with loser-aware validation and cycle detection.
        const guards = database.prepare("SELECT type,name FROM sqlite_master WHERE (type='trigger' AND (name LIKE 'match_reference_%' OR name LIKE 'membership_slot_guard_%')) OR (type='view' AND name IN ('invalid_match_references','invalid_membership_slots'))").all() as Array<{ type: string; name: string }>;
        for (const guard of guards) database.exec(`DROP ${guard.type} "${guard.name}"`);
        for (const { name, sql } of legacy) {
            const replacement = sql.replace(name, `${name}_outcomes`)
                .replaceAll("'GROUP_POSITION','MATCH_WINNER'", "'GROUP_POSITION','MATCH_WINNER','MATCH_LOSER'")
                .replaceAll("kind='MATCH_WINNER'", "kind IN ('MATCH_WINNER','MATCH_LOSER')");
            database.exec(replacement);
            database.exec(`INSERT INTO ${name}_outcomes SELECT * FROM ${name}`);
            database.exec(`DROP TABLE ${name}`);
            database.exec(`ALTER TABLE ${name}_outcomes RENAME TO ${name}`);
        }
        createMatchReferences(database);
        migrateMatchParticipants(database);
        migrateMembershipSlots(database);
    })();
}
