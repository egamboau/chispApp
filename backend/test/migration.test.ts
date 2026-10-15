import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { waitForServer } from './wait_for_server';
test('no crea torneos predeterminados al iniciar', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jornada-migration-'));
  const databasePath = path.join(directory, 'test.db');
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: '3228', DATABASE_PATH: databasePath };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  try {
    await waitForServer(child, 'http://127.0.0.1:3228/api/matches');
    const tournaments = await (await fetch('http://127.0.0.1:3228/api/tournaments')).json();
    assert.deepEqual(tournaments, []);
  } finally {
    child.kill('SIGTERM');
    await closed;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
