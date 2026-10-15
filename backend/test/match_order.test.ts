import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/models/match';
import { MatchService } from '../src/service/match_service';

const match = (id: number, date: string, lineVisible: number) => ({ id, date, lineVisible, lineTeam: `Línea ${id}`, lineTeamId: id } as Match);

test('la API pública mezcla fechas ocultas y conserva el orden publicado', () => {
  const stored = [match(1, '2026-10-01', 0), match(2, '2026-10-01', 0), match(3, '2026-10-01', 0), match(4, '2026-10-02', 1), match(5, '2026-10-02', 1)];
  const service = new MatchService({ getMatches: () => stored } as never, null as never, null as never, null as never, null as never, null as never);
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    assert.deepEqual(service.getMatches({}).map(({ id }) => id), [2, 3, 1, 4, 5]);
    assert.deepEqual(service.getMatches({}, true).map(({ id }) => id), [1, 2, 3, 4, 5]);
    assert.deepEqual(stored.map(({ id }) => id), [1, 2, 3, 4, 5]);
  } finally {
    Math.random = originalRandom;
  }
});
