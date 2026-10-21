import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { MatchResponseSchema, ParticipantMatchInputSchema, PhasePositionsResponseSchema } from '@jupas/shared';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import DBConnection from '../src/db/db_connection';
import type { MatchParticipant, MatchParticipants, ParticipantMatchInput } from '../src/models/match';
import { MatchRepository } from '../src/repository/match_repository';
import { MatchService } from '../src/service/match_service';
import { PhaseRepository } from '../src/repository/phase_repository';
import { PhaseService } from '../src/service/phase_service';
import { GroupRepository } from '../src/repository/group_repository';
import { GroupService } from '../src/service/group_service';
import { TeamRepository } from '../src/repository/team_repository';
import { TeamService } from '../src/service/team_service';
import { TournamentRepository } from '../src/repository/tournament_repository';
import { TournamentService } from '../src/service/tournament_service';
import { MatchPlayerScoringRepository } from '../src/repository/match_player_scoring_repository';
import { MatchController } from '../src/controller/match_controller';
import { PhaseDetailRepository } from '../src/repository/phase_detail_repository';
import { PhaseDetailService } from '../src/service/phase_detail_service';

function serviceFor(db: DBConnection): MatchService {
    return new MatchService(new MatchRepository(db), new PhaseService(new PhaseRepository(db)),
        new GroupService(new GroupRepository(db)), new TeamService(new TeamRepository(db)),
        new TournamentService(new TournamentRepository(db)), new MatchPlayerScoringRepository(db));
}

function fixture(t: TestContext, groupSize = 3) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jupas-participants-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const databasePath = path.join(directory, 'test.db');
    const db = new DBConnection(databasePath);
    const tournament = db.insertTournamentInDatabase('Torneo', true)!;
    const table = db.insertPhase({ tournamentId: tournament.id, name: 'Primera fase', type: 'TABLE', tournamentType: 'MALE', sortOrder: 1 })!;
    const knockout = db.insertPhase({ tournamentId: tournament.id, name: 'Eliminación', type: 'ELIMINATION', tournamentType: 'MALE', sortOrder: 2 })!;
    const groupA = db.insertGroup(table.id, 'A')!, groupB = db.insertGroup(table.id, 'B')!;
    const knockoutGroup = db.insertGroup(knockout.id, 'General')!;
    const teams = Array.from({ length: groupSize * 2 }, (_, index) => db.insertTeam('MALE', tournament.id, `Equipo ${index + 1}`)!);
    for (const [index, team] of teams.entries()) {
        db.executeQuery('INSERT INTO phase_memberships VALUES(?,?,?)', table.id, index < groupSize ? groupA.id : groupB.id, team.id);
        db.executeQuery('INSERT INTO phase_memberships VALUES(?,?,?)', knockout.id, knockoutGroup.id, team.id);
    }
    const position = (rank: number, groupId = groupA.id): MatchParticipant => ({ kind: 'GROUP_POSITION', sourcePhaseId: table.id, sourceGroupId: groupId, position: rank });
    const fixed = (index: number): MatchParticipant => ({ kind: 'TEAM', teamId: teams[index]!.id });
    const winner = (sourceMatchId: number): MatchParticipant => ({ kind: 'MATCH_WINNER', sourceMatchId });
    const input = (participants: MatchParticipants = { teamA: position(1), teamB: position(3), lineTeam: position(3, groupB.id) }): ParticipantMatchInput => ({
        phaseId: knockout.id, groupId: knockoutGroup.id, date: '2026-10-20', jornada: 'MORNING', court: 1, sortOrder: null, participants,
    });
    return { db, databasePath, tournament, table, knockout, groupA, groupB, knockoutGroup, teams, position, fixed, winner, input, service: serviceFor(db) };
}

