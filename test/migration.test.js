const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

test('migra el esquema con jornada a torneos, fases, grupos e IDs sin pérdida', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jornada-migration-'));
  const databasePath = path.join(directory, 'test.db');
  const legacy = new Database(databasePath);
  legacy.exec(`CREATE TABLE matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,tournamentType TEXT NOT NULL,date TEXT NOT NULL,jornada TEXT NOT NULL,
    teamA TEXT NOT NULL,teamB TEXT NOT NULL,lineTeam TEXT NOT NULL,court INTEGER NOT NULL,
    scoreA INTEGER NOT NULL DEFAULT 0,scoreB INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'SCHEDULED',
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ); INSERT INTO matches(tournamentType,date,jornada,teamA,teamB,lineTeam,court,status,scoreA,scoreB)
    VALUES('FEMALE','2026-09-22','AFTERNOON','A','B','C',1,'FINISHED',2,1)`);
  legacy.close();
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '3228', DATABASE_PATH: databasePath }, stdio: 'ignore' });
  try {
    let response;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { response = await fetch('http://127.0.0.1:3228/api/matches'); if (response.ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(response?.ok, true);
    const [match] = await response.json();
    assert.equal(match.teamA, 'A');
    assert.ok(match.phaseId && match.groupId && match.teamAId && match.teamBId);
    const tournaments = await (await fetch('http://127.0.0.1:3228/api/tournaments')).json();
    assert.deepEqual(tournaments.map((item) => item.name).sort(), ['Femenino', 'Masculino']);
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
