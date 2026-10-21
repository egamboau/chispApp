const page = document.body.dataset.page;
const jornadaLabels = { MORNING: 'Mañana', AFTERNOON: 'Tarde' };
const statusLabels = { SCHEDULED: 'Programado', LIVE: 'En juego', FINISHED: 'Final' };
/** Escapes nullable text for insertion into HTML content or quoted attributes. */
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
/** Builds option markup from item IDs and a label property or formatter. */
const options = (items, label = 'name') => items.map((item) => `<option value="${item.id}">${escapeHtml(typeof label === 'function' ? label(item) : item[label])}</option>`).join('');
/** Formats a phase name with its tournament category for selectors. */
const phaseLabel = (phase) => `${phase.tournamentType === 'FEMALE' ? 'Femenino' : 'Masculino'} · ${phase.name}`;
let tournaments = [], phases = [], groups = [], teams = [], players = [], memberships = [], rules = [], sanctions = [], teamCards = [], matches = [], scoring = [], scoringTables = [];

/** Routes /api paths through /api/admin; returns parsed JSON (null for 204) and throws on HTTP or network failures. Callers serialize request bodies. */
async function request(url, init = {}) {
  const response = await fetch(url.replace(/^\/api(?=\/|$)/, '/api/admin'), { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'No se pudo completar la operación.');
  return response.status === 204 ? null : response.json();
}
/** Shows page feedback; success messages clear after 2.5 seconds, while errors remain visible. */
function message(text, error = false) {
  const target = document.querySelector('#message');
  if (!target) return;
  target.textContent = text; target.className = error ? 'error' : 'success';
  if (!error) setTimeout(() => { target.textContent = ''; }, 2500);
}
/** Rebuilds a selector, chooses the preferred ID or first item, and returns that item (undefined when empty). */
function choose(select, items, preferred, label) {
  select.innerHTML = options(items, label);
  const selected = items.find(({ id }) => id === Number(preferred)) || items[0];
  select.value = selected?.id || '';
  return selected;
}
/** Sets the disabled state of all inputs, selects, and buttons within a form. */
function disable(form, value) { form.querySelectorAll('input,select,button').forEach((control) => { control.disabled = value; }); }
/** Returns the cached tournament selected in the admin selector, or undefined. */
const selectedTournament = () => tournaments.find(({ id }) => id === Number(document.querySelector('#admin-tournament').value));
/** Returns the cached phase selected in the admin selector, or undefined. */
const selectedPhase = () => phases.find(({ id }) => id === Number(document.querySelector('#admin-phase')?.value));

/** Reloads tournaments and returns the preferred selection, falling back to the first tournament. */
async function loadTournaments(preferred) {
  tournaments = await request('/api/tournaments');
  return choose(document.querySelector('#admin-tournament'), tournaments, preferred);
}

/** Loads the selected tournament, phase, groups, and rules, then renders configuration and position previews. */
async function loadTournamentPage(tournamentId, phaseId) {
  const tournament = await loadTournaments(tournamentId);
  phases = tournament ? await request(`/api/tournaments/${tournament.id}/phases`) : [];
  const phase = choose(document.querySelector('#admin-phase'), phases, phaseId ?? tournament?.currentPhaseId, phaseLabel);
  [groups, rules] = phase ? await Promise.all([request(`/api/phases/${phase.id}/groups`), request(`/api/phases/${phase.id}/classification-rules`)]) : [[], []];
  renderTournamentPage();
  await renderPhasePositions(phase);
}
/** Fetches and displays assignment previews and confirmation controls for table phases; clears other phase types. */
async function renderPhasePositions(phase, sourceGroups = groups) {
  const target = document.querySelector('#phase-positions');
  target.innerHTML = '';
  if (phase?.type !== 'TABLE') return;
  const preview = await request(`/api/phases/${phase.id}/positions`);
  const roles = { teamA: 'Local', teamB: 'Visitante', lineTeam: 'Línea' };
  target.innerHTML = `<h3>Cierre y asignación de posiciones</h3><p>${preview.confirmedAt ? `Confirmado: ${escapeHtml(preview.confirmedAt)}` : 'Posiciones sin confirmar.'} Las correcciones no cambian automáticamente los equipos asignados.</p>${preview.errors.map(error => `<p class="error">${escapeHtml(error)}</p>`).join('')}${preview.assignments.map(item => `<div class="config-row"><span>Partido ${item.matchId} · ${roles[item.role]} · ${item.position}.º ${escapeHtml(sourceGroups.find(group => group.id === item.sourceGroupId)?.name)} → <strong>${escapeHtml(item.teamName || 'Sin resolver')}</strong>${item.resolvedTeamId !== null && item.resolvedTeamId !== item.teamId ? ' (cambiaría el equipo asignado)' : ''}</span></div>`).join('')}<button class="primary" data-action="confirm-positions" ${preview.canConfirm ? '' : 'disabled'}>CONFIRMAR Y CONGELAR</button>${preview.confirmedAt ? '<button data-action="reopen-positions">REABRIR ASIGNACIONES</button>' : ''}`;
}
/** Renders cached tournament configuration and enables forms only when their required selections exist. */
function renderTournamentPage() {
  const tournament = selectedTournament(), phase = selectedPhase();
  document.querySelector('#tournament-detail').innerHTML = tournament ? `<div class="config-row"><strong>${escapeHtml(tournament.name)}</strong><span>${tournament.active ? 'Activo' : 'Inactivo'}</span><button data-action="edit-tournament">EDITAR</button><button data-action="toggle-tournament">${tournament.active ? 'DESACTIVAR' : 'ACTIVAR'}</button><button class="danger" data-action="delete-tournament">ELIMINAR</button></div>` : '<p class="empty">Crea un torneo para comenzar.</p>';
  document.querySelector('#phase-detail').innerHTML = phase ? `<div class="config-row"><strong>${escapeHtml(phase.name)}</strong><span>${phase.tournamentType === 'FEMALE' ? 'Femenino' : 'Masculino'} · ${phase.type === 'TABLE' ? 'Tabla' : 'Eliminatoria'}</span>${tournament.currentPhaseId === phase.id ? '<span>Fase actual</span>' : '<button data-action="current-phase">HACER ACTUAL</button>'}<button data-action="edit-phase">EDITAR</button><button class="danger" data-action="delete-phase">ELIMINAR</button></div>` : '<p class="empty">Este torneo no tiene fases.</p>';
  document.querySelector('#groups').innerHTML = groups.map((group) => `<div class="config-row"><span>${escapeHtml(group.name)}</span><button data-action="edit-group" data-id="${group.id}">EDITAR</button><button class="danger" data-action="delete-group" data-id="${group.id}">ELIMINAR</button></div>`).join('') || '<p class="empty">Esta fase no tiene grupos.</p>';
  document.querySelector('#rules').innerHTML = rules.map((rule) => `<div class="config-row"><span>${rule.positions.join(', ')}: <strong>${escapeHtml(rule.label)}</strong></span><button data-action="edit-rule" data-id="${rule.id}">EDITAR</button><button class="danger" data-action="delete-rule" data-id="${rule.id}">ELIMINAR</button></div>`).join('') || '<p class="empty">Sin reglas configuradas.</p>';
  disable(document.querySelector('#phase-form'), !tournament);
  disable(document.querySelector('#group-form'), !phase);
  disable(document.querySelector('#rule-form'), !phase || phase.type !== 'TABLE');
}
/** Binds tournament, phase, group, rule, and position-assignment actions, then loads the configuration page. */
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
      const created = await request(`/api/tournaments/${tournament.id}/phases`, { method: 'POST', body: JSON.stringify({ name: document.querySelector('#phase-name').value, type: document.querySelector('#phase-type').value, tournamentType: document.querySelector('#phase-tournament-type').value, sortOrder: phases.length + 1 }) });
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
      const body = { positions: document.querySelector('#rule-positions').value.split(',').map(Number), label: document.querySelector('#rule-label').value };
      await request(`/api/phases/${phase.id}/classification-rules`, { method: 'POST', body: JSON.stringify(body) }); event.target.reset(); await loadTournamentPage(selectedTournament().id, phase.id); message('Regla creada.');
    } catch (error) { message(error.message, true); }
  });
  document.querySelector('#admin-tournament').addEventListener('change', () => loadTournamentPage(selectedTournament()?.id).catch((error) => message(error.message, true)));
  document.querySelector('#admin-phase').addEventListener('change', () => loadTournamentPage(selectedTournament()?.id, selectedPhase()?.id).catch((error) => message(error.message, true)));
  document.querySelector('main').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const action = button.dataset.action, tournament = selectedTournament(), phase = selectedPhase();
    try {
      if (action === 'confirm-positions') {
        if (!confirm('¿Confirmar la clasificación y congelar los equipos previsualizados?')) return;
        await request(`/api/phases/${phase.id}/positions/confirm`, { method: 'POST' });
      }
      if (action === 'reopen-positions') {
        if (!confirm('¿Reabrir para revisar y reconfirmar? Los equipos asignados se conservan y los partidos pendientes no podrán iniciar hasta reconfirmar. Los iniciados o terminados no podrán cambiar de equipo.')) return;
        await request(`/api/phases/${phase.id}/positions/reopen`, { method: 'POST' });
      }
      if (action === 'edit-tournament') { const name = prompt('Nombre del torneo', tournament.name); if (!name) return; await request(`/api/tournaments/${tournament.id}`, { method: 'PUT', body: JSON.stringify({ name, active: Boolean(tournament.active), currentPhaseId: tournament.currentPhaseId }) }); }
      if (action === 'toggle-tournament') await request(`/api/tournaments/${tournament.id}`, { method: 'PUT', body: JSON.stringify({ name: tournament.name, active: !tournament.active, currentPhaseId: tournament.currentPhaseId }) });
      if (action === 'delete-tournament') { if (!confirm('¿Eliminar este torneo?')) return; await request(`/api/tournaments/${tournament.id}`, { method: 'DELETE' }); }
      if (action === 'current-phase') await request(`/api/tournaments/${tournament.id}`, { method: 'PUT', body: JSON.stringify({ name: tournament.name, active: Boolean(tournament.active), currentPhaseId: phase.id }) });
      if (action === 'edit-phase') { const name = prompt('Nombre de la fase', phase.name), type = prompt('Tipo: TABLE o ELIMINATION', phase.type), tournamentType = prompt('Categoría: MALE o FEMALE', phase.tournamentType); if (!name || !['TABLE', 'ELIMINATION'].includes(type) || !['MALE', 'FEMALE'].includes(tournamentType)) return; await request(`/api/phases/${phase.id}`, { method: 'PUT', body: JSON.stringify({ name, type, tournamentType, sortOrder: phase.sortOrder }) }); }
      if (action === 'delete-phase') { if (!confirm('¿Eliminar esta fase?')) return; await request(`/api/phases/${phase.id}`, { method: 'DELETE' }); }
      if (action === 'edit-group') { const group = groups.find(({ id }) => id === Number(button.dataset.id)), name = prompt('Nombre del grupo', group.name); if (!name) return; await request(`/api/groups/${group.id}`, { method: 'PUT', body: JSON.stringify({ name }) }); }
      if (action === 'delete-group') { if (!confirm('¿Eliminar este grupo?')) return; await request(`/api/groups/${button.dataset.id}`, { method: 'DELETE' }); }
      if (action === 'edit-rule') { const rule = rules.find(({ id }) => id === Number(button.dataset.id)), positions = prompt('Posiciones separadas por coma', rule.positions.join(', ')), label = prompt('Destino', rule.label); if (!positions || !label) return; await request(`/api/phases/${phase.id}/classification-rules/${rule.id}`, { method: 'PUT', body: JSON.stringify({ positions: positions.split(',').map(Number), label }) }); }
      if (action === 'delete-rule') await request(`/api/phases/${phase.id}/classification-rules/${button.dataset.id}`, { method: 'DELETE' });
      await loadTournamentPage(action === 'delete-tournament' ? undefined : tournament?.id, action === 'delete-phase' ? undefined : phase?.id); message('Cambio guardado.');
    } catch (error) { message(error.message, true); }
  });
  loadTournamentPage().catch((error) => message(error.message, true));
}

