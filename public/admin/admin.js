const page = document.body.dataset.page;
const jornadaLabels = { MORNING: 'Mañana', AFTERNOON: 'Tarde' };
const statusLabels = { SCHEDULED: 'Programado', LIVE: 'En juego', FINISHED: 'Final' };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const options = (items, label = 'name') => items.map((item) => `<option value="${item.id}">${escapeHtml(item[label])}</option>`).join('');
let tournaments = [], phases = [], groups = [], teams = [], memberships = [], rules = [], sanctions = [], matches = [];

async function request(url, init = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'No se pudo completar la operación.');
  return response.status === 204 ? null : response.json();
}
function message(text, error = false) {
  const target = document.querySelector('#message');
  if (!target) return;
  target.textContent = text; target.className = error ? 'error' : 'success';
  if (!error) setTimeout(() => { target.textContent = ''; }, 2500);
}
function choose(select, items, preferred) {
  select.innerHTML = options(items);
  const selected = items.find(({ id }) => id === Number(preferred)) || items[0];
  select.value = selected?.id || '';
  return selected;
}
function disable(form, value) { form.querySelectorAll('input,select,button').forEach((control) => { control.disabled = value; }); }
const selectedTournament = () => tournaments.find(({ id }) => id === Number(document.querySelector('#admin-tournament').value));
const selectedPhase = () => phases.find(({ id }) => id === Number(document.querySelector('#admin-phase')?.value));

async function loadTournaments(preferred) {
  tournaments = await request('/api/tournaments');
  return choose(document.querySelector('#admin-tournament'), tournaments, preferred);
}

