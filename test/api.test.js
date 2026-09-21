const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const port = 3217;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tournament-test-'));
const base = `http://127.0.0.1:${port}`;
let server;

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(`${base}/api/matches`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server did not start');
}

async function json(url, options = {}) {
  const response = await fetch(`${base}${url}`, { headers: { 'content-type': 'application/json' }, ...options });
  return { response, body: response.status === 204 ? null : await response.json() };
}

test.before(async () => {
  server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), DATABASE_PATH: path.join(tempDir, 'test.db') }, stdio: 'inherit' });
  await waitForServer();
});

test.after(() => {
  server.kill('SIGTERM');
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('flujo completo de partidos y validaciones', async () => {
  const match = { tournamentType: 'MALE', date: '2026-09-20', time: '14:30', teamA: 'Tigres', teamB: 'Leones', lineTeam: 'Halcones', court: 1 };
  let result = await json('/api/matches', { method: 'POST', body: JSON.stringify(match) });
  assert.equal(result.response.status, 201);
  const id = result.body.id;

  result = await json(`/api/matches/${id}`, { method: 'PUT', body: JSON.stringify({ ...match, tournamentType: 'FEMALE', teamA: 'Águilas' }) });
  assert.equal(result.body.tournamentType, 'FEMALE');

  result = await json(`/api/matches/${id}/start`, { method: 'POST' });
  assert.equal(result.body.status, 'LIVE');
  result = await json(`/api/matches/${id}/score`, { method: 'PATCH', body: JSON.stringify({ team: 'A', delta: 1 }) });
  assert.equal(result.body.scoreA, 1);
  result = await json(`/api/matches/${id}/score`, { method: 'PATCH', body: JSON.stringify({ team: 'B', delta: -1 }) });
  assert.equal(result.response.status, 409);
  result = await json('/api/matches?status=LIVE&tournamentType=FEMALE&date=2026-09-20');
  assert.equal(result.body.length, 1);

  result = await json(`/api/matches/${id}/finish`, { method: 'POST' });
  assert.equal(result.body.status, 'FINISHED');
  result = await json(`/api/matches/${id}`, { method: 'DELETE' });
  assert.equal(result.response.status, 204);
  result = await json(`/api/matches/${id}`);
  assert.equal(result.response.status, 404);
});

test('rechaza equipos repetidos', async () => {
  const result = await json('/api/matches', { method: 'POST', body: JSON.stringify({ tournamentType: 'MALE', date: '2026-09-20', time: '10:00', teamA: 'Tigres', teamB: 'tigres', lineTeam: 'Halcones', court: 1 }) });
  assert.equal(result.response.status, 400);
});

test('notifica cambios por SSE', async () => {
  const controller = new AbortController();
  const stream = await fetch(`${base}/api/events`, { signal: controller.signal });
  const reader = stream.body.getReader();
  await reader.read();
  const created = await json('/api/matches', { method: 'POST', body: JSON.stringify({ tournamentType: 'FEMALE', date: '2026-09-21', time: '10:00', teamA: 'Águilas', teamB: 'Panteras', lineTeam: 'Lobas', court: 2 }) });
  const event = new TextDecoder().decode((await reader.read()).value);
  assert.match(event, /event: matches/);
  assert.match(event, new RegExp(`"id":${created.body.id}`));
  controller.abort();
});
