const jornadaLabels = { MORNING: 'Mañana', AFTERNOON: 'Tarde' };
const statusLabels = { SCHEDULED: 'Programado', LIVE: 'En juego', FINISHED: 'Final' };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
let tournaments = [], phases = [], groups = [], teams = [], memberships = [], rules = [], sanctions = [], matches = [];

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'No se pudo completar la operación.');
  return response.status === 204 ? null : response.json();
}
function message(text, error = false, selector = '#config-message') { const target = document.querySelector(selector); target.textContent = text; target.className = error ? 'error' : 'success'; if (!error) setTimeout(() => { target.textContent = ''; }, 2500); }
const selectedTournament = () => tournaments.find((item) => item.id === Number(document.querySelector('#admin-tournament').value));
const selectedPhase = () => phases.find((item) => item.id === Number(document.querySelector('#admin-phase').value));
const options = (items, label = 'name') => items.map((item) => `<option value="${item.id}">${escapeHtml(item[label])}</option>`).join('');

async function loadTournaments(keep) {
  tournaments = await request('/api/tournaments');
  const select = document.querySelector('#admin-tournament');
  select.innerHTML = options(tournaments);
  select.value = keep || tournaments[0]?.id || '';
  await loadPhases();
}
async function loadPhases(keep) {
  const tournament = selectedTournament();
  phases = tournament ? await request(`/api/tournaments/${tournament.id}/phases`) : [];
  document.querySelector('#admin-phase').innerHTML = options(phases);
  document.querySelector('#admin-phase').value = keep || tournament?.currentPhaseId || phases[0]?.id || '';
  document.querySelector('#phaseId').innerHTML = options(phases);
  document.querySelector('#filter-phase').innerHTML = `<option value="">Todas</option>${options(phases)}`;
  await loadPhaseData();
}
async function loadPhaseData() {
  const tournament = selectedTournament(), phase = selectedPhase();
  teams = tournament ? await request(`/api/teams?tournamentId=${tournament.id}`) : [];
  [groups, memberships, rules, sanctions] = phase ? await Promise.all([
    request(`/api/phases/${phase.id}/groups`), request(`/api/phases/${phase.id}/memberships`),
    request(`/api/phases/${phase.id}/classification-rules`), request(`/api/phases/${phase.id}/sanctions`)
  ]) : [[], [], [], []];
  document.querySelector('#membership-team').innerHTML = options(teams);
  document.querySelector('#sanction-team').innerHTML = options(teams);
  document.querySelector('#membership-group').innerHTML = options(groups);
  document.querySelector('#groupId').innerHTML = options(groups);
  renderTeamOptions(); renderConfiguration();
}
function renderTeamOptions(values = {}) {
  const groupId = Number(document.querySelector('#groupId').value);
  const memberIds = memberships.filter((item) => item.groupId === groupId).map((item) => item.teamId);
  for (const key of ['teamAId', 'teamBId']) {
    const select = document.querySelector(`#${key}`), current = values[key] || select.value;
    select.innerHTML = `<option value="">Seleccione</option>${options(teams.filter((team) => memberIds.includes(team.id)))}`; select.value = current;
  }
  const line = document.querySelector('#lineTeamId'), current = values.lineTeamId || line.value;
  line.innerHTML = `<option value="">Seleccione</option>${options(teams)}`; line.value = current;
}
function renderConfiguration() {
  const tournament = selectedTournament(), phase = selectedPhase();
  document.querySelector('#configuration').innerHTML = `<h3>Torneo y fase</h3><div class="config-row"><strong>${escapeHtml(tournament?.name)}</strong><span>${tournament?.active ? 'Activo' : 'Inactivo'}</span><button data-edit="tournament" data-id="${tournament?.id}">EDITAR</button><button data-edit="active" data-id="${tournament?.id}">${tournament?.active ? 'DESACTIVAR' : 'ACTIVAR'}</button><button class="danger" data-delete="tournaments" data-id="${tournament?.id}">ELIMINAR</button></div>
    <div class="config-row"><strong>${escapeHtml(phase?.name)}</strong><span>${phase?.type === 'TABLE' ? 'Tabla' : 'Eliminatoria'}</span><button data-edit="phase" data-id="${phase?.id}">EDITAR</button>${tournament?.currentPhaseId !== phase?.id ? `<button data-edit="current" data-id="${phase?.id}">HACER ACTUAL</button>` : '<span>Fase actual</span>'}<button class="danger" data-delete="phases" data-id="${phase?.id}">ELIMINAR</button></div>
    <h3>Equipos</h3>${teams.map((team) => `<div class="config-row"><span>${escapeHtml(team.name)}</span><button data-edit="team" data-id="${team.id}">EDITAR</button><button class="danger" data-delete="teams" data-id="${team.id}">ELIMINAR</button></div>`).join('') || '<p>Sin equipos.</p>'}
    <h3>Grupos y membresías</h3>${groups.map((group) => `<div class="config-row"><strong>${escapeHtml(group.name)}</strong><button data-edit="group" data-id="${group.id}">EDITAR</button><button class="danger" data-delete="groups" data-id="${group.id}">ELIMINAR</button></div>${memberships.filter((item) => item.groupId === group.id).map((item) => `<div class="config-row member"><span>${escapeHtml(item.teamName)}</span><button class="danger" data-delete="memberships" data-id="${item.teamId}">QUITAR</button></div>`).join('')}`).join('') || '<p>Sin grupos.</p>'}
    <h3>Rangos</h3>${rules.map((rule) => `<div class="config-row"><span>${rule.startPosition}–${rule.endPosition}: <strong>${escapeHtml(rule.label)}</strong></span><button data-edit="rule" data-id="${rule.id}">EDITAR</button><button class="danger" data-delete="rules" data-id="${rule.id}">ELIMINAR</button></div>`).join('') || '<p>Sin rangos; las posiciones pueden quedar sin etiqueta.</p>'}
    <h3>Sanciones</h3>${sanctions.map((item) => `<div class="config-row"><span><strong>${escapeHtml(item.teamName)}</strong>: ${escapeHtml(item.reason)}</span><button class="danger" data-delete="sanctions" data-id="${item.teamId}">QUITAR</button></div>`).join('') || '<p>Sin sanciones.</p>'}`;
}

