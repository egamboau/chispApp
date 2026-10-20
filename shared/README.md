# Shared API contracts

`@jupas/shared` contains Zod schemas and their inferred TypeScript types for API
requests and responses. These contracts describe HTTP data, not SQLite rows.
Import them from `@jupas/shared`.

## Migration status

The request contracts define the API intended for the React migration. The current
backend and legacy UI do not yet consume these schemas. In particular, the current
API still accepts legacy match/team inputs and scoring-table names; adopting the
ID-based contracts requires a separate backend and UI change.

Participant scheduling is already supported by the merged backend. Use
`ParticipantMatchInputSchema` for that request body, including `phaseId`, `groupId`,
schedule fields and all three participant references. `MatchInputSchema` remains
the intended ID-based fixed-team migration contract.

## Conventions

- Input schemas validate request bodies; IDs already supplied in a route are omitted
  from the body. Filter schemas validate query parameters.
- Relations in request bodies use IDs. Names and other values obtainable from those
  IDs are resolved by the server. An entity's own name remains an editable field.
- Objects are strict: unknown fields are rejected.
- `CoercedIdSchema` accepts values such as `'12'` and returns a positive integer;
  `IdSchema` requires a positive integer number in responses.
- Exported types use `z.infer` and describe the result **after parsing**, including
  defaults and transformations. Use `z.input<typeof Schema>` when you need the type
  accepted before parsing.
- Each `*ListResponseSchema` validates an array of its corresponding response schema.
  Its exported `*ListResponse` type describes that parsed array.
- Response schemas may contain names and derived fields for display. Parsing
  `active` and `lineVisible` converts HTTP values `0`/`1` into booleans; other numeric
  response fields are not coerced.

## Common values (`src/common.ts`)

| Contract | Purpose |
| --- | --- |
| `IdSchema`, `CoercedIdSchema` | Positive integer IDs, without/with coercion. |
| `NameSchema` | Trims a name and requires 1–100 characters. |
| `DateSchema` | Requires `YYYY-MM-DD` and a date accepted by `Date.parse`; does not enforce a strict calendar round trip. |
| `TimestampSchema` | Nonempty timestamp string; preserves the API's timestamp format. |
| `BooleanFromIntegerSchema` | Accepts a boolean or `0`/`1` and returns a boolean. |
| `PlayerStatusSchema` | `REGISTERED` or `UNREGISTERED`. |
| `MatchTimeSchema` | `MORNING` or `AFTERNOON`. |
| `TournamentTypeSchema` | `MALE` or `FEMALE`. |
| `ApiErrorResponseSchema` | Error response body `{ error: string }`; HTTP status is handled separately. |

`idSchema`, `dateSchemas` and the value `MatchTime` are aliases retained from the
initial contracts. `LinevisibilitySchema`/`Linevisibility` similarly alias
`LineVisibilitySchema`/`LineVisibility` in the match module.

## Groups (`src/groups.ts`)

| Contract | Purpose |
| --- | --- |
| `CreateGroupSchema` | New group's own name; parent phase ID comes from the route. |
| `UpdateGroupSchema` | Replaces a group's name. |
| `GroupResponseSchema` | Group ID, parent phase ID and name. |

The request types are named `CreateGroup` and `UpdateGroup`.

## Teams (`src/teams.ts`)

| Contract | Purpose |
| --- | --- |
| `CreateTeamInputSchema` | New team's own name and required `tournamentId`; rejects `tournamentType`. |
| `UpdateTeamInputSchema` | Replaces a team's name. |
| `TeamResponseSchema` | Team ID, name, category and tournament ID; permits a null tournament ID in legacy responses. |

## Matches and player scoring (`src/match.ts`)

