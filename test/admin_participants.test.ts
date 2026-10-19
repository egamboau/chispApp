import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// A small DOM fixture exercises the shipped admin script without a browser dependency.
function calendar() {
  const elements: Record<string, Element> = {};
  class Element {
    value = '';
    hidden = false;
    required = false;
    disabled = false;
    textContent = '';
    listeners: Record<string, (event?: unknown) => unknown> = {};
    private html = '';
    get innerHTML() { return this.html; }
    set innerHTML(value: string) {
      this.html = value;
      if (value.startsWith('<option')) this.value = /value="([^"]*)"/.exec(value)?.[1] || '';
      for (const tag of value.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
        const element = elements[`#${tag[1]}`] = new Element();
        element.value = /\bvalue="([^"]*)"/.exec(tag[0])?.[1] || '';
        if (tag[0].startsWith('<select')) {
          const following = value.slice(tag.index! + tag[0].length);
          element.value = /value="([^"]*)"/.exec(following)?.[1] || '';
        }
      }
    }
    addEventListener(event: string, callback: (event?: unknown) => unknown) { this.listeners[event] = callback; }
    querySelectorAll() { return []; }
    reset() {}
  }
  const calls: { url: string; init: { body?: string; method?: string } }[] = [];
  const context = vm.createContext({
    document: {
      body: { dataset: {} },
      querySelector: (selector: string) => elements[selector] ||= new Element(),
      querySelectorAll: () => [],
    },
    fetch: async (url: string, init: { body?: string; method?: string }) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({}) };
    },
    confirm: () => true,
    setTimeout: () => {},
    EventSource: class { addEventListener() {} },
  });
  vm.runInContext(fs.readFileSync('public/admin/admin.js', 'utf8'), context);
  const run = (source: string) => vm.runInContext(source, context);
  run(`
    currentPhase = {id: 2, sortOrder: 2, tournamentType: 'MALE'};
    phases = [{id: 1, sortOrder: 1, name: 'Clasificación', type: 'TABLE', tournamentType: 'MALE'}, currentPhase,
      {id: 3, sortOrder: 3, name: 'Posterior', type: 'TABLE', tournamentType: 'MALE'}];
    sourceGroups = {1: [{id: 11, name: 'A'}, {id: 12, name: 'B'}]};
    groups = [{id: 21, name: 'Segunda'}];
    teams = [{id: 31, name: 'Equipo A'}, {id: 32, name: 'Equipo B'}, {id: 33, name: 'Equipo C'}];
    memberships = [{teamId: 31, groupId: 21}, {teamId: 32, groupId: 21}];
    document.querySelector('#groupId').value = '21';
    renderParticipantFields();
  `);
  return { elements, calls, run };
}

test('admin guarda 1.º A vs 3.º A, línea 3.º B sin equipos conocidos', async () => {
  const { elements, calls, run } = calendar();
  for (const role of ['teamA', 'teamB', 'lineTeam']) {
    elements[`#${role}-kind`]!.value = 'GROUP_POSITION';
    elements[`#${role}-kind`]!.listeners.change!();
    elements[`#${role}-position`]!.value = role === 'teamA' ? '1' : '3';
    elements[`#${role}-group`]!.value = role === 'lineTeam' ? '12' : '11';
    assert.equal(elements[`#${role}Id`]!.required, false);
    assert.equal(elements[`#${role}-position`]!.required, true);
    assert.equal(elements[`#${role}-fixed`]!.hidden, true);
    assert.doesNotMatch(elements[`#${role}-phase`]!.innerHTML, /Posterior/);
  }
  run('loadCalendarPage = async () => {}; initCalendarPage();');
  await elements['#match-form']!.listeners.submit!({ preventDefault() {} });
  assert.equal(calls[0]!.url, '/api/admin/matches');
  assert.equal(calls[0]!.init.method, 'POST');
  const body = JSON.parse(calls[0]!.init.body!);
  assert.deepEqual(body.participants, {
    teamA: { kind: 'GROUP_POSITION', sourcePhaseId: 1, sourceGroupId: 11, position: 1 },
    teamB: { kind: 'GROUP_POSITION', sourcePhaseId: 1, sourceGroupId: 11, position: 3 },
    lineTeam: { kind: 'GROUP_POSITION', sourcePhaseId: 1, sourceGroupId: 12, position: 3 },
  });
  assert.equal(body.phaseId, 2);
  assert.equal('teamAId' in body, false);
});

