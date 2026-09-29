import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('no crea torneos predeterminados al iniciar', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jornada-migration-'));
  const databasePath = path.join(directory, 'test.db');
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '3228', DATABASE_PATH: databasePath }, stdio: 'ignore' });
  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { response = await fetch('http://127.0.0.1:3228/api/matches'); if (response.ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(response?.ok, true);
    const tournaments = await (await fetch('http://127.0.0.1:3228/api/tournaments')).json();
    assert.deepEqual(tournaments, []);
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
