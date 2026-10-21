import { useEffect, useState } from 'react'
import { ApiError, request } from './client'
import type { ResponseParser } from './client'

export type QueryState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: ApiError }

/** Fetches validated API data and exposes loading, success, or error state.
 * A path or schema identity change restarts the request; keep schema references stable.
 * Aborts on cleanup and hides stale results while the next request is loading. */
export function useApiQuery<T>(path: string, schema: ResponseParser<T>): QueryState<T> {
  const [result, setResult] = useState<{
    path: string
    schema: ResponseParser<T>
    state: QueryState<T>
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setResult(null)
    void request(path, schema, { signal: controller.signal }).then(
      data => {
        if (!controller.signal.aborted) setResult({ path, schema, state: { status: 'success', data } })
      },
      error => {
        if (!controller.signal.aborted) setResult({ path, schema, state: { status: 'error', error } })
      },
    )
    return () => controller.abort()
  }, [path, schema])

  return result?.path === path && result.schema === schema ? result.state : { status: 'loading' }
}
