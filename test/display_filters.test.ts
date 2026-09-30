import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('filtra calendario por fecha y estado, y resultados por fecha', () => {
  const elements: Record<string, { value: string; innerHTML: string }> = {
    '#calendar-date': { value: '2026-10-01', innerHTML: '' },
    '#calendar-status': { value: 'SCHEDULED', innerHTML: '' },
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
  assert.doesNotMatch(calendarHtml, /En juego|Resultado/);
  assert.match(resultsHtml, /Resultado/);
  assert.doesNotMatch(resultsHtml, /Programado|En juego/);
});
