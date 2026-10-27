import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('public/display/display.js', 'utf8');
const phases = [
  { id: 30, tournamentType: 'FEMALE', name: 'Primera fase', sortOrder: 1 },
  { id: 20, tournamentType: 'MALE', name: 'Segunda fase', sortOrder: 2 },
  { id: 11, tournamentType: 'MALE', name: 'Primera <fase>', sortOrder: 1 },
  { id: 10, tournamentType: 'MALE', name: 'Primera fase', sortOrder: 1 },
];

function setup(previous: string, currentPhaseId: number) {
  let value = previous, html = '';
  const select = {
    get value() { return value; },
    set value(next: string | number) { value = String(next); },
    get innerHTML() { return html; },
    set innerHTML(next: string) { html = next; value = next.match(/value="(\d+)"/)?.[1] || ''; },
    addEventListener(_event: string, callback: () => void) { this.change = callback; },
    change() {},
  };
  const requests: string[] = [];
  const context = vm.createContext({
    document: { querySelector: (selector: string) => selector === '#phase-select' ? select : { value: '1', textContent: '' } },
    fetch: async (url: string) => {
      requests.push(url);
      return { ok: true, json: async () => url.endsWith('/phases') ? structuredClone(phases) : [] };
    },
  });
  vm.runInContext(`${source.slice(0, source.indexOf("document.querySelector('nav')"))}
    tournaments = [{ id: 1, currentPhaseId: ${currentPhaseId} }];
    filter = 'FEMALE';
    renderStandings = () => {}; renderScoring = () => {}; render = () => {};
    ${source.split('\n').find(line => line.startsWith("document.querySelector('#phase-select').addEventListener"))}
  `, context);
  return { context, select, requests };
}

test('selector público muestra categoría y fase ordenadas, con identificadores originales', async () => {
  const { context, select } = setup('', 20);
  await vm.runInContext('loadPhases()', context);
  assert.equal(select.innerHTML, '<option value="10">Masculino · Primera fase</option><option value="11">Masculino · Primera &lt;fase&gt;</option><option value="20">Masculino · Segunda fase</option><option value="30">Femenino · Primera fase</option>');
});

test('recargar fases conserva selección o usa fase actual y primera opción como respaldo', async () => {
  for (const [previous, current, expected] of [['30', 20, '30'], ['99', 20, '20'], ['', 99, '10']] as const) {
    const { context, select, requests } = setup(previous, current);
    await vm.runInContext('loadPhases()', context);
    assert.equal(select.value, expected);
    assert.deepEqual(requests, ['/api/tournaments/1/phases', `/api/phases/${expected}/standings`, `/api/phases/${expected}/scoring`, `/api/matches?phaseId=${expected}`]);
    assert.equal(vm.runInContext('filter', context), 'FEMALE');
  }
});

test('cambiar categoría de fase recarga tablas y partidos usando el mismo id', async () => {
  const { context, select, requests } = setup('20', 20);
  await vm.runInContext('loadPhases()', context);
  requests.length = 0;
  select.value = '30';
  select.change();
  assert.deepEqual(requests, ['/api/phases/30/standings', '/api/phases/30/scoring', '/api/matches?phaseId=30']);
  assert.equal(vm.runInContext('filter', context), 'FEMALE');
});
