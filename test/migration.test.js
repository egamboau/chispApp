const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
test('no crea torneos predeterminados al iniciar', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jornada-migration-'));
  const databasePath = path.join(directory, 'test.db');
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '3228', DATABASE_PATH: databasePath }, stdio: 'ignore' });
  try {
    let response;
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
