const assert = require('node:assert/strict');
const test = require('node:test');
const contracts = require('@jupas/shared');

const phase = {
  id: 2,
  tournamentId: 1,
  name: 'Liga',
  type: 'TABLE',
  sortOrder: 1,
  tournamentType: 'MALE',
};

test('exports and validates the common API contracts', () => {
  assert.equal(contracts.CoercedIdSchema.parse('12'), 12);
  assert.equal(contracts.DateSchema.safeParse('16/10/2026').success, false);
  assert.deepEqual(contracts.ApiErrorResponseSchema.parse({ error: 'No encontrado.' }), { error: 'No encontrado.' });
});

test('validates group and team inputs and responses', () => {
  assert.deepEqual(contracts.GroupResponseSchema.parse({ id: 3, phaseId: 2, name: ' A ' }), {
    id: 3,
    phaseId: 2,
    name: 'A',
  });
  assert.equal(contracts.GroupResponseSchema.safeParse({ phaseId: 2, name: 'A' }).success, false);
  assert.deepEqual(contracts.CreateTeamInputSchema.parse({ name: ' Tigres ', tournamentId: '1' }), {
    name: 'Tigres',
    tournamentId: 1,
  });
  assert.equal(contracts.CreateTeamInputSchema.safeParse({ name: 'Tigres' }).success, false);
  assert.equal(contracts.CreateTeamInputSchema.safeParse({ name: 'Tigres', tournamentType: 'MALE' }).success, false);
  assert.equal(contracts.CreateTeamInputSchema.safeParse({ name: 'Tigres', tournamentId: 1, tournamentType: 'MALE' }).success, false);
  assert.equal(contracts.TeamResponseSchema.safeParse({ id: 1, tournamentId: null, tournamentType: 'MALE', name: 'Tigres' }).success, true);
});

test('validates match inputs, nullable public fields and scoring', () => {
  const input = contracts.MatchInputSchema.parse({
    groupId: '3',
    teamAId: '4',
    teamBId: 5,
    lineTeamId: 6,
    date: '2026-10-16',
    jornada: 'MORNING',
    court: '1',
    sortOrder: null,
  });
  assert.deepEqual({ groupId: input.groupId, court: input.court }, { groupId: 3, court: 1 });
  assert.equal(contracts.MatchInputSchema.safeParse({ ...input, groupID: 3 }).success, false);
  for (const field of ['phaseId', 'tournamentType', 'teamA', 'teamB', 'lineTeam']) {
    assert.equal(contracts.MatchInputSchema.safeParse({ ...input, [field]: 'redundante' }).success, false);
  }
  for (const field of ['groupId', 'teamAId', 'teamBId', 'lineTeamId']) {
    const missingId = { ...input };
    delete missingId[field];
    assert.equal(contracts.InsertMatchSchema.safeParse(missingId).success, false);
  }
  assert.equal(contracts.MatchInputSchema.safeParse({ date: '2026-10-16', jornada: 'MORNING', court: 1 }).success, false);

  const response = contracts.MatchResponseSchema.parse({
    id: 7,
    tournamentType: 'MALE',
    date: '2026-10-16',
    jornada: 'MORNING',
    teamA: 'A',
    teamB: 'B',
    lineTeam: null,
    court: 1,
    sortOrder: null,
    scoreA: 0,
    scoreB: 0,
    status: 'SCHEDULED',
    createdAt: '2026-10-16 01:00:00',
    updatedAt: '2026-10-16 01:00:00',
    phaseId: 2,
    groupId: 3,
    teamAId: 4,
    teamBId: 5,
    lineTeamId: null,
    yellowCardsA: 0,
    redCardsA: 0,
    yellowCardsB: 0,
    redCardsB: 0,
    tournamentName: 'Torneo',
    phaseName: 'Liga',
    groupName: 'General',
    lineVisible: 0,
    participants: {
      teamA: { reference: { kind: 'TEAM', teamId: 4 }, resolvedTeamId: 4, resolvedTeam: { id: 4, name: 'A' }, status: 'CONFIRMED' },
      teamB: { reference: { kind: 'TEAM', teamId: 5 }, resolvedTeamId: 5, resolvedTeam: { id: 5, name: 'B' }, status: 'CONFIRMED' },
      lineTeam: null,
    },
  });
  assert.equal(response.lineVisible, false);
  assert.equal(response.lineTeam, null);
  const scoring = { playerId: 1, directGoals: 1, horquetas: 0, pepitas: 0, scoringTableId: '2' };
  assert.equal(contracts.NewScoringSchema.parse(scoring).scoringTableId, 2);
  assert.equal(contracts.NewScoringSchema.safeParse({ ...scoring, scoringTableId: undefined }).success, false);
  assert.equal(contracts.NewScoringSchema.safeParse({ ...scoring, scoringTable: 'Torneo Regular' }).success, false);
  assert.equal(contracts.ScoringSchema.safeParse({ directGoals: 1, horquetas: 0, pepitas: 0, scoringTableId: 2 }).success, true);
  assert.equal(contracts.ScoringSchema.safeParse({ directGoals: 0, horquetas: 0, pepitas: 0 }).success, false);
});