function resetMatchForm() { document.querySelector('#match-form').reset(); document.querySelector('#match-id').value = ''; document.querySelector('#form-title').textContent = 'Crear partido'; document.querySelector('#cancel-edit').hidden = true; document.querySelector('#phaseId').value = selectedPhase()?.id || ''; document.querySelector('#groupId').innerHTML = options(groups); renderTeamOptions(); }
function card(match) {
  const score = match.status === 'LIVE' ? `<div class="score-controls">${['A', 'B'].map((side) => `<div><strong>${escapeHtml(match[`team${side}`])}</strong><span><button data-action="score" data-team="${side}" data-delta="-1" ${match[`score${side}`] === 0 ? 'disabled' : ''}>−</button><b>${match[`score${side}`]}</b><button data-action="score" data-team="${side}" data-delta="1">+</button></span></div>`).join('')}</div>` : `<h3>${escapeHtml(match.teamA)} <small>vs</small> ${escapeHtml(match.teamB)}${match.status === 'FINISHED' ? ` · ${match.scoreA}–${match.scoreB}` : ''}</h3>`;
  return `<article class="match-card" data-id="${match.id}"><div class="meta"><span class="badge">${escapeHtml(match.tournamentName)}</span><strong>${escapeHtml(match.phaseName)} · ${escapeHtml(match.groupName)} · Cancha ${match.court}</strong><span>${match.date} · ${jornadaLabels[match.jornada]}</span><span class="status ${match.status.toLowerCase()}">${statusLabels[match.status]}</span></div>${score}<p>Línea: <strong>${escapeHtml(match.lineTeam)}</strong></p>
    <div class="cards"><label>${escapeHtml(match.teamA)} 🟨<input data-card="yellowCardsA" type="number" min="0" value="${match.yellowCardsA}"></label><label>🟥<input data-card="redCardsA" type="number" min="0" value="${match.redCardsA}"></label><label>${escapeHtml(match.teamB)} 🟨<input data-card="yellowCardsB" type="number" min="0" value="${match.yellowCardsB}"></label><label>🟥<input data-card="redCardsB" type="number" min="0" value="${match.redCardsB}"></label><button data-action="cards">GUARDAR TARJETAS</button></div>
    <div class="actions">${match.status === 'SCHEDULED' ? '<button data-action="edit">EDITAR</button><button class="danger" data-action="delete">ELIMINAR</button><button class="primary" data-action="start">INICIAR</button>' : ''}${match.status === 'LIVE' ? '<button class="finish" data-action="finish">FINALIZAR PARTIDO</button>' : ''}</div></article>`;
}
function renderMatches() { const date = document.querySelector('#filter-date').value, phaseId = Number(document.querySelector('#filter-phase').value), court = Number(document.querySelector('#filter-court').value); const filtered = matches.filter((match) => (!date || match.date === date) && (!phaseId || match.phaseId === phaseId) && (!court || match.court === court)); document.querySelector('#matches').innerHTML = filtered.map(card).join('') || '<p class="empty">No hay partidos.</p>'; }
async function loadMatches() { matches = await request('/api/matches'); renderMatches(); }