/** Loads tournament teams, phase memberships, sanctions, cards, and the selected team roster before rendering. */
async function loadTeamPage(tournamentId, phaseId, playerTeamId) {
  const tournament = await loadTournaments(tournamentId);
  phases = tournament ? await request(`/api/tournaments/${tournament.id}/phases`) : [];
  const phase = choose(document.querySelector('#admin-phase'), phases, phaseId ?? tournament?.currentPhaseId, phaseLabel);
  teams = tournament ? await request(`/api/teams?tournamentId=${tournament.id}`) : [];
  [groups, memberships, sanctions, teamCards] = phase ? await Promise.all([request(`/api/phases/${phase.id}/groups`), request(`/api/phases/${phase.id}/memberships`), request(`/api/phases/${phase.id}/sanctions`), request(`/api/phases/${phase.id}/team-cards`)]) : [[], [], [], []];
  const playerTeam = choose(document.querySelector('#player-team'), teams, playerTeamId);
  players = playerTeam ? await request(`/api/teams/${playerTeam.id}/players`) : [];
  renderTeamPage();
}
/** Renders the cached roster, including registration status, and disables entry when no team is selected. */
function renderPlayers() {
  document.querySelector('#players').innerHTML = players.map((player) => `<div class="config-row player-row ${player.status === 'UNREGISTERED' ? 'unregistered' : ''}"><span><strong>${escapeHtml(player.displayName)}</strong><small>Número ${escapeHtml(player.number)} · ${player.status === 'REGISTERED' ? 'Inscrito' : 'Desinscrito'}</small></span><button data-action="edit-player" data-id="${player.id}">EDITAR</button><button data-action="toggle-player" data-id="${player.id}">${player.status === 'REGISTERED' ? 'DESINSCRIBIR' : 'REINSCRIBIR'}</button></div>`).join('') || '<p class="empty">Este equipo no tiene jugadores.</p>';
  disable(document.querySelector('#player-form'), !document.querySelector('#player-team').value);
}
/** Renders teams and phase assignments, sanctions, cards, and players, updating available form choices. */
function renderTeamPage() {
  const tournament = selectedTournament(), phase = selectedPhase(), memberIds = new Set(memberships.map(({ teamId }) => teamId));
  document.querySelector('#phase-help').textContent = !phase ? 'El torneo no tiene fases.' : groups.length ? `Asignando equipos a ${phase.name}.` : `${phase.name} no tiene grupos; crea uno en la página Torneos para asignar equipos.`;
  document.querySelector('#new-team-group').innerHTML = `<option value="">Sin asignar</option>${options(groups)}`;
  const available = teams.filter(({ id }) => !memberIds.has(id));
  document.querySelector('#membership-team').innerHTML = options(available);
  document.querySelector('#membership-group').innerHTML = options(groups);
  document.querySelector('#sanction-team').innerHTML = options(teams.filter(({ id }) => memberIds.has(id)));
  document.querySelector('#team-cards-team').innerHTML = options(teams.filter(({ id }) => memberIds.has(id)));
  document.querySelector('#teams').innerHTML = teams.map((team) => {
    const membership = memberships.find(({ teamId }) => teamId === team.id);
    return `<div class="config-row"><span><strong>${escapeHtml(team.name)}</strong><small>${membership ? `Grupo ${escapeHtml(membership.groupName)}` : phase ? 'Sin grupo en esta fase' : 'En el torneo'}</small></span><button data-action="edit-team" data-id="${team.id}">EDITAR</button>${membership ? `<button data-action="remove-membership" data-id="${team.id}">QUITAR DE FASE</button>` : ''}<button class="danger" data-action="delete-team" data-id="${team.id}">ELIMINAR</button></div>`;
  }).join('') || '<p class="empty">Este torneo no tiene equipos.</p>';
  document.querySelector('#sanctions').innerHTML = sanctions.map((item) => `<div class="config-row"><span><strong>${escapeHtml(item.teamName)}</strong>: ${escapeHtml(item.reason)}</span><button class="danger" data-action="delete-sanction" data-id="${item.teamId}">QUITAR</button></div>`).join('') || '<p class="empty">Sin sanciones.</p>';
  document.querySelector('#team-cards').innerHTML = teamCards.map((item) => `<div class="config-row"><span><strong>${escapeHtml(item.teamName)}</strong>: ${item.yellowCards} 🟨 · ${item.redCards} 🟥</span><button data-action="edit-team-cards" data-id="${item.teamId}">EDITAR</button><button class="danger" data-action="delete-team-cards" data-id="${item.teamId}">ELIMINAR</button></div>`).join('') || '<p class="empty">Sin tarjetas fuera de partido.</p>';
  renderPlayers();
  disable(document.querySelector('#team-form'), !tournament);
  disable(document.querySelector('#membership-form'), !phase || !groups.length || !available.length);
  disable(document.querySelector('#sanction-form'), !memberships.length);
  disable(document.querySelector('#team-cards-form'), !memberships.length);
}
/** Binds team, membership, player, sanction, and card actions, then loads the team page. */
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
  document.querySelector('#team-cards-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const phase = selectedPhase(), teamId = document.querySelector('#team-cards-team').value;
    try { await request(`/api/phases/${phase.id}/teams/${teamId}/cards`, { method: 'PUT', body: JSON.stringify({ yellowCards: document.querySelector('#team-yellow-cards').value, redCards: document.querySelector('#team-red-cards').value }) }); event.target.reset(); await loadTeamPage(selectedTournament().id, phase.id); message('Tarjetas guardadas.'); }
    catch (error) { message(error.message, true); }
  });
  document.querySelector('#player-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const teamId = document.querySelector('#player-team').value;
    try {
      await request(`/api/teams/${teamId}/players`, { method: 'POST', body: JSON.stringify({ number: document.querySelector('#player-number').value, name: document.querySelector('#player-name').value }) });
      event.target.reset(); players = await request(`/api/teams/${teamId}/players`); renderPlayers(); message('Jugador agregado.');
    } catch (error) { message(error.message, true); }
  });
  document.querySelector('#admin-tournament').addEventListener('change', () => loadTeamPage(selectedTournament()?.id).catch((error) => message(error.message, true)));
  document.querySelector('#admin-phase').addEventListener('change', () => loadTeamPage(selectedTournament()?.id, selectedPhase()?.id).catch((error) => message(error.message, true)));
  document.querySelector('#player-team').addEventListener('change', async (event) => {
    try { players = await request(`/api/teams/${event.target.value}/players`); renderPlayers(); }
    catch (error) { message(error.message, true); }
  });
  document.querySelector('#teams').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const team = teams.find(({ id }) => id === Number(button.dataset.id)), phase = selectedPhase();
    try {
      if (button.dataset.action === 'edit-team') { const name = prompt('Nombre del equipo', team.name); if (!name) return; await request(`/api/teams/${team.id}`, { method: 'PUT', body: JSON.stringify({ name }) }); }
      if (button.dataset.action === 'remove-membership') { if (!confirm(`¿Quitar a ${team.name} de esta fase?`)) return; await request(`/api/phases/${phase.id}/memberships/${team.id}`, { method: 'DELETE' }); }
      if (button.dataset.action === 'delete-team') { if (!confirm(`¿Eliminar a ${team.name} del torneo?`)) return; await request(`/api/teams/${team.id}`, { method: 'DELETE' }); }
      await loadTeamPage(selectedTournament().id, phase?.id, document.querySelector('#player-team').value); message('Cambio guardado.');
    } catch (error) { message(error.message, true); }
  });
  document.querySelector('#players').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const player = players.find(({ id }) => id === Number(button.dataset.id)), teamId = document.querySelector('#player-team').value;
    try {
      if (button.dataset.action === 'edit-player') {
        const number = prompt('Número del jugador', player.number), name = prompt('Nombre opcional', player.name || '');
        if (number === null || name === null) return;
        await request(`/api/players/${player.id}`, { method: 'PUT', body: JSON.stringify({ number, name }) });
      }
      if (button.dataset.action === 'toggle-player') await request(`/api/players/${player.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: player.status === 'REGISTERED' ? 'UNREGISTERED' : 'REGISTERED' }) });
      players = await request(`/api/teams/${teamId}/players`); renderPlayers(); message('Jugador actualizado.');
    } catch (error) { message(error.message, true); }
  });
  document.querySelector('#sanctions').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action="delete-sanction"]'); if (!button) return;
    try { await request(`/api/phases/${selectedPhase().id}/teams/${button.dataset.id}/sanction`, { method: 'DELETE' }); await loadTeamPage(selectedTournament().id, selectedPhase().id); message('Sanción eliminada.'); }
    catch (error) { message(error.message, true); }
  });
  document.querySelector('#team-cards').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const item = teamCards.find(({ teamId }) => teamId === Number(button.dataset.id));
    try {
      if (button.dataset.action === 'edit-team-cards') { document.querySelector('#team-cards-team').value = item.teamId; document.querySelector('#team-yellow-cards').value = item.yellowCards; document.querySelector('#team-red-cards').value = item.redCards; return; }
      if (button.dataset.action === 'delete-team-cards') await request(`/api/phases/${selectedPhase().id}/teams/${item.teamId}/cards`, { method: 'DELETE' });
      await loadTeamPage(selectedTournament().id, selectedPhase().id); message('Tarjetas eliminadas.');
    } catch (error) { message(error.message, true); }
  });
  loadTeamPage().catch((error) => message(error.message, true));
}

let currentPhase, sourceGroups = {};
const participantRoles = { teamA: 'Local', teamB: 'Visitante', lineTeam: 'Línea' };
/** Returns earlier table phases in the current category that can supply group-position references. */
const sourcePhases = () => phases.filter(phase => phase.type === 'TABLE' && phase.sortOrder < currentPhase?.sortOrder && phase.tournamentType === currentPhase?.tournamentType);
/** Loads calendar data and source groups, resets the match form, and refreshes matches and assignment previews. */
async function loadCalendarPage(tournamentId, phaseId) {
  const tournament = await loadTournaments(tournamentId);
  phases = tournament ? await request(`/api/tournaments/${tournament.id}/phases`) : [];
  currentPhase = choose(document.querySelector('#admin-phase'), phases, phaseId ?? tournament?.currentPhaseId, phaseLabel);
  teams = tournament ? await request(`/api/teams?tournamentId=${tournament.id}`) : [];
  [groups, memberships, matches] = currentPhase ? await Promise.all([request(`/api/phases/${currentPhase.id}/groups`), request(`/api/phases/${currentPhase.id}/memberships`), request(`/api/matches?phaseId=${currentPhase.id}`)]) : [[], [], []];
  sourceGroups = Object.fromEntries(await Promise.all(sourcePhases().map(async phase => [phase.id, await request(`/api/phases/${phase.id}/groups`)])));
  document.querySelector('#groupId').innerHTML = options(groups);
  resetMatchForm(); renderMatches();
  choose(document.querySelector('#positions-phase'), sourcePhases());
  await previewCalendarPositions();
  disable(document.querySelector('#match-form'), !currentPhase || !groups.length);
}
/** Populates team choices: home teams belong to the selected group, visitors to the phase, and line teams to the tournament. */
function renderMatchTeams(values = {}) {
  const groupId = Number(document.querySelector('#groupId').value), memberIds = memberships.map(item => item.teamId);
  for (const role of Object.keys(participantRoles)) {
    const select = document.querySelector(`#${role}Id`), selected = values[`${role}Id`] ?? select.value;
    const allowed = role === 'teamA' ? memberships.filter(item => item.groupId === groupId).map(item => item.teamId) : memberIds;
    select.innerHTML = `<option value="">${role === 'lineTeam' ? 'Sin asignar' : 'Seleccione'}</option>${options(teams.filter(team => role === 'lineTeam' || allowed.includes(team.id)))}`;
    select.value = selected ?? '';
  }
}
/** Populates a participant reference group selector from its source phase, preferring the supplied group ID. */
function renderParticipantGroups(role, preferred) {
  const phaseId = document.querySelector(`#${role}-phase`).value;
  choose(document.querySelector(`#${role}-group`), sourceGroups[phaseId] || [], preferred);
}
/** Shows the fields for a participant reference kind and updates their required state. */
function toggleParticipant(role) {
  const kind = document.querySelector(`#${role}-kind`).value, position = kind === 'GROUP_POSITION';
  document.querySelector(`#${role}-fixed`).hidden = kind !== 'TEAM';
  document.querySelector(`#${role}-position-fields`).hidden = !position;
  document.querySelector(`#${role}Id`).required = kind === 'TEAM' && role !== 'lineTeam';
  for (const field of ['phase', 'group', 'position']) document.querySelector(`#${role}-${field}`).required = position;
}
/** Builds participant editors from a match, preserves existing winner references, and warns about confirmed assignments. */
function renderParticipantFields(match = {}) {
  document.querySelector('#match-participants').innerHTML = Object.entries(participantRoles).map(([role, label]) => `<fieldset><legend>${label}</legend><label>Asignación<select id="${role}-kind"><option value="TEAM">Equipo fijo</option><option value="GROUP_POSITION">Posición de grupo/fase</option></select></label><label id="${role}-fixed">Equipo<select id="${role}Id"></select></label><div id="${role}-position-fields"><label>Fase origen<select id="${role}-phase">${options(sourcePhases(), phaseLabel)}</select></label><label>Grupo origen<select id="${role}-group"></select></label><label>Posición<input id="${role}-position" type="number" min="1" step="1" value="1"></label></div></fieldset>`).join('');
  renderMatchTeams(match);
  for (const role of Object.keys(participantRoles)) {
    const reference = match.participants?.[role]?.reference;
    // Preserve winner references created through the API when editing the schedule.
    if (reference?.kind === 'MATCH_WINNER') document.querySelector(`#${role}-kind`).innerHTML += '<option value="MATCH_WINNER">Ganador de partido (conservar)</option>';
    document.querySelector(`#${role}-kind`).value = reference?.kind || 'TEAM';
    if (reference?.kind === 'GROUP_POSITION') {
      document.querySelector(`#${role}-phase`).value = reference.sourcePhaseId;
      document.querySelector(`#${role}-position`).value = reference.position;
    }
    renderParticipantGroups(role, reference?.sourceGroupId);
    toggleParticipant(role);
    document.querySelector(`#${role}-kind`).addEventListener('change', () => toggleParticipant(role));
    document.querySelector(`#${role}-phase`).addEventListener('change', () => renderParticipantGroups(role));
  }
  const warning = document.querySelector('#assignment-warning');
  warning.hidden = !Object.values(match.participants || {}).some(item => item?.reference?.kind !== 'TEAM' && item?.status === 'CONFIRMED');
  warning.textContent = 'Asignaciones confirmadas: cambiar una referencia requiere revisar y confirmar otra vez la fase origen.';
}
/** Reads participant references from the form, retaining the original reference for existing match-winner assignments. */
function matchParticipants() {
  const editing = matches.find(match => match.id === Number(document.querySelector('#match-id').value));
  return Object.fromEntries(Object.keys(participantRoles).map(role => {
    const kind = document.querySelector(`#${role}-kind`).value;
    if (role === 'lineTeam' && kind === 'TEAM' && !document.querySelector('#lineTeamId').value) return [role, null];
    return [role, kind === 'GROUP_POSITION' ? { kind, sourcePhaseId: Number(document.querySelector(`#${role}-phase`).value), sourceGroupId: Number(document.querySelector(`#${role}-group`).value), position: Number(document.querySelector(`#${role}-position`).value) } : kind === 'MATCH_WINNER' ? editing.participants[role].reference : { kind, teamId: Number(document.querySelector(`#${role}Id`).value) }];
  }));
}
/** Renders position assignments for the selected source phase using its cached groups. */
async function previewCalendarPositions() {
  const phase = phases.find(phase => phase.id === Number(document.querySelector('#positions-phase').value));
  await renderPhasePositions(phase, sourceGroups[phase?.id] || []);
}
/** Clears match editing state and rebuilds group and participant fields for a new match. */
function resetMatchForm() {
  document.querySelector('#match-form').reset(); document.querySelector('#match-id').value = ''; document.querySelector('#cancel-edit').hidden = true;
  document.querySelector('#groupId').innerHTML = options(groups); renderParticipantFields();
}
/** Builds an admin match card with score controls and actions appropriate to its status. */
function matchCard(match) {
  const score = match.status === 'LIVE' ? `<div class="score-controls">${['A', 'B'].map((side) => `<div><strong>${escapeHtml(match[`team${side}`])}</strong><span><button data-action="score" data-team="${side}" data-delta="-1" ${match[`score${side}`] === 0 ? 'disabled' : ''}>−</button><b>${match[`score${side}`]}</b><button data-action="score" data-team="${side}" data-delta="1">+</button></span></div>`).join('')}</div>` : match.status === 'FINISHED' ? `<div class="score-controls final-score">${['A', 'B'].map((side) => `<label><strong>${escapeHtml(match[`team${side}`])}</strong><input data-result="score${side}" type="number" min="0" step="1" value="${match[`score${side}`]}"></label>`).join('')}</div>` : `<h3>${escapeHtml(match.teamA)} <small>vs</small> ${escapeHtml(match.teamB)}</h3>`;
  return `<article class="match-card ${match.tournamentType.toLowerCase()}" data-id="${match.id}"><div class="meta"><span class="badge">${match.tournamentType === 'FEMALE' ? 'Femenino' : 'Masculino'}</span><strong>${escapeHtml(match.phaseName)} · ${escapeHtml(match.groupName)} · Cancha ${match.court}</strong><span>${match.date} · ${jornadaLabels[match.jornada]} · Orden ${match.sortOrder ?? 'sin definir'}</span><span class="status ${match.status.toLowerCase()}">${statusLabels[match.status]}</span></div>${score}${match.status !== 'SCHEDULED' ? '<p>Partido iniciado o terminado: las asignaciones de participantes están bloqueadas.</p>' : ''}<p>Línea: <strong>${escapeHtml(match.lineTeam || 'Sin asignar')}</strong></p><div class="cards"><label>${escapeHtml(match.teamA)} 🟨<input data-card="yellowCardsA" type="number" min="0" value="${match.yellowCardsA}"></label><label>🟥<input data-card="redCardsA" type="number" min="0" value="${match.redCardsA}"></label><label>${escapeHtml(match.teamB)} 🟨<input data-card="yellowCardsB" type="number" min="0" value="${match.yellowCardsB}"></label><label>🟥<input data-card="redCardsB" type="number" min="0" value="${match.redCardsB}"></label><button data-action="cards">GUARDAR TARJETAS</button></div><div class="actions"><button data-action="order">EDITAR ORDEN</button>${match.status === 'SCHEDULED' ? '<button data-action="edit">EDITAR</button><button class="danger" data-action="delete">ELIMINAR</button><button class="primary" data-action="start">INICIAR</button>' : ''}${match.status === 'LIVE' ? '<button class="danger" data-action="reset">REINICIAR MARCADOR</button><button class="finish" data-action="finish">FINALIZAR PARTIDO</button>' : ''}${match.status === 'FINISHED' ? `<button data-action="result">GUARDAR RESULTADO</button><button class="primary" data-action="reopen">REABRIR PARTIDO</button><a class="primary" href="/admin/scoring.html?matchId=${match.id}">ADMINISTRAR GOLEO</a>` : ''}</div></article>`;
}
/** Renders cached matches filtered by date and court, and updates the selected date’s line-publication control. */
function renderMatches() {
  const date = document.querySelector('#filter-date').value, court = Number(document.querySelector('#filter-court').value);
  const filtered = matches.filter((match) => (!date || match.date === date) && (!court || match.court === court));
  document.querySelector('#matches').innerHTML = filtered.map(matchCard).join('') || '<p class="empty">No hay partidos en la fase seleccionada.</p>';
  const dateMatches = matches.filter((match) => match.date === date), visibility = document.querySelector('#line-visibility'), visible = dateMatches.some((match) => match.lineVisible);
  visibility.disabled = !date || !dateMatches.length; visibility.textContent = !date ? 'SELECCIONA FECHA' : visible ? 'OCULTAR LÍNEAS' : 'PUBLICAR LÍNEAS'; visibility.className = visible ? 'danger' : 'primary';
}
/** Binds scheduling, assignment, scoring, card, and match lifecycle actions, subscribes to updates, and loads the calendar. */
function initCalendarPage() {
  document.querySelector('#admin-tournament').addEventListener('change', () => loadCalendarPage(selectedTournament()?.id).catch((error) => message(error.message, true)));
  document.querySelector('#preview-positions').addEventListener('click', () => previewCalendarPositions().catch(error => message(error.message, true)));
  document.querySelector('#positions-phase').addEventListener('change', () => previewCalendarPositions().catch(error => message(error.message, true)));
  document.querySelector('#phase-positions').addEventListener('click', async event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!['confirm-positions', 'reopen-positions'].includes(action)) return;
    const phaseId = document.querySelector('#positions-phase').value;
    if (!confirm(action === 'confirm-positions' ? '¿Confirmar y congelar los equipos previsualizados?' : '¿Reabrir asignaciones? Los equipos se conservan; los partidos iniciados o terminados no pueden cambiar de equipo.')) return;
    try { await request(`/api/phases/${phaseId}/positions/${action === 'confirm-positions' ? 'confirm' : 'reopen'}`, { method: 'POST' }); await previewCalendarPositions(); matches = await request(`/api/matches?phaseId=${currentPhase.id}`); renderMatches(); } catch (error) { message(error.message, true); }
  });
  document.querySelector('#groupId').addEventListener('change', () => renderMatchTeams());
  document.querySelector('#admin-phase').addEventListener('change', () => loadCalendarPage(selectedTournament()?.id, selectedPhase()?.id).catch((error) => message(error.message, true)));
  document.querySelectorAll('.filters input').forEach((input) => input.addEventListener('input', renderMatches));
  document.querySelector('#cancel-edit').addEventListener('click', resetMatchForm);
  document.querySelector('#line-visibility').addEventListener('click', async () => { const date = document.querySelector('#filter-date').value, visible = matches.some((match) => match.date === date && match.lineVisible); try { await request(`/api/line-visibility/${date}`, { method: 'PUT', body: JSON.stringify({ visible: !visible }) }); await loadCalendarPage(selectedTournament().id, currentPhase.id); document.querySelector('#filter-date').value = date; renderMatches(); message(`Líneas ${visible ? 'ocultadas' : 'publicadas'}.`); } catch (error) { message(error.message, true); } });
  document.querySelector('#match-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const matchId = document.querySelector('#match-id').value;
    const body = Object.fromEntries(['groupId', 'date', 'jornada', 'court', 'sortOrder'].map((key) => [key, document.querySelector(`#${key}`).value])); body.phaseId = currentPhase.id; body.participants = matchParticipants();
    if (matchId && !document.querySelector('#assignment-warning').hidden && !confirm('¿Guardar los cambios de este partido con asignaciones confirmadas? Revisa después la resolución de la fase origen.')) return;
    try { await request(matchId ? `/api/matches/${matchId}` : '/api/matches', { method: matchId ? 'PUT' : 'POST', body: JSON.stringify(body) }); resetMatchForm(); await loadCalendarPage(selectedTournament().id, currentPhase.id); message('Partido guardado.'); }
    catch (error) { message(error.message, true); }
  });
  document.querySelector('#matches').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const article = button.closest('[data-id]'), match = matches.find(({ id }) => id === Number(article.dataset.id));
    try {
      if (button.dataset.action === 'edit') { for (const key of ['date', 'jornada', 'court', 'sortOrder']) document.querySelector(`#${key}`).value = match[key] ?? ''; document.querySelector('#groupId').value = match.groupId; renderParticipantFields(match); document.querySelector('#match-id').value = match.id; document.querySelector('#cancel-edit').hidden = false; return; }
      if (button.dataset.action === 'order') { const value = prompt('Orden oficial (vacío para dejarlo sin definir)', match.sortOrder ?? ''); if (value === null) return; await request(`/api/matches/${match.id}/order`, { method: 'PATCH', body: JSON.stringify({ sortOrder: value.trim() || null }) }); }
      else if (button.dataset.action === 'delete') { if (!confirm(`¿Eliminar ${match.teamA} vs ${match.teamB}?`)) return; await request(`/api/matches/${match.id}`, { method: 'DELETE' }); }
      else if (button.dataset.action === 'score') await request(`/api/matches/${match.id}/score`, { method: 'PATCH', body: JSON.stringify({ team: button.dataset.team, delta: Number(button.dataset.delta) }) });
      else if (button.dataset.action === 'result') { if (!confirm('¿Guardar la corrección del resultado final?')) return; const body = Object.fromEntries([...article.querySelectorAll('[data-result]')].map((input) => [input.dataset.result, Number(input.value)])); await request(`/api/matches/${match.id}/result`, { method: 'PATCH', body: JSON.stringify(body) }); }
      else if (button.dataset.action === 'reopen') { if (!confirm('¿Reabrir este partido conservando el marcador?')) return; await request(`/api/matches/${match.id}/reopen`, { method: 'POST' }); }
      else if (button.dataset.action === 'reset') { if (!confirm('¿Reiniciar el marcador a 0–0?')) return; await request(`/api/matches/${match.id}/reset`, { method: 'POST' }); }
      else if (button.dataset.action === 'cards') { const body = Object.fromEntries([...article.querySelectorAll('[data-card]')].map((input) => [input.dataset.card, Number(input.value)])); await request(`/api/matches/${match.id}/cards`, { method: 'PATCH', body: JSON.stringify(body) }); }
      else await request(`/api/matches/${match.id}/${button.dataset.action}`, { method: 'POST' });
      await loadCalendarPage(selectedTournament().id, currentPhase.id);
    } catch (error) { message(error.message, true); }
  });
  new EventSource('/api/events').addEventListener('matches', () => loadCalendarPage(selectedTournament()?.id, currentPhase?.id));
  loadCalendarPage().catch((error) => message(error.message, true));
}