test('validates participant scheduling and rejects malformed references', () => {
  const participants = {
    teamA: { kind: 'TEAM', teamId: '4' },
    teamB: { kind: 'GROUP_POSITION', sourcePhaseId: '2', sourceGroupId: '3', position: '1' },
    lineTeam: { kind: 'MATCH_WINNER', sourceMatchId: '7' },
  };
  const input = contracts.ParticipantMatchInputSchema.parse({
    phaseId: '8', groupId: '9', date: '2026-10-16', jornada: 'MORNING', court: '1', participants,
  });
  assert.equal(input.sortOrder, null);
  assert.equal(input.participants.teamB.position, 1);
  for (const reference of [
    { kind: 'TEAM', teamId: 0 },
    { kind: 'GROUP_POSITION', sourcePhaseId: 2, sourceGroupId: 3, position: 0 },
    { kind: 'MATCH_WINNER', sourceMatchId: 7, teamId: 4 },
    { kind: 'UNKNOWN' },
  ]) assert.equal(contracts.MatchParticipantSchema.safeParse(reference).success, false);
  assert.equal(contracts.MatchParticipantsSchema.safeParse({ ...participants, lineTeam: null }).success, false);
  assert.equal(contracts.MatchParticipantResponseSchema.safeParse(participants.teamA).success, false);
});

test('transforms tournament responses and defaults phase inputs', () => {
  const tournament = contracts.TournamentResponseSchema.parse({
    id: 1,
    name: 'Torneo',
    active: 1,
    currentPhaseId: null,
    legacyType: null,
  });
  assert.equal(tournament.active, true);
  assert.deepEqual(contracts.CreatePhaseInputSchema.parse({ name: 'Liga' }), {
    name: 'Liga',
    type: 'TABLE',
    sortOrder: 1,
  });
  assert.deepEqual(contracts.PhaseResponseSchema.parse(phase), phase);
});

test('normalizes player inputs and validates player responses', () => {
  assert.deepEqual(contracts.PlayerInputSchema.parse({ number: ' 07 ', name: '  ' }), { number: '07', name: null });
  assert.equal(contracts.PlayerInputSchema.safeParse({ number: 'A7' }).success, false);
  assert.equal(contracts.PlayerResponseSchema.safeParse({
    id: 1,
    teamId: 2,
    number: '07',
    name: null,
    status: 'REGISTERED',
    displayName: 'Equipo A - Número 07',
  }).success, true);
});

test('validates and transforms phase-detail contracts', () => {
  assert.deepEqual(
    contracts.ClassificationRuleInputSchema.parse({ positions: ['3', 1, 3], label: ' Copa ' }),
    { startPosition: 1, endPosition: 3, positions: [1, 3], label: 'Copa' },
  );
  assert.deepEqual(
    contracts.ClassificationRuleInputSchema.parse({ startPosition: 2, endPosition: 4, label: 'Final' }).positions,
    [2, 3, 4],
  );
  assert.equal(contracts.TeamCardsInputSchema.safeParse({ yellowCards: 0, redCards: 0 }).success, false);
  assert.equal(contracts.PhaseStandingsResponseSchema.safeParse({
    phase,
    hasStandings: false,
    message: 'Esta fase eliminatoria no tiene tabla.',
    rules: [],
    groups: [],
  }).success, true);
  assert.equal(contracts.PhaseScoringResponseSchema.safeParse({ phase, tables: [] }).success, true);
});