function bindForm(id, body, url, done) { document.querySelector(`#${id}`).addEventListener('submit', async (event) => { event.preventDefault(); try { await request(url(), { method: 'POST', body: JSON.stringify(body()) }); event.target.reset(); await done(); message('Guardado.'); } catch (error) { message(error.message, true); } }); }
bindForm('tournament-form', () => ({ name: document.querySelector('#tournament-name').value }), () => '/api/tournaments', () => loadTournaments());
bindForm('phase-form', () => ({ name: document.querySelector('#phase-name').value, type: document.querySelector('#phase-type').value, sortOrder: phases.length + 1 }), () => `/api/tournaments/${selectedTournament().id}/phases`, () => loadPhases());
bindForm('group-form', () => ({ name: document.querySelector('#group-name').value }), () => `/api/phases/${selectedPhase().id}/groups`, loadPhaseData);
bindForm('team-form', () => ({ tournamentId: selectedTournament().id, name: document.querySelector('#team-name').value }), () => '/api/teams', loadPhaseData);
bindForm('membership-form', () => ({ teamId: Number(document.querySelector('#membership-team').value), groupId: Number(document.querySelector('#membership-group').value) }), () => `/api/phases/${selectedPhase().id}/memberships`, loadPhaseData);
bindForm('rule-form', () => ({ startPosition: Number(document.querySelector('#rule-start').value), endPosition: Number(document.querySelector('#rule-end').value), label: document.querySelector('#rule-label').value }), () => `/api/phases/${selectedPhase().id}/classification-rules`, loadPhaseData);
document.querySelector('#sanction-form').addEventListener('submit', async (event) => { event.preventDefault(); const teamId = document.querySelector('#sanction-team').value; try { await request(`/api/phases/${selectedPhase().id}/teams/${teamId}/sanction`, { method: 'PUT', body: JSON.stringify({ reason: document.querySelector('#sanction-reason').value }) }); event.target.reset(); await loadPhaseData(); message('Sanción guardada.'); } catch (error) { message(error.message, true); } });

document.querySelector('#configuration').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-delete],[data-edit]'); if (!button) return;
  const phaseId = selectedPhase().id;
  try {
    if (button.dataset.delete) {
      if (!confirm('¿Eliminar este registro?')) return;
      const urls = { tournaments: `/api/tournaments/${button.dataset.id}`, phases: `/api/phases/${button.dataset.id}`, teams: `/api/teams/${button.dataset.id}`, groups: `/api/groups/${button.dataset.id}`, memberships: `/api/phases/${phaseId}/memberships/${button.dataset.id}`, rules: `/api/phases/${phaseId}/classification-rules/${button.dataset.id}`, sanctions: `/api/phases/${phaseId}/teams/${button.dataset.id}/sanction` };
      await request(urls[button.dataset.delete], { method: 'DELETE' });
    } else {
      const tournament = selectedTournament(), phase = selectedPhase();
      if (button.dataset.edit === 'current') await request(`/api/tournaments/${tournament.id}`, { method: 'PUT', body: JSON.stringify({ name: tournament.name, active: Boolean(tournament.active), currentPhaseId: phase.id }) });
      if (button.dataset.edit === 'active') await request(`/api/tournaments/${tournament.id}`, { method: 'PUT', body: JSON.stringify({ name: tournament.name, active: !tournament.active, currentPhaseId: tournament.currentPhaseId }) });
      if (button.dataset.edit === 'tournament') { const name = prompt('Nombre del torneo', tournament.name); if (!name) return; await request(`/api/tournaments/${tournament.id}`, { method: 'PUT', body: JSON.stringify({ name, active: Boolean(tournament.active), currentPhaseId: tournament.currentPhaseId }) }); }
      if (button.dataset.edit === 'phase') { const name = prompt('Nombre de la fase', phase.name), type = prompt('Tipo: TABLE o ELIMINATION', phase.type); if (!name || !['TABLE', 'ELIMINATION'].includes(type)) return; await request(`/api/phases/${phase.id}`, { method: 'PUT', body: JSON.stringify({ name, type, sortOrder: phase.sortOrder }) }); }
      if (button.dataset.edit === 'team') { const team = teams.find((item) => item.id === Number(button.dataset.id)), name = prompt('Nombre del equipo', team.name); if (!name) return; await request(`/api/teams/${team.id}`, { method: 'PUT', body: JSON.stringify({ name }) }); }
      if (button.dataset.edit === 'group') { const group = groups.find((item) => item.id === Number(button.dataset.id)), name = prompt('Nombre del grupo', group.name); if (!name) return; await request(`/api/groups/${group.id}`, { method: 'PUT', body: JSON.stringify({ name }) }); }
      if (button.dataset.edit === 'rule') { const rule = rules.find((item) => item.id === Number(button.dataset.id)), startPosition = Number(prompt('Posición inicial', rule.startPosition)), endPosition = Number(prompt('Posición final', rule.endPosition)), label = prompt('Etiqueta de destino', rule.label); if (!label) return; await request(`/api/phases/${phase.id}/classification-rules/${rule.id}`, { method: 'PUT', body: JSON.stringify({ startPosition, endPosition, label }) }); }
    }
    await loadTournaments(selectedTournament()?.id); await loadMatches(); message('Cambio guardado.');
  } catch (error) { message(error.message, true); }
});
document.querySelector('#admin-tournament').addEventListener('change', () => loadPhases());
document.querySelector('#admin-phase').addEventListener('change', loadPhaseData);
document.querySelector('#phaseId').addEventListener('change', async (event) => { groups = await request(`/api/phases/${event.target.value}/groups`); memberships = await request(`/api/phases/${event.target.value}/memberships`); document.querySelector('#groupId').innerHTML = options(groups); renderTeamOptions(); });
document.querySelector('#groupId').addEventListener('change', () => renderTeamOptions());
document.querySelectorAll('.filters input, .filters select').forEach((input) => input.addEventListener('input', renderMatches));