function completedTable(t: TestContext, groupSize = 3) {
    const f = fixture(t, groupSize);
    const details = new PhaseDetailService(new PhaseDetailRepository(f.db), new PhaseService(new PhaseRepository(f.db)));
    const sourceIds: number[] = [];
    for (const [groupIndex, group] of [f.groupA, f.groupB].entries()) {
        for (let a = 0; a < groupSize; a++) for (let b = a + 1; b < groupSize; b++) {
            const offset = groupIndex * groupSize;
            const match = f.service.saveParticipantMatch({ ...f.input({ teamA: f.fixed(offset + a), teamB: f.fixed(offset + b), lineTeam: f.fixed(groupIndex ? 0 : groupSize) }), phaseId: f.table.id, groupId: group.id });
            f.db.executeQuery("UPDATE matches SET scoreA=1,status='FINISHED' WHERE id=?", match.id);
            sourceIds.push(match.id);
        }
    }
    return { ...f, details, sourceIds };
}

test('issue 41: previsualiza y confirma ambas pentagonales con trazabilidad e idempotencia', t => {
    const f = completedTable(t, 5), match = f.service.saveParticipantMatch(f.input());
    const before = f.service.getMatchParticipants(match.id)!;
    const preview = f.details.previewPositions(f.table.id)!;
    const { snapshot, ...publicPreview } = preview;
    assert.deepEqual(PhasePositionsResponseSchema.parse(publicPreview), publicPreview);
    assert.equal(PhasePositionsResponseSchema.safeParse(preview).success, false);
    assert.equal(preview.canConfirm, true);
    assert.equal(preview.confirmedAt, null);
    assert.deepEqual(Object.fromEntries(preview.assignments.map(item => [item.role, item.teamId])), {
        teamA: f.teams[0]!.id, teamB: f.teams[2]!.id, lineTeam: f.teams[7]!.id,
    });
    assert.deepEqual(f.service.getMatchParticipants(match.id), before);
    assert.equal(f.service.changeStatus(match.id, 'SCHEDULED', 'LIVE'), undefined);
    f.details.confirmPositions(f.table.id);
    const confirmed = f.service.getMatchParticipants(match.id)!;
    for (const role of ['teamA', 'teamB', 'lineTeam'] as const) assert.deepEqual(confirmed[role].reference, before[role].reference);
    assert.deepEqual([confirmed.teamA.resolvedTeamId, confirmed.teamB.resolvedTeamId, confirmed.lineTeam.resolvedTeamId], [f.teams[0]!.id, f.teams[2]!.id, f.teams[7]!.id]);
    assert.equal(f.service.getMatch(match.id, true)?.lineTeam, f.teams[7]!.name);
    const saved = f.service.getMatch(match.id, true);
    const confirmation = f.details.confirmPositions(f.table.id);
    assert.equal(confirmation?.stale, false);
    assert.deepEqual(f.service.getMatch(match.id, true), saved);
    const reopened = new DBConnection(f.databasePath);
    const restartedDetails = new PhaseDetailService(new PhaseDetailRepository(reopened), new PhaseService(new PhaseRepository(reopened)));
    assert.deepEqual(restartedDetails.confirmPositions(f.table.id), confirmation);
    assert.deepEqual(serviceFor(reopened).getMatchParticipants(match.id), confirmed);
    assert.equal(f.db.getAllTeams().length, 10);
    assert.deepEqual(f.db.fetchAllFromQuery('PRAGMA foreign_key_check'), []);
    assert.equal(f.service.changeStatus(match.id, 'SCHEDULED', 'LIVE')?.status, 'LIVE');
});

test('bloquea fases incompletas, partidos pendientes y empates sin inventar desempates', t => {
    const f = completedTable(t), match = f.service.saveParticipantMatch(f.input());
    const sourceId = f.sourceIds[0]!;
    f.db.executeQuery("UPDATE matches SET status='SCHEDULED' WHERE id=?", sourceId);
    assert.match(f.details.previewPositions(f.table.id)!.errors.join(' '), /pendientes.*incompleto/);
    assert.throws(() => f.details.confirmPositions(f.table.id));
    f.db.executeQuery('DELETE FROM matches WHERE id=?', sourceId);
    assert.match(f.details.previewPositions(f.table.id)!.errors.join(' '), /incompleto/);
    f.db.executeQuery("UPDATE matches SET scoreA=0,scoreB=0 WHERE phaseId=?", f.table.id);
    assert.match(f.details.previewPositions(f.table.id)!.errors.join(' '), /empates sin resolver/);
    assert.throws(() => f.details.confirmPositions(f.table.id));
    assert.equal(f.service.getMatch(match.id, true)?.teamAId, null);
    assert.equal(f.details.previewPositions(f.table.id)!.confirmedAt, null);
    assert.equal(f.details.previewPositions(999), undefined);
    assert.equal(f.details.previewPositions(f.knockout.id)!.canConfirm, false);
});

