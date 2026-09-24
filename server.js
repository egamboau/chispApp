const express = require('express');
const Database = require('better-sqlite3');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const app = express();
const port = Number(process.env.PORT) || 3000;
const accessTeamDomain = process.env.CF_ACCESS_TEAM_DOMAIN?.replace(/\/$/, '');
const accessAudience = process.env.CF_ACCESS_AUD;
if (process.env.NODE_ENV === 'production' && (!accessTeamDomain || !accessAudience)) throw new Error('CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are required in production.');
const accessVerifier = accessTeamDomain && accessAudience ? import('jose').then(({ createRemoteJWKSet, jwtVerify }) => {
  const keys = createRemoteJWKSet(new URL(accessTeamDomain + '/cdn-cgi/access/certs'));
  return (token) => jwtVerify(token, keys, { issuer: accessTeamDomain, audience: accessAudience });
}) : null;
const databasePath = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'tournament.db');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('journal_mode = DELETE');
db.pragma('foreign_keys = ON');

const matchesSchema = `CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournamentType TEXT NOT NULL CHECK (tournamentType IN ('MALE', 'FEMALE')),
  date TEXT NOT NULL, jornada TEXT NOT NULL CHECK (jornada IN ('MORNING', 'AFTERNOON')),
  teamA TEXT NOT NULL, teamB TEXT NOT NULL, lineTeam TEXT NOT NULL,
  court INTEGER NOT NULL CHECK (court > 0), scoreA INTEGER NOT NULL DEFAULT 0 CHECK (scoreA >= 0),
  scoreB INTEGER NOT NULL DEFAULT 0 CHECK (scoreB >= 0),
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'LIVE', 'FINISHED')),
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
db.exec(matchesSchema);
if (db.prepare('PRAGMA table_info(matches)').all().some(({ name }) => name === 'time')) db.transaction(() => {
  db.exec('ALTER TABLE matches RENAME TO matches_with_time');
  db.exec(matchesSchema);
  db.exec(`INSERT INTO matches (id,tournamentType,date,jornada,teamA,teamB,lineTeam,court,scoreA,scoreB,status,createdAt,updatedAt)
    SELECT id,tournamentType,date,CASE WHEN time<'12:00' THEN 'MORNING' ELSE 'AFTERNOON' END,teamA,teamB,lineTeam,court,scoreA,scoreB,status,createdAt,updatedAt FROM matches_with_time`);
  db.exec('DROP TABLE matches_with_time');
})();

db.exec(`
CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY AUTOINCREMENT,tournamentType TEXT NOT NULL CHECK(tournamentType IN ('MALE','FEMALE')),name TEXT NOT NULL COLLATE NOCASE CHECK(length(name) BETWEEN 1 AND 100),UNIQUE(tournamentType,name));
INSERT OR IGNORE INTO teams(tournamentType,name) SELECT tournamentType,teamA FROM matches UNION SELECT tournamentType,teamB FROM matches UNION SELECT tournamentType,lineTeam FROM matches;
CREATE TABLE IF NOT EXISTS tournaments (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(name) BETWEEN 1 AND 100),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),currentPhaseId INTEGER,legacyType TEXT UNIQUE CHECK(legacyType IN('MALE','FEMALE')));
CREATE TABLE IF NOT EXISTS phases (id INTEGER PRIMARY KEY AUTOINCREMENT,tournamentId INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),type TEXT NOT NULL DEFAULT 'TABLE' CHECK(type IN('TABLE','ELIMINATION')),sortOrder INTEGER NOT NULL DEFAULT 1 CHECK(sortOrder>0),UNIQUE(tournamentId,name));
CREATE TABLE IF NOT EXISTS groups_table (id INTEGER PRIMARY KEY AUTOINCREMENT,phaseId INTEGER NOT NULL REFERENCES phases(id) ON DELETE RESTRICT,name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),UNIQUE(phaseId,name));
CREATE TABLE IF NOT EXISTS phase_memberships (phaseId INTEGER NOT NULL REFERENCES phases(id) ON DELETE RESTRICT,groupId INTEGER NOT NULL REFERENCES groups_table(id) ON DELETE RESTRICT,teamId INTEGER NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,PRIMARY KEY(phaseId,teamId));
CREATE TABLE IF NOT EXISTS sanctions (phaseId INTEGER NOT NULL REFERENCES phases(id) ON DELETE RESTRICT,teamId INTEGER NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,reason TEXT NOT NULL CHECK(length(trim(reason))>0),PRIMARY KEY(phaseId,teamId));
CREATE TABLE IF NOT EXISTS classification_rules (id INTEGER PRIMARY KEY AUTOINCREMENT,phaseId INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,startPosition INTEGER NOT NULL CHECK(startPosition>0),endPosition INTEGER NOT NULL CHECK(endPosition>=startPosition),label TEXT NOT NULL CHECK(length(trim(label))>0));`);

function addColumn(table, definition) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(({ name }) => name === definition.split(/\s+/)[0])) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}
addColumn('teams', 'tournamentId INTEGER REFERENCES tournaments(id)');
for (const definition of ['phaseId INTEGER REFERENCES phases(id)', 'groupId INTEGER REFERENCES groups_table(id)', 'teamAId INTEGER REFERENCES teams(id)', 'teamBId INTEGER REFERENCES teams(id)', 'lineTeamId INTEGER REFERENCES teams(id)', 'yellowCardsA INTEGER NOT NULL DEFAULT 0 CHECK(yellowCardsA>=0)', 'redCardsA INTEGER NOT NULL DEFAULT 0 CHECK(redCardsA>=0)', 'yellowCardsB INTEGER NOT NULL DEFAULT 0 CHECK(yellowCardsB>=0)', 'redCardsB INTEGER NOT NULL DEFAULT 0 CHECK(redCardsB>=0)']) addColumn('matches', definition);

app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  const startedAt = Date.now(); req.requestId = randomUUID(); res.set('X-Request-Id', req.requestId);
  res.on('finish', () => { const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'; console[level](JSON.stringify({ timestamp: new Date().toISOString(), level, event: 'request', requestId: req.requestId, method: req.method, path: req.originalUrl, status: res.statusCode, durationMs: Date.now() - startedAt })); });
  next();
});
app.use(express.json({ limit: '20kb' }));
async function requireAccess(req, res) {
  if (!accessVerifier) return true;
  const token = req.get('Cf-Access-Jwt-Assertion');
  if (!token) { res.status(403).json({ error: 'Acceso administrativo requerido.' }); return false; }
  try { await (await accessVerifier)(token); return true; }
  catch (error) {
    const unavailable = error instanceof TypeError || ['ERR_JWKS_TIMEOUT', 'ERR_JOSE_GENERIC'].includes(error.code);
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', event: 'access_validation_failed', error: { name: error.name, message: error.message } }));
    res.status(unavailable ? 503 : 403).json({ error: unavailable ? 'No se pudo validar el acceso.' : 'Acceso administrativo inválido.' });
    return false;
  }
}
const publicApiPaths = [/^\/api\/tournaments$/, /^\/api\/tournaments\/\d+\/phases$/, /^\/api\/matches$/, /^\/api\/phases\/\d+\/standings$/, /^\/api\/events$/];
app.use(async (req, res, next) => {
  const adminPage = req.path === '/admin' || req.path.startsWith('/admin/');
  const adminApi = req.path === '/api/admin' || req.path.startsWith('/api/admin/');
  if (adminPage || adminApi) {
    if (!await requireAccess(req, res)) return;
    if (adminApi) { req.isAdmin = true; req.url = req.url.replace(/^\/api\/admin(?=\/|$)/, '/api'); }
    return next();
  }
  if (req.path.startsWith('/api/') && (!['GET', 'HEAD'].includes(req.method) || !publicApiPaths.some((pattern) => pattern.test(req.path)))) return res.status(404).json({ error: 'Ruta no encontrada.' });
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res) => res.set('Cache-Control', 'no-store') }));

const clients = new Set();
const clean = (value) => typeof value === 'string' ? value.trim() : '';
const id = (value) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const fail = (res, status, error) => res.status(status).json({ error });
const one = (table, value) => db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(value);
function notify(type, value) { const data = `event: matches\ndata: ${JSON.stringify({ type, id: value })}\n\n`; for (const client of clients) client.write(data); }
const matchSelect = `SELECT m.*,t.name tournamentName,p.name phaseName,g.name groupName FROM matches m LEFT JOIN phases p ON p.id=m.phaseId LEFT JOIN tournaments t ON t.id=p.tournamentId LEFT JOIN groups_table g ON g.id=m.groupId`;
const getMatch = db.prepare(`${matchSelect} WHERE m.id=?`);
const legacyType = (tournament) => tournament.legacyType || (tournament.id % 2 ? 'MALE' : 'FEMALE');
app.get('/', (_req, res) => res.redirect('/display'));

app.get('/api/tournaments', (req, res) => res.json(db.prepare(`SELECT * FROM tournaments ${!req.isAdmin || req.query.active === 'true' ? 'WHERE active=1' : ''} ORDER BY name`).all()));
app.post('/api/tournaments', (req, res) => {
  const name = clean(req.body.name); if (!name || name.length > 100) return fail(res, 400, 'Nombre de torneo inválido.');
  try { const result = db.prepare('INSERT INTO tournaments(name,active) VALUES(?,?)').run(name, req.body.active === false ? 0 : 1); res.status(201).json(one('tournaments', result.lastInsertRowid)); }
  catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(res, 409, 'Ese torneo ya existe.'); throw error; }
});
app.put('/api/tournaments/:id', (req, res) => {
  const tournament = one('tournaments', req.params.id), name = clean(req.body.name), currentPhaseId = req.body.currentPhaseId == null ? null : id(req.body.currentPhaseId);
  if (!tournament) return fail(res, 404, 'Torneo no encontrado.');
  if (!name || (req.body.currentPhaseId != null && !currentPhaseId)) return fail(res, 400, 'Datos de torneo inválidos.');
  if (currentPhaseId && !db.prepare('SELECT 1 FROM phases WHERE id=? AND tournamentId=?').get(currentPhaseId, tournament.id)) return fail(res, 400, 'La fase actual no pertenece al torneo.');
  db.prepare('UPDATE tournaments SET name=?,active=?,currentPhaseId=? WHERE id=?').run(name, req.body.active === false ? 0 : 1, currentPhaseId, tournament.id); notify('tournament', tournament.id); res.json(one('tournaments', tournament.id));
});
function guardedDelete(table, label) { return (req, res) => { try { const result = db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id); if (!result.changes) return fail(res, 404, `${label} no encontrado.`); res.status(204).end(); } catch (error) { if (error.code?.startsWith('SQLITE_CONSTRAINT')) return fail(res, 409, `No se puede eliminar: ${label.toLowerCase()} tiene datos asociados.`); throw error; } }; }
app.delete('/api/tournaments/:id', guardedDelete('tournaments', 'Torneo'));

app.get('/api/tournaments/:id/phases', (req, res) => res.json(db.prepare('SELECT * FROM phases WHERE tournamentId=? ORDER BY sortOrder,id').all(req.params.id)));
app.post('/api/tournaments/:id/phases', (req, res) => {
  const phase = { tournamentId: Number(req.params.id), name: clean(req.body.name), type: req.body.type || 'TABLE', sortOrder: Number(req.body.sortOrder || 1) };
  if (!one('tournaments', phase.tournamentId)) return fail(res, 404, 'Torneo no encontrado.');
  if (!phase.name || !['TABLE', 'ELIMINATION'].includes(phase.type) || !Number.isInteger(phase.sortOrder) || phase.sortOrder < 1) return fail(res, 400, 'Datos de fase inválidos.');
  const result = db.prepare('INSERT INTO phases(tournamentId,name,type,sortOrder) VALUES(@tournamentId,@name,@type,@sortOrder)').run(phase); res.status(201).json(one('phases', result.lastInsertRowid));
});
app.put('/api/phases/:id', (req, res) => {
  const phase = one('phases', req.params.id), name = clean(req.body.name), sortOrder = Number(req.body.sortOrder);
  if (!phase) return fail(res, 404, 'Fase no encontrada.');
  if (!name || !['TABLE', 'ELIMINATION'].includes(req.body.type) || !Number.isInteger(sortOrder) || sortOrder < 1) return fail(res, 400, 'Datos de fase inválidos.');
  db.prepare('UPDATE phases SET name=?,type=?,sortOrder=? WHERE id=?').run(name, req.body.type, sortOrder, phase.id); notify('phase', phase.id); res.json(one('phases', phase.id));
});
app.delete('/api/phases/:id', (req, res) => {
  const phase = one('phases', req.params.id);
  if (!phase) return fail(res, 404, 'Fase no encontrada.');
  if (db.prepare('SELECT 1 FROM matches WHERE phaseId=?').get(phase.id)) return fail(res, 409, 'No se puede eliminar: la fase tiene partidos asociados.');
  db.transaction(() => {
    db.prepare('UPDATE tournaments SET currentPhaseId=NULL WHERE currentPhaseId=?').run(phase.id);
    db.prepare('DELETE FROM phase_memberships WHERE phaseId=?').run(phase.id);
    db.prepare('DELETE FROM sanctions WHERE phaseId=?').run(phase.id);
    db.prepare('DELETE FROM groups_table WHERE phaseId=?').run(phase.id);
    db.prepare('DELETE FROM phases WHERE id=?').run(phase.id);
  })();
  res.status(204).end();
});

app.get('/api/phases/:id/groups', (req, res) => res.json(db.prepare('SELECT * FROM groups_table WHERE phaseId=? ORDER BY name').all(req.params.id)));
app.post('/api/phases/:id/groups', (req, res) => { const name = clean(req.body.name); if (!one('phases', req.params.id)) return fail(res, 404, 'Fase no encontrada.'); if (!name || name.length > 100) return fail(res, 400, 'Nombre de grupo inválido.'); const result = db.prepare('INSERT INTO groups_table(phaseId,name) VALUES(?,?)').run(req.params.id, name); res.status(201).json(one('groups_table', result.lastInsertRowid)); });
app.put('/api/groups/:id', (req, res) => { const name = clean(req.body.name); if (!name) return fail(res, 400, 'Nombre de grupo inválido.'); const result = db.prepare('UPDATE groups_table SET name=? WHERE id=?').run(name, req.params.id); if (!result.changes) return fail(res, 404, 'Grupo no encontrado.'); res.json(one('groups_table', req.params.id)); });
app.delete('/api/groups/:id', guardedDelete('groups_table', 'Grupo'));

app.get('/api/teams', (req, res) => {
  if (req.query.tournamentType && !['MALE', 'FEMALE'].includes(req.query.tournamentType)) return fail(res, 400, 'Torneo inválido.');
  const where = id(req.query.tournamentId) ? 'WHERE tournamentId=@tournamentId' : req.query.tournamentType ? 'WHERE tournamentType=@tournamentType' : '';
  const statement = db.prepare(`SELECT * FROM teams ${where} ORDER BY name`);
  res.json(where ? statement.all({ tournamentId: id(req.query.tournamentId), tournamentType: req.query.tournamentType }) : statement.all());
});
app.post('/api/teams', (req, res) => {
  const tournament = req.body.tournamentId ? one('tournaments', req.body.tournamentId) : db.prepare('SELECT * FROM tournaments WHERE legacyType=?').get(req.body.tournamentType), name = clean(req.body.name);
  if (!tournament) return fail(res, 400, 'Torneo inválido.'); if (!name || name.length > 100) return fail(res, 400, 'Nombre de equipo inválido.');
  try { const result = db.prepare('INSERT INTO teams(tournamentType,tournamentId,name) VALUES(?,?,?)').run(legacyType(tournament), tournament.id, name); res.status(201).json(one('teams', result.lastInsertRowid)); }
  catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(res, 409, 'Ese equipo ya existe en el torneo.'); throw error; }
});
app.put('/api/teams/:id', (req, res) => {
  const team = one('teams', req.params.id), name = clean(req.body.name);
  if (!team) return fail(res, 404, 'Equipo no encontrado.');
  if (!name || name.length > 100) return fail(res, 400, 'Nombre de equipo inválido.');
  try {
    db.transaction(() => {
      db.prepare('UPDATE teams SET name=? WHERE id=?').run(name, team.id);
      db.prepare('UPDATE matches SET teamA=?,updatedAt=CURRENT_TIMESTAMP WHERE teamAId=?').run(name, team.id);
      db.prepare('UPDATE matches SET teamB=?,updatedAt=CURRENT_TIMESTAMP WHERE teamBId=?').run(name, team.id);
      db.prepare('UPDATE matches SET lineTeam=?,updatedAt=CURRENT_TIMESTAMP WHERE lineTeamId=?').run(name, team.id);
    })();
    notify('team', team.id);
    res.json(one('teams', team.id));
  } catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(res, 409, 'Ese equipo ya existe en el torneo.'); throw error; }
});
app.delete('/api/teams/:id', guardedDelete('teams', 'Equipo'));

app.get('/api/phases/:id/memberships', (req, res) => res.json(db.prepare('SELECT pm.*,t.name teamName,g.name groupName FROM phase_memberships pm JOIN teams t ON t.id=pm.teamId JOIN groups_table g ON g.id=pm.groupId WHERE pm.phaseId=? ORDER BY g.name,t.name').all(req.params.id)));
app.post('/api/phases/:id/memberships', (req, res) => {
  const phase = one('phases', req.params.id), group = one('groups_table', req.body.groupId), team = one('teams', req.body.teamId);
  if (!phase || !group || group.phaseId !== phase.id || !team || team.tournamentId !== phase.tournamentId) return fail(res, 400, 'Fase, grupo o equipo inválido.');
  try { db.prepare('INSERT INTO phase_memberships VALUES(?,?,?)').run(phase.id, group.id, team.id); res.status(201).json({ phaseId: phase.id, groupId: group.id, teamId: team.id }); }
  catch (error) { if (error.code?.startsWith('SQLITE_CONSTRAINT')) return fail(res, 409, 'El equipo ya pertenece a un grupo de esta fase.'); throw error; }
});
app.put('/api/phases/:id/memberships/:teamId', (req, res) => { const group = one('groups_table', req.body.groupId); if (!group || group.phaseId !== Number(req.params.id)) return fail(res, 400, 'Grupo inválido.'); if (db.prepare('SELECT 1 FROM matches WHERE phaseId=? AND(teamAId=? OR teamBId=?)').get(req.params.id, req.params.teamId, req.params.teamId)) return fail(res, 409, 'El equipo tiene partidos existentes.'); const result = db.prepare('UPDATE phase_memberships SET groupId=? WHERE phaseId=? AND teamId=?').run(group.id, req.params.id, req.params.teamId); if (!result.changes) return fail(res, 404, 'Membresía no encontrada.'); res.json({ phaseId: Number(req.params.id), groupId: group.id, teamId: Number(req.params.teamId) }); });
app.delete('/api/phases/:id/memberships/:teamId', (req, res) => { if (db.prepare('SELECT 1 FROM matches WHERE phaseId=? AND(teamAId=? OR teamBId=?)').get(req.params.id, req.params.teamId, req.params.teamId)) return fail(res, 409, 'El equipo tiene partidos existentes.'); const result = db.prepare('DELETE FROM phase_memberships WHERE phaseId=? AND teamId=?').run(req.params.id, req.params.teamId); if (!result.changes) return fail(res, 404, 'Membresía no encontrada.'); res.status(204).end(); });

const parseRule = (body) => { const rule = { startPosition: Number(body.startPosition), endPosition: Number(body.endPosition), label: clean(body.label) }; return Number.isInteger(rule.startPosition) && rule.startPosition > 0 && Number.isInteger(rule.endPosition) && rule.endPosition >= rule.startPosition && rule.label ? rule : null; };
const overlaps = (phaseId, rule, except = 0) => db.prepare('SELECT 1 FROM classification_rules WHERE phaseId=? AND id<>? AND startPosition<=? AND endPosition>=?').get(phaseId, except, rule.endPosition, rule.startPosition);
app.get('/api/phases/:id/classification-rules', (req, res) => res.json(db.prepare('SELECT * FROM classification_rules WHERE phaseId=? ORDER BY startPosition').all(req.params.id)));
app.post('/api/phases/:id/classification-rules', (req, res) => { const rule = parseRule(req.body); if (!one('phases', req.params.id)) return fail(res, 404, 'Fase no encontrada.'); if (!rule) return fail(res, 400, 'Rango inválido.'); if (overlaps(req.params.id, rule)) return fail(res, 409, 'El rango se superpone con otro.'); const result = db.prepare('INSERT INTO classification_rules(phaseId,startPosition,endPosition,label) VALUES(?,?,?,?)').run(req.params.id, rule.startPosition, rule.endPosition, rule.label); notify('classification-rules', Number(req.params.id)); res.status(201).json(one('classification_rules', result.lastInsertRowid)); });
app.put('/api/phases/:id/classification-rules/:ruleId', (req, res) => { const current = one('classification_rules', req.params.ruleId), rule = parseRule(req.body); if (!current || current.phaseId !== Number(req.params.id)) return fail(res, 404, 'Regla no encontrada.'); if (!rule) return fail(res, 400, 'Rango inválido.'); if (overlaps(req.params.id, rule, current.id)) return fail(res, 409, 'El rango se superpone con otro.'); db.prepare('UPDATE classification_rules SET startPosition=?,endPosition=?,label=? WHERE id=?').run(rule.startPosition, rule.endPosition, rule.label, current.id); notify('classification-rules', current.phaseId); res.json(one('classification_rules', current.id)); });
app.delete('/api/phases/:id/classification-rules/:ruleId', (req, res) => { const result = db.prepare('DELETE FROM classification_rules WHERE id=? AND phaseId=?').run(req.params.ruleId, req.params.id); if (!result.changes) return fail(res, 404, 'Regla no encontrada.'); notify('classification-rules', Number(req.params.id)); res.status(204).end(); });

app.get('/api/phases/:id/sanctions', (req, res) => res.json(db.prepare('SELECT s.*,t.name teamName FROM sanctions s JOIN teams t ON t.id=s.teamId WHERE s.phaseId=? ORDER BY t.name').all(req.params.id)));
app.put('/api/phases/:id/teams/:teamId/sanction', (req, res) => { const reason = clean(req.body.reason); if (!reason) return fail(res, 400, 'El motivo es obligatorio.'); if (!db.prepare('SELECT 1 FROM phase_memberships WHERE phaseId=? AND teamId=?').get(req.params.id, req.params.teamId)) return fail(res, 400, 'El equipo no pertenece a la fase.'); db.prepare('INSERT INTO sanctions VALUES(?,?,?) ON CONFLICT(phaseId,teamId) DO UPDATE SET reason=excluded.reason').run(req.params.id, req.params.teamId, reason); notify('sanction', Number(req.params.id)); res.json(db.prepare('SELECT * FROM sanctions WHERE phaseId=? AND teamId=?').get(req.params.id, req.params.teamId)); });
app.delete('/api/phases/:id/teams/:teamId/sanction', (req, res) => { const result = db.prepare('DELETE FROM sanctions WHERE phaseId=? AND teamId=?').run(req.params.id, req.params.teamId); if (!result.changes) return fail(res, 404, 'Sanción no encontrada.'); notify('sanction', Number(req.params.id)); res.status(204).end(); });

function matchInput(body) {
  const phase = body.phaseId ? one('phases', body.phaseId) : db.prepare('SELECT p.* FROM phases p JOIN tournaments t ON t.currentPhaseId=p.id WHERE t.legacyType=?').get(body.tournamentType), group = body.groupId ? one('groups_table', body.groupId) : phase && db.prepare('SELECT * FROM groups_table WHERE phaseId=? ORDER BY id LIMIT 1').get(phase.id), tournament = phase && one('tournaments', phase.tournamentId);
  const findTeam = (teamId, name) => {
    if (teamId) return one('teams', teamId);
    const teamName = clean(name);
    if (!tournament || !teamName) return null;
    let team = db.prepare('SELECT * FROM teams WHERE tournamentId=? AND name=? COLLATE NOCASE').get(tournament.id, teamName);
    if (!team) {
      const result = db.prepare('INSERT INTO teams(tournamentType,tournamentId,name) VALUES(?,?,?)').run(legacyType(tournament), tournament.id, teamName);
      team = one('teams', result.lastInsertRowid);
      if (phase && group) db.prepare('INSERT OR IGNORE INTO phase_memberships VALUES(?,?,?)').run(phase.id, group.id, team.id);
    }
    return team;
  };
  const a = findTeam(body.teamAId, body.teamA), b = findTeam(body.teamBId, body.teamB), line = findTeam(body.lineTeamId, body.lineTeam);
  const match = { phaseId: phase?.id, groupId: group?.id, teamAId: a?.id, teamBId: b?.id, lineTeamId: line?.id, tournamentType: tournament && legacyType(tournament), teamA: a?.name, teamB: b?.name, lineTeam: line?.name, date: clean(body.date), jornada: body.jornada, court: Number(body.court) }, errors = [];
  if (!phase || !group || group.phaseId !== phase.id) errors.push('Fase o grupo inválido.'); if (!/^\d{4}-\d{2}-\d{2}$/.test(match.date) || Number.isNaN(Date.parse(`${match.date}T00:00:00Z`))) errors.push('Fecha inválida.'); if (!['MORNING', 'AFTERNOON'].includes(match.jornada)) errors.push('Jornada inválida.'); if (!Number.isInteger(match.court) || match.court < 1) errors.push('Cancha inválida.');
  if (!a || !b || !line || new Set([a?.id, b?.id, line?.id]).size !== 3) errors.push('Los tres equipos deben existir y ser diferentes.');
  if (phase && group && a && !db.prepare('SELECT 1 FROM phase_memberships WHERE phaseId=? AND groupId=? AND teamId=?').get(phase.id, group.id, a.id)) errors.push('El equipo A debe pertenecer al grupo seleccionado.');
  if (phase && b && !db.prepare('SELECT 1 FROM phase_memberships WHERE phaseId=? AND teamId=?').get(phase.id, b.id)) errors.push('El equipo B debe pertenecer a la fase.');
  return { match, errors };
}
app.get('/api/matches', (req, res) => { const clauses = [], params = {}; for (const key of ['phaseId', 'groupId']) if (req.query[key]) { if (!id(req.query[key])) return fail(res, 400, `${key} inválido.`); clauses.push(`m.${key}=@${key}`); params[key] = Number(req.query[key]); } if (req.query.tournamentType) { if (!['MALE', 'FEMALE'].includes(req.query.tournamentType)) return fail(res, 400, 'Torneo inválido.'); clauses.push('m.tournamentType=@tournamentType'); params.tournamentType = req.query.tournamentType; } if (req.query.status) { if (!['SCHEDULED', 'LIVE', 'FINISHED'].includes(req.query.status)) return fail(res, 400, 'Estado inválido.'); clauses.push('m.status=@status'); params.status = req.query.status; } if (req.query.date) { clauses.push('m.date=@date'); params.date = req.query.date; } const statement = db.prepare(`${matchSelect}${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY m.date,CASE m.jornada WHEN 'MORNING' THEN 0 ELSE 1 END,m.court,m.id`); res.json(clauses.length ? statement.all(params) : statement.all()); });
app.get('/api/matches/:id', (req, res) => { const match = getMatch.get(req.params.id); return match ? res.json(match) : fail(res, 404, 'Partido no encontrado.'); });
app.post('/api/matches', (req, res) => { const { match, errors } = matchInput(req.body); if (errors.length) return fail(res, 400, errors.join(' ')); const result = db.prepare('INSERT INTO matches(tournamentType,date,jornada,teamA,teamB,lineTeam,court,phaseId,groupId,teamAId,teamBId,lineTeamId) VALUES(@tournamentType,@date,@jornada,@teamA,@teamB,@lineTeam,@court,@phaseId,@groupId,@teamAId,@teamBId,@lineTeamId)').run(match); const created = getMatch.get(result.lastInsertRowid); notify('created', created.id); res.status(201).json(created); });
app.put('/api/matches/:id', (req, res) => { const existing = getMatch.get(req.params.id); if (!existing) return fail(res, 404, 'Partido no encontrado.'); if (existing.status !== 'SCHEDULED') return fail(res, 409, 'Solo se puede editar un partido programado.'); const { match, errors } = matchInput(req.body); if (errors.length) return fail(res, 400, errors.join(' ')); db.prepare('UPDATE matches SET tournamentType=@tournamentType,date=@date,jornada=@jornada,teamA=@teamA,teamB=@teamB,lineTeam=@lineTeam,court=@court,phaseId=@phaseId,groupId=@groupId,teamAId=@teamAId,teamBId=@teamBId,lineTeamId=@lineTeamId,updatedAt=CURRENT_TIMESTAMP WHERE id=@id').run({ ...match, id: existing.id }); const updated = getMatch.get(existing.id); notify('updated', updated.id); res.json(updated); });
app.delete('/api/matches/:id', (req, res) => { const result = db.prepare('DELETE FROM matches WHERE id=?').run(req.params.id); if (!result.changes) return fail(res, 404, 'Partido no encontrado.'); notify('deleted', Number(req.params.id)); res.status(204).end(); });
function status(req, res, from, to) { const result = db.prepare('UPDATE matches SET status=?,updatedAt=CURRENT_TIMESTAMP WHERE id=? AND status=?').run(to, req.params.id, from); if (!result.changes) return fail(res, getMatch.get(req.params.id) ? 409 : 404, getMatch.get(req.params.id) ? `El partido debe estar ${from}.` : 'Partido no encontrado.'); const updated = getMatch.get(req.params.id); notify(to.toLowerCase(), updated.id); res.json(updated); }
app.post('/api/matches/:id/start', (req, res) => status(req, res, 'SCHEDULED', 'LIVE'));
app.post('/api/matches/:id/finish', (req, res) => status(req, res, 'LIVE', 'FINISHED'));
app.patch('/api/matches/:id/score', (req, res) => { const { team, delta } = req.body; if (!['A', 'B'].includes(team) || ![-1, 1].includes(delta)) return fail(res, 400, 'Cambio inválido.'); const column = team === 'A' ? 'scoreA' : 'scoreB', result = db.prepare(`UPDATE matches SET ${column}=${column}+?,updatedAt=CURRENT_TIMESTAMP WHERE id=? AND status='LIVE' AND ${column}+?>=0`).run(delta, req.params.id, delta); if (!result.changes) { const match = getMatch.get(req.params.id); return fail(res, match ? 409 : 404, match ? 'Marcador bloqueado o inválido.' : 'Partido no encontrado.'); } const updated = getMatch.get(req.params.id); notify('score', updated.id); res.json(updated); });
app.patch('/api/matches/:id/cards', (req, res) => { const cards = Object.fromEntries(['yellowCardsA', 'redCardsA', 'yellowCardsB', 'redCardsB'].map((key) => [key, Number(req.body[key])])); if (Object.values(cards).some((value) => !Number.isInteger(value) || value < 0)) return fail(res, 400, 'Las tarjetas deben ser enteros no negativos.'); const result = db.prepare('UPDATE matches SET yellowCardsA=@yellowCardsA,redCardsA=@redCardsA,yellowCardsB=@yellowCardsB,redCardsB=@redCardsB,updatedAt=CURRENT_TIMESTAMP WHERE id=@id').run({ ...cards, id: req.params.id }); if (!result.changes) return fail(res, 404, 'Partido no encontrado.'); const updated = getMatch.get(req.params.id); notify('cards', updated.id); res.json(updated); });

const destinationAt = (rules, position) => rules.find((rule) => position >= rule.startPosition && position <= rule.endPosition)?.label || null;
function calculateGroupStandings(members, matches, rules, sanctions) {
  const rows = new Map(members.map((team) => [team.id, { teamId: team.id, teamName: team.name, played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, yellowCards: 0, redCards: 0, sanctioned: sanctions.has(team.id), sanctionReason: sanctions.get(team.id) || null }]));
  for (const match of matches) {
    const a = rows.get(match.teamAId), b = rows.get(match.teamBId), draw = match.scoreA === match.scoreB;
    if (a) { a.played++; a.goalsFor += match.scoreA; a.goalsAgainst += match.scoreB; a.yellowCards += match.yellowCardsA; a.redCards += match.redCardsA; if (draw) { a.draws++; a.points++; } else if (match.scoreA > match.scoreB) { a.wins++; a.points += 3; } else a.losses++; }
    if (b) { b.played++; b.goalsFor += match.scoreB; b.goalsAgainst += match.scoreA; b.yellowCards += match.yellowCardsB; b.redCards += match.redCardsB; if (draw) { b.draws++; b.points++; } else if (match.scoreB > match.scoreA) { b.wins++; b.points += 3; } else b.losses++; }
  }
  for (const row of rows.values()) row.goalDifference = row.goalsFor - row.goalsAgainst;
  const split = (items, value) => { const groups = []; for (const item of items) { const key = value(item), last = groups.at(-1); if (!last || last.key !== key) groups.push({ key, items: [item] }); else last.items.push(item); } return groups.map(({ items: group }) => group); };
  const direct = (items) => { const stats = new Map(items.map(({ teamId }) => [teamId, { points: 0, goalDifference: 0, goalsFor: 0 }])); for (const match of matches) { if (!stats.has(match.teamAId) || !stats.has(match.teamBId)) continue; const a = stats.get(match.teamAId), b = stats.get(match.teamBId); a.goalsFor += match.scoreA; a.goalDifference += match.scoreA - match.scoreB; b.goalsFor += match.scoreB; b.goalDifference += match.scoreB - match.scoreA; if (match.scoreA === match.scoreB) { a.points++; b.points++; } else stats.get(match.scoreA > match.scoreB ? match.teamAId : match.teamBId).points += 3; } return stats; };
  const resolve = (items, criterion = 0) => { if (items.length < 2 || criterion > 5) return [items]; let value, ascending = false; if (criterion === 0) value = (row) => row.goalDifference; if (criterion === 1) value = (row) => row.goalsFor; if (criterion >= 2 && criterion <= 4) { const head = direct(items); value = (row) => head.get(row.teamId)[['points', 'goalDifference', 'goalsFor'][criterion - 2]]; } if (criterion === 5) { value = (row) => row.redCards * 1000000 + row.yellowCards; ascending = true; } const sorted = [...items].sort((a, b) => ascending ? value(a) - value(b) : value(b) - value(a)); return split(sorted, value).flatMap((group) => resolve(group, criterion + 1)); };
  const ordered = []; for (const tied of split([...rows.values()].sort((a, b) => b.points - a.points), (row) => row.points)) { const start = ordered.reduce((total, group) => total + group.length, 0) + 1, crosses = new Set(tied.map((_row, index) => destinationAt(rules, start + index) || '__none__')).size > 1, sanctionGroups = crosses ? split([...tied].sort((a, b) => Number(a.sanctioned) - Number(b.sanctioned)), (row) => row.sanctioned) : [tied]; for (const group of sanctionGroups) ordered.push(...resolve(group)); }
  const result = []; let position = 1; for (const tied of ordered) { const destinations = Array.from({ length: tied.length }, (_, index) => destinationAt(rules, position + index)), same = destinations.every((item) => item === destinations[0]), possibleDestinations = [...new Set(destinations.filter(Boolean))]; for (const row of tied) result.push({ ...row, position, requiresTiebreaker: tied.length > 1, destination: same ? destinations[0] : null, possibleDestinations: same ? [] : possibleDestinations, tiebreakerRule: tied.length > 1 ? 'Dos tiempos de 5 minutos y penales si persiste el empate.' : null }); position += tied.length; }
  return result;
}
app.get('/api/phases/:id/standings', (req, res) => { const phase = one('phases', req.params.id); if (!phase) return fail(res, 404, 'Fase no encontrada.'); if (phase.type !== 'TABLE') return res.json({ phase, hasStandings: false, message: 'Esta fase eliminatoria no tiene tabla.', rules: [], groups: [] }); const rules = db.prepare('SELECT * FROM classification_rules WHERE phaseId=? ORDER BY startPosition').all(phase.id), sanctions = new Map(db.prepare('SELECT teamId,reason FROM sanctions WHERE phaseId=?').all(phase.id).map((item) => [item.teamId, item.reason])), matches = db.prepare("SELECT * FROM matches WHERE phaseId=? AND status='FINISHED'").all(phase.id), groups = db.prepare('SELECT * FROM groups_table WHERE phaseId=? ORDER BY name').all(phase.id).map((group) => { const members = db.prepare('SELECT t.* FROM phase_memberships pm JOIN teams t ON t.id=pm.teamId WHERE pm.phaseId=? AND pm.groupId=?').all(phase.id, group.id); return { ...group, standings: calculateGroupStandings(members, matches, rules, sanctions) }; }); res.json({ phase, hasStandings: true, rules, groups }); });

app.head('/api/events', (_req, res) => res.status(200).end());
app.get('/api/events', (req, res) => { res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' }); res.flushHeaders(); res.write('event: connected\ndata: {}\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); });
app.use('/api', (_req, res) => fail(res, 404, 'Ruta no encontrada.'));
app.use((error, req, res, _next) => { console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', event: 'request_error', requestId: req.requestId, method: req.method, path: req.originalUrl, error: { name: error.name, message: error.message, stack: error.stack } })); res.status(500).json({ error: 'Error interno del servidor.' }); });
const server = app.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', event: 'server_started', address: `0.0.0.0:${port}`, databasePath })));
function shutdown() { server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
module.exports = { app, db, server, calculateGroupStandings };
