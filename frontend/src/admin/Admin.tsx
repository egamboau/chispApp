import { useEffect, useRef, useState } from 'react'
import { loadAdmin, scoringSelection } from '../api/admin'
import type { AdminData, AdminPage, AdminSelection } from '../api/admin'
import { subscribeDisplay } from '../api/display'
import { Select } from './Forms'
import { Tournaments } from './Tournaments'
import { Teams } from './Teams'
import { Calendar } from './Calendar'
import { Scoring } from './Scoring'
import './admin.css'

const pages = { tournaments: ['Torneos', '/admin/'], teams: ['Equipos', '/admin/teams.html'], calendar: ['Calendario', '/admin/calendar.html'], scoring: ['Goleo', '/admin/scoring.html'] } as const

/** Resolves the four preserved administrative URLs without introducing a routing dependency. */
export function adminPage(path: string): AdminPage {
  return path.endsWith('/teams.html') ? 'teams' : path.endsWith('/calendar.html') ? 'calendar' : path.endsWith('/scoring.html') ? 'scoring' : 'tournaments'
}

/** Owns protected CRUD data, abortable selections, feedback and live reloads; failures retain entered drafts.
 * A single mutation runs at a time, and every attempt refreshes server state, including partially completed operations. */
export function Admin() {
  const page = adminPage(location.pathname)
  const [selection, setSelection] = useState<AdminSelection>({})
  const [refresh, setRefresh] = useState(0), [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ selection: AdminSelection; data: AdminData }>()
  const previous = useRef<AdminData>(undefined)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [connection, setConnection] = useState('')
  const [busy, setBusy] = useState(false), mutation = useRef(false)
  const [initializing, setInitializing] = useState(page === 'scoring' && !!new URLSearchParams(location.search).get('matchId'))
  useEffect(() => {
    if (!initializing) return
    const controller = new AbortController()
    void scoringSelection(Number(new URLSearchParams(location.search).get('matchId')), controller.signal).then(value => {
      if (!controller.signal.aborted) { setSelection(value); setInitializing(false) }
    }, failure => { if (!controller.signal.aborted) { setMessage(failure.message); setInitializing(false) } })
    return () => controller.abort()
  }, [initializing])
  useEffect(() => {
    if (initializing) return
    const controller = new AbortController(), last = previous.current
    const tournamentId = selection.tournamentId ?? last?.tournament?.id
    const phaseId = selection.phaseId ?? (last?.tournament?.id === tournamentId ? last?.phase?.id : undefined)
    void loadAdmin(page, { tournamentId, phaseId }, controller.signal).then(data => {
      if (!controller.signal.aborted) { previous.current = data; setResult({ selection, data }); setError('') }
    }, failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [page, selection, refresh, initializing])
  useEffect(() => page === 'calendar' ? subscribeDisplay(() => setRefresh(value => value + 1), setConnection) : undefined, [page])
  const data = result?.selection === selection ? result.data : undefined
  /** Serializes writes and catches schema/API errors; successful writes reset forms only after explicit acknowledgement. */
  async function run(operation: () => Promise<unknown>) {
    if (mutation.current) return false
    mutation.current = true; setBusy(true); setMessage('')
    try { await operation(); setMessage('Cambio guardado.'); setRevision(value => value + 1); return true }
    catch (failure) {
      const issues = failure && typeof failure === 'object' && 'issues' in failure ? failure.issues as { path: unknown[] }[] : undefined
      setMessage(issues ? `Datos inválidos: ${issues.map(item => item.path.join('.') || 'formulario').join(', ')}. Revisa campos y cantidades.` : failure instanceof Error ? failure.message : 'No se pudo completar la operación.')
      return false
    } finally { mutation.current = false; setBusy(false); setRefresh(value => value + 1) }
  }
  return <><header><div className="brand"><h1>ChispApp</h1><p>Administración · Datos proporcionados por Chisperos</p></div><nav aria-label="Administración">{(Object.keys(pages) as AdminPage[]).map(key => <a key={key} href={pages[key][1]} aria-current={page === key ? 'page' : undefined} className={page === key ? 'active' : undefined}>{pages[key][0]}</a>)}<a href="/display" target="_blank" rel="noreferrer">Pantalla pública</a></nav></header>
    <div className="admin-feedback"><p role="alert">{message}</p>{error && <p role="alert" className="error">{error} <button onClick={() => setRefresh(value => value + 1)}>REINTENTAR</button></p>}{connection && <p role="status">{connection}</p>}</div>
    {data ? <><fieldset className="admin-selectors" disabled={busy}><Select label="Torneo" items={data.tournaments} value={data.tournament?.id ?? ''} onChange={value => { setSelection({ tournamentId: Number(value) }); setMessage('') }} /><Select label="Fase" items={data.phases.map(item => ({ ...item, name: `${item.tournamentType === 'FEMALE' ? 'Femenino' : 'Masculino'} · ${item.name}` }))} value={data.phase?.id ?? ''} onChange={value => { setSelection({ tournamentId: data.tournament?.id, phaseId: Number(value) }); setMessage('') }} /></fieldset>
      <fieldset className="admin-workspace" disabled={busy || !!error}><main key={`${data.tournament?.id}-${data.phase?.id}`} className={page === 'calendar' ? undefined : 'management-layout'}>{page === 'tournaments' ? <Tournaments data={data} run={run} /> : page === 'teams' ? <Teams data={data} run={run} revision={revision} /> : page === 'calendar' ? <Calendar data={data} run={run} revision={revision} /> : <Scoring data={data} run={run} revision={revision} />}</main></fieldset>
    </> : !error && <p role="status">Cargando administración…</p>}
    <footer>© 2026 Eduardo Gamboa.</footer>
  </>
}