test('advierte correcciones, conserva asignaciones y exige reapertura para reconfirmar', t => {
    const f = completedTable(t), match = f.service.saveParticipantMatch(f.input());
    f.details.confirmPositions(f.table.id);
    const before = f.service.getMatchParticipants(match.id);
    f.service.setResult(f.sourceIds[0]!, 0, 4);
    const changed = f.details.previewPositions(f.table.id)!;
    assert.equal(changed.stale, true);
    assert.match(changed.errors.join(' '), /Reabre/);
    assert.deepEqual(f.service.getMatchParticipants(match.id), before);
    assert.throws(() => f.details.confirmPositions(f.table.id));
    f.details.reopenPositions(f.table.id);
    assert.equal(f.service.changeStatus(match.id, 'SCHEDULED', 'LIVE'), undefined);
    const pending = f.service.getMatch(match.id, true)!;
    assert.equal(pending.teamA, 'Primera fase · 1.º A');
    assert.equal(pending.teamB, 'Primera fase · 3.º A');
    assert.equal(pending.lineTeam, 'Primera fase · 3.º B');
    assert.deepEqual(f.service.getMatchParticipants(match.id), before);
    f.details.confirmPositions(f.table.id);
    assert.equal(f.service.getMatch(match.id, true)?.teamAId, f.teams[1]!.id);
    assert.equal(f.service.getMatch(match.id, true)?.teamA, f.teams[1]!.name);
    assert.equal(f.service.getMatch(match.id, true)?.teamBId, f.teams[2]!.id);
    assert.equal(f.details.previewPositions(f.table.id)!.stale, false);
});

for (const status of ['LIVE', 'FINISHED'] as const) test(`una corrección nunca reasigna un partido ${status} ni confirma parcialmente`, t => {
    const f = completedTable(t);
    const scheduled = f.service.saveParticipantMatch(f.input());
    const frozen = f.service.saveParticipantMatch(f.input());
    f.details.confirmPositions(f.table.id);
    f.service.changeStatus(frozen.id, 'SCHEDULED', 'LIVE');
    if (status === 'FINISHED') f.service.changeStatus(frozen.id, 'LIVE', 'FINISHED');
    const before = f.service.getMatchParticipants(frozen.id);
    f.service.setResult(f.sourceIds[0]!, 0, 4);
    f.details.reopenPositions(f.table.id);
    assert.throws(() => f.details.confirmPositions(f.table.id), /iniciado o terminado/);
    assert.deepEqual(f.service.getMatchParticipants(frozen.id), before);
    assert.equal(f.service.getMatch(scheduled.id, true)?.teamAId, f.teams[0]!.id);
    assert.equal(f.details.previewPositions(f.table.id)!.confirmedAt, null);
});

test('rechaza colisiones con equipos fijos y revierte todas las asignaciones si falla una escritura', t => {
    const f = completedTable(t);
    const collision = f.service.saveParticipantMatch(f.input({ teamA: f.position(1), teamB: f.fixed(0), lineTeam: f.position(3, f.groupB.id) }));
    assert.throws(() => f.details.confirmPositions(f.table.id), /deben ser diferentes/);
    f.service.deleteMatch(collision.id);
    const first = f.service.saveParticipantMatch(f.input()), second = f.service.saveParticipantMatch(f.input());
    f.db.executeQuery(`CREATE TRIGGER fail_assignment BEFORE UPDATE OF teamAId ON matches WHEN NEW.id=${second.id} BEGIN SELECT RAISE(ABORT,'Fallo de escritura'); END`);
    assert.throws(() => f.details.confirmPositions(f.table.id), { name: 'DatabaseError' });
    assert.equal(f.service.getMatch(first.id, true)?.teamAId, null);
    assert.equal(f.details.previewPositions(f.table.id)!.confirmedAt, null);
});