/** Returns the cached match selected for scoring, or undefined. */
const selectedScoringMatch = () => matches.find(({ id }) => id === Number(document.querySelector('#scoring-match').value));
/** Formats a finished match with its date, jornada, court, teams, and result for the scoring selector. */
const scoringMatchLabel = (match) => `${match.date} · ${jornadaLabels[match.jornada]} · Cancha ${match.court} · ${match.teamA} ${match.scoreA}–${match.scoreB} ${match.teamB}`;

/** Loads finished matches and scoring tables for the selected phase, then loads the preferred match’s scoring details. */
async function loadScoringPage(tournamentId, phaseId, matchId) {
  const tournament = await loadTournaments(tournamentId);
  phases = tournament ? await request(`/api/tournaments/${tournament.id}/phases`) : [];
  const phase = choose(document.querySelector('#admin-phase'), phases, phaseId ?? tournament?.currentPhaseId, phaseLabel);
  if (phase) {
    const [phaseMatches, phaseScoring] = await Promise.all([request(`/api/matches?phaseId=${phase.id}&status=FINISHED`), request(`/api/phases/${phase.id}/scoring`)]);
    matches = phaseMatches; scoringTables = phaseScoring.tables;
  } else { matches = []; scoringTables = []; }
  const match = choose(document.querySelector('#scoring-match'), matches, matchId, scoringMatchLabel);
  await loadScoringDetails(match?.id);
}

