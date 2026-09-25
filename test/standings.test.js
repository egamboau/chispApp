const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'standings-test-'));
process.env.DATABASE_PATH = path.join(tempDir, 'test.db');
process.env.PORT = '3281';
const { calculateGroupStandings, server, db } = require('../server');

const team = (id) => ({ id, name: `Equipo ${id}` });
const game = (teamAId, teamBId, scoreA, scoreB, cards = {}) => ({
  teamAId, teamBId, scoreA, scoreB,
  yellowCardsA: 0, redCardsA: 0, yellowCardsB: 0, redCardsB: 0, ...cards
});
const order = (members, matches, rules = [], sanctions = new Map()) => calculateGroupStandings(members.map(team), matches, rules, sanctions);

test.after(() => server.close(() => { db.close(); fs.rmSync(tempDir, { recursive: true, force: true }); }));

test('aplica diferencia y goles generales antes del enfrentamiento directo', () => {
  let result = order([1, 2, 3, 4], [game(1, 3, 2, 0), game(2, 4, 1, 0)]);
  assert.deepEqual(result.slice(0, 2).map((row) => row.teamId), [1, 2]);
  result = order([1, 2, 3, 4], [game(1, 3, 2, 1), game(2, 4, 1, 0)]);
  assert.deepEqual(result.slice(0, 2).map((row) => row.teamId), [1, 2]);
});

test('contabiliza un partido contra un equipo de otro grupo', () => {
  const [row] = order([1], [game(1, 2, 2, 1)]);
  assert.deepEqual({ played: row.played, wins: row.wins, goalsFor: row.goalsFor, goalsAgainst: row.goalsAgainst, points: row.points }, { played: 1, wins: 1, goalsFor: 2, goalsAgainst: 1, points: 3 });
});

test('aplica puntos directos tras igualar puntos, diferencia y goles generales', () => {
  const result = order([1, 2, 3, 4, 5, 6], [game(1, 2, 1, 0), game(1, 3, 0, 1), game(2, 4, 1, 0), game(1, 5, 0, 0), game(2, 6, 0, 0)]);
  assert.deepEqual(result.slice(0, 2).map((row) => row.teamId), [1, 2]);
});

test('recalcula diferencia y goles directos para el subgrupo aún empatado', () => {
  const difference = order([1, 2, 3, 4, 5, 6], [
    game(1, 2, 2, 0), game(2, 3, 3, 0), game(3, 1, 1, 0),
    game(1, 4, 3, 2), game(2, 5, 2, 1), game(3, 6, 4, 0)
  ]);
  assert.deepEqual(difference.slice(0, 3).map((row) => row.teamId), [1, 2, 3]);

  const goals = order([1, 2, 3, 4, 5, 6], [
    game(1, 2, 2, 1), game(2, 3, 3, 2), game(3, 1, 4, 3),
    game(1, 4, 3, 2), game(2, 5, 4, 3), game(3, 6, 2, 1)
  ]);
  assert.deepEqual(goals.slice(0, 3).map((row) => row.teamId), [3, 1, 2]);
});

test('usa rojas, luego amarillas, y conserva posición compartida si persiste', () => {
  let result = order([1, 2], [game(1, 2, 0, 0, { redCardsA: 0, yellowCardsA: 5, redCardsB: 1 })]);
  assert.deepEqual(result.map((row) => row.teamId), [1, 2]);
  result = order([1, 2], [game(1, 2, 0, 0, { yellowCardsA: 1, yellowCardsB: 2 })]);
  assert.deepEqual(result.map((row) => row.teamId), [1, 2]);
  result = order([1, 2], [game(1, 2, 0, 0)]);
  assert.equal(result[0].position, result[1].position);
  assert.equal(result[0].requiresTiebreaker, true);
});

test('deja destinos pendientes al cruzar rangos y aplica sanción solo en esa frontera', () => {
  const rules = [{ startPosition: 1, endPosition: 1, label: 'Segunda fase' }, { startPosition: 2, endPosition: 2, label: 'Copa' }];
  let result = order([1, 2], [], rules);
  assert.deepEqual(result[0].possibleDestinations, ['Segunda fase', 'Copa']);
  assert.equal(result[0].destination, null);
  result = order([1, 2], [], rules, new Map([[1, 'Artículo 19']]));
  assert.deepEqual(result.map((row) => row.teamId), [2, 1]);
  assert.deepEqual(result.map((row) => row.destination), ['Segunda fase', 'Copa']);
  result = order([1, 2], [], [{ startPosition: 1, endPosition: 2, label: 'Copa' }], new Map([[1, 'Artículo 19']]));
  assert.equal(result[0].requiresTiebreaker, true);
  assert.equal(result[0].destination, 'Copa');
});

test('asigna destinos a listas de posiciones no consecutivas', () => {
  const rules = [{ positions: [1, 3, 5, 7, 9], label: 'Grupo A' }, { positions: [2, 4, 6, 8, 10], label: 'Grupo B' }];
  const result = order([1, 2, 3, 4], [game(1, 2, 4, 0), game(2, 3, 3, 0), game(3, 4, 2, 0)], rules);
  assert.deepEqual(result.map((row) => row.destination), ['Grupo A', 'Grupo B', 'Grupo A', 'Grupo B']);
});