test('guarda fase, grupo y posición en los tres roles y no crea equipos al reiniciar', t => {
    const f = fixture(t), input = f.input();
    const match = f.service.saveParticipantMatch(input);
    assert.deepEqual([match.teamAId, match.teamBId, match.lineTeamId], [null, null, null]);
    assert.match(match.teamA, /Primera fase.*1.º A/);
    const expected = Object.fromEntries(Object.entries(input.participants).map(([role, reference]) => [role, { reference, resolvedTeamId: null }]));
    assert.deepEqual(f.service.getMatchParticipants(match.id), expected);
    for (let attempt = 0; attempt < 2; attempt++) {
        const reopened = new DBConnection(f.databasePath);
        assert.deepEqual(serviceFor(reopened).getMatchParticipants(match.id), expected);
        assert.equal(reopened.getAllTeams().length, 6);
        assert.deepEqual(reopened.fetchAllFromQuery('PRAGMA foreign_key_check'), []);
    }
    assert.equal(f.service.deleteMatch(match.id), true);
    assert.deepEqual(f.db.fetchAllFromQuery('SELECT * FROM match_participant_references'), []);
});

test('admite tabla con grupo único, participantes mixtos y conserva la referencia al asignar equipo', t => {
    const f = fixture(t);
    f.db.executeQuery('UPDATE phase_memberships SET groupId=? WHERE groupId=?', f.groupA.id, f.groupB.id);
    f.db.executeQuery('DELETE FROM groups_table WHERE id=?', f.groupB.id);
    const input = f.input({ teamA: f.position(1), teamB: f.fixed(1), lineTeam: f.fixed(2) });
    const match = f.service.saveParticipantMatch(input);
    assert.deepEqual(f.service.getMatchParticipants(match.id)?.teamB, { reference: f.fixed(1), resolvedTeamId: f.teams[1]!.id });
    f.db.executeQuery('UPDATE matches SET teamAId=?,teamA=? WHERE id=?', f.teams[0]!.id, f.teams[0]!.name, match.id);
    f.service.saveParticipantMatch({ ...input, court: 2 }, match.id);
    assert.deepEqual(f.service.getMatchParticipants(match.id)?.teamA, { reference: f.position(1), resolvedTeamId: f.teams[0]!.id });
    assert.deepEqual(serviceFor(new DBConnection(f.databasePath)).getMatchParticipants(match.id)?.teamA, { reference: f.position(1), resolvedTeamId: f.teams[0]!.id });
    f.service.saveParticipantMatch({ ...input, participants: { ...input.participants, teamA: f.position(2) } }, match.id);
    assert.equal(f.service.getMatchParticipants(match.id)?.teamA.resolvedTeamId, null);
});

test('admite ganadores dentro de la misma fase y de fases anteriores en cualquier rol', t => {
    const f = fixture(t);
    const semi1 = f.service.saveParticipantMatch(f.input({ teamA: f.fixed(0), teamB: f.fixed(1), lineTeam: f.fixed(2) }));
    const semi2 = f.service.saveParticipantMatch(f.input({ teamA: f.fixed(3), teamB: f.fixed(4), lineTeam: f.fixed(5) }));
    const input = f.input({ teamA: f.winner(semi1.id), teamB: f.winner(semi2.id), lineTeam: f.position(3) });
    const final = f.service.saveParticipantMatch(input);
    assert.deepEqual(f.service.getMatchParticipants(final.id)?.teamA.reference, f.winner(semi1.id));
    f.service.updateSortOrder(semi1.id, 20);
    assert.deepEqual(serviceFor(new DBConnection(f.databasePath)).getMatchParticipants(final.id)?.teamA.reference, f.winner(semi1.id));
    const later = f.db.insertPhase({ tournamentId: f.tournament.id, name: 'Final', type: 'ELIMINATION', tournamentType: 'MALE', sortOrder: 3 })!;
    const group = f.db.insertGroup(later.id, 'General')!;
    const next = f.service.saveParticipantMatch({ ...input, phaseId: later.id, groupId: group.id,
        participants: { teamA: f.winner(semi1.id), teamB: f.position(1), lineTeam: f.winner(semi2.id) } });
    assert.deepEqual(f.service.getMatchParticipants(next.id)?.lineTeam.reference, f.winner(semi2.id));
});

