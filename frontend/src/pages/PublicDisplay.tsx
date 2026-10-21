import { useEffect, useRef, useState } from 'react'
import { loadDisplay, subscribeDisplay } from '../api/display'
import type { DisplayData, DisplaySelection } from '../api/display'
import { Layout } from '../components/Layout'
import { MatchList } from '../components/MatchList'
import { Calendar, calendarMatches } from './Calendar'
import type { CalendarFilters } from './Calendar'
import { Scoring, Standings } from './Rankings'
import styles from './PublicDisplay.module.css'

const tabs = { live: 'EN JUEGO', calendar: 'CALENDARIO', results: 'RESULTADOS', standings: 'TABLA', scoring: 'GOLEO' }
const initialFilters: CalendarFilters = { category: 'ALL', date: '', status: '' }

/** Owns the public display's selections, filters and SSE lifecycle. Selection requests abort on
 * change/unmount; live refreshes retain current data, filters and available tournament/phase choices.
 * Public visibility, order and all business calculations come from the validated server payloads. */
export function PublicDisplay() {
  const [view, setView] = useState<keyof typeof tabs>('live')
  const [filters, setFilters] = useState(initialFilters)
  const [resultsDate, setResultsDate] = useState('')
  const [selection, setSelection] = useState<DisplaySelection>({})
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{ selection: DisplaySelection; data: DisplayData }>()
  const [error, setError] = useState('')
  const [connection, setConnection] = useState('')
  const previous = useRef<DisplayData>(undefined)

  useEffect(() => subscribeDisplay(() => setRefresh(value => value + 1), setConnection), [])
  useEffect(() => {
    const controller = new AbortController()
    const last = previous.current
    const tournamentId = selection.tournamentId ?? last?.tournament?.id
    const phaseId = selection.phaseId ?? (last?.tournament?.id === tournamentId ? last?.phase?.id : undefined)
    void loadDisplay({ tournamentId, phaseId }, controller.signal).then(data => {
      if (controller.signal.aborted) return
      previous.current = data
      setResult({ selection, data })
      setError('')
    }, failure => {
      if (!controller.signal.aborted) setError(`${failure.message} Sin conexión. Reintentando…`)
    })
    return () => controller.abort()
  }, [selection, refresh])

  const data = result?.selection === selection ? result.data : undefined
  const calendar = data ? calendarMatches(data.matches, filters) : []
  const results = data?.matches.filter(match => match.status === 'FINISHED' && (!resultsDate || match.date === resultsDate)) ?? []
  const navigation = <>
    <div className={styles.selectors}>
      <label>Torneo<select aria-label="Torneo activo" value={data?.tournament?.id ?? ''} disabled={!data?.tournaments.length} onChange={event => setSelection({ tournamentId: Number(event.target.value) })}>{data?.tournaments.map(tournament => <option key={tournament.id} value={tournament.id}>{tournament.name}</option>)}</select></label>
      <label>Fase<select aria-label="Fase" value={data?.phase?.id ?? ''} disabled={!data?.phases.length} onChange={event => setSelection({ tournamentId: data?.tournament?.id, phaseId: Number(event.target.value) })}>{data?.phases.map(phase => <option key={phase.id} value={phase.id}>{phase.name}</option>)}</select></label>
    </div>
    <nav className={styles.navigation} aria-label="Vistas del torneo">{(Object.keys(tabs) as Array<keyof typeof tabs>).map(tab => <button key={tab} type="button" aria-pressed={view === tab} onClick={() => setView(tab)}>{tabs[tab]}</button>)}</nav>
  </>
  return <Layout navigation={navigation}>
    <div className={styles.page}>
      {(connection || error) && <p className={styles.connection} role="status">{error || connection} <button type="button" onClick={() => setRefresh(value => value + 1)}>Reintentar</button></p>}
      {!data ? <p role="status">{error ? 'No se pudieron cargar los datos.' : 'Cargando partidos…'}</p> : <>
        <section hidden={view !== 'live'} aria-label="En juego" aria-live="polite">{data.matches.some(match => match.status === 'LIVE') ? <MatchList matches={data.matches.filter(match => match.status === 'LIVE')} /> : <p className={styles.empty}>No hay partidos en juego</p>}</section>
        <section hidden={view !== 'calendar'} aria-label="Calendario" aria-live="polite">
          <div className={styles.filters} aria-label="Filtrar calendario">
            <div className={styles.filterButtons} role="group" aria-label="Categoría">{(['ALL', 'MALE', 'FEMALE'] as const).map(category => <button key={category} type="button" aria-pressed={filters.category === category} onClick={() => setFilters({ ...filters, category })}>{({ ALL: 'TODOS', MALE: 'MASCULINO', FEMALE: 'FEMENINO' })[category]}</button>)}</div>
            <label>Fecha<input type="date" value={filters.date} onChange={event => setFilters({ ...filters, date: event.target.value })} /></label>
            <label>Estado<select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value as CalendarFilters['status'] })}><option value="">Todos</option><option value="SCHEDULED">Programado</option><option value="LIVE">En juego</option></select></label>
            <button type="button" onClick={() => setFilters(initialFilters)}>LIMPIAR</button>
          </div>
          <Calendar matches={calendar} empty={filters.category !== 'ALL' || filters.date || filters.status ? 'No hay partidos para los filtros seleccionados' : 'No hay partidos'} />
        </section>
        <section hidden={view !== 'results'} aria-label="Resultados" aria-live="polite">
          <div className={styles.filters} aria-label="Filtrar resultados"><label>Fecha<input type="date" value={resultsDate} onChange={event => setResultsDate(event.target.value)} /></label><button type="button" onClick={() => setResultsDate('')}>LIMPIAR</button></div>
          <Calendar matches={results} results empty={resultsDate ? 'No hay resultados para la fecha seleccionada' : 'No hay resultados anteriores'} />
        </section>
        <section hidden={view !== 'standings'} aria-label="Tabla" aria-live="polite">{data.standings ? <Standings data={data.standings} /> : <p role="status">{data.standingsError ?? 'No hay fase seleccionada'}</p>}</section>
        <section hidden={view !== 'scoring'} aria-label="Goleo" aria-live="polite">{data.scoring ? <Scoring data={data.scoring} /> : <p role="status">{data.scoringError ?? 'No hay fase seleccionada'}</p>}</section>
      </>}
    </div>
  </Layout>
}
