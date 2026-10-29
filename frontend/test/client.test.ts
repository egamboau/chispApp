import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { CreateTournamentInputSchema, TournamentListResponseSchema } from '@jupas/shared'
import { ApiError, request } from '../src/api/client.ts'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

const tournament = { id: 1, name: ' Copa ', active: 1, currentPhaseId: null, currentMalePhaseId: null, currentFemalePhaseId: null, legacyType: null }

test('validates shared responses and transforms booleans and names', async () => {
  globalThis.fetch = async () => Response.json([tournament])
  const result = await request('/api/tournaments?active=true', TournamentListResponseSchema)
  assert.equal(result[0]?.active, true)
  assert.equal(result[0]?.name, 'Copa')
})

test('sends parsed DTOs as JSON with same-origin credentials and custom headers', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/admin/tournaments')
    assert.equal(init?.method, 'POST')
    assert.equal(init?.credentials, 'same-origin')
    assert.equal(new Headers(init?.headers).get('Content-Type'), 'application/json')
    assert.equal(new Headers(init?.headers).get('X-Test'), 'yes')
    assert.deepEqual(JSON.parse(String(init?.body)), { name: 'Copa', active: true })
    return Response.json([tournament], { status: 201 })
  }
  await request('/api/admin/tournaments', TournamentListResponseSchema, {
    method: 'POST', headers: { 'X-Test': 'yes' }, body: CreateTournamentInputSchema.parse({ name: ' Copa ' }),
  })
})

test('handles empty 204 deletes without JSON parsing', async () => {
  globalThis.fetch = async () => new Response(null, { status: 204 })
  assert.equal(await request('/api/admin/teams/1', undefined, { method: 'DELETE' }), undefined)
})

test('normalizes JSON HTTP errors and HTML/auth gateway errors', async () => {
  for (const response of [Response.json({ error: 'Sin acceso.' }, { status: 403 }), new Response('<html>gateway</html>', { status: 502 })]) {
    globalThis.fetch = async () => response
    await assert.rejects(request('/api/tournaments', TournamentListResponseSchema), (error: unknown) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, response.status)
      assert.equal(error.message, response.status === 403 ? 'Sin acceso.' : 'Error HTTP 502.')
      return true
    })
  }
})

test('rejects malformed JSON, invalid DTOs and empty responses when data is required', async () => {
  for (const response of [new Response('not json'), Response.json([{ ...tournament, id: '1' }]), new Response(null, { status: 204 })]) {
    globalThis.fetch = async () => response
    await assert.rejects(request('/api/tournaments', TournamentListResponseSchema), { name: 'ApiError', message: 'Respuesta del servidor inválida.' })
  }
})

test('normalizes network failures but preserves cancellation', async () => {
  globalThis.fetch = async () => { throw new TypeError('offline') }
  await assert.rejects(request('/api/tournaments', TournamentListResponseSchema), { name: 'ApiError', status: 0 })
  const controller = new AbortController()
  controller.abort()
  globalThis.fetch = async (_url, options) => { throw options?.signal?.reason }
  await assert.rejects(request('/api/tournaments', TournamentListResponseSchema, { signal: controller.signal }), { name: 'AbortError' })
})

test('rejects off-origin and traversing paths before fetching', async () => {
  globalThis.fetch = async () => { assert.fail('must not fetch') }
  for (const path of ['https://example.com/api/teams', '//example.com/api/teams', '/api/../admin', '/api/%2e%2e/admin', '/api/\\example.com']) {
    await assert.rejects(request(path), { name: 'ApiError', message: 'Ruta de API inválida.' })
  }
})