test('rechaza referencias inválidas y revierte la creación completa', t => {
    const f = fixture(t);
    const otherTournament = f.db.insertTournamentInDatabase('Otro', true)!;
    const other = f.db.insertPhase({ tournamentId: otherTournament.id, name: 'Otra tabla', type: 'TABLE', tournamentType: 'MALE', sortOrder: 1 })!;
    const otherGroup = f.db.insertGroup(other.id, 'A')!;
    const female = f.db.insertPhase({ tournamentId: f.tournament.id, name: 'Femenino', type: 'TABLE', tournamentType: 'FEMALE', sortOrder: 1 })!;
    const femaleGroup = f.db.insertGroup(female.id, 'A')!;
    for (const [phase, group] of [[other, otherGroup], [female, femaleGroup]] as const) {
        const team = f.db.insertTeam(phase.tournamentType, phase.tournamentId, phase.name)!;
        f.db.executeQuery('INSERT INTO phase_memberships VALUES(?,?,?)', phase.id, group.id, team.id);
    }
    const invalid: MatchParticipant[] = [
        ...[0, -1, 1.5, 4].map(rank => f.position(rank)),
        { kind: 'GROUP_POSITION', sourcePhaseId: f.table.id, sourceGroupId: f.knockoutGroup.id, position: 1 },
        { kind: 'GROUP_POSITION', sourcePhaseId: f.knockout.id, sourceGroupId: f.knockoutGroup.id, position: 1 },
        { kind: 'GROUP_POSITION', sourcePhaseId: other.id, sourceGroupId: otherGroup.id, position: 1 },
        { kind: 'GROUP_POSITION', sourcePhaseId: female.id, sourceGroupId: femaleGroup.id, position: 1 },
        { kind: 'GROUP_POSITION', sourcePhaseId: 999, sourceGroupId: f.groupA.id, position: 1 },
        { kind: 'GROUP_POSITION', sourcePhaseId: f.table.id, sourceGroupId: 999, position: 1 },
        f.winner(999), f.winner(1.5), { kind: 'TEAM', teamId: 999 },
    ];
    for (const participant of invalid) {
        assert.throws(() => f.service.saveParticipantMatch(f.input({ teamA: f.position(1), teamB: f.position(2), lineTeam: participant })));
        assert.deepEqual(f.db.fetchAllFromQuery('SELECT id FROM matches'), []);
        assert.deepEqual(f.db.fetchAllFromQuery('SELECT * FROM match_participant_references'), []);
    }
    assert.throws(() => f.service.saveParticipantMatch(f.input({ teamA: f.position(1), teamB: f.position(1), lineTeam: f.fixed(2) })));
    assert.throws(() => f.service.saveParticipantMatch(f.input({ teamA: f.fixed(0), teamB: f.fixed(0), lineTeam: f.fixed(2) })));
    assert.equal(f.db.getAllTeams().length, 8);
});

test('rechaza autorreferencias y ciclos indirectos al editar, conservando los datos previos', t => {
    const f = fixture(t), input = f.input();
    const a = f.service.saveParticipantMatch(input);
    const b = f.service.saveParticipantMatch(f.input({ ...input.participants, teamA: f.winner(a.id) }));
    const c = f.service.saveParticipantMatch(f.input({ ...input.participants, teamA: f.winner(b.id) }));
    const before = f.service.getMatchParticipants(a.id);
    for (const source of [a.id, c.id]) {
        assert.throws(() => f.service.saveParticipantMatch({ ...input, court: 9, participants: { ...input.participants, teamA: f.winner(source) } }, a.id));
        assert.deepEqual(f.service.getMatchParticipants(a.id), before);
        assert.equal(f.service.getMatch(a.id, true)?.court, 1);
    }
    const fixed = f.service.saveParticipantMatch(f.input({ teamA: f.fixed(0), teamB: f.fixed(1), lineTeam: f.fixed(2) }));
    assert.throws(() => f.service.saveParticipantMatch(f.input({ ...input.participants, teamA: f.winner(fixed.id), teamB: f.winner(fixed.id) })));
});

