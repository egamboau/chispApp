import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'

test('Vite serves both page entries and returns HTTP 404 for unknown pages', async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'chispapp-vite-test-'))
  const server = await createServer({
    cacheDir,
    root: fileURLToPath(new URL('..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0, hmr: false },
  })
  t.after(async () => {
    try { await server.close() }
    finally { await rm(cacheDir, { recursive: true, force: true }) }
  })
  await server.listen()
  const base = server.resolvedUrls!.local[0]!
  const options = { headers: { Accept: 'text/html' } }
  for (const path of ['display', 'display/', 'display/index.html', 'admin', 'admin/', 'admin/index.html', 'admin/teams.html', 'admin/calendar.html', 'admin/scoring.html?matchId=1']) {
    const response = await fetch(new URL(path, base), options)
    assert.equal(response.status, 200, path)
    assert.match(await response.text(), /src="\/src\/main.tsx"/, path)
  }
  for (const path of ['display/admin', 'display/admmin', 'display/admin.html', 'public/admin', 'admin/unknown']) {
    assert.equal((await fetch(new URL(path, base), options)).status, 404, path)
    assert.equal((await fetch(new URL(path, base))).status, 404, path)
  }
  const root = await fetch(base, { ...options, redirect: 'manual' })
  assert.equal(root.status, 302)
  assert.equal(root.headers.get('location'), '/display/')
})
