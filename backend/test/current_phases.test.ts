import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateCurrentPhases } from '../src/db/current_phases';
import DBConnection from '../src/db/db_connection';

test('migration preserves legacy selections, leaves the other category empty and runs only once', () => {
    const db = new Database(':memory:');
    try {
        db.exec(`CREATE TABLE tournaments(id INTEGER PRIMARY KEY,currentPhaseId INTEGER);
            CREATE TABLE phases(id INTEGER PRIMARY KEY,tournamentId INTEGER,tournamentType TEXT);
            INSERT INTO phases VALUES(10,1,'MALE'),(11,1,'FEMALE'),(20,2,'FEMALE');
            INSERT INTO tournaments VALUES(1,10),(2,20),(3,NULL);`);
        migrateCurrentPhases(db);
        assert.deepEqual(db.prepare('SELECT * FROM tournaments ORDER BY id').all(), [
            { id: 1, currentPhaseId: 10, currentMalePhaseId: 10, currentFemalePhaseId: null },
            { id: 2, currentPhaseId: 20, currentMalePhaseId: null, currentFemalePhaseId: 20 },
            { id: 3, currentPhaseId: null, currentMalePhaseId: null, currentFemalePhaseId: null },
        ]);
        db.exec('UPDATE tournaments SET currentMalePhaseId=NULL,currentFemalePhaseId=11 WHERE id=1');
        migrateCurrentPhases(db);
        assert.deepEqual(db.prepare('SELECT currentMalePhaseId,currentFemalePhaseId FROM tournaments WHERE id=1').get(), { currentMalePhaseId: null, currentFemalePhaseId: 11 });
        assert.equal(db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM phases').get()!.count, 3);
    } finally { db.close(); }
});

test('invalid legacy references abort migration without partially adding columns', () => {
    const db = new Database(':memory:');
    try {
        db.exec(`CREATE TABLE tournaments(id INTEGER PRIMARY KEY,currentPhaseId INTEGER);
            CREATE TABLE phases(id INTEGER PRIMARY KEY,tournamentId INTEGER,tournamentType TEXT);
            INSERT INTO phases VALUES(10,2,'MALE'); INSERT INTO tournaments VALUES(1,10);`);
        assert.throws(() => migrateCurrentPhases(db), /referencias/);
        assert.equal(db.prepare('PRAGMA table_info(tournaments)').all().length, 2);
    } finally { db.close(); }
});

test('changing or deleting a phase clears only its category selection', () => {
    const db = new DBConnection(':memory:');
    const tournament = db.insertTournamentInDatabase('Paralelo', true)!;
    const male = db.insertPhase({ tournamentId: tournament.id, name: 'Masculina', type: 'TABLE', sortOrder: 1, tournamentType: 'MALE' })!;
    const female = db.insertPhase({ tournamentId: tournament.id, name: 'Femenina', type: 'TABLE', sortOrder: 1, tournamentType: 'FEMALE' })!;
    db.updateTournament(tournament.id, tournament.name, true, male.id, female.id, male.id);
    db.updatePhase(male.id, { ...male, tournamentType: 'FEMALE' });
    assert.equal(db.fetchOneElementFromTable<any>('tournaments', tournament.id).currentMalePhaseId, null);
    assert.equal(db.fetchOneElementFromTable<any>('tournaments', tournament.id).currentFemalePhaseId, female.id);
    db.deletePhase(female.id);
    assert.equal(db.fetchOneElementFromTable<any>('tournaments', tournament.id).currentFemalePhaseId, null);
});