test('protege referencias ante cambios de origen y escrituras SQL inválidas', t => {
    const f = fixture(t);
    const match = f.service.saveParticipantMatch(f.input());
    const semi = f.service.saveParticipantMatch(f.input({ teamA: f.fixed(0), teamB: f.fixed(1), lineTeam: f.fixed(2) }));
    const final = f.service.saveParticipantMatch(f.input({ teamA: f.winner(semi.id), teamB: f.position(2), lineTeam: f.position(3, f.groupB.id) }));
    assert.throws(() => f.service.deleteMatch(semi.id));
    assert.throws(() => f.db.executeQuery('DELETE FROM phases WHERE id=?', f.table.id));
    assert.throws(() => f.db.executeQuery('DELETE FROM groups_table WHERE id=?', f.groupA.id));
    assert.throws(() => f.db.executeQuery('UPDATE phases SET sortOrder=3 WHERE id=?', f.table.id));
    assert.throws(() => f.db.executeQuery("UPDATE phases SET type='ELIMINATION' WHERE id=?", f.table.id));
    assert.throws(() => f.db.executeQuery("UPDATE phases SET type='TABLE' WHERE id=?", f.knockout.id));
    assert.throws(() => f.db.executeQuery("UPDATE phases SET tournamentType='FEMALE' WHERE id=?", f.table.id));
    assert.throws(() => f.db.executeQuery('UPDATE groups_table SET phaseId=? WHERE id=?', f.knockout.id, f.groupA.id));
    assert.throws(() => f.db.executeQuery('DELETE FROM phase_memberships WHERE phaseId=? AND teamId=?', f.table.id, f.teams[0]!.id));
    assert.throws(() => f.db.executeQuery('UPDATE phase_memberships SET groupId=? WHERE phaseId=? AND teamId=?', f.groupB.id, f.table.id, f.teams[0]!.id));
    assert.throws(() => f.db.executeQuery("UPDATE match_participant_references SET position=1.5 WHERE matchId=? AND role='teamA'", match.id));
    assert.throws(() => f.db.executeQuery("UPDATE match_participant_references SET position=1 WHERE matchId=? AND role='teamB'", match.id));
    assert.throws(() => f.db.executeQuery("UPDATE match_participant_references SET sourceMatchId=? WHERE matchId=? AND role='teamA'", final.id, final.id));
    assert.throws(() => f.db.executeQuery("INSERT INTO match_participant_references(matchId,role,kind,sourceMatchId) VALUES(?,'lineTeam','GROUP_POSITION',?)", semi.id, semi.id));
    assert.equal(f.db.fetchAllFromQuery('SELECT * FROM invalid_match_references').length, 0);
});

test('la edición HTTP antigua devuelve conflicto antes de crear equipos o perder referencias', async t => {
    const f = fixture(t), match = f.service.saveParticipantMatch(f.input());
    const before = f.service.getMatchParticipants(match.id);
    const controller = new MatchController(f.service, null as never);
    let status = 200;
    let body: unknown;
    const response = {
        status(value: number) { status = value; return this; },
        json(value: unknown) { body = value; return this; },
    };
    const { participants, ...schedule } = f.input();
    await controller.updateMatch({ params: { id: String(match.id) }, body: {
        ...schedule, teamA: 'Equipo ficticio A', teamB: 'Equipo ficticio B', lineTeam: 'Equipo ficticio línea',
    } } as never, response as never, error => { throw error; });
    assert.equal(status, 409);
    assert.match((body as { error: string }).error, /referencias/);
    assert.deepEqual(f.service.getMatchParticipants(match.id), before);
    assert.equal(f.db.getAllTeams().length, 6);
});

