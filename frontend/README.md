# React frontend

The app is served at `/react/`; the Vite dev server proxies `/api` to port 3000.
Build the shared package before development (`npm run dev:frontend` does this).

## HTTP and loading state

Use `request` from `src/api/client.ts` for API calls. Pass a response schema from
`@jupas/shared`; its parsed output determines the result type and applies shared
transformations (for example, integer flags become booleans). Only shared
contracts are imported into the browser, never backend models or services.

```ts
import { CreateTournamentInputSchema, TournamentResponseSchema } from '@jupas/shared'
import { request } from './src/api/client'

const body = CreateTournamentInputSchema.parse({ name: 'Copa' })
const tournament = await request('/api/admin/tournaments', TournamentResponseSchema, {
  method: 'POST', body,
})
await request('/api/admin/tournaments/1', undefined, { method: 'DELETE' })
```

Parse request input with its shared schema before sending it. Shared contracts
include some planned migration inputs; consult `shared/README.md` before using
an input against the current backend. JSON requests preserve same-origin session
credentials. Public reads use `/api/...`; protected writes use `/api/admin/...`.
No retries are automatic, so failed mutations are never silently repeated.

`ApiError` carries the server error message and HTTP `status` (0 for a network
failure). Invalid JSON or response shapes also become `ApiError`; cancellation
preserves the original abort error. Omit the schema only when no response data is
needed, such as a 204 delete. Pass `signal` to cancel an imperative request.

For reads in React, use `useApiQuery(path, Schema)` from `src/api/useApiQuery.ts`.
It returns a discriminated state: `{ status: 'loading' }`,
`{ status: 'success', data }`, or `{ status: 'error', error }`. Render accessible
loading/error feedback in the consuming page. Keep schemas at module scope;
changing the path or schema starts a new request. Cleanup cancels old requests
and prevents stale responses from replacing the current result.

Run `npm test --workspace=chispapp-frontend` for HTTP response and transformation
tests. The root `npm test` includes these tests.
