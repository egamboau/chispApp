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
let serverLogs = '';

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(`${base}/api/matches`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server did not start');
}

async function waitForLog(text) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (serverLogs.includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Log not found: ${text}`);
}

async function json(url, options = {}) {
  const response = await fetch(`${base}${url}`, { headers: { 'content-type': 'application/json' }, ...options });
  return { response, body: response.status === 204 ? null : await response.json() };
}

test.before(async () => {
  const legacyDb = new (require('better-sqlite3'))(path.join(tempDir, 'test.db'));
  legacyDb.exec(`CREATE TABLE matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tournamentType TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL,
    teamA TEXT NOT NULL, teamB TEXT NOT NULL, lineTeam TEXT NOT NULL, court INTEGER NOT NULL,
    scoreA INTEGER NOT NULL DEFAULT 0, scoreB INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'SCHEDULED',
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ); INSERT INTO matches (tournamentType, date, time, teamA, teamB, lineTeam, court)
    VALUES ('MALE', '2026-09-19', '07:00', 'Legado A', 'Legado B', 'Legado Línea', 3)`);
  legacyDb.close();
  const env = { ...process.env, PORT: String(port), DATABASE_PATH: path.join(tempDir, 'test.db') };
  delete env.NODE_TEST_CONTEXT;
  server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (chunk) => { serverLogs += chunk; });
  server.stderr.on('data', (chunk) => { serverLogs += chunk; });
  await waitForServer();
});

test('migra horas existentes a jornadas sin perder el partido', async () => {
  const result = await json('/api/matches?date=2026-09-19');
  assert.equal(result.body[0].jornada, 'MORNING');
  assert.equal(result.body[0].teamA, 'Legado A');
  assert.equal('time' in result.body[0], false);
  const teams = await json('/api/teams?tournamentType=MALE');
  assert.deepEqual(teams.body.map(({ name }) => name), ['Legado A', 'Legado B', 'Legado Línea']);
});

test('sirve las tres páginas administrativas y la pantalla pública', async () => {
  const [tournamentsAdmin, teamsAdmin, calendarAdmin, display, css] = await Promise.all([fetch(`${base}/admin/`), fetch(`${base}/admin/teams.html`), fetch(`${base}/admin/calendar.html`), fetch(`${base}/display/`), fetch(`${base}/display/display.css`)]);
  assert.match(await tournamentsAdmin.text(), /id="rule-form"/);
  assert.match(await teamsAdmin.text(), /id="membership-form"/);
  assert.match(await calendarAdmin.text(), /id="match-form"/);
  assert.match(await display.text(), /data-view="standings"/);
  assert.match(await css.text(), /@media \(max-width: 900px\)/);
});

test('guarda equipos separados por torneo', async () => {
  let result = await json('/api/teams', { method: 'POST', body: JSON.stringify({ tournamentType: 'FEMALE', name: ' Panteras ' }) });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.name, 'Panteras');
  const id = result.body.id;

  result = await json('/api/teams?tournamentType=FEMALE');
  assert.deepEqual(result.body.map(({ name }) => name), ['Panteras']);

  result = await json('/api/teams', { method: 'POST', body: JSON.stringify({ tournamentType: 'FEMALE', name: 'panteras' }) });
  assert.equal(result.response.status, 409);

  result = await json(`/api/teams/${id}`, { method: 'DELETE' });
  assert.equal(result.response.status, 204);
  result = await json('/api/teams?tournamentType=FEMALE');
  assert.deepEqual(result.body, []);
  result = await json(`/api/teams/${id}`, { method: 'DELETE' });
  assert.equal(result.response.status, 404);
});

test.after(() => {
  server.kill('SIGTERM');
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('flujo completo de partidos y validaciones', async () => {
  const match = { tournamentType: 'MALE', date: '2026-09-20', jornada: 'AFTERNOON', teamA: 'Tigres', teamB: 'Leones', lineTeam: 'Halcones', court: 1 };
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
  result = await json(`/api/matches/${id}/cards`, { method: 'PATCH', body: JSON.stringify({ yellowCardsA: 2, redCardsA: 0, yellowCardsB: 1, redCardsB: 1 }) });
  assert.deepEqual([result.body.yellowCardsA, result.body.redCardsB], [2, 1]);
  result = await json(`/api/matches/${id}/score`, { method: 'PATCH', body: JSON.stringify({ team: 'A', delta: 1 }) });
  assert.equal(result.response.status, 409);
  result = await json(`/api/matches/${id}`, { method: 'DELETE' });
  assert.equal(result.response.status, 204);
  result = await json(`/api/matches/${id}`);
  assert.equal(result.response.status, 404);
});

test('rechaza equipos repetidos', async () => {
  const result = await json('/api/matches', { method: 'POST', body: JSON.stringify({ tournamentType: 'MALE', date: '2026-09-20', jornada: 'MORNING', teamA: 'Tigres', teamB: 'tigres', lineTeam: 'Halcones', court: 1 }) });
  assert.equal(result.response.status, 400);
});

test('registra peticiones API con un identificador', async () => {
  const result = await json('/api/no-existe');
  assert.equal(result.response.status, 404);
  const requestId = result.response.headers.get('x-request-id');
  assert.match(requestId, /^[0-9a-f-]{36}$/);
  await waitForLog(requestId);
  assert.match(serverLogs, new RegExp(`"event":"request","requestId":"${requestId}".*"status":404`));
});

test('notifica cambios por SSE', async () => {
  const controller = new AbortController();
  const stream = await fetch(`${base}/api/events`, { signal: controller.signal });
  const reader = stream.body.getReader();
  await reader.read();
  const created = await json('/api/matches', { method: 'POST', body: JSON.stringify({ tournamentType: 'FEMALE', date: '2026-09-21', jornada: 'MORNING', teamA: 'Águilas', teamB: 'Panteras', lineTeam: 'Lobas', court: 2 }) });
  const event = new TextDecoder().decode((await reader.read()).value);
  assert.match(event, /event: matches/);
  assert.match(event, new RegExp(`"id":${created.body.id}`));
  controller.abort();
});

test('administra fases, rangos, grupos y sanciones con destinos compartidos', async () => {
  let result = await json('/api/tournaments', { method: 'POST', body: JSON.stringify({ name: 'Mixto' }) });
  const tournamentId = result.body.id;
  result = await json(`/api/tournaments/${tournamentId}/phases`, { method: 'POST', body: JSON.stringify({ name: 'Liga', type: 'TABLE', sortOrder: 1 }) });
  const phaseId = result.body.id;
  const groupIds = [];
  for (const name of ['A', 'B']) {
    result = await json(`/api/phases/${phaseId}/groups`, { method: 'POST', body: JSON.stringify({ name }) });
    groupIds.push(result.body.id);
  }
  const teamIds = [];
  for (const name of ['Uno', 'Dos', 'Tres', 'Cuatro']) {
    result = await json('/api/teams', { method: 'POST', body: JSON.stringify({ tournamentId, name }) });
    teamIds.push(result.body.id);
  }
  for (let index = 0; index < teamIds.length; index++) {
    result = await json(`/api/phases/${phaseId}/memberships`, { method: 'POST', body: JSON.stringify({ teamId: teamIds[index], groupId: groupIds[Math.floor(index / 2)] }) });
    assert.equal(result.response.status, 201);
  }
  result = await json(`/api/phases/${phaseId}/classification-rules`, { method: 'POST', body: JSON.stringify({ startPosition: 1, endPosition: 1, label: 'Segunda fase' }) });
  assert.equal(result.response.status, 201);
  result = await json(`/api/phases/${phaseId}/classification-rules`, { method: 'POST', body: JSON.stringify({ startPosition: 1, endPosition: 2, label: 'Copa' }) });
  assert.equal(result.response.status, 409);
  result = await json(`/api/phases/${phaseId}/classification-rules`, { method: 'POST', body: JSON.stringify({ startPosition: 2, endPosition: 2, label: 'Copa' }) });
  assert.equal(result.response.status, 201);

  result = await json(`/api/phases/${phaseId}/standings`);
  assert.equal(result.body.groups.length, 2);
  for (const group of result.body.groups) assert.deepEqual(group.standings[0].possibleDestinations, ['Segunda fase', 'Copa']);

  result = await json(`/api/phases/${phaseId}/teams/${teamIds[0]}/sanction`, { method: 'PUT', body: JSON.stringify({ reason: 'Artículo 19' }) });
  assert.equal(result.response.status, 200);
  result = await json(`/api/phases/${phaseId}/standings`);
  const groupA = result.body.groups.find((group) => group.name === 'A').standings;
  const groupB = result.body.groups.find((group) => group.name === 'B').standings;
  assert.deepEqual(groupA.map((row) => row.teamName), ['Dos', 'Uno']);
  assert.deepEqual(groupA.map((row) => row.destination), ['Segunda fase', 'Copa']);
  assert.equal(groupB[0].requiresTiebreaker, true);

  result = await json('/api/matches', { method: 'POST', body: JSON.stringify({ phaseId, groupId: groupIds[0], date: '2026-09-22', jornada: 'MORNING', court: 1, teamAId: teamIds[0], teamBId: teamIds[2], lineTeamId: teamIds[1] }) });
  assert.equal(result.response.status, 201);
  const crossGroupMatchId = result.body.id;
  await json(`/api/matches/${crossGroupMatchId}/start`, { method: 'POST' });
  await json(`/api/matches/${crossGroupMatchId}/finish`, { method: 'POST' });
  result = await json(`/api/phases/${phaseId}/standings`);
  assert.equal(result.body.groups.find((group) => group.id === groupIds[0]).standings.find((row) => row.teamId === teamIds[0]).played, 1);
  assert.equal(result.body.groups.find((group) => group.id === groupIds[1]).standings.find((row) => row.teamId === teamIds[2]).played, 1);
  await json(`/api/matches/${crossGroupMatchId}`, { method: 'DELETE' });

  result = await json(`/api/tournaments/${tournamentId}/phases`, { method: 'POST', body: JSON.stringify({ name: 'Final', type: 'ELIMINATION', sortOrder: 2 }) });
  result = await json(`/api/phases/${result.body.id}/standings`);
  assert.equal(result.body.hasStandings, false);

  result = await json(`/api/tournaments/${tournamentId}`, { method: 'PUT', body: JSON.stringify({ name: 'Mixto', active: true, currentPhaseId: phaseId }) });
  assert.equal(result.body.currentPhaseId, phaseId);
  result = await json(`/api/phases/${phaseId}`, { method: 'DELETE' });
  assert.equal(result.response.status, 204);
  result = await json(`/api/tournaments/${tournamentId}/phases`);
  assert.deepEqual(result.body.map(({ name }) => name), ['Final']);
  result = await json('/api/tournaments');
  assert.equal(result.body.find(({ id }) => id === tournamentId).currentPhaseId, null);
});