test('rechaza ganadores de fases de tabla o futuras y protege ediciones antiguas', t => {
    const f = fixture(t);
    const old = f.service.saveParticipantMatch({ ...f.input({ teamA: f.fixed(0), teamB: f.fixed(1), lineTeam: f.fixed(2) }), phaseId: f.table.id, groupId: f.groupA.id });
    assert.throws(() => f.service.saveParticipantMatch(f.input({ teamA: f.winner(old.id), teamB: f.position(2), lineTeam: f.position(3) })));
    const later = f.db.insertPhase({ tournamentId: f.tournament.id, name: 'Futura', type: 'ELIMINATION', tournamentType: 'MALE', sortOrder: 3 })!;
    const group = f.db.insertGroup(later.id, 'General')!;
    const future = f.service.saveParticipantMatch({ ...f.input(), phaseId: later.id, groupId: group.id });
    assert.throws(() => f.service.saveParticipantMatch(f.input({ teamA: f.winner(future.id), teamB: f.position(2), lineTeam: f.position(3) })));
    const referenced = f.service.saveParticipantMatch(f.input());
    const legacy = f.service.buildInput({ ...f.input(), tournamentType: 'MALE', teamAId: f.teams[0]!.id, teamBId: f.teams[1]!.id, lineTeamId: f.teams[2]!.id });
    assert.throws(() => f.service.updateMatch(referenced.id, legacy.match));
    f.db.executeQuery("UPDATE matches SET status='LIVE' WHERE id=?", old.id);
    assert.throws(() => f.service.saveParticipantMatch(f.input(), old.id));
});

test('migra nombres históricos sin perder resultados, tarjetas, orden ni goleo', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jupas-participants-legacy-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const databasePath = path.join(directory, 'test.db');
    const old = new Database(databasePath);
    old.exec(`CREATE TABLE matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,tournamentType TEXT NOT NULL,date TEXT NOT NULL,jornada TEXT NOT NULL,
        teamA TEXT NOT NULL,teamB TEXT NOT NULL,lineTeam TEXT NOT NULL,court INTEGER NOT NULL,
        scoreA INTEGER NOT NULL DEFAULT 0,scoreB INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'SCHEDULED',
        sortOrder INTEGER,yellowCardsA INTEGER NOT NULL DEFAULT 0,redCardsA INTEGER NOT NULL DEFAULT 0,
        yellowCardsB INTEGER NOT NULL DEFAULT 0,redCardsB INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        INSERT INTO matches(id,tournamentType,date,jornada,teamA,teamB,lineTeam,court,scoreA,scoreB,status,sortOrder,yellowCardsA)
            VALUES(7,'MALE','2026-10-01','MORNING','Histórico A','Histórico B','Histórico Línea',2,3,1,'FINISHED',4,2);`);
    const before = old.prepare('SELECT * FROM matches').get() as Record<string, unknown>;
    old.close();
    const db = new DBConnection(databasePath), service = serviceFor(db);
    const match = service.getMatch(7, true)!;
    for (const [key, value] of Object.entries(before)) assert.equal(match[key as keyof typeof match], value);
    assert.equal(service.getMatchParticipants(7)?.teamA.reference.kind, 'TEAM');
    const player = Number(db.executeQuery("INSERT INTO players(teamId,number) VALUES(?,'9')", match.teamAId).lastInsertRowid);
    db.executeQuery('INSERT INTO match_player_scoring(matchId,playerId,directGoals) VALUES(7,?,2)', player);
    const reopened = new DBConnection(databasePath);
    assert.deepEqual(serviceFor(reopened).getMatchParticipants(7), service.getMatchParticipants(7));
    assert.equal(reopened.fetchOneFromQuery<{ total: number }>('SELECT total FROM match_player_scoring WHERE matchId=7')?.total, 2);
    assert.equal(reopened.getAllTeams().length, 3);
});