async function loadTournamentPage(tournamentId, phaseId) {
  const tournament = await loadTournaments(tournamentId);
  phases = tournament ? await request(`/api/tournaments/${tournament.id}/phases`) : [];
  const phase = choose(document.querySelector('#admin-phase'), phases, phaseId ?? tournament?.currentPhaseId);
  [groups, rules] = phase ? await Promise.all([request(`/api/phases/${phase.id}/groups`), request(`/api/phases/${phase.id}/classification-rules`)]) : [[], []];
  renderTournamentPage();
}
function renderTournamentPage() {
  const tournament = selectedTournament(), phase = selectedPhase();
  document.querySelector('#tournament-detail').innerHTML = tournament ? `<div class="config-row"><strong>${escapeHtml(tournament.name)}</strong><span>${tournament.active ? 'Activo' : 'Inactivo'}</span><button data-action="edit-tournament">EDITAR</button><button data-action="toggle-tournament">${tournament.active ? 'DESACTIVAR' : 'ACTIVAR'}</button><button class="danger" data-action="delete-tournament">ELIMINAR</button></div>` : '<p class="empty">Crea un torneo para comenzar.</p>';
  document.querySelector('#phase-detail').innerHTML = phase ? `<div class="config-row"><strong>${escapeHtml(phase.name)}</strong><span>${phase.type === 'TABLE' ? 'Tabla' : 'Eliminatoria'}</span>${tournament.currentPhaseId === phase.id ? '<span>Fase actual</span>' : '<button data-action="current-phase">HACER ACTUAL</button>'}<button data-action="edit-phase">EDITAR</button><button class="danger" data-action="delete-phase">ELIMINAR</button></div>` : '<p class="empty">Este torneo no tiene fases.</p>';
  document.querySelector('#groups').innerHTML = groups.map((group) => `<div class="config-row"><span>${escapeHtml(group.name)}</span><button data-action="edit-group" data-id="${group.id}">EDITAR</button><button class="danger" data-action="delete-group" data-id="${group.id}">ELIMINAR</button></div>`).join('') || '<p class="empty">Esta fase no tiene grupos.</p>';
  document.querySelector('#rules').innerHTML = rules.map((rule) => `<div class="config-row"><span>${rule.startPosition}–${rule.endPosition}: <strong>${escapeHtml(rule.label)}</strong></span><button data-action="edit-rule" data-id="${rule.id}">EDITAR</button><button class="danger" data-action="delete-rule" data-id="${rule.id}">ELIMINAR</button></div>`).join('') || '<p class="empty">Sin rangos configurados.</p>';
  disable(document.querySelector('#phase-form'), !tournament);
  disable(document.querySelector('#group-form'), !phase);
  disable(document.querySelector('#rule-form'), !phase || phase.type !== 'TABLE');
}
function initTournamentPage() {
  document.querySelector('#tournament-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const created = await request('/api/tournaments', { method: 'POST', body: JSON.stringify({ name: document.querySelector('#tournament-name').value }) });
      event.target.reset(); await loadTournamentPage(created.id); message('Torneo creado.');
    } catch (error) { message(error.message, true); }
  });
  document.querySelector('#phase-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const tournament = selectedTournament();
    try {
      const created = await request(`/api/tournaments/${tournament.id}/phases`, { method: 'POST', body: JSON.stringify({ name: document.querySelector('#phase-name').value, type: document.querySelector('#phase-type').value, sortOrder: phases.length + 1 }) });
      event.target.reset(); await loadTournamentPage(tournament.id, created.id); message('Fase creada.');
    } catch (error) { message(error.message, true); }
  });
  document.querySelector('#group-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const phase = selectedPhase();
    try { await request(`/api/phases/${phase.id}/groups`, { method: 'POST', body: JSON.stringify({ name: document.querySelector('#group-name').value }) }); event.target.reset(); await loadTournamentPage(selectedTournament().id, phase.id); message('Grupo creado.'); }
    catch (error) { message(error.message, true); }
  });
  document.querySelector('#rule-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const phase = selectedPhase();
    try {
      const body = { startPosition: Number(document.querySelector('#rule-start').value), endPosition: Number(document.querySelector('#rule-end').value), label: document.querySelector('#rule-label').value };
      await request(`/api/phases/${phase.id}/classification-rules`, { method: 'POST', body: JSON.stringify(body) }); event.target.reset(); await loadTournamentPage(selectedTournament().id, phase.id); message('Rango creado.');
    } catch (error) { message(error.message, true); }
  });
  document.querySelector('#admin-tournament').addEventListener('change', () => loadTournamentPage(selectedTournament()?.id).catch((error) => message(error.message, true)));
  document.querySelector('#admin-phase').addEventListener('change', () => loadTournamentPage(selectedTournament()?.id, selectedPhase()?.id).catch((error) => message(error.message, true)));
  document.querySelector('main').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const action = button.dataset.action, tournament = selectedTournament(), phase = selectedPhase();
    try {
      if (action === 'edit-tournament') { const name = prompt('Nombre del torneo', tournament.name); if (!name) return; await request(`/api/tournaments/${tournament.id}`, { method: 'PUT', body: JSON.stringify({ name, active: Boolean(tournament.active), currentPhaseId: tournament.currentPhaseId }) }); }
      if (action === 'toggle-tournament') await request(`/api/tournaments/${tournament.id}`, { method: 'PUT', body: JSON.stringify({ name: tournament.name, active: !tournament.active, currentPhaseId: tournament.currentPhaseId }) });
      if (action === 'delete-tournament') { if (!confirm('¿Eliminar este torneo?')) return; await request(`/api/tournaments/${tournament.id}`, { method: 'DELETE' }); }
      if (action === 'current-phase') await request(`/api/tournaments/${tournament.id}`, { method: 'PUT', body: JSON.stringify({ name: tournament.name, active: Boolean(tournament.active), currentPhaseId: phase.id }) });
      if (action === 'edit-phase') { const name = prompt('Nombre de la fase', phase.name), type = prompt('Tipo: TABLE o ELIMINATION', phase.type); if (!name || !['TABLE', 'ELIMINATION'].includes(type)) return; await request(`/api/phases/${phase.id}`, { method: 'PUT', body: JSON.stringify({ name, type, sortOrder: phase.sortOrder }) }); }
      if (action === 'delete-phase') { if (!confirm('¿Eliminar esta fase?')) return; await request(`/api/phases/${phase.id}`, { method: 'DELETE' }); }
      if (action === 'edit-group') { const group = groups.find(({ id }) => id === Number(button.dataset.id)), name = prompt('Nombre del grupo', group.name); if (!name) return; await request(`/api/groups/${group.id}`, { method: 'PUT', body: JSON.stringify({ name }) }); }
      if (action === 'delete-group') { if (!confirm('¿Eliminar este grupo?')) return; await request(`/api/groups/${button.dataset.id}`, { method: 'DELETE' }); }
      if (action === 'edit-rule') { const rule = rules.find(({ id }) => id === Number(button.dataset.id)), startPosition = Number(prompt('Posición inicial', rule.startPosition)), endPosition = Number(prompt('Posición final', rule.endPosition)), label = prompt('Destino', rule.label); if (!label) return; await request(`/api/phases/${phase.id}/classification-rules/${rule.id}`, { method: 'PUT', body: JSON.stringify({ startPosition, endPosition, label }) }); }
      if (action === 'delete-rule') await request(`/api/phases/${phase.id}/classification-rules/${button.dataset.id}`, { method: 'DELETE' });
      await loadTournamentPage(action === 'delete-tournament' ? undefined : tournament?.id, action === 'delete-phase' ? undefined : phase?.id); message('Cambio guardado.');
    } catch (error) { message(error.message, true); }
  });
  loadTournamentPage().catch((error) => message(error.message, true));
}