| Contract | Purpose |
| --- | --- |
| `MatchStatusSchema` | `SCHEDULED`, `LIVE` or `FINISHED`. |
| `MatchParticipantSchema`, `MatchParticipantsSchema` | Request references to a fixed team, group position or match winner; all three roles are required. |
| `ParticipantMatchInputSchema` | Current participant scheduling request; omitted, null or blank sort order becomes null. |
| `MatchParticipantResponseSchema`, `MatchParticipantDetailsSchema`, `MatchParticipantsResponseSchema` | Numeric response references, resolution details and all three roles; hidden line details are null. |
| `MatchInputSchema` | Match scheduling body: `groupId`, three team IDs, date, jornada, court and optional nullable sort order. Phase, category and team names are derived from IDs. |
| `InsertMatchSchema`, `UpdateMatchSchema` | Aliases of `MatchInputSchema` for create and full scheduling updates. |
| `MatchFiltersSchema` | Optional phase, group, category, status and date query filters. |
| `UpdateSortOrderSchema` | Replaces official order with a positive integer, or clears it with `null`. |
| `LineVisibilitySchema` | Publishes/hides line assignments; the date comes from the route. |
| `LineVisibilityResponseSchema` | Date and resulting visibility. |
| `ScoreSchema` | Increment/decrement (`1`/`-1`) for team `A` or `B`. |
| `ResultSchema` | Replaces both scores with nonnegative integers. |
| `CardsSchema` | Replaces yellow/red card counts for both teams. |
| `NewScoringSchema` | Creates player scoring using `playerId`, required `scoringTableId` and three scoring counts; match ID comes from the route. At least one count must be positive. |
| `ScoringSchema` | Replaces scoring counts; optional `scoringTableId` changes the table. Match/player IDs come from the route. At least one count must be positive. |
| `MatchScoringResponseSchema` | Player's scoring for a match, including table name, total, team ID and jersey number. |
| `MatchResponseSchema` | Match details with display names, IDs, scores, cards, timestamps, visibility and participant details. Pending team IDs, hidden lines and undefined official order use `null`. |

These schemas validate payload shape. Entity existence, membership, distinct teams,
authorization and allowed match-state transitions remain server responsibilities.

## Tournaments (`src/tournaments.ts`)

| Contract | Purpose |
| --- | --- |
| `CreateTournamentInputSchema` | Name and optional active flag, defaulting to `true`. |
| `UpdateTournamentInputSchema` | Name, current phase ID and active flag, defaulting to `true`. |
| `TournamentResponseSchema` | Tournament details; current phase and legacy category may be null. Parsed `active` is boolean. |

## Phases (`src/phases.ts`)

| Contract | Purpose |
| --- | --- |
| `PhaseTypeSchema` | `TABLE` or `ELIMINATION`. |
| `CreatePhaseInputSchema` | Name, phase type (default `TABLE`), optional category and order (default `1`); tournament ID comes from the route. |
| `UpdatePhaseInputSchema` | Replaces name, type and order, with an optional category. |
| `PhaseResponseSchema` | Phase details including tournament ID and category. |

The phase's category is independently configurable, so it remains an input rather
than being assumed from the parent tournament.

## Players (`src/players.ts`)

| Contract | Purpose |
| --- | --- |
| `PlayerInputSchema` | Create/update jersey number and optional name. Preserves leading zeros in numbers; missing, null or blank names become `null`. Team/player IDs come from routes. |
| `UpdatePlayerStatusInputSchema` | Changes registration status. |
| `PlayerResponseSchema` | Player details and server-computed display name. |

## Phase details (`src/phase-details.ts`)

| Contract | Purpose |
| --- | --- |
| `MembershipInputSchema` | Assigns `teamId` to `groupId`; phase ID comes from the route. |
| `PhasePositionsResponseSchema` | Preview, confirm and reopen results: phase ID, confirmation timestamp, stale/canConfirm flags, errors and proposed assignments; excludes the internal snapshot. |
| `UpdateMembershipInputSchema` | Moves an existing membership to another group; phase/team IDs come from the route. |
| `MembershipResponseSchema` | Phase, group and team IDs; list responses may include group/team names. |
| `ClassificationRuleInputSchema` | Creates/updates a destination label for explicit positions or an inclusive range. Parsing deduplicates/sorts positions and computes range bounds. |
| `ClassificationRuleResponseSchema` | Rule IDs, label, bounds and positions as an array, never serialized JSON. |
| `SanctionInputSchema` | Nonblank sanction reason; phase/team IDs come from the route. |
| `SanctionResponseSchema` | Sanction IDs and reason, optionally enriched with team name. |
| `TeamCardsInputSchema` | Independent team card counts for a phase; at least one count must be positive. |
| `TeamCardsResponseSchema` | Phase/team IDs and card counts, optionally enriched with team name. |
| `StandingResponseSchema` | One team's computed statistics, position, sanction and qualification/tiebreaker details. |
| `StandingsGroupResponseSchema` | Group details with its computed standings. |
| `PhaseStandingsResponseSchema` | Phase, rules and grouped standings; `hasStandings` and optional message describe availability for the phase type. |
| `ScoringTableInputSchema` | Creates/renames a scoring table using its own name; phase/table IDs come from routes. |
| `ScoringTableResponseSchema` | Scoring table ID, name, tournament ID and category. |
| `ScoringRankingRowResponseSchema` | Player totals and rank, enriched with team/player display fields. |
| `PhaseScoringResponseSchema` | Phase and scoring tables, each with separate total, pepitas and horquetas rankings. |

## Checks

Run `npm test --workspace=@jupas/shared` from the repository root to build the
package and test contract parsing. Run `npm run typecheck` for all workspaces.