test('issue 42: CRUD HTTP expone los tres placeholders, confirmación y bloqueos sin crear equipos', async t => {
    const f = completedTable(t);
    const controller = new MatchController(f.service, null as never);
    const call = async (handler: typeof controller.insertMatch, body: unknown = {}, id?: number, admin = true) => {
        let status = 200;
        let result: any;
        const response = {
            status(value: number) { status = value; return this; },
            json(value: unknown) { result = value; return this; },
            end() { return this; },
        };
        await handler({ body, params: { id: String(id), matchId: String(id) }, query: {}, isAdmin: admin } as never,
            response as never, error => { throw error; });
        return { status, body: result };
    };
    const input = f.input(), teamCount = f.db.getAllTeams().length;
    assert.deepEqual(ParticipantMatchInputSchema.parse(input), input);
    const created = await call(controller.insertMatch, input);
    assert.equal(created.status, 201);
    MatchResponseSchema.parse(created.body);
    const id = created.body.id;
    for (const role of ['teamA', 'teamB', 'lineTeam'] as const) {
        assert.equal(created.body[`${role}Id`], null);
        assert.deepEqual(created.body.participants[role], {
            reference: input.participants[role], resolvedTeamId: null, resolvedTeam: null, status: 'PENDING',
        });
    }
    assert.equal((await call(controller.startMatch, {}, id)).status, 409);
    assert.equal((await call(controller.setResult, { scoreA: 1, scoreB: 0 }, id)).status, 409);
    assert.equal((await call(controller.insertScoring, { playerId: 1, directGoals: 1, horquetas: 0, pepitas: 0 }, id)).status, 409);
    const changed = await call(controller.updateMatch, { ...input, court: 2 }, id);
    assert.equal(changed.status, 200);
    assert.equal(changed.body.court, 2);
    assert.deepEqual(changed.body.participants, created.body.participants);
    assert.equal((await call(controller.insertMatch, null)).status, 400);
    assert.equal((await call(controller.insertMatch, { ...input, participants: null })).status, 400);
    assert.equal((await call(controller.insertMatch, { ...input, participants: { ...input.participants, teamA: { kind: 'TEAM', teamId: 0 } } })).status, 400);
    const invalidReference = await call(controller.insertMatch, { ...input, participants: { ...input.participants, teamA: f.winner(999999) } });
    assert.equal(invalidReference.status, 409);
    assert.match(invalidReference.body.error, /Referencia/);
    const hidden = await call(controller.getMatch, {}, id, false);
    MatchResponseSchema.parse(hidden.body);
    assert.equal(hidden.body.lineTeamId, null);
    assert.equal(hidden.body.participants.lineTeam, null);
    f.details.confirmPositions(f.table.id);
    const confirmed = (await call(controller.getMatch, {}, id)).body;
    MatchResponseSchema.parse(confirmed);
    for (const role of ['teamA', 'teamB', 'lineTeam'] as const) {
        assert.deepEqual(confirmed.participants[role].reference, input.participants[role]);
        assert.equal(confirmed.participants[role].status, 'CONFIRMED');
        assert.deepEqual(confirmed.participants[role].resolvedTeam, { id: confirmed[`${role}Id`], name: confirmed[role] });
    }
    f.details.reopenPositions(f.table.id);
    MatchResponseSchema.parse((await call(controller.getMatch, {}, id)).body);
    assert.equal((await call(controller.getMatch, {}, id)).body.participants.teamA.status, 'RESOLVED');
    assert.equal((await call(controller.insertScoring, { playerId: 1, directGoals: 1, horquetas: 0, pepitas: 0 }, id)).status, 409);
    f.details.confirmPositions(f.table.id);
    assert.equal((await call(controller.startMatch, {}, id)).status, 200);
    assert.equal((await call(controller.updateMatch, input, id)).status, 409);
    assert.equal(f.db.getAllTeams().length, teamCount);
    assert.equal((await call(controller.deleteMatch, {}, id)).status, 204);
    assert.equal((await call(controller.getMatch, {}, id)).status, 404);
});
