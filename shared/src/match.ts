import { z } from 'zod';
import {
  CoercedIdSchema,
  DateSchema,
  IdSchema,
  MatchTimeSchema,
  NameSchema,
  TimestampSchema,
  TournamentTypeSchema,
} from './common';

/** Match lifecycle state: scheduled, live or finished. */
export const MatchStatusSchema = z.enum(['SCHEDULED', 'LIVE', 'FINISHED']);

/** Fixed team, source group position or source match winner. */
export const MatchParticipantSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEAM'), teamId: CoercedIdSchema }).strict(),
  z.object({ kind: z.literal('GROUP_POSITION'), sourcePhaseId: CoercedIdSchema, sourceGroupId: CoercedIdSchema, position: CoercedIdSchema }).strict(),
  z.object({ kind: z.literal('MATCH_WINNER'), sourceMatchId: CoercedIdSchema }).strict(),
]);

/** Local and visitor are required; line assignment is optional. */
export const MatchParticipantsSchema = z.object({
  teamA: MatchParticipantSchema,
  teamB: MatchParticipantSchema,
  lineTeam: MatchParticipantSchema.nullable().optional(),
}).strict();

/** Scheduling with references, including teams that are not yet known. */
export const ParticipantMatchInputSchema = z.object({
  phaseId: CoercedIdSchema,
  groupId: CoercedIdSchema,
  date: DateSchema,
  jornada: MatchTimeSchema,
  court: CoercedIdSchema,
  sortOrder: z.preprocess(value => value === '' || value == null ? null : value, CoercedIdSchema.nullable()),
  participants: MatchParticipantsSchema,
}).strict();

/** Response references require numeric IDs without request coercion. */
export const MatchParticipantResponseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEAM'), teamId: IdSchema }).strict(),
  z.object({ kind: z.literal('GROUP_POSITION'), sourcePhaseId: IdSchema, sourceGroupId: IdSchema, position: IdSchema }).strict(),
  z.object({ kind: z.literal('MATCH_WINNER'), sourceMatchId: IdSchema }).strict(),
]);

/** Resolution state and original reference; hidden line details are null. */
export const MatchParticipantDetailsSchema = z.object({
  reference: MatchParticipantResponseSchema,
  resolvedTeamId: IdSchema.nullable(),
  resolvedTeam: z.object({ id: IdSchema, name: NameSchema }).strict().nullable(),
  status: z.enum(['PENDING', 'RESOLVED', 'CONFIRMED']),
}).strict();

export const MatchParticipantsResponseSchema = z.object({
  teamA: MatchParticipantDetailsSchema,
  teamB: MatchParticipantDetailsSchema,
  lineTeam: MatchParticipantDetailsSchema.nullable(),
}).strict();

export type MatchParticipant = z.infer<typeof MatchParticipantSchema>;
export type MatchParticipants = z.infer<typeof MatchParticipantsSchema>;
export type ParticipantMatchInput = z.infer<typeof ParticipantMatchInputSchema>;
export type MatchParticipantDetails = z.infer<typeof MatchParticipantsResponseSchema>;

const matchInputFields = {
  groupId: CoercedIdSchema,
  teamAId: CoercedIdSchema,
  teamBId: CoercedIdSchema,
  lineTeamId: CoercedIdSchema.nullable().optional(),
  date: DateSchema,
  jornada: MatchTimeSchema,
  court: z.coerce.number().int().positive(),
  sortOrder: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
};

/** Scheduling body using group and team IDs; server resolves phase, category and names. Entity checks remain server-side. */
export const MatchInputSchema = z.object(matchInputFields).strict();

/** Create-match body; uses the same scheduling fields as MatchInputSchema. */
export const InsertMatchSchema = MatchInputSchema;

/** Full scheduling-update body, using the same fields as MatchInputSchema. */
export const UpdateMatchSchema = MatchInputSchema;

/** Optional query filters for listing matches. */
export const MatchFiltersSchema = z.object({
  phaseId: CoercedIdSchema.optional(),
  groupId: CoercedIdSchema.optional(),
  tournamentType: TournamentTypeSchema.optional(),
  status: MatchStatusSchema.optional(),
  date: DateSchema.optional(),
}).strict();

/** Sets a positive official order, or clears it with null. */
export const UpdateSortOrderSchema = z.object({
  sortOrder: z.union([z.coerce.number().int().positive(), z.null()]),
}).strict();

/** Publishes or hides line assignments for the date supplied in the route. */
export const LineVisibilitySchema = z.object({ visible: z.boolean() }).strict();

/** Date and resulting line-assignment visibility. */
export const LineVisibilityResponseSchema = z.object({ date: DateSchema, visible: z.boolean() }).strict();

/** Adds or subtracts one goal for team A or B. */
export const ScoreSchema = z.object({
  team: z.enum(['A', 'B']),
  delta: z.union([z.literal(-1), z.literal(1)]),
}).strict();

/** Replaces both match scores with nonnegative integers. */
export const ResultSchema = z.object({
  scoreA: z.coerce.number().int().nonnegative(),
  scoreB: z.coerce.number().int().nonnegative(),
}).strict();

/** Replaces yellow/red card counts for both match teams. */
export const CardsSchema = z.object({
  yellowCardsA: z.coerce.number().int().nonnegative(),
  redCardsA: z.coerce.number().int().nonnegative(),
  yellowCardsB: z.coerce.number().int().nonnegative(),
  redCardsB: z.coerce.number().int().nonnegative(),
}).strict();

