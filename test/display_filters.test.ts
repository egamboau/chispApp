import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('calendario omite finalizados y resultados conserva el histórico', () => {
  const elements: Record<string, { value: string; innerHTML: string }> = {
    '#calendar-date': { value: '', innerHTML: '' },
    '#calendar-status': { value: '', innerHTML: '' },
    '#calendar-list': { value: '', innerHTML: '' },
    '#results-date': { value: '2026-10-02', innerHTML: '' },
    '#results-list': { value: '', innerHTML: '' },
  };
  const source = fs.readFileSync('public/display/display.js', 'utf8');
  const renderers = source.slice(0, source.indexOf('function renderStandings'));
  const matches = [
    { tournamentType: 'MALE', date: '2026-10-01', jornada: 'AFTERNOON', teamA: 'Tarde 1', teamB: 'B', lineVisible: 0, court: 1, scoreA: 0, scoreB: 0, status: 'SCHEDULED' },
    { tournamentType: 'MALE', date: '2026-10-01', jornada: 'MORNING', teamA: 'Mañana 1', teamB: 'B', lineVisible: 0, court: 2, scoreA: 0, scoreB: 0, status: 'SCHEDULED' },
    { tournamentType: 'MALE', date: '2026-10-01', jornada: 'AFTERNOON', teamA: 'Tarde 2', teamB: 'B', lineVisible: 0, court: 3, scoreA: 0, scoreB: 0, status: 'SCHEDULED' },
    { tournamentType: 'MALE', date: '2026-10-01', jornada: 'MORNING', teamA: 'Mañana 2', teamB: 'B', lineVisible: 0, court: 4, scoreA: 0, scoreB: 0, status: 'SCHEDULED' },
    { tournamentType: 'MALE', date: '2026-10-01', jornada: 'MORNING', teamA: 'En juego', teamB: 'B', lineVisible: 0, court: 1, scoreA: 1, scoreB: 0, status: 'LIVE' },
    { tournamentType: 'FEMALE', date: '2026-10-02', jornada: 'AFTERNOON', teamA: 'Resultado', teamB: 'B', lineVisible: 0, court: 2, scoreA: 2, scoreB: 1, status: 'FINISHED' },
  ];

  vm.runInNewContext(`${renderers}\nmatches = ${JSON.stringify(matches)}; renderCalendar(); renderResults();`, {
    document: { querySelector: (selector: string) => elements[selector] }, Intl,
  });

  const calendarHtml = elements['#calendar-list']!.innerHTML;
  const resultsHtml = elements['#results-list']!.innerHTML;
  assert.match(calendarHtml, /Mañana 1[\s\S]*Mañana 2[\s\S]*Tarde 1[\s\S]*Tarde 2/);
  assert.match(calendarHtml, /En juego/);
  assert.doesNotMatch(calendarHtml, /Resultado/);
  assert.match(resultsHtml, /Resultado/);
  assert.doesNotMatch(resultsHtml, /Programado|En juego/);
});

