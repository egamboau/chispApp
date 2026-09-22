const labels = { MALE: 'Masculino', FEMALE: 'Femenino' };
const statusLabels = { SCHEDULED: 'PROGRAMADO', LIVE: 'EN JUEGO', FINISHED: 'FINAL' };
const jornadaLabels = { MORNING: 'MAÑANA', AFTERNOON: 'TARDE' };
let matches = [];
let filter = 'ALL';

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const badge = (match) => `<span class="badge ${match.tournamentType.toLowerCase()}">${labels[match.tournamentType]}</span>`;
const shortDate = (date) => new Intl.DateTimeFormat('es-GT', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00`));

function liveCard(match) {
  return `<article class="live-card ${match.tournamentType.toLowerCase()}">
    <div class="card-top">${badge(match)}<strong>CANCHA ${match.court}</strong></div>
    <div class="score"><span>${escapeHtml(match.teamA)}</span><b>${match.scoreA}</b><i>–</i><b>${match.scoreB}</b><span>${escapeHtml(match.teamB)}</span></div>
    <p>Línea: <strong>${escapeHtml(match.lineTeam)}</strong></p>
  </article>`;
}

function upcomingCard(match) {
  return `<article class="upcoming-card ${match.tournamentType.toLowerCase()}">
    <div class="jornada">${jornadaLabels[match.jornada]}</div>
    <div>${badge(match)} <strong>CANCHA ${match.court}</strong></div>
    <h3>${escapeHtml(match.teamA)} <small>vs</small> ${escapeHtml(match.teamB)}</h3>
    <p>Línea: <strong>${escapeHtml(match.lineTeam)}</strong></p>
  </article>`;
}

function render() {
  const live = matches.filter((match) => match.status === 'LIVE');
  const upcoming = matches.filter((match) => match.status === 'SCHEDULED').slice(0, 6);
  document.querySelector('#live').innerHTML = live.length
    ? `<div class="live-grid">${live.map(liveCard).join('')}</div>`
    : `<div class="empty"><h2>No hay partidos en juego</h2><p>Próximos partidos</p></div><div class="upcoming-grid compact">${upcoming.slice(0, 3).map(upcomingCard).join('')}</div>`;
  document.querySelector('#upcoming').innerHTML = upcoming.length
    ? `<div class="upcoming-grid">${upcoming.map(upcomingCard).join('')}</div>`
    : '<div class="empty"><h2>No hay próximos partidos</h2></div>';
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
      <span class="jornada">${jornadaLabels[match.jornada]}</span><div>${badge(match)} <strong>CANCHA ${match.court}</strong><h3>${escapeHtml(match.teamA)} <b>${match.scoreA} – ${match.scoreB}</b> ${escapeHtml(match.teamB)}</h3><p>Línea: ${escapeHtml(match.lineTeam)}</p></div><span class="status finished">FINAL</span>
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
      <span class="jornada">${jornadaLabels[match.jornada]}</span><div>${badge(match)} <strong>CANCHA ${match.court}</strong><h3>${escapeHtml(match.teamA)} ${match.status === 'SCHEDULED' ? '<small>vs</small>' : `<b>${match.scoreA} – ${match.scoreB}</b>`} ${escapeHtml(match.teamB)}</h3><p>Línea: ${escapeHtml(match.lineTeam)}</p></div><span class="status ${match.status.toLowerCase()}">${statusLabels[match.status]}</span>
    </article>`).join('')}</section>`).join('') || '<div class="empty"><h2>No hay partidos</h2></div>';
}

async function loadMatches() {
  try {
    const response = await fetch('/api/matches');
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

const events = new EventSource('/api/events');
events.addEventListener('matches', loadMatches);
events.onerror = () => { document.querySelector('#connection').textContent = 'Reconectando…'; };
loadMatches();