async function loadTeamPage(tournamentId, phaseId) {
  const tournament = await loadTournaments(tournamentId);
  phases = tournament ? await request(`/api/tournaments/${tournament.id}/phases`) : [];
  const phase = choose(document.querySelector('#admin-phase'), phases, phaseId ?? tournament?.currentPhaseId);
  teams = tournament ? await request(`/api/teams?tournamentId=${tournament.id}`) : [];
  [groups, memberships, sanctions] = phase ? await Promise.all([request(`/api/phases/${phase.id}/groups`), request(`/api/phases/${phase.id}/memberships`), request(`/api/phases/${phase.id}/sanctions`)]) : [[], [], []];
  renderTeamPage();
}
function renderTeamPage() {
  const tournament = selectedTournament(), phase = selectedPhase(), memberIds = new Set(memberships.map(({ teamId }) => teamId));
  document.querySelector('#phase-help').textContent = !phase ? 'El torneo no tiene fases.' : groups.length ? `Asignando equipos a ${phase.name}.` : `${phase.name} no tiene grupos; crea uno en la página Torneos para asignar equipos.`;
  document.querySelector('#new-team-group').innerHTML = `<option value="">Sin asignar</option>${options(groups)}`;
  const available = teams.filter(({ id }) => !memberIds.has(id));
  document.querySelector('#membership-team').innerHTML = options(available);
  document.querySelector('#membership-group').innerHTML = options(groups);
  document.querySelector('#sanction-team').innerHTML = options(teams.filter(({ id }) => memberIds.has(id)));
  document.querySelector('#teams').innerHTML = teams.map((team) => {
    const membership = memberships.find(({ teamId }) => teamId === team.id);
    return `<div class="config-row"><span><strong>${escapeHtml(team.name)}</strong><small>${membership ? `Grupo ${escapeHtml(membership.groupName)}` : phase ? 'Sin grupo en esta fase' : 'En el torneo'}</small></span><button data-action="edit-team" data-id="${team.id}">EDITAR</button>${membership ? `<button data-action="remove-membership" data-id="${team.id}">QUITAR DE FASE</button>` : ''}<button class="danger" data-action="delete-team" data-id="${team.id}">ELIMINAR</button></div>`;
  }).join('') || '<p class="empty">Este torneo no tiene equipos.</p>';
  document.querySelector('#sanctions').innerHTML = sanctions.map((item) => `<div class="config-row"><span><strong>${escapeHtml(item.teamName)}</strong>: ${escapeHtml(item.reason)}</span><button class="danger" data-action="delete-sanction" data-id="${item.teamId}">QUITAR</button></div>`).join('') || '<p class="empty">Sin sanciones.</p>';
  disable(document.querySelector('#team-form'), !tournament);
  disable(document.querySelector('#membership-form'), !phase || !groups.length || !available.length);
  disable(document.querySelector('#sanction-form'), !memberships.length);
}
function initTeamPage() {
  document.querySelector('#team-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const tournament = selectedTournament(), phase = selectedPhase(), groupId = Number(document.querySelector('#new-team-group').value);
    try {
      const team = await request('/api/teams', { method: 'POST', body: JSON.stringify({ tournamentId: tournament.id, name: document.querySelector('#team-name').value }) });
      if (phase && groupId) await request(`/api/phases/${phase.id}/memberships`, { method: 'POST', body: JSON.stringify({ teamId: team.id, groupId }) });
      event.target.reset(); await loadTeamPage(tournament.id, phase?.id); message('Equipo creado.');
    } catch (error) { message(error.message, true); }
  });
  document.querySelector('#membership-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const phase = selectedPhase();
    try { await request(`/api/phases/${phase.id}/memberships`, { method: 'POST', body: JSON.stringify({ teamId: Number(document.querySelector('#membership-team').value), groupId: Number(document.querySelector('#membership-group').value) }) }); await loadTeamPage(selectedTournament().id, phase.id); message('Equipo asignado.'); }
    catch (error) { message(error.message, true); }
  });
  document.querySelector('#sanction-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const phase = selectedPhase(), teamId = document.querySelector('#sanction-team').value;
    try { await request(`/api/phases/${phase.id}/teams/${teamId}/sanction`, { method: 'PUT', body: JSON.stringify({ reason: document.querySelector('#sanction-reason').value }) }); event.target.reset(); await loadTeamPage(selectedTournament().id, phase.id); message('Sanción guardada.'); }
    catch (error) { message(error.message, true); }
  });
  document.querySelector('#admin-tournament').addEventListener('change', () => loadTeamPage(selectedTournament()?.id).catch((error) => message(error.message, true)));
  document.querySelector('#admin-phase').addEventListener('change', () => loadTeamPage(selectedTournament()?.id, selectedPhase()?.id).catch((error) => message(error.message, true)));
  document.querySelector('#teams').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const team = teams.find(({ id }) => id === Number(button.dataset.id)), phase = selectedPhase();
    try {
      if (button.dataset.action === 'edit-team') { const name = prompt('Nombre del equipo', team.name); if (!name) return; await request(`/api/teams/${team.id}`, { method: 'PUT', body: JSON.stringify({ name }) }); }
      if (button.dataset.action === 'remove-membership') { if (!confirm(`¿Quitar a ${team.name} de esta fase?`)) return; await request(`/api/phases/${phase.id}/memberships/${team.id}`, { method: 'DELETE' }); }
      if (button.dataset.action === 'delete-team') { if (!confirm(`¿Eliminar a ${team.name} del torneo?`)) return; await request(`/api/teams/${team.id}`, { method: 'DELETE' }); }
      await loadTeamPage(selectedTournament().id, phase?.id); message('Cambio guardado.');
    } catch (error) { message(error.message, true); }
  });
  document.querySelector('#sanctions').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action="delete-sanction"]'); if (!button) return;
    try { await request(`/api/phases/${selectedPhase().id}/teams/${button.dataset.id}/sanction`, { method: 'DELETE' }); await loadTeamPage(selectedTournament().id, selectedPhase().id); message('Sanción eliminada.'); }
    catch (error) { message(error.message, true); }
  });
  loadTeamPage().catch((error) => message(error.message, true));
}

