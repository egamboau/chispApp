const express = require('express');
const Database = require('better-sqlite3');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const app = express();
const port = Number(process.env.PORT) || 3000;
const databasePath = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'tournament.db');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma('journal_mode = DELETE');
db.pragma('foreign_keys = ON');
const createMatchesTable = `
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournamentType TEXT NOT NULL CHECK (tournamentType IN ('MALE', 'FEMALE')),
    date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    jornada TEXT NOT NULL CHECK (jornada IN ('MORNING', 'AFTERNOON')),
    teamA TEXT NOT NULL,
    teamB TEXT NOT NULL,
    lineTeam TEXT NOT NULL,
    court INTEGER NOT NULL CHECK (court > 0),
    scoreA INTEGER NOT NULL DEFAULT 0 CHECK (scoreA >= 0),
    scoreB INTEGER NOT NULL DEFAULT 0 CHECK (scoreB >= 0),
    status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'LIVE', 'FINISHED')),
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;
db.exec(createMatchesTable);
const teamsTableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'teams'").get();
db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournamentType TEXT NOT NULL CHECK (tournamentType IN ('MALE', 'FEMALE')),
    name TEXT NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 100),
    UNIQUE (tournamentType, name)
  )
`);

if (db.prepare('PRAGMA table_info(matches)').all().some(({ name }) => name === 'time')) {
  db.transaction(() => {
    db.exec('ALTER TABLE matches RENAME TO matches_with_time');
    db.exec(createMatchesTable);
    db.exec(`
      INSERT INTO matches (id, tournamentType, date, jornada, teamA, teamB, lineTeam, court, scoreA, scoreB, status, createdAt, updatedAt)
      SELECT id, tournamentType, date, CASE WHEN time < '12:00' THEN 'MORNING' ELSE 'AFTERNOON' END,
        teamA, teamB, lineTeam, court, scoreA, scoreB, status, createdAt, updatedAt
      FROM matches_with_time
    `);
    db.exec('DROP TABLE matches_with_time');
  })();
}

if (!teamsTableExists) {
  db.exec(`
    INSERT OR IGNORE INTO teams (tournamentType, name)
    SELECT tournamentType, teamA FROM matches
    UNION SELECT tournamentType, teamB FROM matches
    UNION SELECT tournamentType, lineTeam FROM matches
  `);
}

app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  const startedAt = Date.now();
  req.requestId = randomUUID();
  res.set('X-Request-Id', req.requestId);
  res.on('finish', () => {
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    console[level](JSON.stringify({ timestamp: new Date().toISOString(), level, event: 'request', requestId: req.requestId, method: req.method, path: req.originalUrl, status: res.statusCode, durationMs: Date.now() - startedAt }));
  });
  next();
});
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const clients = new Set();
function notify(type, id) {
  const message = `event: matches\ndata: ${JSON.stringify({ type, id })}\n\n`;
  for (const client of clients) client.write(message);
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateMatch(body) {
  const match = {
    tournamentType: body.tournamentType,
    date: cleanText(body.date),
    jornada: body.jornada,
    teamA: cleanText(body.teamA),
    teamB: cleanText(body.teamB),
    lineTeam: cleanText(body.lineTeam),
    court: Number(body.court)
  };
  const errors = [];
  if (!['MALE', 'FEMALE'].includes(match.tournamentType)) errors.push('Torneo inválido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(match.date) || Number.isNaN(Date.parse(`${match.date}T00:00:00Z`))) errors.push('Fecha inválida.');
  if (!['MORNING', 'AFTERNOON'].includes(match.jornada)) errors.push('Jornada inválida.');
  if (!Number.isInteger(match.court) || match.court < 1) errors.push('La cancha debe ser un entero positivo.');
  if (!match.teamA || !match.teamB || !match.lineTeam) errors.push('Todos los equipos son requeridos.');
  const names = [match.teamA, match.teamB, match.lineTeam].map((name) => name.toLocaleLowerCase('es'));
  if (new Set(names).size !== 3) errors.push('Los equipos y el equipo de línea deben ser diferentes.');
  return { match, errors };
}

const selectOne = db.prepare('SELECT * FROM matches WHERE id = ?');
const insertMatch = db.prepare(`
  INSERT INTO matches (tournamentType, date, jornada, teamA, teamB, lineTeam, court)
  VALUES (@tournamentType, @date, @jornada, @teamA, @teamB, @lineTeam, @court)
`);
const updateMatch = db.prepare(`
  UPDATE matches SET tournamentType=@tournamentType, date=@date, jornada=@jornada,
    teamA=@teamA, teamB=@teamB, lineTeam=@lineTeam, court=@court, updatedAt=CURRENT_TIMESTAMP
  WHERE id=@id
`);

app.get('/api/teams', (req, res) => {
  if (req.query.tournamentType && !['MALE', 'FEMALE'].includes(req.query.tournamentType)) return res.status(400).json({ error: 'Torneo inválido.' });
  res.json(req.query.tournamentType
    ? db.prepare('SELECT * FROM teams WHERE tournamentType = ? ORDER BY name COLLATE NOCASE').all(req.query.tournamentType)
    : db.prepare('SELECT * FROM teams ORDER BY tournamentType, name COLLATE NOCASE').all());
});

app.post('/api/teams', (req, res) => {
  const team = { tournamentType: req.body.tournamentType, name: cleanText(req.body.name) };
  if (!['MALE', 'FEMALE'].includes(team.tournamentType)) return res.status(400).json({ error: 'Torneo inválido.' });
  if (!team.name || team.name.length > 100) return res.status(400).json({ error: 'El nombre debe tener entre 1 y 100 caracteres.' });
  try {
    const result = db.prepare('INSERT INTO teams (tournamentType, name) VALUES (@tournamentType, @name)').run(team);
    res.status(201).json(db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid));
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Ese equipo ya existe en el torneo.' });
    throw error;
  }
});

app.delete('/api/teams/:id', (req, res) => {
  const result = db.prepare('DELETE FROM teams WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Equipo no encontrado.' });
  res.status(204).end();
});

