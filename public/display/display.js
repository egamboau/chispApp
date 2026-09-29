const labels = { MALE: 'Masculino', FEMALE: 'Femenino' };
const statusLabels = { SCHEDULED: 'PROGRAMADO', LIVE: 'EN JUEGO', FINISHED: 'FINAL' };
const jornadaLabels = { MORNING: '<span role="img" aria-label="Mañana" title="Mañana">☀️</span>', AFTERNOON: '<span role="img" aria-label="Tarde" title="Tarde">🌇</span>' };
let matches = [];
let filter = 'ALL';
let tournaments = [];
let selectedScoringTable = 'Torneo Regular';

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const badge = (match) => `<span class="badge ${match.tournamentType.toLowerCase()}">${labels[match.tournamentType]}</span>`;
const shortDate = (date) => new Intl.DateTimeFormat('es-GT', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00`));

function liveCard(match) {
  return `<article class="live-card ${match.tournamentType.toLowerCase()}">
    <div class="card-top">${badge(match)}<strong>CANCHA ${match.court}</strong></div>
    <div class="score"><span>${escapeHtml(match.teamA)}</span><b>${match.scoreA}</b><i>–</i><b>${match.scoreB}</b><span>${escapeHtml(match.teamB)}</span></div>
    <p>Línea: <strong>${match.lineVisible ? escapeHtml(match.lineTeam) : 'Por publicar'}</strong></p>
  </article>`;
}

function render() {
  const live = matches.filter((match) => match.status === 'LIVE');
  document.querySelector('#live').innerHTML = live.length
    ? `<div class="live-grid">${live.map(liveCard).join('')}</div>`
    : '<div class="empty"><h2>No hay partidos en juego</h2></div>';
  renderCalendar();
  renderResults();
}

function renderResults() {
  const days = matches.filter((match) => match.status === 'FINISHED').reduce((grouped, match) => {
    (grouped[match.date] ||= []).push(match);
    return grouped;
  }, {});
  document.querySelector('#results').innerHTML = Object.entries(days).reverse().map(([date, dayMatches]) => `
    <section class="day"><h2>${shortDate(date)}</h2>${dayMatches.map((match) => `<article class="calendar-match ${match.tournamentType.toLowerCase()}">
      <span class="jornada">${jornadaLabels[match.jornada]}</span><div>${badge(match)} <strong>CANCHA ${match.court}</strong><h3>${escapeHtml(match.teamA)} <b>${match.scoreA} – ${match.scoreB}</b> ${escapeHtml(match.teamB)}</h3><p>Línea: ${match.lineVisible ? escapeHtml(match.lineTeam) : 'Por publicar'}</p></div><span class="status finished">FINAL</span>
    </article>`).join('')}</section>`).join('') || '<div class="empty"><h2>No hay resultados anteriores</h2></div>';
}

function renderCalendar() {
  const selected = filter === 'ALL' ? matches : matches.filter((match) => match.tournamentType === filter);
  const days = selected.reduce((grouped, match) => {
    (grouped[match.date] ||= []).push(match);
    return grouped;
  }, {});
  document.querySelector('#calendar-list').innerHTML = Object.entries(days).map(([date, dayMatches]) => `
    <section class="day"><h2>${shortDate(date)}</h2>${dayMatches.map((match) => `<article class="calendar-match ${match.tournamentType.toLowerCase()}">
      <span class="jornada">${jornadaLabels[match.jornada]}</span><div>${badge(match)} <strong>CANCHA ${match.court}</strong><h3>${escapeHtml(match.teamA)} ${match.status === 'SCHEDULED' ? '<small>vs</small>' : `<b>${match.scoreA} – ${match.scoreB}</b>`} ${escapeHtml(match.teamB)}</h3><p>Línea: ${match.lineVisible ? escapeHtml(match.lineTeam) : 'Por publicar'}</p></div><span class="status ${match.status.toLowerCase()}">${statusLabels[match.status]}</span>
    </article>`).join('')}</section>`).join('') || '<div class="empty"><h2>No hay partidos</h2></div>';
}

function renderStandings(data) {
  const target = document.querySelector('#standings');
  if (!data.hasStandings) { target.innerHTML = `<div class="empty"><h2>${escapeHtml(data.message)}</h2></div>`; return; }
  const legend = data.rules.map((rule) => `<span>${rule.positions.map((position) => `${position}.º`).join(', ')}: ${escapeHtml(rule.label)}</span>`).join('');
  target.innerHTML = `<div class="standings-legend">${legend || 'Sin destinos configurados'}</div>${data.groups.map((group) => `<section class="standings-group"><h2>${escapeHtml(group.name)}</h2><div class="table-scroll"><table><thead><tr><th>Pos.</th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th><th>Pts.</th><th>🟥</th><th>🟨</th><th>Destino</th></tr></thead><tbody>${group.standings.map((row, index) => {
    const boundary = index && row.destination !== group.standings[index - 1].destination ? ' class="range-start"' : '';
    const destination = row.destination || (row.possibleDestinations.length ? `Pendiente: ${row.possibleDestinations.map(escapeHtml).join(' / ')}` : '—');
    return `<tr${boundary}><td>${row.position}.º${row.requiresTiebreaker ? '*' : ''}</td><td>${escapeHtml(row.teamName)}${row.sanctioned ? ` <abbr title="${escapeHtml(row.sanctionReason)}">Sancionado</abbr>` : ''}</td><td>${row.played}</td><td>${row.wins}</td><td>${row.draws}</td><td>${row.losses}</td><td>${row.goalsFor}</td><td>${row.goalsAgainst}</td><td>${row.goalDifference}</td><td><strong>${row.points}</strong></td><td>${row.redCards}</td><td>${row.yellowCards}</td><td>${destination}</td></tr>`;
  }).join('')}</tbody></table></div>${group.standings.some((row) => row.requiresTiebreaker) ? '<p class="tiebreaker">* Partido extra: dos tiempos de 5 minutos y penales si persiste el empate.</p>' : ''}</section>`).join('')}`;
}

function scoringTable(title, rows, metric, metricLabel) {
  return `<section class="scoring-table"><h2>${title}</h2>${rows.length ? `<div class="table-scroll"><table><thead><tr><th>Pos.</th><th>Jugador</th><th>Equipo</th><th>${metricLabel}</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${row.position}.º</td><td><strong>#${escapeHtml(row.playerNumber)}</strong> ${escapeHtml(row.playerName || 'Sin nombre')}</td><td>${escapeHtml(row.teamName)}</td><td><strong>${row[metric]}</strong></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty-ranking">Sin anotaciones</p>'}</section>`;
}

function renderScoring(data) {
  const selected = data.tables.find(({ name }) => name === selectedScoringTable) || data.tables.find(({ name }) => name === 'Torneo Regular') || data.tables[0];
  selectedScoringTable = selected.name;
  const target = document.querySelector('#scoring');
  target.innerHTML = `<div class="scoring-controls"><label>Tabla de goleo<select>${data.tables.map(({ name }) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}</select></label><p class="scoring-weights">Directo = 1 · Pepita = 2 · Horqueta = 3</p></div><div class="scoring-tables"></div>`;
  const select = target.querySelector('select'), tables = target.querySelector('.scoring-tables');
  const show = () => {
    selectedScoringTable = select.value;
    const table = data.tables.find(({ name }) => name === selectedScoringTable);
    tables.innerHTML = `${scoringTable('Goleadores', table.rankings.total, 'total', 'Total')}${scoringTable('Pepitas', table.rankings.pepitas, 'pepitas', 'Pepitas')}${scoringTable('Horquetas', table.rankings.horquetas, 'horquetas', 'Horquetas')}`;
  };
  select.value = selectedScoringTable; select.addEventListener('change', show); show();
}

async function loadStandings() {
  const phaseId = document.querySelector('#phase-select').value;
  if (!phaseId) return;
  const response = await fetch(`/api/phases/${phaseId}/standings`);
  if (response.ok) renderStandings(await response.json());
}

async function loadScoring() {
  const phaseId = document.querySelector('#phase-select').value;
  if (!phaseId) return;
  const response = await fetch(`/api/phases/${phaseId}/scoring`);
  if (response.ok) renderScoring(await response.json());
}

async function loadSelectors() {
  tournaments = await (await fetch('/api/tournaments?active=true')).json();
  const tournamentSelect = document.querySelector('#tournament-select');
  const previous = Number(tournamentSelect.value);
  tournamentSelect.innerHTML = tournaments.map((tournament) => `<option value="${tournament.id}">${escapeHtml(tournament.name)}</option>`).join('');
  if (tournaments.some((tournament) => tournament.id === previous)) tournamentSelect.value = previous;
  await loadPhases();
}

async function loadPhases() {
  const tournament = tournaments.find((item) => item.id === Number(document.querySelector('#tournament-select').value));
  if (!tournament) return;
  const phases = await (await fetch(`/api/tournaments/${tournament.id}/phases`)).json();
  const select = document.querySelector('#phase-select');
  const previous = Number(select.value);
  select.innerHTML = phases.map((phase) => `<option value="${phase.id}">${escapeHtml(phase.name)}</option>`).join('');
  if (phases.some((phase) => phase.id === previous)) select.value = previous;
  else if (phases.some((phase) => phase.id === tournament.currentPhaseId)) select.value = tournament.currentPhaseId;
  await Promise.all([loadStandings(), loadScoring(), loadMatches()]);
}

async function loadMatches() {
  try {
    const phaseId = document.querySelector('#phase-select').value;
    const response = await fetch(`/api/matches${phaseId ? `?phaseId=${phaseId}` : ''}`);
    if (!response.ok) throw new Error();
    matches = await response.json();
    render();
    document.querySelector('#connection').textContent = '';
  } catch {
    document.querySelector('#connection').textContent = 'Sin conexión. Reintentando…';
  }
}

document.querySelector('nav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (!button) return;
  document.querySelectorAll('nav button, .view').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  document.querySelector(`#${button.dataset.view}`).classList.add('active');
});

document.querySelector('.filters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  filter = button.dataset.filter;
  document.querySelectorAll('.filters button').forEach((item) => item.classList.toggle('active', item === button));
  renderCalendar();
});
document.querySelector('#tournament-select').addEventListener('change', loadPhases);
document.querySelector('#phase-select').addEventListener('change', () => { loadStandings(); loadScoring(); loadMatches(); });

const events = new EventSource('/api/events');
events.addEventListener('matches', () => { loadMatches(); loadSelectors(); });
events.onerror = () => { document.querySelector('#connection').textContent = 'Reconectando…'; };
loadMatches();
loadSelectors();