test('admin edita referencias confirmadas sin convertirlas a equipos y conserva ganador pendiente', () => {
  const { elements, run } = calendar();
  run(`
    matches = [{id: 8, teamAId: 31, teamBId: null, lineTeamId: 33, participants: {
      teamA: {reference: {kind: 'GROUP_POSITION', sourcePhaseId: 1, sourceGroupId: 12, position: 3}, status: 'CONFIRMED'},
      teamB: {reference: {kind: 'MATCH_WINNER', sourceMatchId: 7}, status: 'PENDING'},
      lineTeam: {reference: {kind: 'TEAM', teamId: 33}, status: 'CONFIRMED'}
    }}];
    document.querySelector('#match-id').value = '8';
    renderParticipantFields(matches[0]);
  `);
  assert.equal(elements['#assignment-warning']!.hidden, false);
  assert.match(elements['#assignment-warning']!.textContent, /confirmar otra vez/);
  assert.equal(elements['#teamA-kind']!.value, 'GROUP_POSITION');
  assert.equal(elements['#teamA-position']!.value, 3);
  assert.equal(elements['#teamBId']!.required, false);
  assert.equal(elements['#teamB-fixed']!.hidden, true);
  assert.deepEqual(JSON.parse(run('JSON.stringify(matchParticipants())')), {
    teamA: {kind: 'GROUP_POSITION', sourcePhaseId: 1, sourceGroupId: 12, position: 3},
    teamB: {kind: 'MATCH_WINNER', sourceMatchId: 7},
    lineTeam: {kind: 'TEAM', teamId: 33},
  });
});

test('previsualización muestra etiquetas, pendientes y errores; habilita confirmación solo si está lista', async () => {
  const { elements, run } = calendar();
  run(`request = async () => ({confirmedAt: null, errors: ['Grupo A incompleto'], canConfirm: false,
    assignments: [{matchId: 8, role: 'teamA', position: 1, sourceGroupId: 11, teamName: null, resolvedTeamId: null, teamId: null}]});`);
  await run('renderPhasePositions(phases[0], sourceGroups[1])');
  assert.match(elements['#phase-positions']!.innerHTML, /1.º A/);
  assert.match(elements['#phase-positions']!.innerHTML, /Sin resolver/);
  assert.match(elements['#phase-positions']!.innerHTML, /Grupo A incompleto/);
  assert.match(elements['#phase-positions']!.innerHTML, /data-action="confirm-positions" disabled/);
  run(`request = async () => ({confirmedAt: '2026-10-19', errors: [], canConfirm: true, assignments: []});`);
  await run('renderPhasePositions(phases[0], sourceGroups[1])');
  assert.doesNotMatch(elements['#phase-positions']!.innerHTML, /data-action="confirm-positions" disabled/);
  assert.match(elements['#phase-positions']!.innerHTML, /REABRIR ASIGNACIONES/);
});

test('equipo fijo conserva restricciones y partidos iniciados muestran el bloqueo', () => {
  const { elements, run } = calendar();
  assert.equal(elements['#teamAId']!.required, true);
  assert.equal(elements['#teamA-phase']!.required, false);
  assert.equal(elements['#teamA-position-fields']!.hidden, true);
  assert.match(elements['#teamAId']!.innerHTML, /Equipo A/);
  assert.doesNotMatch(elements['#teamAId']!.innerHTML, /Equipo C/);
  assert.match(elements['#lineTeamId']!.innerHTML, /Equipo C/);
  const html = run(`matchCard({id: 8, tournamentType: 'MALE', status: 'LIVE', teamA: 'A', teamB: 'B', scoreA: 0, scoreB: 0})`);
  assert.match(html, /asignaciones de participantes están bloqueadas/);
  assert.doesNotMatch(html, /data-action="edit"/);
});
