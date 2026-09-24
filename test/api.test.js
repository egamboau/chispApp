const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const port = 43127;
const jwksPort = 43128;
const audience = 'test-audience';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tournament-test-'));
const base = `http://127.0.0.1:${port}`;
const teamDomain = `http://127.0.0.1:${jwksPort}`;
let server, jwksServer, accessToken, expiredToken, wrongAudienceToken, wrongIssuerToken;
let serverLogs = '';

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(`${base}/api/matches`)).ok) return; } catch (error) { serverLogs += `\nprobe: ${error.cause?.message || error.message}`; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${serverLogs}`);
}

async function waitForLog(text) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (serverLogs.includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Log not found: ${text}`);
}

async function json(url, options = {}) {
  const { headers, ...init } = options;
  const adminUrl = url.replace(/^\/api(?=\/|$)/, '/api/admin');
  const response = await fetch(`${base}${adminUrl}`, { ...init, headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': accessToken, ...headers } });
  return { response, body: response.status === 204 ? null : await response.json() };
}

async function publicJson(url, options = {}) {
  const response = await fetch(`${base}${url}`, options);
  return { response, body: response.status === 204 ? null : await response.json() };
}

test.before(async () => {
  const { exportJWK, generateKeyPair, SignJWT } = await import('jose');
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), alg: 'RS256', kid: 'test-key', use: 'sig' };
  jwksServer = http.createServer((req, res) => {
    if (req.url !== '/cdn-cgi/access/certs') { res.writeHead(404).end(); return; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => jwksServer.listen(jwksPort, '127.0.0.1', resolve));
  const sign = (issuer, tokenAudience, expiration) => new SignJWT({ email: 'admin@example.com', type: 'app' })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer(issuer).setAudience(tokenAudience).setIssuedAt().setExpirationTime(expiration).sign(privateKey);
  accessToken = await sign(teamDomain, audience, '1h');
  expiredToken = await sign(teamDomain, audience, Math.floor(Date.now() / 1000) - 60);
  wrongAudienceToken = await sign(teamDomain, 'wrong-audience', '1h');
  wrongIssuerToken = await sign(teamDomain + '/wrong', audience, '1h');

  const legacyDb = new (require('better-sqlite3'))(path.join(tempDir, 'test.db'));
  legacyDb.exec(`CREATE TABLE matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tournamentType TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL,
    teamA TEXT NOT NULL, teamB TEXT NOT NULL, lineTeam TEXT NOT NULL, court INTEGER NOT NULL,
    scoreA INTEGER NOT NULL DEFAULT 0, scoreB INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'SCHEDULED',
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ); INSERT INTO matches (tournamentType, date, time, teamA, teamB, lineTeam, court)
    VALUES ('MALE', '2026-09-19', '07:00', 'Legado A', 'Legado B', 'Legado Línea', 3);
  CREATE TABLE tournaments (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL COLLATE NOCASE UNIQUE,active INTEGER NOT NULL DEFAULT 1,currentPhaseId INTEGER,legacyType TEXT UNIQUE);
  CREATE TABLE phases (id INTEGER PRIMARY KEY AUTOINCREMENT,tournamentId INTEGER NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL DEFAULT 'TABLE',sortOrder INTEGER NOT NULL DEFAULT 1,UNIQUE(tournamentId,name));
  CREATE TABLE groups_table (id INTEGER PRIMARY KEY AUTOINCREMENT,phaseId INTEGER NOT NULL,name TEXT NOT NULL,UNIQUE(phaseId,name));
  INSERT INTO tournaments(id,name,currentPhaseId,legacyType) VALUES(1,'Masculino',1,'MALE'),(2,'Femenino',2,'FEMALE');
  INSERT INTO phases(id,tournamentId,name) VALUES(1,1,'Fase 1'),(2,2,'Fase 1');
  INSERT INTO groups_table(id,phaseId,name) VALUES(1,1,'General'),(2,2,'General')`);
  legacyDb.close();
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), DATABASE_PATH: path.join(tempDir, 'test.db'), CF_ACCESS_TEAM_DOMAIN: teamDomain, CF_ACCESS_AUD: audience };
  delete env.NODE_TEST_CONTEXT;
  server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (chunk) => { serverLogs += chunk; });
  server.stderr.on('data', (chunk) => { serverLogs += chunk; });
  await waitForServer();
});

test('protege el panel y separa la API pública de la administrativa', async () => {
  assert.equal((await fetch(`${base}/admin/`)).status, 403);
  assert.equal((await fetch(`${base}/admin/`, { headers: { 'cf-access-jwt-assertion': accessToken } })).status, 200);
  assert.equal((await fetch(`${base}/api/admin/teams`)).status, 403);
  for (const token of [expiredToken, wrongAudienceToken, wrongIssuerToken]) {
    assert.equal((await fetch(`${base}/api/admin/teams`, { headers: { 'cf-access-jwt-assertion': token } })).status, 403);
  }
  assert.equal((await publicJson('/api/teams')).response.status, 404);
  assert.equal((await publicJson('/api/matches', { method: 'POST' })).response.status, 404);
  assert.equal((await publicJson('/api/matches')).response.status, 200);
  assert.equal((await fetch(`${base}/api/events`, { method: 'HEAD' })).status, 200);
  assert.equal((await json('/api/teams')).response.status, 200);
  const hidden = await json('/api/tournaments', { method: 'POST', body: JSON.stringify({ name: 'Oculto', active: false }) });
  assert.equal((await publicJson('/api/tournaments')).body.some(({ id }) => id === hidden.body.id), false);
  assert.equal((await json('/api/tournaments')).body.some(({ id }) => id === hidden.body.id), true);
  await json(`/api/tournaments/${hidden.body.id}`, { method: 'DELETE' });
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
  const auth = { headers: { 'cf-access-jwt-assertion': accessToken } };
  const [tournamentsAdmin, teamsAdmin, calendarAdmin, display, css] = await Promise.all([fetch(`${base}/admin/`, auth), fetch(`${base}/admin/teams.html`, auth), fetch(`${base}/admin/calendar.html`, auth), fetch(`${base}/display/`), fetch(`${base}/display/display.css`)]);
  assert.equal(display.headers.get('cache-control'), 'no-store');
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

test.after(async () => {
  server.kill('SIGTERM');
  await new Promise((resolve) => jwksServer.close(resolve));
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