document.querySelector('#match-form').addEventListener('submit', async (event) => { event.preventDefault(); const matchId = document.querySelector('#match-id').value, body = Object.fromEntries(['phaseId', 'groupId', 'date', 'jornada', 'court', 'teamAId', 'teamBId', 'lineTeamId'].map((key) => [key, document.querySelector(`#${key}`).value])); try { await request(matchId ? `/api/matches/${matchId}` : '/api/matches', { method: matchId ? 'PUT' : 'POST', body: JSON.stringify(body) }); resetMatchForm(); await loadMatches(); message('Partido guardado.', false, '#message'); } catch (error) { message(error.message, true, '#message'); } });
document.querySelector('#cancel-edit').addEventListener('click', resetMatchForm);
document.querySelector('#matches').addEventListener('click', async (event) => { const button = event.target.closest('[data-action]'); if (!button) return; const article = button.closest('[data-id]'), match = matches.find((item) => item.id === Number(article.dataset.id)); try { if (button.dataset.action === 'edit') { for (const key of ['phaseId', 'date', 'jornada', 'court']) document.querySelector(`#${key}`).value = match[key]; groups = await request(`/api/phases/${match.phaseId}/groups`); memberships = await request(`/api/phases/${match.phaseId}/memberships`); document.querySelector('#groupId').innerHTML = options(groups); document.querySelector('#groupId').value = match.groupId; renderTeamOptions(match); document.querySelector('#match-id').value = match.id; document.querySelector('#form-title').textContent = 'Editar partido'; document.querySelector('#cancel-edit').hidden = false; return; } if (button.dataset.action === 'delete') { if (!confirm('¿Eliminar partido?')) return; await request(`/api/matches/${match.id}`, { method: 'DELETE' }); } else if (button.dataset.action === 'score') await request(`/api/matches/${match.id}/score`, { method: 'PATCH', body: JSON.stringify({ team: button.dataset.team, delta: Number(button.dataset.delta) }) }); else if (button.dataset.action === 'cards') { const body = Object.fromEntries([...article.querySelectorAll('[data-card]')].map((input) => [input.dataset.card, Number(input.value)])); await request(`/api/matches/${match.id}/cards`, { method: 'PATCH', body: JSON.stringify(body) }); } else await request(`/api/matches/${match.id}/${button.dataset.action}`, { method: 'POST' }); await loadMatches(); } catch (error) { message(error.message, true, '#message'); } });

const events = new EventSource('/api/events'); events.addEventListener('matches', () => { loadMatches(); loadPhaseData(); });
loadTournaments().then(loadMatches).catch((error) => message(error.message, true));