/** Loads both rosters and scoring for a match, updates its URL, and renders; clears details when no match is found. */
async function loadScoringDetails(matchId) {
  const match = matches.find(({ id }) => id === Number(matchId));
  if (match) {
    const [teamAPlayers, teamBPlayers, matchScoring] = await Promise.all([
      request(`/api/teams/${match.teamAId}/players`), request(`/api/teams/${match.teamBId}/players`), request(`/api/matches/${match.id}/scoring`),
    ]);
    players = [...teamAPlayers, ...teamBPlayers]; scoring = matchScoring;
    history.replaceState(null, '', `/admin/scoring.html?matchId=${match.id}`);
  } else {
    players = []; scoring = [];
    history.replaceState(null, '', '/admin/scoring.html');
  }
  renderScoringPage();
}

/** Offers registered players plus players with existing scoring on the selected team; disables submission when empty. */
function renderScoringPlayerOptions(preferred) {
  const teamId = Number(document.querySelector('#scoring-team').value);
  const available = players.filter((player) => player.teamId === teamId && (player.status === 'REGISTERED' || scoring.some((item) => item.playerId === player.id)));
  choose(document.querySelector('#scoring-player'), available, preferred, (player) => `#${player.number} · ${player.name || 'Sin nombre'}`);
  document.querySelector('#scoring-form button[type="submit"]').disabled = !available.length;
}

