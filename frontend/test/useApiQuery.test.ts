import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TournamentListResponseSchema } from '@jupas/shared'
import { useApiQuery } from '../src/api/useApiQuery.ts'

test('starts in a loading state without fetching during render', () => {
  function Query() {
    const state = useApiQuery('/api/tournaments', TournamentListResponseSchema)
    assert.deepEqual(state, { status: 'loading' })
    return createElement('span', { role: 'status' }, state.status)
  }
  assert.equal(renderToStaticMarkup(createElement(Query)), '<span role="status">loading</span>')
})
