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

    assert.equal(scoring.save({ matchId, playerId: playerA, directGoals: 3, horquetas: 2, pepitas: 1 }).total, 11);
    assert.equal(scoring.save({ matchId, playerId: playerA, directGoals: 3, horquetas: 1, pepitas: 1 }).total, 8);
    assert.equal(scoring.getForMatch(matchId).length, 1);
    assert.throws(() => scoring.save({ matchId, playerId: playerC, directGoals: 1, horquetas: 0, pepitas: 0 }));
    assert.throws(() => scoring.save({ matchId, playerId: playerA, directGoals: -1, horquetas: 0, pepitas: 0 }));
    assert.throws(() => scoring.save({ matchId, playerId: playerA, directGoals: 0, horquetas: 0, pepitas: 0 }));
    assert.throws(() => db.executeQuery('UPDATE matches SET teamAId=? WHERE id=?', teamC, matchId));
    assert.throws(() => db.executeQuery('UPDATE players SET teamId=? WHERE id=?', teamC, playerA));

    const reopened = new MatchPlayerScoringRepository(new DBConnection(databasePath));
    assert.equal(reopened.getForMatch(matchId)[0]?.total, 8);
    assert.equal(reopened.delete(matchId, playerA), true);
    assert.deepEqual(reopened.getForMatch(matchId), []);

    reopened.save({ matchId, playerId: playerA, directGoals: 1, horquetas: 0, pepitas: 0 });
    db.executeQuery('DELETE FROM matches WHERE id=?', matchId);
    assert.deepEqual(reopened.getForMatch(matchId), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