/** Loads the selected player’s existing scoring or new-entry defaults and refreshes the weighted total. */
function populateScoringForm() {
  const item = scoring.find(({ playerId }) => playerId === Number(document.querySelector('#scoring-player').value));
  document.querySelector('#scoring-player-id').value = item?.playerId || '';
  document.querySelector('#scoringTable').value = item?.scoringTable || 'Torneo Regular';
  for (const key of ['directGoals', 'pepitas', 'horquetas']) document.querySelector(`#${key}`).value = item?.[key] || 0;
  document.querySelector('#scoring-form button[type="submit"]').textContent = item ? 'GUARDAR CAMBIOS' : 'GUARDAR GOLEO';
  document.querySelector('#cancel-scoring-edit').hidden = !item; updateScoringTotal();
}

/** Displays direct goals plus twice the pepitas and three times the horquetas entered in the form. */
function updateScoringTotal() {
  const value = Number(document.querySelector('#directGoals').value) + Number(document.querySelector('#pepitas').value) * 2 + Number(document.querySelector('#horquetas').value) * 3;
  document.querySelector('#scoring-total').textContent = value;
}

/** Resets scoring controls, selects the preferred entry’s team/player when available, and populates that player’s values. */
function resetScoringForm(preferred = scoring[0]) {
  const form = document.querySelector('#scoring-form');
  form.reset(); document.querySelector('#scoring-player-id').value = '';
  document.querySelector('#scoring-team').disabled = false; document.querySelector('#scoring-player').disabled = false;
  form.querySelector('button[type="submit"]').textContent = 'GUARDAR GOLEO'; document.querySelector('#cancel-scoring-edit').hidden = true;
  if (preferred) document.querySelector('#scoring-team').value = preferred.teamId;
  renderScoringPlayerOptions(preferred?.playerId); populateScoringForm();
}