const scoringFields = {
  directGoals: z.coerce.number().int().nonnegative(),
  horquetas: z.coerce.number().int().nonnegative(),
  pepitas: z.coerce.number().int().nonnegative(),
};

const hasScoring = (value: { directGoals: number; horquetas: number; pepitas: number }) =>
  value.directGoals + value.horquetas + value.pepitas > 0;

/** Creates scoring for a player and scoring-table ID; match ID comes from the route. Requires a positive count. */
export const NewScoringSchema = z.object({
  playerId: CoercedIdSchema,
  ...scoringFields,
  scoringTableId: CoercedIdSchema,
}).strict().refine(hasScoring);

/** Replaces scoring counts and optionally changes the scoring-table ID; match/player IDs come from the route. */
export const ScoringSchema = z.object({
  ...scoringFields,
  scoringTableId: CoercedIdSchema.optional(),
}).strict().refine(hasScoring);

/** Player scoring for a match, enriched with table name, total, team ID and jersey number. */
export const MatchScoringResponseSchema = z.object({
  matchId: IdSchema,
  playerId: IdSchema,
  directGoals: z.number().int().nonnegative(),
  horquetas: z.number().int().nonnegative(),
  pepitas: z.number().int().nonnegative(),
  scoringTable: NameSchema,
  total: z.number().int().nonnegative(),
  teamId: IdSchema,
  playerNumber: z.string(),
}).strict();

/** List of player-scoring responses for a match. */
export const MatchScoringListResponseSchema = z.array(MatchScoringResponseSchema);

/** Match details for display; hidden lines and undefined order are nullable, and lineVisible parses to boolean. */
export const MatchResponseSchema = z.object({
  id: IdSchema,
  tournamentType: TournamentTypeSchema,
  date: DateSchema,
  jornada: MatchTimeSchema,
  teamA: NameSchema,
  teamB: NameSchema,
  lineTeam: NameSchema.nullable(),
  court: z.number().int().positive(),
  sortOrder: z.number().int().positive().nullable(),
  scoreA: z.number().int().nonnegative(),
  scoreB: z.number().int().nonnegative(),
  status: MatchStatusSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  phaseId: IdSchema,
  groupId: IdSchema,
  teamAId: IdSchema.nullable(),
  teamBId: IdSchema.nullable(),
  lineTeamId: IdSchema.nullable(),
  yellowCardsA: z.number().int().nonnegative(),
  redCardsA: z.number().int().nonnegative(),
  yellowCardsB: z.number().int().nonnegative(),
  redCardsB: z.number().int().nonnegative(),
  tournamentName: NameSchema,
  phaseName: NameSchema,
  groupName: NameSchema,
  lineVisible: z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(Boolean),
  lineAssigned: z.boolean().optional(),
  participants: MatchParticipantsResponseSchema,
}).strict();

/** List of match responses. */
export const MatchListResponseSchema = z.array(MatchResponseSchema);

/** Parsed TypeScript value produced by {@link MatchStatusSchema}. */
export type MatchStatus = z.infer<typeof MatchStatusSchema>;

/** Parsed TypeScript value produced by {@link MatchInputSchema}. */
export type MatchInput = z.infer<typeof MatchInputSchema>;

/** Alias of {@link MatchInput}. */
export type InsertMatch = MatchInput;

/** Alias of {@link MatchInput}. */
export type UpdateMatch = MatchInput;

/** Parsed TypeScript value produced by {@link MatchFiltersSchema}. */
export type MatchFilters = z.infer<typeof MatchFiltersSchema>;

/** Parsed TypeScript value produced by {@link UpdateSortOrderSchema}. */
export type UpdateSortOrder = z.infer<typeof UpdateSortOrderSchema>;

/** Parsed TypeScript value produced by {@link LineVisibilitySchema}. */
export type LineVisibility = z.infer<typeof LineVisibilitySchema>;

/** Parsed TypeScript value produced by {@link LineVisibilityResponseSchema}. */
export type LineVisibilityResponse = z.infer<typeof LineVisibilityResponseSchema>;

/** Parsed TypeScript value produced by {@link ScoreSchema}. */
export type Score = z.infer<typeof ScoreSchema>;

/** Parsed TypeScript value produced by {@link ResultSchema}. */
export type Result = z.infer<typeof ResultSchema>;

/** Parsed TypeScript value produced by {@link CardsSchema}. */
export type Cards = z.infer<typeof CardsSchema>;

/** Parsed TypeScript value produced by {@link NewScoringSchema}. */
export type NewScoring = z.infer<typeof NewScoringSchema>;

/** Parsed TypeScript value produced by {@link ScoringSchema}. */
export type Scoring = z.infer<typeof ScoringSchema>;

/** Parsed TypeScript value produced by {@link MatchScoringResponseSchema}. */
export type MatchScoringResponse = z.infer<typeof MatchScoringResponseSchema>;

/** Parsed TypeScript value produced by {@link MatchScoringListResponseSchema}. */
export type MatchScoringListResponse = z.infer<typeof MatchScoringListResponseSchema>;

/** Parsed TypeScript value produced by {@link MatchResponseSchema}. */
export type MatchResponse = z.infer<typeof MatchResponseSchema>;

/** Parsed TypeScript value produced by {@link MatchListResponseSchema}. */
export type MatchListResponse = z.infer<typeof MatchListResponseSchema>;

/** Legacy alias of LineVisibilitySchema. */
export const LinevisibilitySchema = LineVisibilitySchema;

/** Alias of {@link LineVisibility}. */
export type Linevisibility = LineVisibility;
