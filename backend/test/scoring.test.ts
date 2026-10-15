import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import DBConnection from '../src/db/db_connection';
import { MatchPlayerScoringRepository } from '../src/repository/match_player_scoring_repository';

test('persiste y permite corregir el goleo agregado por jugador', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jupas-scoring-'));
  const databasePath = path.join(directory, 'test.db');
  try {
    const legacy = new Database(databasePath);
    legacy.exec(`CREATE TABLE matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,tournamentType TEXT NOT NULL,date TEXT NOT NULL,time TEXT NOT NULL,
      teamA TEXT NOT NULL,teamB TEXT NOT NULL,lineTeam TEXT NOT NULL,court INTEGER NOT NULL,
      scoreA INTEGER NOT NULL DEFAULT 0,scoreB INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'SCHEDULED',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    legacy.close();

    const db = new DBConnection(databasePath);
    const teamA = Number(db.executeQuery("INSERT INTO teams(tournamentType,name) VALUES('MALE','A')").lastInsertRowid);
    const teamB = Number(db.executeQuery("INSERT INTO teams(tournamentType,name) VALUES('MALE','B')").lastInsertRowid);
    const teamC = Number(db.executeQuery("INSERT INTO teams(tournamentType,name) VALUES('MALE','C')").lastInsertRowid);
    const playerA = Number(db.executeQuery("INSERT INTO players(teamId,number) VALUES(?,'1')", teamA).lastInsertRowid);
    const playerC = Number(db.executeQuery("INSERT INTO players(teamId,number) VALUES(?,'2')", teamC).lastInsertRowid);
    const matchId = Number(db.executeQuery("INSERT INTO matches(tournamentType,date,jornada,teamA,teamB,lineTeam,court,teamAId,teamBId) VALUES('MALE','2026-09-29','MORNING','A','B','C',1,?,?)", teamA, teamB).lastInsertRowid);
    const scoring = new MatchPlayerScoringRepository(db);

    let saved = scoring.insert({ matchId, playerId: playerA, directGoals: 3, horquetas: 2, pepitas: 1 });
    assert.deepEqual({ total: saved.total, scoringTable: saved.scoringTable }, { total: 11, scoringTable: 'Torneo Regular' });
    saved = scoring.update({ matchId, playerId: playerA, directGoals: 3, horquetas: 1, pepitas: 1, scoringTable: 'Copa' });
    assert.deepEqual({ total: saved.total, scoringTable: saved.scoringTable }, { total: 8, scoringTable: 'Copa' });
    assert.equal(scoring.getForMatch(matchId).length, 1);
    assert.throws(() => scoring.insert({ matchId, playerId: playerC, directGoals: 1, horquetas: 0, pepitas: 0 }));
    assert.throws(() => scoring.update({ matchId, playerId: playerA, directGoals: -1, horquetas: 0, pepitas: 0 }));
    assert.throws(() => scoring.update({ matchId, playerId: playerA, directGoals: 0, horquetas: 0, pepitas: 0 }));
    assert.throws(() => db.executeQuery('UPDATE matches SET teamAId=? WHERE id=?', teamC, matchId));
    assert.throws(() => db.executeQuery('UPDATE players SET teamId=? WHERE id=?', teamC, playerA));

    const reopened = new MatchPlayerScoringRepository(new DBConnection(databasePath));
    assert.equal(reopened.getForMatch(matchId)[0]?.scoringTable, 'Copa');
    assert.equal(reopened.delete(matchId, playerA), true);
    assert.deepEqual(reopened.getForMatch(matchId), []);

    reopened.insert({ matchId, playerId: playerA, directGoals: 1, horquetas: 0, pepitas: 0 });
    db.executeQuery('DELETE FROM matches WHERE id=?', matchId);
    assert.deepEqual(reopened.getForMatch(matchId), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('migra el catálogo de goleo al torneo y conserva sus nombres', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jupas-scoring-migration-'));
  const databasePath = path.join(directory, 'test.db');
  try {
    const legacy = new Database(databasePath);
    legacy.exec(`CREATE TABLE matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,tournamentType TEXT NOT NULL,date TEXT NOT NULL,jornada TEXT NOT NULL,
      teamA TEXT NOT NULL,teamB TEXT NOT NULL,lineTeam TEXT NOT NULL,court INTEGER NOT NULL,
      scoreA INTEGER NOT NULL DEFAULT 0,scoreB INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'FINISHED',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      teamAId INTEGER,teamBId INTEGER,phaseId INTEGER
    );
    CREATE TABLE teams (id INTEGER PRIMARY KEY AUTOINCREMENT,tournamentType TEXT NOT NULL,name TEXT NOT NULL,UNIQUE(tournamentType,name));
    CREATE TABLE players (id INTEGER PRIMARY KEY AUTOINCREMENT,teamId INTEGER NOT NULL,number TEXT NOT NULL,name TEXT,status TEXT NOT NULL DEFAULT 'REGISTERED',UNIQUE(teamId,number));
    CREATE TABLE match_player_scoring (matchId INTEGER NOT NULL,playerId INTEGER NOT NULL,directGoals INTEGER NOT NULL DEFAULT 0,horquetas INTEGER NOT NULL DEFAULT 0,pepitas INTEGER NOT NULL DEFAULT 0,scoringTable TEXT NOT NULL DEFAULT 'Torneo Regular',total INTEGER GENERATED ALWAYS AS(directGoals+pepitas*2+horquetas*3) VIRTUAL,PRIMARY KEY(matchId,playerId));
    CREATE TABLE tournaments (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,currentPhaseId INTEGER,legacyType TEXT UNIQUE);
    CREATE TABLE phases (id INTEGER PRIMARY KEY AUTOINCREMENT,tournamentId INTEGER NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL DEFAULT 'TABLE',tournamentType TEXT,sortOrder INTEGER NOT NULL DEFAULT 1,UNIQUE(tournamentId,name));
    CREATE TABLE scoring_tables (id INTEGER PRIMARY KEY AUTOINCREMENT,tournamentType TEXT NOT NULL,name TEXT NOT NULL COLLATE NOCASE,UNIQUE(tournamentType,name));
    INSERT INTO teams(id,tournamentType,name) VALUES(1,'MALE','A'),(2,'MALE','B');
    INSERT INTO players(id,teamId,number) VALUES(1,1,'7');
    INSERT INTO tournaments(id,name,currentPhaseId,legacyType) VALUES(1,'Temporada',1,'MALE');
    INSERT INTO phases(id,tournamentId,name,tournamentType) VALUES(1,1,'Fase 1','MALE');
    INSERT INTO scoring_tables(tournamentType,name) VALUES('MALE','Torneo Regular'),('MALE','Copa');
    INSERT INTO matches(id,tournamentType,date,jornada,teamA,teamB,lineTeam,court,teamAId,teamBId,phaseId) VALUES(1,'MALE','2026-09-29','MORNING','A','B','C',1,1,2,1);
    INSERT INTO match_player_scoring(matchId,playerId,directGoals,horquetas,pepitas) VALUES(1,1,1,1,1);`);
    legacy.close();

    const connection = new DBConnection(databasePath);
    const migrated = new MatchPlayerScoringRepository(connection).getForMatch(1)[0]!;
    assert.deepEqual({ total: migrated.total, scoringTable: migrated.scoringTable }, { total: 6, scoringTable: 'Torneo Regular' });
    assert.deepEqual(connection.fetchAllFromQuery<{ tournamentId: number; name: string }>('SELECT tournamentId,name FROM scoring_tables ORDER BY name'), [{ tournamentId: 1, name: 'Copa' }, { tournamentId: 1, name: 'Torneo Regular' }]);
    connection.executeQuery("UPDATE scoring_tables SET name='General' WHERE tournamentType='MALE' AND name='Torneo Regular'");
    connection.executeQuery("UPDATE match_player_scoring SET scoringTable='General' WHERE matchId=1");
    assert.equal(new MatchPlayerScoringRepository(new DBConnection(databasePath)).getForMatch(1)[0]?.scoringTable, 'General');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