/** Renders match details, scoring table controls, and per-team entries, then resets the scoring form. */
function renderScoringPage() {
  const match = selectedScoringMatch(), detail = document.querySelector('#scoring-match-detail'), list = document.querySelector('#scoring-list'), teamSelect = document.querySelector('#scoring-team');
  detail.innerHTML = match ? `<article class="match-summary"><p>${escapeHtml(match.date)} · ${jornadaLabels[match.jornada]} · Cancha ${match.court}</p><h3>${escapeHtml(match.teamA)} <strong>${match.scoreA}–${match.scoreB}</strong> ${escapeHtml(match.teamB)}</h3></article>` : '<p class="empty">No hay partidos finalizados en esta fase.</p>';
  document.querySelector('#scoring-table-options').innerHTML = scoringTables.map(({ name }) => `<option value="${escapeHtml(name)}"></option>`).join('');
  const managed = document.querySelector('#scoring-table-manage');
  const previousTable = Number(managed.value); managed.innerHTML = options(scoringTables);
  managed.value = scoringTables.some(({ id }) => id === previousTable) ? previousTable : scoringTables[0]?.id || '';
  document.querySelector('#scoring-table-name').value = scoringTables.find(({ id }) => id === Number(managed.value))?.name || '';
  teamSelect.innerHTML = match ? options([{ id: match.teamAId, name: match.teamA }, { id: match.teamBId, name: match.teamB }]) : '';
  disable(document.querySelector('#scoring-form'), !match);
  resetScoringForm();
  if (!match) disable(document.querySelector('#scoring-form'), true);
  list.innerHTML = match ? [[match.teamAId, match.teamA], [match.teamBId, match.teamB]].map(([teamId, teamName]) => {
    const rows = scoring.filter((item) => item.teamId === teamId).map((item) => {
      const player = players.find(({ id }) => id === item.playerId), combo = item.pepitas > 0 && item.horquetas > 0 ? '<em class="combo">Pepita + horqueta</em>' : '';
      return `<div class="scoring-row${player?.status === 'UNREGISTERED' ? ' unregistered' : ''}"><span><strong>#${escapeHtml(item.playerNumber)}</strong> ${escapeHtml(player?.name || 'Sin nombre')}<small>Tabla: ${escapeHtml(item.scoringTable)} · Directos: ${item.directGoals} · Pepitas: ${item.pepitas} · Horquetas: ${item.horquetas} ${combo}</small></span><b>${item.total}</b><button data-action="edit-scoring" data-player-id="${item.playerId}">EDITAR</button><button class="danger" data-action="delete-scoring" data-player-id="${item.playerId}">ELIMINAR</button></div>`;
    }).join('');
    return `<section class="scoring-team"><h3>${escapeHtml(teamName)}</h3>${rows || '<p class="empty">Sin goleo registrado.</p>'}</section>`;
  }).join('') : '';
}