test('placeholders públicos se distinguen y se reemplazan sin alterar programación', () => {
  const elements: Record<string, { value: string; innerHTML: string }> = Object.fromEntries(
    ['#calendar-date', '#calendar-status', '#calendar-list', '#results-date', '#results-list', '#live']
      .map(selector => [selector, { value: '', innerHTML: '' }]),
  );
  const source = fs.readFileSync('public/display/display.js', 'utf8');
  const renderers = source.slice(0, source.indexOf('function renderStandings'));
  const position = (rank: number, groupId: number) => ({
    reference: { kind: 'GROUP_POSITION', sourcePhaseId: 1, sourceGroupId: groupId, position: rank },
    resolvedTeamId: null, resolvedTeam: null, status: 'PENDING',
  });
  const match = {
    tournamentType: 'MALE', date: '2026-10-20', jornada: 'MORNING', court: 4, sortOrder: 2,
    teamA: 'Pentagonales · 1.º A', teamB: 'Pentagonales · 3.º A', lineTeam: 'Pentagonales · 3.º B',
    lineVisible: 1, scoreA: 0, scoreB: 0, status: 'SCHEDULED',
    participants: { teamA: position(1, 1), teamB: position(3, 1), lineTeam: position(3, 2) },
  };
  const context = vm.createContext({ document: { querySelector: (selector: string) => elements[selector] }, Intl });
  vm.runInContext(`${renderers}\nmatches = ${JSON.stringify([match, { ...match, teamA: 'Después', teamB: 'Rival', lineTeam: 'Árbitros', participants: undefined, sortOrder: 3 }])}; render();`, context);
  const pending = elements['#calendar-list']!.innerHTML;
  assert.match(pending, /1\.º A[\s\S]*3\.º A[\s\S]*Línea:[\s\S]*3\.º B/);
  assert.equal((pending.match(/class="participant-pending"/g) || []).length, 3);
  assert.equal((pending.match(/Por definir/g) || []).length, 3);
  assert.doesNotMatch(pending, /<img/);
  assert.match(pending, /CANCHA 4/);
  vm.runInContext("matches[0].status = 'FINISHED'; renderResults(); matches[0].status = 'SCHEDULED';", context);
  assert.equal((elements['#results-list']!.innerHTML.match(/Por definir/g) || []).length, 3);

  vm.runInContext(`
    Object.entries(matches[0].participants).forEach(([role, participant], index) => {
      participant.status = 'CONFIRMED';
      participant.resolvedTeamId = index + 1;
      participant.resolvedTeam = { id: index + 1, name: ['Águilas', 'Tigres', 'Halcones'][index] };
    });
    render();
  `, context);
  const confirmed = elements['#calendar-list']!.innerHTML;
  assert.match(confirmed, /Águilas[\s\S]*Tigres[\s\S]*Línea: Halcones[\s\S]*Después/);
  assert.doesNotMatch(confirmed, /Por definir|participant-pending|Pentagonales/);
  assert.equal(confirmed.match(/<h2>.*?<\/h2>/)?.[0], pending.match(/<h2>.*?<\/h2>/)?.[0]);
  assert.match(confirmed, /CANCHA 4/);
  assert.equal(vm.runInContext('matches[0].sortOrder', context), 2);

  vm.runInContext("matches[0].status = 'LIVE'; render();", context);
  assert.match(elements['#live']!.innerHTML, /Águilas[\s\S]*Tigres[\s\S]*Halcones/);
  vm.runInContext("matches[0].status = 'FINISHED'; render();", context);
  assert.match(elements['#results-list']!.innerHTML, /Águilas[\s\S]*0 – 0[\s\S]*Tigres[\s\S]*Halcones/);
  assert.doesNotMatch(elements['#calendar-list']!.innerHTML, /Águilas/);
});

test('participantes escapan nombres y mantienen la línea oculta', () => {
  const source = fs.readFileSync('public/display/display.js', 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.slice(0, source.indexOf('function liveCard')), context);
  const render = (match: object, role: string) => vm.runInContext(`participantName(${JSON.stringify(match)}, ${JSON.stringify(role)})`, context) as string;
  assert.equal(render({ teamA: '<Equipo>' }, 'teamA'), '&lt;Equipo&gt;');
  assert.match(render({ teamA: '<1.º A>', participants: { teamA: { status: 'PENDING' } } }, 'teamA'), /&lt;1\.º A&gt;.*Por definir/);
  assert.equal(render({ teamA: 'Anterior', participants: { teamA: { status: 'CONFIRMED', resolvedTeam: { name: '<Real>' } } } }, 'teamA'), '&lt;Real&gt;');
  const reopened = { teamA: 'Primera fase · 1.º A', status: 'SCHEDULED', participants: { teamA: {
    reference: { kind: 'GROUP_POSITION' }, status: 'RESOLVED', resolvedTeam: { name: 'Anterior' },
  } } };
  assert.match(render(reopened, 'teamA'), /Primera fase · 1\.º A.*Por definir/);
  assert.doesNotMatch(render(reopened, 'teamA'), /Anterior/);
  assert.equal(render({ ...reopened, status: 'LIVE' }, 'teamA'), 'Anterior');
  for (const status of ['PENDING', 'CONFIRMED']) {
    assert.equal(render({ lineVisible: 0, lineTeam: 'Secreto', participants: { lineTeam: { status, resolvedTeam: { name: 'Secreto' } } } }, 'lineTeam'), 'Por publicar');
  }
  assert.equal(render({ lineVisible: 0, lineTeam: null, participants: { lineTeam: null } }, 'lineTeam'), 'Por publicar');
});
