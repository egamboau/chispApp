import { useState } from 'react'
import type { PhaseScoringResponse, PhaseStandingsResponse } from '@jupas/shared'
import styles from './PublicDisplay.module.css'

/** Displays server-calculated standings, sanctions, destinations and tiebreaker notices. */
export function Standings({ data }: { data: PhaseStandingsResponse }) {
  if (!data.hasStandings) return <p className={styles.empty}>{data.message}</p>
  return <>
    <div className={styles.legend}>{data.rules.length ? data.rules.map(rule => <span key={rule.id}>{rule.positions.map(position => `${position}.º`).join(', ')}: {rule.label}</span>) : 'Sin destinos configurados'}</div>
    {data.groups.map(group => <section key={group.id}><h2>{group.name}</h2><div className={styles.tableScroll} tabIndex={0} role="region" aria-label={`Tabla ${group.name}`}><table><thead><tr>{['Pos.', 'Equipo', 'PJ', 'G', 'E', 'P', 'GF', 'GC', 'DG', 'Pts.', '🟥', '🟨', 'Destino'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>
      {group.standings.map((row, index) => <tr key={row.teamId} className={index > 0 && row.destination !== group.standings[index - 1]?.destination ? styles.rangeStart : undefined}>
        <td>{row.position}.º{row.requiresTiebreaker && '*'}</td><td>{row.teamName}{row.sanctioned && <> <abbr title={row.sanctionReason ?? undefined}>Sancionado</abbr></>}</td>
        <td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.goalDifference}</td><td><strong>{row.points}</strong></td><td>{row.redCards}</td><td>{row.yellowCards}</td><td>{row.destination || (row.possibleDestinations.length ? `Pendiente: ${row.possibleDestinations.join(' / ')}` : '—')}</td>
      </tr>)}
    </tbody></table></div>{group.standings.some(row => row.requiresTiebreaker) && <p className={styles.legend}>* Partido extra: dos tiempos de 5 minutos y penales si persiste el empate.</p>}</section>)}
  </>
}

/** Keeps the selected scoring table when present; renders all three server-calculated rankings. */
export function Scoring({ data }: { data: PhaseScoringResponse }) {
  const [name, setName] = useState('Torneo Regular')
  const selected = data.tables.find(table => table.name === name) ?? data.tables.find(table => table.name === 'Torneo Regular') ?? data.tables[0]
  if (!selected) return <p className={styles.empty}>Sin tablas de goleo</p>
  return <>
    <div className={styles.scoringControls}><label>Tabla de goleo<select value={selected.name} onChange={event => setName(event.target.value)}>{data.tables.map(table => <option key={table.id}>{table.name}</option>)}</select></label><p className={styles.legend}>Directo = 1 · Pepita = 2 · Horqueta = 3</p></div>
    {(['total', 'pepitas', 'horquetas'] as const).map(metric => <section key={metric}><h2>{({ total: 'Goleadores', pepitas: 'Pepitas', horquetas: 'Horquetas' })[metric]}</h2>{selected.rankings[metric].length ? <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={`Ranking ${metric}`}><table><thead><tr>{['Pos.', 'Jugador', 'Equipo', ({ total: 'Total', pepitas: 'Pepitas', horquetas: 'Horquetas' })[metric]].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{selected.rankings[metric].map(row => <tr key={row.playerId}><td>{row.position}.º</td><td><strong>#{row.playerNumber}</strong> {row.playerName || 'Sin nombre'}</td><td>{row.teamName}</td><td><strong>{row[metric]}</strong></td></tr>)}</tbody></table></div> : <p className={styles.empty}>Sin anotaciones</p>}</section>)}
  </>
}
