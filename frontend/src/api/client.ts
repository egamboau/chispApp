import { ApiErrorResponseSchema } from '@jupas/shared'

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status = 0, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ApiError'
    this.status = status
  }
}

export type ResponseParser<T> = { parse(value: unknown): T }
type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown }

export function request<T>(path: string, schema: ResponseParser<T>, options?: RequestOptions): Promise<T>
export function request(path: string, schema?: undefined, options?: RequestOptions): Promise<void>
export async function request<T>(
  path: string,
  schema?: ResponseParser<T>,
  { body, headers, ...options }: RequestOptions = {},
): Promise<T | void> {
  // Keep session credentials and JSON bodies on this application's API origin.
  if (!path.startsWith('/api/') || path.includes('\\') || new URL(path, 'http://local').pathname !== path.split('?')[0]) {
    throw new ApiError('Ruta de API inválida.')
  }
  const requestHeaders = new Headers(headers)
  requestHeaders.set('Accept', 'application/json')
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json')

  let response: Response
  try {
    response = await fetch(path, {
      ...options,
      headers: requestHeaders,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new ApiError('No se pudo conectar con el servidor.', 0, { cause: error })
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    const parsed = ApiErrorResponseSchema.safeParse(payload)
    throw new ApiError(parsed.success ? parsed.data.error : `Error HTTP ${response.status}.`, response.status)
  }
  if (!schema) return
  try {
    return schema.parse(await response.json())
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new ApiError('Respuesta del servidor inválida.', response.status, { cause: error })
  }
}
