import type Database from 'better-sqlite3';

/** Copies the legacy selection once; later restarts must preserve intentionally cleared selections. */
export function migrateCurrentPhases(database: Database.Database) {
    const columns = database.prepare<[], { name: string }>('PRAGMA table_info(tournaments)').all();
    database.transaction(() => {
        if (columns.every(item => item.name !== 'currentMalePhaseId') && database.prepare(`SELECT 1 FROM tournaments t WHERE currentPhaseId IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM phases p WHERE p.id=t.currentPhaseId AND p.tournamentId=t.id AND p.tournamentType IN ('MALE','FEMALE'))`).get()) {
            throw new Error('No se pueden migrar las fases actuales: hay referencias de torneo o categoría inválidas.');
        }
        for (const [column, category] of [['currentMalePhaseId', 'MALE'], ['currentFemalePhaseId', 'FEMALE']]) {
            if (columns.some(item => item.name === column)) continue;
            database.exec(`ALTER TABLE tournaments ADD COLUMN ${column} INTEGER REFERENCES phases(id) ON DELETE SET NULL`);
            database.prepare(`UPDATE tournaments SET ${column}=currentPhaseId WHERE EXISTS (
                SELECT 1 FROM phases p WHERE p.id=tournaments.currentPhaseId AND p.tournamentId=tournaments.id AND p.tournamentType=?)`).run(category);
        }
    })();
}