let currentPhase;
async function loadCalendarPage(tournamentId) {
  const tournament = await loadTournaments(tournamentId);
  phases = tournament ? await request(`/api/tournaments/${tournament.id}/phases`) : [];
  currentPhase = phases.find(({ id }) => id === tournament?.currentPhaseId);
  teams = tournament ? await request(`/api/teams?tournamentId=${tournament.id}`) : [];
  [groups, memberships, matches] = currentPhase ? await Promise.all([request(`/api/phases/${currentPhase.id}/groups`), request(`/api/phases/${currentPhase.id}/memberships`), request(`/api/matches?phaseId=${currentPhase.id}`)]) : [[], [], []];
  document.querySelector('#current-phase').textContent = currentPhase ? `${currentPhase.name}${groups.length ? '' : ' (sin grupos)'}` : 'Sin fase actual';
  document.querySelector('#groupId').innerHTML = options(groups);
  renderMatchTeams(); renderMatches();
  disable(document.querySelector('#match-form'), !currentPhase || !groups.length);
}
function renderMatchTeams(values = {}) {
  const groupId = Number(document.querySelector('#groupId').value), memberIds = memberships.map((item) => item.teamId);
  for (const id of ['teamAId', 'teamBId']) { const select = document.querySelector(`#${id}`), selected = values[id] || select.value, allowed = id === 'teamAId' ? memberships.filter((item) => item.groupId === groupId).map((item) => item.teamId) : memberIds; select.innerHTML = `<option value="">Seleccione</option>${options(teams.filter((team) => allowed.includes(team.id)))}`; select.value = selected; }
  const line = document.querySelector('#lineTeamId'), selected = values.lineTeamId || line.value;
  line.innerHTML = `<option value="">Seleccione</option>${options(teams)}`; line.value = selected;
}
function resetMatchForm() {
  document.querySelector('#match-form').reset(); document.querySelector('#match-id').value = ''; document.querySelector('#cancel-edit').hidden = true;
  document.querySelector('#groupId').innerHTML = options(groups); renderMatchTeams();
}
function matchCard(match) {
  const score = match.status === 'LIVE' ? `<div class="score-controls">${['A', 'B'].map((side) => `<div><strong>${escapeHtml(match[`team${side}`])}</strong><span><button data-action="score" data-team="${side}" data-delta="-1" ${match[`score${side}`] === 0 ? 'disabled' : ''}>−</button><b>${match[`score${side}`]}</b><button data-action="score" data-team="${side}" data-delta="1">+</button></span></div>`).join('')}</div>` : `<h3>${escapeHtml(match.teamA)} <small>vs</small> ${escapeHtml(match.teamB)}${match.status === 'FINISHED' ? ` · ${match.scoreA}–${match.scoreB}` : ''}</h3>`;
  return `<article class="match-card ${match.tournamentType.toLowerCase()}" data-id="${match.id}"><div class="meta"><span class="badge">${escapeHtml(match.tournamentName)}</span><strong>${escapeHtml(match.phaseName)} · ${escapeHtml(match.groupName)} · Cancha ${match.court}</strong><span>${match.date} · ${jornadaLabels[match.jornada]}</span><span class="status ${match.status.toLowerCase()}">${statusLabels[match.status]}</span></div>${score}<p>Línea: <strong>${escapeHtml(match.lineTeam)}</strong></p><div class="cards"><label>${escapeHtml(match.teamA)} 🟨<input data-card="yellowCardsA" type="number" min="0" value="${match.yellowCardsA}"></label><label>🟥<input data-card="redCardsA" type="number" min="0" value="${match.redCardsA}"></label><label>${escapeHtml(match.teamB)} 🟨<input data-card="yellowCardsB" type="number" min="0" value="${match.yellowCardsB}"></label><label>🟥<input data-card="redCardsB" type="number" min="0" value="${match.redCardsB}"></label><button data-action="cards">GUARDAR TARJETAS</button></div><div class="actions">${match.status === 'SCHEDULED' ? '<button data-action="edit">EDITAR</button><button class="danger" data-action="delete">ELIMINAR</button><button class="primary" data-action="start">INICIAR</button>' : ''}${match.status === 'LIVE' ? '<button class="finish" data-action="finish">FINALIZAR PARTIDO</button>' : ''}</div></article>`;
}
function renderMatches() {
  const date = document.querySelector('#filter-date').value, court = Number(document.querySelector('#filter-court').value);
  const filtered = matches.filter((match) => (!date || match.date === date) && (!court || match.court === court));
  document.querySelector('#matches').innerHTML = filtered.map(matchCard).join('') || '<p class="empty">No hay partidos en la fase actual.</p>';
}
function initCalendarPage() {
  document.querySelector('#admin-tournament').addEventListener('change', () => loadCalendarPage(selectedTournament()?.id).catch((error) => message(error.message, true)));
  document.querySelector('#groupId').addEventListener('change', () => renderMatchTeams());
  document.querySelectorAll('.filters input').forEach((input) => input.addEventListener('input', renderMatches));
  document.querySelector('#cancel-edit').addEventListener('click', resetMatchForm);
  document.querySelector('#match-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const matchId = document.querySelector('#match-id').value;
    const body = Object.fromEntries(['groupId', 'date', 'jornada', 'court', 'teamAId', 'teamBId', 'lineTeamId'].map((key) => [key, document.querySelector(`#${key}`).value])); body.phaseId = currentPhase.id;
    try { await request(matchId ? `/api/matches/${matchId}` : '/api/matches', { method: matchId ? 'PUT' : 'POST', body: JSON.stringify(body) }); resetMatchForm(); await loadCalendarPage(selectedTournament().id); message('Partido guardado.'); }
    catch (error) { message(error.message, true); }
  });
  document.querySelector('#matches').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const article = button.closest('[data-id]'), match = matches.find(({ id }) => id === Number(article.dataset.id));
    try {
      if (button.dataset.action === 'edit') { for (const key of ['date', 'jornada', 'court']) document.querySelector(`#${key}`).value = match[key]; document.querySelector('#groupId').value = match.groupId; renderMatchTeams(match); document.querySelector('#match-id').value = match.id; document.querySelector('#cancel-edit').hidden = false; return; }
      if (button.dataset.action === 'delete') { if (!confirm(`¿Eliminar ${match.teamA} vs ${match.teamB}?`)) return; await request(`/api/matches/${match.id}`, { method: 'DELETE' }); }
      else if (button.dataset.action === 'score') await request(`/api/matches/${match.id}/score`, { method: 'PATCH', body: JSON.stringify({ team: button.dataset.team, delta: Number(button.dataset.delta) }) });
      else if (button.dataset.action === 'cards') { const body = Object.fromEntries([...article.querySelectorAll('[data-card]')].map((input) => [input.dataset.card, Number(input.value)])); await request(`/api/matches/${match.id}/cards`, { method: 'PATCH', body: JSON.stringify(body) }); }
      else await request(`/api/matches/${match.id}/${button.dataset.action}`, { method: 'POST' });
      await loadCalendarPage(selectedTournament().id);
    } catch (error) { message(error.message, true); }
  });
  new EventSource('/api/events').addEventListener('matches', () => loadCalendarPage(selectedTournament()?.id));
  loadCalendarPage().catch((error) => message(error.message, true));
}

if (page === 'tournaments') initTournamentPage();
if (page === 'teams') initTeamPage();
if (page === 'calendar') initCalendarPage();
