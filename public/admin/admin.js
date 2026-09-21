const labels = { MALE: 'Masculino', FEMALE: 'Femenino' };
const statusLabels = { SCHEDULED: 'Programado', LIVE: 'En juego', FINISHED: 'Final' };
const form = document.querySelector('#match-form');
let matches = [];

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'No se pudo completar la operación.');
  }
  return response.status === 204 ? null : response.json();
}

function showMessage(text, error = false) {
  const message = document.querySelector('#message');
  message.textContent = text;
  message.className = error ? 'error' : 'success';
  if (!error) setTimeout(() => { message.textContent = ''; }, 2500);
}

function resetForm() {
  form.reset();
  document.querySelector('#match-id').value = '';
  document.querySelector('#form-title').textContent = 'Crear partido';
  document.querySelector('#cancel-edit').hidden = true;
}

function card(match) {
  const score = match.status === 'LIVE' ? `<div class="score-controls">
    <div><strong>${escapeHtml(match.teamA)}</strong><span><button data-action="score" data-team="A" data-delta="-1" ${match.scoreA === 0 ? 'disabled' : ''} aria-label="Restar punto a ${escapeHtml(match.teamA)}">−</button><b>${match.scoreA}</b><button data-action="score" data-team="A" data-delta="1" aria-label="Sumar punto a ${escapeHtml(match.teamA)}">+</button></span></div>
    <div><strong>${escapeHtml(match.teamB)}</strong><span><button data-action="score" data-team="B" data-delta="-1" ${match.scoreB === 0 ? 'disabled' : ''} aria-label="Restar punto a ${escapeHtml(match.teamB)}">−</button><b>${match.scoreB}</b><button data-action="score" data-team="B" data-delta="1" aria-label="Sumar punto a ${escapeHtml(match.teamB)}">+</button></span></div>
  </div>` : `<h3>${escapeHtml(match.teamA)} <small>vs</small> ${escapeHtml(match.teamB)}${match.status === 'FINISHED' ? ` · ${match.scoreA}–${match.scoreB}` : ''}</h3>`;
  return `<article class="match-card ${match.tournamentType.toLowerCase()}" data-id="${match.id}">
    <div class="meta"><span class="badge">${labels[match.tournamentType]}</span><strong>Cancha ${match.court}</strong><time>${match.date} · ${match.time}</time><span class="status ${match.status.toLowerCase()}">${statusLabels[match.status]}</span></div>
    ${score}<p>Línea: <strong>${escapeHtml(match.lineTeam)}</strong></p>
    <div class="actions"><button data-action="edit">EDITAR</button><button class="danger" data-action="delete">ELIMINAR</button>${match.status === 'SCHEDULED' ? '<button class="primary" data-action="start">INICIAR</button>' : ''}${match.status === 'LIVE' ? '<button class="finish" data-action="finish">FINALIZAR PARTIDO</button>' : ''}</div>
  </article>`;
}

function render() {
  const date = document.querySelector('#filter-date').value;
  const tournament = document.querySelector('#filter-tournament').value;
  const court = document.querySelector('#filter-court').value;
  const filtered = matches.filter((match) => (!date || match.date === date) && (!tournament || match.tournamentType === tournament) && (!court || match.court === Number(court)));
  document.querySelector('#matches').innerHTML = filtered.map(card).join('') || '<p class="empty">No hay partidos con estos filtros.</p>';
}

async function loadMatches() {
  try {
    matches = await request('/api/matches');
    render();
  } catch (error) { showMessage(error.message, true); }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = document.querySelector('#match-id').value;
  const body = Object.fromEntries(['tournamentType', 'date', 'time', 'court', 'teamA', 'teamB', 'lineTeam'].map((key) => [key, document.querySelector(`#${key}`).value]));
  try {
    await request(id ? `/api/matches/${id}` : '/api/matches', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    resetForm();
    showMessage(id ? 'Partido actualizado.' : 'Partido creado.');
    await loadMatches();
  } catch (error) { showMessage(error.message, true); }
});

document.querySelector('#cancel-edit').addEventListener('click', resetForm);
document.querySelectorAll('.filters input, .filters select').forEach((input) => input.addEventListener('input', render));

document.querySelector('#matches').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.closest('[data-id]').dataset.id;
  const match = matches.find((item) => item.id === Number(id));
  try {
    if (button.dataset.action === 'edit') {
      for (const key of ['tournamentType', 'date', 'time', 'court', 'teamA', 'teamB', 'lineTeam']) document.querySelector(`#${key}`).value = match[key];
      document.querySelector('#match-id').value = id;
      document.querySelector('#form-title').textContent = 'Editar partido';
      document.querySelector('#cancel-edit').hidden = false;
      document.querySelector('.form-panel').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (button.dataset.action === 'delete') {
      if (!confirm(`¿Eliminar ${match.teamA} vs ${match.teamB}?`)) return;
      await request(`/api/matches/${id}`, { method: 'DELETE' });
    } else if (button.dataset.action === 'score') {
      await request(`/api/matches/${id}/score`, { method: 'PATCH', body: JSON.stringify({ team: button.dataset.team, delta: Number(button.dataset.delta) }) });
    } else {
      await request(`/api/matches/${id}/${button.dataset.action}`, { method: 'POST' });
    }
    await loadMatches();
  } catch (error) { showMessage(error.message, true); }
});

const events = new EventSource('/api/events');
events.addEventListener('matches', loadMatches);
loadMatches();
