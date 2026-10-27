import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import fs from 'node:fs';
import http, { type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import Database from 'better-sqlite3';
import { waitForServer } from './wait_for_server';

const port = 43127;
const jwksPort = 43128;
const audience = 'test-audience';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tournament-test-'));
const base = `http://127.0.0.1:${port}`;
const teamDomain = `http://127.0.0.1:${jwksPort}`;
let server: ChildProcessByStdio<null, Readable, Readable>, jwksServer: Server;
let accessToken: string, expiredToken: string, wrongAudienceToken: string, wrongIssuerToken: string;
let serverLogs = '';
type JsonResult = { response: Response; body: any };
type ApiRow = { teamId: number; teamName: string; destination: string | null; possibleDestinations: string[]; requiresTiebreaker: boolean; points: number; played: number; yellowCards: number; redCards: number };
type ApiGroup = { id: number; name: string; standings: ApiRow[] };

async function waitForLog(text: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (serverLogs.includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Log not found: ${text}`);
}

async function json(url: string, options: RequestInit = {}): Promise<JsonResult> {
  const { headers, ...init } = options;
  const adminUrl = url.replace(/^\/api(?=\/|$)/, '/api/admin');
  const response = await fetch(`${base}${adminUrl}`, { ...init, headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': accessToken, ...(headers as Record<string, string> | undefined) } });
  return { response, body: response.status === 204 ? null : await response.json() };
}

async function publicJson(url: string, options: RequestInit = {}): Promise<JsonResult> {
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
  await new Promise<void>((resolve) => jwksServer.listen(jwksPort, '127.0.0.1', resolve));
  const sign = (issuer: string, tokenAudience: string, expiration: string | number) => new SignJWT({ email: 'admin@example.com', type: 'app' })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer(issuer).setAudience(tokenAudience).setIssuedAt().setExpirationTime(expiration).sign(privateKey);
  accessToken = await sign(teamDomain, audience, '1h');
  expiredToken = await sign(teamDomain, audience, Math.floor(Date.now() / 1000) - 60);
  wrongAudienceToken = await sign(teamDomain, 'wrong-audience', '1h');
  wrongIssuerToken = await sign(teamDomain + '/wrong', audience, '1h');

  const legacyDb = new Database(path.join(tempDir, 'test.db'));
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
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', PORT: String(port), DATABASE_PATH: path.join(tempDir, 'test.db'), CF_ACCESS_TEAM_DOMAIN: teamDomain, CF_ACCESS_AUD: audience };
  delete env.NODE_TEST_CONTEXT;
  server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (chunk: Buffer) => { serverLogs += chunk; });
  server.stderr.on('data', (chunk: Buffer) => { serverLogs += chunk; });
  await waitForServer(server, `${base}/api/matches`);
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
  assert.equal((await publicJson('/api/tournaments')).body.some(({ id }: { id: number }) => id === hidden.body.id), false);
  assert.equal((await json('/api/tournaments')).body.some(({ id }: { id: number }) => id === hidden.body.id), true);
  await json(`/api/tournaments/${hidden.body.id}`, { method: 'DELETE' });
});

test('migra horas existentes a jornadas sin perder el partido', async () => {
  const result = await json('/api/matches?date=2026-09-19');
  assert.equal(result.body[0].jornada, 'MORNING');
  assert.equal(result.body[0].teamA, 'Legado A');
  assert.equal(result.body[0].sortOrder, null);
  assert.equal('time' in result.body[0], false);
  const teams = await json('/api/teams?tournamentType=MALE');
  assert.deepEqual(teams.body.map(({ name }: { name: string }) => name), ['Legado A', 'Legado B', 'Legado Línea']);
  assert.deepEqual((await json(`/api/teams/${teams.body[0].id}/players`)).body, []);
  const phases = await json('/api/tournaments/1/phases');
  assert.equal(phases.body[0].tournamentType, 'MALE');
});

test('expone previsualización, confirmación y reapertura solo por la API administrativa', async () => {
  assert.equal((await fetch(`${base}/api/admin/phases/1/positions`)).status, 403);
  assert.equal((await publicJson('/api/phases/1/positions')).response.status, 404);
  assert.equal((await publicJson('/api/phases/1/positions/confirm', { method: 'POST' })).response.status, 404);
  assert.equal((await json('/api/phases/invalid/positions')).response.status, 400);
  assert.equal((await json('/api/phases/999999/positions')).response.status, 404);
  assert.equal((await json('/api/phases/999999/positions/confirm', { method: 'POST' })).response.status, 404);
  assert.equal((await json('/api/phases/999999/positions/reopen', { method: 'POST' })).response.status, 404);
  const preview = await json('/api/phases/1/positions');
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.canConfirm, false);
  assert.equal('snapshot' in preview.body, false);
  assert.equal((await json('/api/phases/1/positions/confirm', { method: 'POST' })).response.status, 409);
  const reopened = await json('/api/phases/1/positions/reopen', { method: 'POST' });
  assert.equal(reopened.response.status, 200);
  assert.equal(reopened.body.confirmedAt, null);
});

test('sirve las páginas administrativas y la pantalla pública', async () => {
  const auth = { headers: { 'cf-access-jwt-assertion': accessToken } };
  const [tournamentsAdmin, teamsAdmin, calendarAdmin, scoringAdmin, adminJs, display, css] = await Promise.all([fetch(`${base}/admin/`, auth), fetch(`${base}/admin/teams.html`, auth), fetch(`${base}/admin/calendar.html`, auth), fetch(`${base}/admin/scoring.html`, auth), fetch(`${base}/admin/admin.js`, auth), fetch(`${base}/display/`), fetch(`${base}/display/display.css`)]);
  assert.equal(display.headers.get('cache-control'), 'no-store');
  assert.match(await tournamentsAdmin.text(), /href="\/admin\/scoring.html"[\s\S]*id="phase-tournament-type"[\s\S]*id="rule-form"/);
  assert.match(await teamsAdmin.text(), /id="membership-form"[\s\S]*id="player-form"/);
  assert.match(await calendarAdmin.text(), /id="admin-phase"[\s\S]*id="match-form"[\s\S]*id="sortOrder"[\s\S]*id="line-visibility"/);
  assert.match(await scoringAdmin.text(), /id="scoring-match"[\s\S]*id="scoring-form"[\s\S]*id="scoring-list"/);
  assert.match(await (await fetch(`${base}/admin/scoring.html`, auth)).text(), /id="scoring-table-form"[\s\S]*id="create-scoring-table"[\s\S]*id="scoringTable"/);
  assert.match(await adminJs.text(), /EDITAR ORDEN[\s\S]*ADMINISTRAR GOLEO/);
  assert.match(await display.text(), /data-view="standings"[\s\S]*data-view="scoring"/);
  assert.match(await css.text(), /@media \(max-width: 900px\)/);
});

test('calendario entre fases: confirma tres grupos, publica y corrige sin perder referencias', async t => {
  const post = async (url: string, body: unknown = {}, expected = 201) => {
    const result = await json(url, { method: 'POST', body: JSON.stringify(body) });
    assert.equal(result.response.status, expected, JSON.stringify(result.body));
    return result.body;
  };
  const tournament = await post('/api/tournaments', { name: 'Calendario entre fases' });
  t.after(() => {
    const db = new Database(path.join(tempDir, 'test.db'));
    try {
      db.transaction(() => {
        db.prepare('DELETE FROM matches WHERE phaseId IN (SELECT id FROM phases WHERE tournamentId=?)').run(tournament.id);
        for (const name of ['phase_position_confirmations', 'phase_memberships', 'groups_table']) {
          db.prepare(`DELETE FROM ${name} WHERE phaseId IN (SELECT id FROM phases WHERE tournamentId=?)`).run(tournament.id);
        }
        for (const name of ['scoring_tables', 'phases', 'teams']) db.prepare(`DELETE FROM ${name} WHERE tournamentId=?`).run(tournament.id);
        db.prepare('DELETE FROM tournaments WHERE id=?').run(tournament.id);
        db.prepare('DELETE FROM published_line_dates WHERE date=?').run('2026-11-15');
      })();
    } finally { db.close(); }
  });
  const tournamentType = tournament.id % 2 ? 'MALE' : 'FEMALE';
  const phase = async (name: string, type: string, sortOrder: number) => post(`/api/tournaments/${tournament.id}/phases`, { name, type, sortOrder, tournamentType });
  const table = await phase('Clasificación', 'TABLE', 1);
  const knockout = await phase('Final', 'ELIMINATION', 2);
  const destination = await post(`/api/phases/${knockout.id}/groups`, { name: 'Finalistas' });
  const groups: { id: number }[] = [], pairs: { id: number }[][] = [];
  for (const name of ['A', 'B', 'C']) {
    const group = await post(`/api/phases/${table.id}/groups`, { name });
    groups.push(group);
    const pair = [];
    for (const suffix of ['1', '2']) {
      const team = await post('/api/teams', { tournamentId: tournament.id, name: `${name}${suffix}` });
      pair.push(team);
      await post(`/api/phases/${table.id}/memberships`, { groupId: group.id, teamId: team.id });
      await post(`/api/phases/${knockout.id}/memberships`, { groupId: destination.id, teamId: team.id });
    }
    pairs.push(pair);
  }
  const participants = Object.fromEntries(['teamA', 'teamB', 'lineTeam'].map((role, index) => [role, {
    kind: 'GROUP_POSITION', sourcePhaseId: table.id, sourceGroupId: groups[index]!.id, position: 1,
  }]));
  const date = '2026-11-15';
  const schedule = { phaseId: knockout.id, groupId: destination.id, date, jornada: 'MORNING', court: 2, sortOrder: 1, participants };
  const final = await post('/api/matches', schedule);
  const publicFinal = async () => {
    const result = await publicJson(`/api/matches?phaseId=${knockout.id}`);
    assert.equal(result.response.status, 200);
    return result.body.find(({ id }: { id: number }) => id === final.id);
  };
  const positions = `/api/phases/${table.id}/positions`;
  assert.equal((await post(`${positions}/confirm`, {}, 409)).error.includes('incompleto'), true);
  await post(`/api/matches/${final.id}/start`, {}, 409);
  const invalid = { ...schedule, participants: { ...participants, teamA: { ...participants.teamA, position: 3 } } };
  const invalidResult = await json('/api/matches', { method: 'POST', body: JSON.stringify(invalid) });
  assert.equal(invalidResult.response.status, 409);

  const sources = [];
  for (const [index, group] of groups.entries()) {
    const match = await post('/api/matches', {
      phaseId: table.id, groupId: group.id, date: '2026-11-14', jornada: 'MORNING', court: index + 1,
      teamAId: pairs[index]![0]!.id, teamBId: pairs[index]![1]!.id, lineTeamId: pairs[(index + 1) % 3]![0]!.id,
    });
    sources.push(match);
    await post(`/api/matches/${match.id}/start`, {}, 200);
    await post(`/api/matches/${match.id}/finish`, {}, 200);
    const result = await json(`/api/matches/${match.id}/result`, { method: 'PATCH', body: JSON.stringify({ scoreA: 1, scoreB: 0 }) });
    assert.equal(result.response.status, 200);
  }
  // A tied source group must fail through the routed API, without partial assignments.
  const resultUrl = `/api/matches/${sources[0].id}/result`;
  await json(resultUrl, { method: 'PATCH', body: JSON.stringify({ scoreA: 0, scoreB: 0 }) });
  assert.match((await post(`${positions}/confirm`, {}, 409)).error, /empates sin resolver/);
  assert.equal((await json(`/api/matches/${final.id}`)).body.teamAId, null);
  await json(resultUrl, { method: 'PATCH', body: JSON.stringify({ scoreA: 1, scoreB: 0 }) });

  const pending = (await publicFinal());
  assert.equal(pending.participants.teamA.status, 'PENDING');
  assert.equal(pending.participants.lineTeam, null);
  assert.equal((await json(`/api/matches/${final.id}`)).body.participants.lineTeam.status, 'PENDING');
  await json(`/api/line-visibility/${date}`, { method: 'PUT', body: JSON.stringify({ visible: true }) });
  const publishedPending = (await publicFinal());
  assert.deepEqual(publishedPending.participants.lineTeam.reference, participants.lineTeam);
  assert.equal(publishedPending.participants.lineTeam.status, 'PENDING');
  const confirmed = await post(`${positions}/confirm`, {}, 200);
  assert.deepEqual(await post(`${positions}/confirm`, {}, 200), confirmed);
  const resolved = (await publicFinal());
  for (const [index, role] of ['teamA', 'teamB', 'lineTeam'].entries()) {
    assert.equal(resolved[`${role}Id`], pairs[index]![0]!.id);
    assert.equal(resolved.participants[role].status, 'CONFIRMED');
    assert.deepEqual(resolved.participants[role].reference, participants[role]);
  }
  assert.deepEqual((await publicJson(`/api/matches?phaseId=${knockout.id}`)).body, [resolved]);
  const persisted = new Database(path.join(tempDir, 'test.db'), { readonly: true });
  try {
    assert.equal((persisted.prepare('SELECT * FROM match_participant_references WHERE matchId=?').all(final.id)).length, 3);
    assert.equal((persisted.prepare('SELECT teamAId FROM matches WHERE id=?').get(final.id) as { teamAId: number }).teamAId, pairs[0]![0]!.id);
    assert.ok(persisted.prepare('SELECT * FROM phase_position_confirmations WHERE phaseId=?').get(table.id));
  } finally { persisted.close(); }
  assert.equal((await json(`/api/teams?tournamentId=${tournament.id}`)).body.length, 6);

  await json(resultUrl, { method: 'PATCH', body: JSON.stringify({ scoreA: 0, scoreB: 2 }) });
  assert.equal((await json(positions)).body.stale, true);
  await post(`${positions}/confirm`, {}, 409);
  assert.equal((await publicFinal()).teamAId, pairs[0]![0]!.id);
  await post(`${positions}/reopen`, {}, 200);
  await post(`/api/matches/${final.id}/start`, {}, 409);
  await post(`${positions}/confirm`, {}, 200);
  assert.equal((await publicFinal()).teamAId, pairs[0]![1]!.id);
  await post(`/api/matches/${final.id}/start`, {}, 200);
  await json(resultUrl, { method: 'PATCH', body: JSON.stringify({ scoreA: 3, scoreB: 0 }) });
  await post(`${positions}/reopen`, {}, 200);
  assert.match((await post(`${positions}/confirm`, {}, 409)).error, /iniciado o terminado/);
  assert.equal((await json(`/api/matches/${final.id}`)).body.teamAId, pairs[0]![1]!.id);
});

test('guarda equipos separados por torneo', async () => {
  let result = await json('/api/teams', { method: 'POST', body: JSON.stringify({ tournamentType: 'FEMALE', name: ' Panteras ' }) });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.name, 'Panteras');
  const id = result.body.id;

  result = await json('/api/teams?tournamentType=FEMALE');
  assert.deepEqual(result.body.map(({ name }: { name: string }) => name), ['Panteras']);

  result = await json('/api/teams', { method: 'POST', body: JSON.stringify({ tournamentType: 'FEMALE', name: 'panteras' }) });
  assert.equal(result.response.status, 409);

  result = await json(`/api/teams/${id}`, { method: 'DELETE' });
  assert.equal(result.response.status, 204);
  result = await json('/api/teams?tournamentType=FEMALE');
  assert.deepEqual(result.body, []);
  result = await json(`/api/teams/${id}`, { method: 'DELETE' });
  assert.equal(result.response.status, 404);
});

test('administra la nómina sin perder ceros iniciales', async () => {
  let result = await json('/api/teams', { method: 'POST', body: JSON.stringify({ tournamentType: 'MALE', name: 'Nómina A' }) });
  const teamA = result.body.id;
  result = await json('/api/teams', { method: 'POST', body: JSON.stringify({ tournamentType: 'MALE', name: 'Nómina B' }) });
  const teamB = result.body.id;

  assert.equal((await publicJson(`/api/teams/${teamA}/players`)).response.status, 404);
  result = await json(`/api/teams/${teamA}/players`, { method: 'POST', body: JSON.stringify({ number: '00', name: '' }) });
  assert.equal(result.response.status, 201);
  assert.deepEqual({ number: result.body.number, name: result.body.name, status: result.body.status, displayName: result.body.displayName }, { number: '00', name: null, status: 'REGISTERED', displayName: 'Equipo Nómina A - Número 00' });
  const playerId = result.body.id;

  assert.equal((await json(`/api/teams/${teamA}/players`, { method: 'POST', body: JSON.stringify({ number: '00' }) })).response.status, 409);
  assert.equal((await json(`/api/teams/${teamB}/players`, { method: 'POST', body: JSON.stringify({ number: '00' }) })).response.status, 201);
  assert.equal((await json(`/api/teams/${teamA}/players`, { method: 'POST', body: JSON.stringify({ number: 'A1' }) })).response.status, 400);

  result = await json(`/api/players/${playerId}`, { method: 'PUT', body: JSON.stringify({ number: '07', name: ' Ana ' }) });
  assert.deepEqual({ id: result.body.id, number: result.body.number, name: result.body.name, displayName: result.body.displayName }, { id: playerId, number: '07', name: 'Ana', displayName: 'Ana' });
  result = await json(`/api/players/${playerId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'UNREGISTERED' }) });
  assert.equal(result.body.status, 'UNREGISTERED');
  result = await json(`/api/players/${playerId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'REGISTERED' }) });
  assert.equal(result.body.status, 'REGISTERED');
  assert.equal((await json(`/api/teams/${teamA}`, { method: 'DELETE' })).response.status, 409);
});

test.after(async () => {
  server.kill('SIGTERM');
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
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
  result = await json(`/api/matches/${id}/result`, { method: 'PATCH', body: JSON.stringify({ scoreA: 3, scoreB: 2 }) });
  assert.deepEqual([result.body.scoreA, result.body.scoreB], [3, 2]);
  result = await json(`/api/matches/${id}/reopen`, { method: 'POST' });
  assert.deepEqual([result.body.status, result.body.scoreA, result.body.scoreB], ['LIVE', 3, 2]);
  result = await json(`/api/matches/${id}/reset`, { method: 'POST' });
  assert.deepEqual([result.body.scoreA, result.body.scoreB], [0, 0]);
  result = await json(`/api/matches/${id}`, { method: 'DELETE' });
  assert.equal(result.response.status, 204);
  result = await json(`/api/matches/${id}`);
  assert.equal(result.response.status, 404);
});

test('administra el goleo de un partido finalizado', async () => {
  let result = await json('/api/matches', { method: 'POST', body: JSON.stringify({ tournamentType: 'MALE', date: '2026-09-22', jornada: 'AFTERNOON', teamA: 'Goleo A', teamB: 'Goleo B', lineTeam: 'Goleo Línea', court: 4 }) });
  const match = result.body;
  const playerA = (await json(`/api/teams/${match.teamAId}/players`, { method: 'POST', body: JSON.stringify({ number: '01' }) })).body;
  const outsider = (await json(`/api/teams/${match.lineTeamId}/players`, { method: 'POST', body: JSON.stringify({ number: '99' }) })).body;

  await json(`/api/matches/${match.id}/start`, { method: 'POST' });
  result = await json(`/api/matches/${match.id}/finish`, { method: 'POST' });
  assert.equal(result.body.status, 'FINISHED');
  result = await json(`/api/matches/${match.id}/scoring`);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, []);
  assert.equal((await publicJson(`/api/matches/${match.id}/scoring`)).response.status, 404);
  assert.equal((await publicJson(`/api/matches/${match.id}/scoring`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerId: playerA.id, directGoals: 1, horquetas: 0, pepitas: 0 }) })).response.status, 404);

  const controller = new AbortController();
  const stream = await fetch(`${base}/api/events`, { signal: controller.signal });
  const reader = stream.body!.getReader();
  await reader.read();

  result = await json(`/api/matches/${match.id}/scoring`, { method: 'POST', body: JSON.stringify({ playerId: playerA.id, directGoals: 0, horquetas: 1, pepitas: 1 }) });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.total, 5);
  assert.equal(result.body.scoringTable, 'Torneo Regular');
  const event = new TextDecoder().decode((await reader.read()).value);
  assert.match(event, new RegExp(`"type":"scoring","id":${match.id}`));
  controller.abort();

  assert.equal((await json(`/api/matches/${match.id}/scoring`, { method: 'POST', body: JSON.stringify({ playerId: playerA.id, directGoals: 1, horquetas: 0, pepitas: 0 }) })).response.status, 409);
  result = await json(`/api/matches/${match.id}/scoring`);
  assert.deepEqual(result.body.map(({ playerId, total }: { playerId: number; total: number }) => ({ playerId, total })), [{ playerId: playerA.id, total: 5 }]);

  result = await json(`/api/matches/${match.id}/scoring/${playerA.id}`, { method: 'PUT', body: JSON.stringify({ directGoals: 2, horquetas: 1, pepitas: 0, scoringTable: 'Torneo Regular' }) });
  assert.equal(result.body.total, 5);
  assert.equal(result.body.scoringTable, 'Torneo Regular');
  assert.equal((await json(`/api/matches/${match.id}/scoring/${playerA.id}`, { method: 'PUT', body: JSON.stringify({ directGoals: 0, horquetas: 0, pepitas: 0 }) })).response.status, 400);
  assert.equal((await json(`/api/matches/${match.id}/scoring/${playerA.id}`, { method: 'PUT', body: JSON.stringify({ directGoals: -1, horquetas: 0, pepitas: 0 }) })).response.status, 400);
  assert.equal((await json(`/api/matches/${match.id}/scoring`, { method: 'POST', body: JSON.stringify({ playerId: outsider.id, directGoals: 1, horquetas: 0, pepitas: 0 }) })).response.status, 400);
  assert.equal((await json(`/api/matches/${match.id}/scoring`, { method: 'POST', body: JSON.stringify({ playerId: 999999, directGoals: 1, horquetas: 0, pepitas: 0 }) })).response.status, 404);
  assert.equal((await json('/api/matches/999999/scoring')).response.status, 404);
  assert.equal((await json(`/api/matches/${match.id}/scoring/${outsider.id}`, { method: 'DELETE' })).response.status, 400);

  assert.equal((await json(`/api/matches/${match.id}/scoring/${playerA.id}`, { method: 'DELETE' })).response.status, 204);
  assert.equal((await json(`/api/matches/${match.id}/scoring/${playerA.id}`, { method: 'DELETE' })).response.status, 404);
});

test('publica rankings independientes de fase por tabla y sexo', async () => {
  const createMatch = async (date: string, tournamentType: 'MALE' | 'FEMALE', names: string[]) => (await json('/api/matches', {
    method: 'POST',
    body: JSON.stringify({ tournamentType, date, jornada: 'MORNING', teamA: names[0], teamB: names[1], lineTeam: names[2], court: 1 }),
  })).body;
  const finish = async (id: number) => {
    await json(`/api/matches/${id}/start`, { method: 'POST' });
    await json(`/api/matches/${id}/finish`, { method: 'POST' });
  };
  const score = (matchId: number, playerId: number, directGoals: number, pepitas: number, horquetas: number, scoringTable = 'Torneo Regular') => json(`/api/matches/${matchId}/scoring`, {
    method: 'POST', body: JSON.stringify({ playerId, directGoals, pepitas, horquetas, scoringTable }),
  });

  const first = await createMatch('2026-10-01', 'MALE', ['Ranking A', 'Ranking B', 'Ranking Línea']);
  const playerA = (await json(`/api/teams/${first.teamAId}/players`, { method: 'POST', body: JSON.stringify({ number: '07', name: 'Alfa' }) })).body;
  const playerA2 = (await json(`/api/teams/${first.teamAId}/players`, { method: 'POST', body: JSON.stringify({ number: '08', name: 'Beta' }) })).body;
  const playerB = (await json(`/api/teams/${first.teamBId}/players`, { method: 'POST', body: JSON.stringify({ number: '07', name: 'Gamma' }) })).body;
  await finish(first.id);
  await score(first.id, playerA.id, 0, 1, 1);
  await score(first.id, playerA2.id, 0, 1, 1);
  await score(first.id, playerB.id, 1, 0, 0);

  let result = await publicJson(`/api/phases/${first.phaseId}/scoring`);
  assert.equal(result.response.status, 200);
  let regular = result.body.tables.find(({ name }: any) => name === 'Torneo Regular').rankings;
  assert.deepEqual(regular.total.map(({ playerId, position, total }: any) => ({ playerId, position, total })), [
    { playerId: playerA.id, position: 1, total: 5 },
    { playerId: playerA2.id, position: 1, total: 5 },
    { playerId: playerB.id, position: 3, total: 1 },
  ]);
  assert.deepEqual(regular.pepitas.map(({ playerId, position }: any) => ({ playerId, position })), [{ playerId: playerA.id, position: 1 }, { playerId: playerA2.id, position: 1 }]);
  assert.deepEqual(regular.horquetas.map(({ playerId, position }: any) => ({ playerId, position })), [{ playerId: playerA.id, position: 1 }, { playerId: playerA2.id, position: 1 }]);

  const copaTable = await json(`/api/phases/${first.phaseId}/scoring-tables`, { method: 'POST', body: JSON.stringify({ name: 'Copa' }) });
  assert.equal(copaTable.response.status, 201);
  assert.equal((await json(`/api/phases/${first.phaseId}/scoring-tables`, { method: 'POST', body: JSON.stringify({ name: 'Torneo Regular' }) })).response.status, 409);

  const maleTournament = (await json('/api/tournaments')).body.find(({ legacyType }: any) => legacyType === 'MALE');
  const secondPhase = (await json(`/api/tournaments/${maleTournament.id}/phases`, { method: 'POST', body: JSON.stringify({ name: 'Segunda Ranking', type: 'TABLE', tournamentType: 'MALE', sortOrder: 2 }) })).body;
  const secondGroup = (await json(`/api/phases/${secondPhase.id}/groups`, { method: 'POST', body: JSON.stringify({ name: 'General' }) })).body;
  for (const teamId of [first.teamAId, first.teamBId]) await json(`/api/phases/${secondPhase.id}/memberships`, { method: 'POST', body: JSON.stringify({ teamId, groupId: secondGroup.id }) });
  const second = (await json('/api/matches', { method: 'POST', body: JSON.stringify({ phaseId: secondPhase.id, groupId: secondGroup.id, date: '2026-10-02', jornada: 'MORNING', court: 1, teamAId: first.teamAId, teamBId: first.teamBId, lineTeamId: first.lineTeamId }) })).body;
  await finish(second.id);
  await score(second.id, playerA.id, 1, 0, 0);
  await score(second.id, playerA2.id, 0, 1, 0, 'Copa');
  const live = await createMatch('2026-10-03', 'MALE', ['Ranking A', 'Ranking B', 'Ranking Línea']);
  await json(`/api/matches/${live.id}/start`, { method: 'POST' });
  await score(live.id, playerB.id, 0, 5, 0);

  const otherPhase = await createMatch('2026-10-01', 'FEMALE', ['Ranking FA', 'Ranking FB', 'Ranking FL']);
  const otherPlayer = (await json(`/api/teams/${otherPhase.teamAId}/players`, { method: 'POST', body: JSON.stringify({ number: '07' }) })).body;
  await finish(otherPhase.id);
  await score(otherPhase.id, otherPlayer.id, 0, 10, 10);

  const otherTournament = (await json('/api/tournaments', { method: 'POST', body: JSON.stringify({ name: 'Otro Ranking' }) })).body;
  const isolatedPhase = (await json(`/api/tournaments/${otherTournament.id}/phases`, { method: 'POST', body: JSON.stringify({ name: 'Liga', type: 'TABLE', tournamentType: 'MALE', sortOrder: 1 }) })).body;
  const isolatedGroup = (await json(`/api/phases/${isolatedPhase.id}/groups`, { method: 'POST', body: JSON.stringify({ name: 'General' }) })).body;
  const isolatedMatch = (await json('/api/matches', { method: 'POST', body: JSON.stringify({ phaseId: isolatedPhase.id, groupId: isolatedGroup.id, date: '2026-10-04', jornada: 'MORNING', court: 1, teamA: 'Aislado A', teamB: 'Aislado B', lineTeam: 'Aislado Línea' }) })).body;
  const isolatedPlayer = (await json(`/api/teams/${isolatedMatch.teamAId}/players`, { method: 'POST', body: JSON.stringify({ number: '07' }) })).body;
  await finish(isolatedMatch.id);
  await score(isolatedMatch.id, isolatedPlayer.id, 20, 0, 0);

  result = await publicJson(`/api/phases/${first.phaseId}/scoring`);
  regular = result.body.tables.find(({ name }: any) => name === 'Torneo Regular').rankings;
  assert.deepEqual(regular.total.map(({ playerId, total }: any) => ({ playerId, total })), [
    { playerId: playerA.id, total: 6 },
    { playerId: playerA2.id, total: 5 },
    { playerId: playerB.id, total: 1 },
  ]);
  const renamed = await json(`/api/phases/${first.phaseId}/scoring-tables/${copaTable.body.id}`, { method: 'PUT', body: JSON.stringify({ name: 'Copa Mayor' }) });
  assert.equal(renamed.body.name, 'Copa Mayor');
  result = await publicJson(`/api/phases/${first.phaseId}/scoring`);
  const copa = result.body.tables.find(({ name }: any) => name === 'Copa Mayor').rankings;
  assert.deepEqual(copa.total.map(({ playerId, total }: any) => ({ playerId, total })), [{ playerId: playerA2.id, total: 2 }]);
  assert.equal(regular.total.some(({ playerId }: any) => playerId === otherPlayer.id), false);
  assert.equal(regular.total.some(({ playerId }: any) => playerId === isolatedPlayer.id), false);
  const sameSexOtherPhase = await publicJson(`/api/phases/${secondPhase.id}/scoring`);
  assert.deepEqual(sameSexOtherPhase.body.tables, result.body.tables);
  const female = await publicJson(`/api/phases/${otherPhase.phaseId}/scoring`);
  assert.deepEqual(female.body.tables.find(({ name }: any) => name === 'Torneo Regular').rankings.total.map(({ playerId }: any) => playerId), [otherPlayer.id]);
  const isolated = await publicJson(`/api/phases/${isolatedPhase.id}/scoring`);
  assert.deepEqual(isolated.body.tables.find(({ name }: any) => name === 'Torneo Regular').rankings.total.map(({ playerId }: any) => playerId), [isolatedPlayer.id]);
  assert.equal((await publicJson('/api/phases/999999/scoring')).response.status, 404);
});

test('oculta las líneas hasta que un administrador publique la fecha', async () => {
  const date = '2026-09-23';
  let result = await json('/api/matches', { method: 'POST', body: JSON.stringify({ tournamentType: 'MALE', date, jornada: 'MORNING', teamA: 'A', teamB: 'B', lineTeam: 'Secreto', court: 1 }) });
  const matchId = result.body.id;
  result = await publicJson(`/api/matches?date=${date}`);
  assert.equal(result.body[0].lineVisible, 0);
  assert.equal(result.body[0].lineTeam, null);
  assert.equal(result.body[0].lineTeamId, null);

  result = await json(`/api/line-visibility/${date}`, { method: 'PUT', body: JSON.stringify({ visible: true }) });
  assert.equal(result.response.status, 200);
  result = await publicJson(`/api/matches?date=${date}`);
  assert.equal(result.body[0].lineTeam, 'Secreto');

  await json(`/api/line-visibility/${date}`, { method: 'PUT', body: JSON.stringify({ visible: false }) });
  result = await publicJson(`/api/matches?date=${date}`);
  assert.equal(result.body[0].lineTeam, null);
  await json(`/api/matches/${matchId}`, { method: 'DELETE' });
});

test('ordena partidos publicados y permite cambiar el orden de un finalizado', async () => {
  const date = '2026-09-24';
  const create = (name: string, court: number, sortOrder?: number) => json('/api/matches', { method: 'POST', body: JSON.stringify({ tournamentType: 'MALE', date, jornada: 'MORNING', teamA: `${name} A`, teamB: `${name} B`, lineTeam: `${name} Línea`, court, sortOrder }) });
  const second = (await create('Orden segundo', 1, 2)).body;
  const unordered = (await create('Orden libre', 2)).body;
  const first = (await create('Orden primero', 3, 1)).body;
  assert.equal(unordered.sortOrder, null);
  let result = await json(`/api/matches/${first.id}`, { method: 'PUT', body: JSON.stringify({ tournamentType: 'MALE', date, jornada: 'MORNING', teamA: first.teamA, teamB: first.teamB, lineTeam: first.lineTeam, court: 3 }) });
  assert.equal(result.body.sortOrder, 1);

  await json(`/api/line-visibility/${date}`, { method: 'PUT', body: JSON.stringify({ visible: true }) });
  result = await publicJson(`/api/matches?date=${date}`);
  assert.deepEqual(result.body.map(({ id }: { id: number }) => id), [first.id, second.id, unordered.id]);

  await json(`/api/matches/${second.id}/start`, { method: 'POST' });
  await json(`/api/matches/${second.id}/finish`, { method: 'POST' });
  result = await json(`/api/matches/${second.id}/order`, { method: 'PATCH', body: JSON.stringify({ sortOrder: 3 }) });
  assert.deepEqual({ status: result.body.status, sortOrder: result.body.sortOrder }, { status: 'FINISHED', sortOrder: 3 });
  result = await json(`/api/matches/${second.id}/order`, { method: 'PATCH', body: JSON.stringify({ sortOrder: null }) });
  assert.equal(result.body.sortOrder, null);
  assert.equal((await json(`/api/matches/${second.id}/order`, { method: 'PATCH', body: JSON.stringify({ sortOrder: 0 }) })).response.status, 400);

  await json(`/api/line-visibility/${date}`, { method: 'PUT', body: JSON.stringify({ visible: false }) });
  for (const match of [first, second, unordered]) await json(`/api/matches/${match.id}`, { method: 'DELETE' });
});

test('rechaza equipos repetidos', async () => {
  const result = await json('/api/matches', { method: 'POST', body: JSON.stringify({ tournamentType: 'MALE', date: '2026-09-20', jornada: 'MORNING', teamA: 'Tigres', teamB: 'tigres', lineTeam: 'Halcones', court: 1 }) });
  assert.equal(result.response.status, 400);
});

test('registra peticiones API con un identificador', async () => {
  const result = await json('/api/no-existe');
  assert.equal(result.response.status, 404);
  const requestId = result.response.headers.get('x-request-id');
  assert.ok(requestId);
  assert.match(requestId, /^[0-9a-f-]{36}$/);
  await waitForLog(requestId);
  assert.match(serverLogs, new RegExp(`"event":"request","requestId":"${requestId}".*"status":404`));
});

test('notifica cambios por SSE', async () => {
  const controller = new AbortController();
  const stream = await fetch(`${base}/api/events`, { signal: controller.signal });
  const reader = stream.body!.getReader();
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
  result = await json(`/api/tournaments/${tournamentId}/phases`, { method: 'POST', body: JSON.stringify({ name: 'Liga', type: 'TABLE', tournamentType: 'FEMALE', sortOrder: 1 }) });
  const phaseId = result.body.id;
  assert.equal(result.body.tournamentType, 'FEMALE');
  const groupIds: number[] = [];
  for (const name of ['A', 'B']) {
    result = await json(`/api/phases/${phaseId}/groups`, { method: 'POST', body: JSON.stringify({ name }) });
    groupIds.push(result.body.id);
  }
  const teamIds: number[] = [];
  for (const name of ['Uno', 'Dos', 'Tres', 'Cuatro']) {
    result = await json('/api/teams', { method: 'POST', body: JSON.stringify({ tournamentId, name }) });
    teamIds.push(result.body.id);
  }
  for (let index = 0; index < teamIds.length; index++) {
    result = await json(`/api/phases/${phaseId}/memberships`, { method: 'POST', body: JSON.stringify({ teamId: teamIds[index], groupId: groupIds[Math.floor(index / 2)] }) });
    assert.equal(result.response.status, 201);
  }
  result = await json(`/api/phases/${phaseId}/classification-rules`, { method: 'POST', body: JSON.stringify({ positions: [1, 3, 5, 7, 9], label: 'Segunda fase' }) });
  assert.equal(result.response.status, 201);
  assert.deepEqual(result.body.positions, [1, 3, 5, 7, 9]);
  result = await json(`/api/phases/${phaseId}/classification-rules`, { method: 'POST', body: JSON.stringify({ positions: [3, 4], label: 'Copa' }) });
  assert.equal(result.response.status, 409);
  result = await json(`/api/phases/${phaseId}/classification-rules`, { method: 'POST', body: JSON.stringify({ positions: [2, 4, 6, 8, 10], label: 'Copa' }) });
  assert.equal(result.response.status, 201);

  result = await json(`/api/phases/${phaseId}/standings`);
  assert.equal(result.body.groups.length, 2);
  for (const group of result.body.groups as ApiGroup[]) assert.deepEqual(group.standings[0]!.possibleDestinations, ['Segunda fase', 'Copa']);

  result = await json(`/api/phases/${phaseId}/teams/${teamIds[0]}/sanction`, { method: 'PUT', body: JSON.stringify({ reason: 'Artículo 19' }) });
  assert.equal(result.response.status, 200);
  result = await json(`/api/phases/${phaseId}/teams/${teamIds[0]}/cards`, { method: 'PUT', body: JSON.stringify({ yellowCards: 2, redCards: 1 }) });
  assert.equal(result.response.status, 200);
  result = await json(`/api/phases/${phaseId}/teams/${teamIds[0]}/cards`, { method: 'PUT', body: JSON.stringify({ yellowCards: 3, redCards: 1 }) });
  assert.equal(result.response.status, 200);
  result = await json(`/api/phases/${phaseId}/team-cards`);
  assert.deepEqual(result.body.map(({ teamId, yellowCards, redCards }: ApiRow) => ({ teamId, yellowCards, redCards })), [{ teamId: teamIds[0], yellowCards: 3, redCards: 1 }]);
  result = await json(`/api/phases/${phaseId}/standings`);
  const groupA = (result.body.groups as ApiGroup[]).find((group) => group.name === 'A')!.standings;
  const groupB = (result.body.groups as ApiGroup[]).find((group) => group.name === 'B')!.standings;
  assert.deepEqual(groupA.map((row) => row.teamName), ['Dos', 'Uno']);
  assert.deepEqual(groupA.map((row) => row.destination), ['Segunda fase', 'Copa']);
  assert.equal(groupB[0]!.requiresTiebreaker, true);
  assert.deepEqual({ yellowCards: groupA.find((row) => row.teamId === teamIds[0])!.yellowCards, redCards: groupA.find((row) => row.teamId === teamIds[0])!.redCards }, { yellowCards: 3, redCards: 1 });

  result = await json('/api/matches', { method: 'POST', body: JSON.stringify({ phaseId, groupId: groupIds[0], date: '2026-09-22', jornada: 'MORNING', court: 1, teamAId: teamIds[0], teamBId: teamIds[2], lineTeamId: teamIds[1] }) });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.tournamentType, 'FEMALE');
  const crossGroupMatchId = result.body.id;
  result = await json(`/api/phases/${phaseId}`, { method: 'PUT', body: JSON.stringify({ name: 'Liga', type: 'TABLE', tournamentType: 'MALE', sortOrder: 1 }) });
  assert.equal(result.body.tournamentType, 'MALE');
  result = await json(`/api/matches/${crossGroupMatchId}`);
  assert.equal(result.body.tournamentType, 'MALE');
  await json(`/api/matches/${crossGroupMatchId}/start`, { method: 'POST' });
  await json(`/api/matches/${crossGroupMatchId}/cards`, { method: 'PATCH', body: JSON.stringify({ yellowCardsA: 1, redCardsA: 1, yellowCardsB: 0, redCardsB: 0 }) });
  await json(`/api/matches/${crossGroupMatchId}/finish`, { method: 'POST' });
  await json(`/api/matches/${crossGroupMatchId}/result`, { method: 'PATCH', body: JSON.stringify({ scoreA: 2, scoreB: 0 }) });
  result = await json(`/api/phases/${phaseId}/standings`);
  const teamStanding = (result.body.groups as ApiGroup[]).find((group) => group.id === groupIds[0])!.standings.find((row) => row.teamId === teamIds[0])!;
  assert.equal(teamStanding.points, 3);
  assert.deepEqual({ yellowCards: teamStanding.yellowCards, redCards: teamStanding.redCards }, { yellowCards: 4, redCards: 2 });
  assert.equal((result.body.groups as ApiGroup[]).find((group) => group.id === groupIds[1])!.standings.find((row) => row.teamId === teamIds[2])!.played, 1);
  await json(`/api/matches/${crossGroupMatchId}/reopen`, { method: 'POST' });
  result = await json(`/api/phases/${phaseId}/standings`);
  assert.equal((result.body.groups as ApiGroup[]).find((group) => group.id === groupIds[0])!.standings.find((row) => row.teamId === teamIds[0])!.played, 0);
  await json(`/api/matches/${crossGroupMatchId}`, { method: 'DELETE' });
  result = await json(`/api/phases/${phaseId}/teams/${teamIds[0]}/cards`, { method: 'DELETE' });
  assert.equal(result.response.status, 204);
  result = await json(`/api/phases/${phaseId}/team-cards`);
  assert.deepEqual(result.body, []);

  result = await json(`/api/tournaments/${tournamentId}/phases`, { method: 'POST', body: JSON.stringify({ name: 'Final', type: 'ELIMINATION', tournamentType: 'MALE', sortOrder: 2 }) });
  result = await json(`/api/phases/${result.body.id}/standings`);
  assert.equal(result.body.hasStandings, false);

  result = await json(`/api/tournaments/${tournamentId}`, { method: 'PUT', body: JSON.stringify({ name: 'Mixto', active: true, currentPhaseId: phaseId }) });
  assert.equal(result.body.currentPhaseId, phaseId);
  result = await json(`/api/phases/${phaseId}`, { method: 'DELETE' });
  assert.equal(result.response.status, 204);
  result = await json(`/api/tournaments/${tournamentId}/phases`);
  assert.deepEqual(result.body.map(({ name }: { name: string }) => name), ['Final']);
  result = await json('/api/tournaments');
  assert.equal(result.body.find(({ id }: { id: number }) => id === tournamentId).currentPhaseId, null);
});

test('línea opcional: crear, asignar, quitar y leer en ambos contratos', async () => {
  const date = '2026-12-03';
  const schedule = { tournamentType: 'MALE', date, jornada: 'MORNING', court: 1, teamA: 'Sin línea A', teamB: 'Sin línea B' };
  const created = await json('/api/matches', { method: 'POST', body: JSON.stringify(schedule) });
  assert.equal(created.response.status, 201);
  const id = created.body.id;
  const absent = (match: any) => {
    assert.equal(match.lineTeam, null);
    assert.equal(match.lineTeamId, null);
    assert.equal(match.participants.lineTeam, null);
  };
  absent(created.body);
  absent((await json('/api/matches/' + id)).body);
  const publicMatch = async () => (await publicJson('/api/matches?date=' + date)).body.find((match: any) => match.id === id);
  const publicAbsent = await publicMatch();
  absent(publicAbsent);
  assert.equal(publicAbsent.lineAssigned, false);
  const assigned = await json('/api/matches/' + id, { method: 'PUT', body: JSON.stringify({ ...schedule, lineTeam: 'Línea posterior' }) });
  assert.equal(assigned.response.status, 200);
  assert.ok(assigned.body.lineTeamId);
  assert.equal((await publicMatch()).lineAssigned, true);
  absent((await json('/api/matches/' + id, { method: 'PUT', body: JSON.stringify({ ...schedule, lineTeam: null, lineTeamId: null }) })).body);
  const participants = { teamA: { kind: 'TEAM', teamId: created.body.teamAId }, teamB: { kind: 'TEAM', teamId: created.body.teamBId } };
  const input = { phaseId: created.body.phaseId, groupId: created.body.groupId, date, jornada: 'MORNING', court: 2, participants };
  const referenced = await json('/api/matches', { method: 'POST', body: JSON.stringify(input) });
  assert.equal(referenced.response.status, 201);
  absent(referenced.body);
  for (const lineTeam of [{ kind: 'TEAM', teamId: assigned.body.lineTeamId }, null]) {
    const result = await json('/api/matches/' + referenced.body.id, { method: 'PUT', body: JSON.stringify({ ...input, participants: { ...participants, lineTeam } }) });
    assert.equal(result.response.status, 200);
    if (lineTeam === null) absent(result.body);
  }
  for (const lineTeam of [{ kind: 'TEAM', teamId: created.body.teamAId }, { kind: 'TEAM', teamId: 999999 }]) {
    assert.equal((await json('/api/matches', { method: 'POST', body: JSON.stringify({ ...input, participants: { ...participants, lineTeam } }) })).response.status, 400);
  }
  assert.equal((await json('/api/matches', { method: 'POST', body: JSON.stringify({ ...schedule, teamB: '' }) })).response.status, 400);
  assert.equal((await json('/api/matches', { method: 'POST', body: JSON.stringify({ ...schedule, lineTeamId: 999999 }) })).response.status, 400);
  assert.equal((await json('/api/matches', { method: 'POST', body: JSON.stringify({ ...schedule, lineTeam: 123 }) })).response.status, 400);
  await json('/api/line-visibility/' + date, { method: 'PUT', body: JSON.stringify({ visible: true }) });
  absent(await publicMatch());
  absent((await publicJson('/api/matches?date=' + date)).body.find((match: any) => match.id === id));
  assert.equal((await json('/api/matches/' + id + '/start', { method: 'POST' })).response.status, 200);
});