/** Resolves a matchId deep link to its tournament and phase; falls back to the default selection with feedback if unavailable. */
async function loadInitialScoringPage() {
  const matchId = Number(new URLSearchParams(location.search).get('matchId'));
  if (!matchId) return loadScoringPage();
  try {
    const target = await request(`/api/matches/${matchId}`), availableTournaments = await request('/api/tournaments');
    const phaseLists = await Promise.all(availableTournaments.map((tournament) => request(`/api/tournaments/${tournament.id}/phases`)));
    const tournamentIndex = phaseLists.findIndex((items) => items.some(({ id }) => id === target.phaseId));
    if (tournamentIndex < 0 || target.status !== 'FINISHED') throw new Error('El partido no está disponible para cargar goleo.');
    await loadScoringPage(availableTournaments[tournamentIndex].id, target.phaseId, target.id);
  } catch (error) {
    await loadScoringPage(); message(error.message, true);
  }
}

/** Binds scoring selection, table management, entry editing, and deletion actions, then loads the scoring page. */
function initScoringPage() {
  document.querySelector('#admin-tournament').addEventListener('change', () => loadScoringPage(selectedTournament()?.id).catch((error) => message(error.message, true)));
  document.querySelector('#admin-phase').addEventListener('change', () => loadScoringPage(selectedTournament()?.id, selectedPhase()?.id).catch((error) => message(error.message, true)));
  document.querySelector('#scoring-match').addEventListener('change', () => loadScoringDetails(selectedScoringMatch()?.id).catch((error) => message(error.message, true)));
  document.querySelector('#scoring-team').addEventListener('change', () => { renderScoringPlayerOptions(); populateScoringForm(); });
  document.querySelector('#scoring-player').addEventListener('change', populateScoringForm);
  document.querySelector('#scoring-table-manage').addEventListener('change', (event) => { document.querySelector('#scoring-table-name').value = scoringTables.find(({ id }) => id === Number(event.target.value))?.name || ''; });
  document.querySelector('#scoring-table-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const phase = selectedPhase(), tableId = Number(document.querySelector('#scoring-table-manage').value), name = document.querySelector('#scoring-table-name').value.trim();
    try { await request(`/api/phases/${phase.id}/scoring-tables/${tableId}`, { method: 'PUT', body: JSON.stringify({ name }) }); await loadScoringPage(selectedTournament().id, phase.id, selectedScoringMatch()?.id); message('Tabla renombrada.'); }
    catch (error) { message(error.message, true); }
  });
  document.querySelector('#create-scoring-table').addEventListener('click', async () => {
    const phase = selectedPhase(), name = document.querySelector('#scoring-table-name').value.trim();
    try { await request(`/api/phases/${phase.id}/scoring-tables`, { method: 'POST', body: JSON.stringify({ name }) }); await loadScoringPage(selectedTournament().id, phase.id, selectedScoringMatch()?.id); message('Tabla creada.'); }
    catch (error) { message(error.message, true); }
  });
  document.querySelectorAll('#directGoals,#pepitas,#horquetas').forEach((input) => input.addEventListener('input', updateScoringTotal));
  document.querySelector('#cancel-scoring-edit').addEventListener('click', populateScoringForm);
  document.querySelector('#scoring-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const match = selectedScoringMatch(), editing = document.querySelector('#scoring-player-id').value, playerId = Number(editing || document.querySelector('#scoring-player').value);
    const body = { ...Object.fromEntries(['directGoals', 'pepitas', 'horquetas'].map((key) => [key, Number(document.querySelector(`#${key}`).value)])), scoringTable: document.querySelector('#scoringTable').value.trim() };
    if (body.directGoals + body.pepitas + body.horquetas === 0) return message('Registra al menos una anotación.', true);
    try {
      await request(`/api/matches/${match.id}/scoring${editing ? `/${playerId}` : ''}`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(editing ? body : { playerId, ...body }) });
      await loadScoringPage(selectedTournament().id, selectedPhase().id, match.id); message('Goleo guardado.');
    } catch (error) { message(error.message, true); }
  });
  document.querySelector('#scoring-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const item = scoring.find(({ playerId }) => playerId === Number(button.dataset.playerId)), match = selectedScoringMatch();
    if (button.dataset.action === 'edit-scoring') {
      document.querySelector('#scoring-team').value = item.teamId; renderScoringPlayerOptions(item.playerId); populateScoringForm(); return;
    }
    if (!confirm(`¿Eliminar el goleo del jugador #${item.playerNumber}?`)) return;
    try { await request(`/api/matches/${match.id}/scoring/${item.playerId}`, { method: 'DELETE' }); scoring = await request(`/api/matches/${match.id}/scoring`); renderScoringPage(); message('Goleo eliminado.'); }
    catch (error) { message(error.message, true); }
  });
  loadInitialScoringPage().catch((error) => message(error.message, true));
}

if (page === 'tournaments') initTournamentPage();
if (page === 'teams') initTeamPage();
if (page === 'calendar') initCalendarPage();
if (page === 'scoring') initScoringPage();
