# React frontend

The public tournament display and built assets are served at `/display/`.
The Vite dev server uses the same path and proxies `/api` to port 3000.
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

## Presentation components

`Layout` supplies the public display shell and skip link; pass `Navigation` as its
`navigation` prop and page content as children. Navigation accepts `{ href, label }`
items plus `currentHref` and uses ordinary links with `aria-current`.

`MatchCard` and `Scoreboard` accept a parsed shared `MatchResponse`. `TeamLabel`
accepts the same match plus `teamA`, `teamB`, or `lineTeam` as `role`; it preserves
pending group assignments and hides unpublished line assignments. React escapes
all team text. `MatchList` accepts either `loading: true` or a `matches` array;
loading and empty states announce themselves with `role="status"`.

The shared CSS Module preserves the public display palette and uses flexible grids
with tablet (900px) and mobile (520px) breakpoints. The public display preserves live/calendar/results/standings/scoring tabs, active tournament
and phase selection, date/category/status filters, and SSE updates. The backend remains the
authority for hidden-line ordering, visibility and all standings/scoring calculations.
SSE errors reconnect after three seconds; a 45-second heartbeat watchdog detects silent
connections. Selection changes and unmount cancel in-flight requests and timers.
Run the frontend tests for server-rendered component behavior and privacy checks.

## Administration

The single `index.html` / `main.tsx` entry selects public or administrative React
components from the current URL. Administration is served at `/admin/`, `/admin/teams.html`,
`/admin/calendar.html` and `/admin/scoring.html`; existing links remain valid.
Cloudflare Access checks run before serving these pages and `/api/admin` requests.
Administrative code and CSS load on demand only for `/admin` routes; `/display`
renders the public display. During development, open `http://localhost:5173/admin/` for administration or
`http://localhost:5173/display/` for the public display. Vite proxies API requests
to the backend on port 3000. Unknown page URLs return 404. Production serves
both pages from the backend, with compiled assets under `/display/assets/`.

Admin forms parse shared input schemas and validated API responses. Mutations use
same-origin `/api/admin`, display server errors without retrying writes, and block
duplicate submissions. Failed reads disable stale editing; selection changes abort
old requests. Calendar SSE refreshes retain filters and drafts. Confirmed group
positions and API-created match-winner references survive schedule edits; the server
owns all transition and assignment checks. Scoring deep links resolve tournament and
phase before loading a finished match, including inactive tournaments. Create scoring
tables in Tablas, then select one for new or existing player totals. The UI validates
the selected table ID and sends its name to the existing scoring API. Registro
retains valid match/team/table selections for consecutive entries; Goleadores opens
existing entries in Registro for editing. Task panels remain mounted to preserve drafts.

Frontend regressions cover participant preservation, lifecycle controls, position
blockers, protected writes, cancellation and scoring links. Backend HTTP tests cover
Access, CRUD conflicts, score transitions and every preserved admin URL.