app.get('/', (_req, res) => res.redirect('/display'));

app.get('/api/matches', (req, res) => {
  const conditions = [];
  const params = {};
  if (req.query.tournamentType) {
    if (!['MALE', 'FEMALE'].includes(req.query.tournamentType)) return res.status(400).json({ error: 'Torneo inválido.' });
    conditions.push('tournamentType = @tournamentType');
    params.tournamentType = req.query.tournamentType;
  }
  if (req.query.status) {
    if (!['SCHEDULED', 'LIVE', 'FINISHED'].includes(req.query.status)) return res.status(400).json({ error: 'Estado inválido.' });
    conditions.push('status = @status');
    params.status = req.query.status;
  }
  if (req.query.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) return res.status(400).json({ error: 'Fecha inválida.' });
    conditions.push('date = @date');
    params.date = req.query.date;
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  res.json(db.prepare(`SELECT * FROM matches${where} ORDER BY date, CASE jornada WHEN 'MORNING' THEN 0 ELSE 1 END, court, id`).all(params));
});

app.get('/api/matches/:id', (req, res) => {
  const match = selectOne.get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Partido no encontrado.' });
  res.json(match);
});

app.post('/api/matches', (req, res) => {
  const { match, errors } = validateMatch(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  const result = insertMatch.run(match);
  const created = selectOne.get(result.lastInsertRowid);
  notify('created', created.id);
  res.status(201).json(created);
});

app.put('/api/matches/:id', (req, res) => {
  if (!selectOne.get(req.params.id)) return res.status(404).json({ error: 'Partido no encontrado.' });
  const { match, errors } = validateMatch(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  updateMatch.run({ ...match, id: req.params.id });
  const updated = selectOne.get(req.params.id);
  notify('updated', updated.id);
  res.json(updated);
});

app.delete('/api/matches/:id', (req, res) => {
  const result = db.prepare('DELETE FROM matches WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Partido no encontrado.' });
  notify('deleted', Number(req.params.id));
  res.status(204).end();
});

function changeStatus(req, res, from, to) {
  const result = db.prepare('UPDATE matches SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = ?').run(to, req.params.id, from);
  if (!result.changes) {
    if (!selectOne.get(req.params.id)) return res.status(404).json({ error: 'Partido no encontrado.' });
    return res.status(409).json({ error: `El partido debe estar ${from}.` });
  }
  const updated = selectOne.get(req.params.id);
  notify(to.toLowerCase(), updated.id);
  res.json(updated);
}

app.post('/api/matches/:id/start', (req, res) => changeStatus(req, res, 'SCHEDULED', 'LIVE'));
app.post('/api/matches/:id/finish', (req, res) => changeStatus(req, res, 'LIVE', 'FINISHED'));

app.patch('/api/matches/:id/score', (req, res) => {
  const { team, delta } = req.body;
  if (!['A', 'B'].includes(team) || ![-1, 1].includes(delta)) return res.status(400).json({ error: 'Equipo o cambio de marcador inválido.' });
  const column = team === 'A' ? 'scoreA' : 'scoreB';
  const result = db.prepare(`UPDATE matches SET ${column} = ${column} + ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = 'LIVE' AND ${column} + ? >= 0`).run(delta, req.params.id, delta);
  if (!result.changes) {
    const match = selectOne.get(req.params.id);
    if (!match) return res.status(404).json({ error: 'Partido no encontrado.' });
    return res.status(409).json({ error: match.status !== 'LIVE' ? 'El partido no está en juego.' : 'El marcador no puede ser negativo.' });
  }
  const updated = selectOne.get(req.params.id);
  notify('score', updated.id);
  res.json(updated);
});

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('event: connected\ndata: {}\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
app.use((error, req, res, _next) => {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', event: 'request_error', requestId: req.requestId, method: req.method, path: req.originalUrl, error: { name: error.name, message: error.message, stack: error.stack } }));
  res.status(500).json({ error: 'Error interno del servidor.' });
});

const server = app.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', event: 'server_started', address: `0.0.0.0:${port}`, databasePath })));

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { app, db, server };
