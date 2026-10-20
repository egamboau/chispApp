import { z } from 'zod';
import { CoercedIdSchema, IdSchema, NameSchema, TimestampSchema, TournamentTypeSchema } from './common';
import { GroupResponseSchema } from './groups';
import { PhaseResponseSchema } from './phases';

/** Public result of previewing, confirming or reopening phase positions; excludes the internal snapshot. */
export const PhasePositionsResponseSchema = z.object({
  phaseId: IdSchema,
  confirmedAt: TimestampSchema.nullable(),
  stale: z.boolean(),
  canConfirm: z.boolean(),
  errors: z.array(z.string()),
  assignments: z.array(z.object({
    matchId: IdSchema,
    role: z.enum(['teamA', 'teamB', 'lineTeam']),
    kind: z.literal('GROUP_POSITION'),
    sourcePhaseId: IdSchema,
    sourceGroupId: IdSchema,
    position: IdSchema,
    sourceMatchId: z.null(),
    resolvedTeamId: IdSchema.nullable(),
    teamId: IdSchema.nullable(),
    teamName: NameSchema.nullable(),
  }).strict()),
}).strict();

export type PhasePositionsResponse = z.infer<typeof PhasePositionsResponseSchema>;

/** Assigns a team ID to a group ID; phase ID comes from the route. */
export const MembershipInputSchema = z.object({
  groupId: CoercedIdSchema,
  teamId: CoercedIdSchema,
}).strict();

/** Moves a membership to another group; phase/team IDs come from the route. */
export const UpdateMembershipInputSchema = z.object({ groupId: CoercedIdSchema }).strict();

/** Membership IDs, optionally enriched with team/group names. */
export const MembershipResponseSchema = z.object({
  phaseId: IdSchema,
  groupId: IdSchema,
  teamId: IdSchema,
  teamName: NameSchema.optional(),
  groupName: NameSchema.optional(),
}).strict();

/** List of memberships for a phase. */
export const MembershipListResponseSchema = z.array(MembershipResponseSchema);

/** Creates/updates a destination label from positions or an inclusive range; parses into sorted unique positions and bounds. */
export const ClassificationRuleInputSchema = z.object({
  positions: z.array(CoercedIdSchema).min(1).optional(),
  startPosition: CoercedIdSchema.optional(),
  endPosition: CoercedIdSchema.optional(),
  label: z.string().trim().min(1),
}).strict().superRefine((value, context) => {
  if (!value.positions && ( !value.startPosition || !value.endPosition ||value.endPosition < value.startPosition || value.endPosition - value.startPosition > 1000)) 
    context.addIssue({ code: 'custom', message: 'Rango inválido.' });
}).transform(value => {
  const positions = [...new Set(value.positions ?? Array.from(
    { length: value.endPosition! - value.startPosition! + 1 },
    (_, index) => value.startPosition! + index,
  ))].sort((a, b) => a - b);
  return { startPosition: positions[0]!, endPosition: positions.at(-1)!, positions, label: value.label };
});

/** Classification rule with positions as an array, never serialized JSON. */
export const ClassificationRuleResponseSchema = z.object({
  id: IdSchema,
  phaseId: IdSchema,
  startPosition: IdSchema,
  endPosition: IdSchema,
  positions: z.array(IdSchema).min(1),
  label: z.string().min(1),
}).strict();

/** List of classification rules for a phase. */
export const ClassificationRuleListResponseSchema = z.array(ClassificationRuleResponseSchema);

/** Sets a nonblank sanction reason; phase/team IDs come from the route. */
export const SanctionInputSchema = z.object({ reason: z.string().trim().min(1) }).strict();

/** Sanction IDs and reason, optionally enriched with team name. */
export const SanctionResponseSchema = z.object({
  phaseId: IdSchema,
  teamId: IdSchema,
  reason: z.string().min(1),
  teamName: NameSchema.optional(),
}).strict();

/** List of sanctions for a phase. */
export const SanctionListResponseSchema = z.array(SanctionResponseSchema);

/** Sets independent phase card counts for a team; at least one count must be positive. */
export const TeamCardsInputSchema = z.object({
  yellowCards: z.coerce.number().int().nonnegative(),
  redCards: z.coerce.number().int().nonnegative(),
}).strict().refine(value => value.yellowCards + value.redCards > 0);

/** Phase/team IDs and card counts, optionally enriched with team name. */
export const TeamCardsResponseSchema = z.object({
  phaseId: IdSchema,
  teamId: IdSchema,
  yellowCards: z.number().int().nonnegative(),
  redCards: z.number().int().nonnegative(),
  teamName: NameSchema.optional(),
}).strict();

/** List of independent team-card counts for a phase. */
export const TeamCardsListResponseSchema = z.array(TeamCardsResponseSchema);

/** Computed team statistics, rank, sanctions and qualification/tiebreaker details. */
export const StandingResponseSchema = z.object({
  teamId: IdSchema,
  teamName: NameSchema,
  played: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  draws: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  goalsFor: z.number().int().nonnegative(),
  goalsAgainst: z.number().int().nonnegative(),
  goalDifference: z.number().int(),
  points: z.number().int(),
  yellowCards: z.number().int().nonnegative(),
  redCards: z.number().int().nonnegative(),
  sanctioned: z.boolean(),
  sanctionReason: z.string().nullable(),
  position: IdSchema,
  requiresTiebreaker: z.boolean(),
  destination: z.string().nullable(),
  possibleDestinations: z.array(z.string()),
  tiebreakerRule: z.string().nullable(),
}).strict();

/** Group details with its computed team standings. */
export const StandingsGroupResponseSchema = GroupResponseSchema.extend({
  standings: z.array(StandingResponseSchema),
}).strict();

/** Phase, classification rules and grouped standings, with availability and optional explanation. */
export const PhaseStandingsResponseSchema = z.object({
  phase: PhaseResponseSchema,
  hasStandings: z.boolean(),
  message: z.string().optional(),
  rules: z.array(ClassificationRuleResponseSchema),
  groups: z.array(StandingsGroupResponseSchema),
}).strict();

/** Creates or renames a scoring table using its own name; parent/table IDs come from routes. */
export const ScoringTableInputSchema = z.object({ name: NameSchema }).strict();

/** Scoring-table identity, name, tournament ID and category. */
export const ScoringTableResponseSchema = z.object({
  id: IdSchema,
  tournamentId: IdSchema,
  tournamentType: TournamentTypeSchema,
  name: NameSchema,
}).strict();

/** Player totals and rank, enriched with player and team display fields. */
export const ScoringRankingRowResponseSchema = z.object({
  scoringTable: NameSchema,
  playerId: IdSchema,
  teamId: IdSchema,
  teamName: NameSchema,
  playerNumber: z.string(),
  playerName: z.string().nullable(),
  directGoals: z.number().int().nonnegative(),
  pepitas: z.number().int().nonnegative(),
  horquetas: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  position: IdSchema,
}).strict();

const ScoringRankingsResponseSchema = z.object({
  total: z.array(ScoringRankingRowResponseSchema),
  pepitas: z.array(ScoringRankingRowResponseSchema),
  horquetas: z.array(ScoringRankingRowResponseSchema),
}).strict();

/** Phase and scoring tables with separate total, pepitas and horquetas rankings. */
export const PhaseScoringResponseSchema = z.object({
  phase: PhaseResponseSchema,
  tables: z.array(z.object({
    id: IdSchema,
    name: NameSchema,
    rankings: ScoringRankingsResponseSchema,
  }).strict()),
}).strict();

/** Parsed TypeScript value produced by {@link MembershipInputSchema}. */
export type MembershipInput = z.infer<typeof MembershipInputSchema>;

/** Parsed TypeScript value produced by {@link UpdateMembershipInputSchema}. */
export type UpdateMembershipInput = z.infer<typeof UpdateMembershipInputSchema>;

/** Parsed TypeScript value produced by {@link MembershipResponseSchema}. */
export type MembershipResponse = z.infer<typeof MembershipResponseSchema>;

/** Parsed TypeScript value produced by {@link MembershipListResponseSchema}. */
export type MembershipListResponse = z.infer<typeof MembershipListResponseSchema>;

/** Parsed TypeScript value produced by {@link ClassificationRuleInputSchema}. */
export type ClassificationRuleInput = z.infer<typeof ClassificationRuleInputSchema>;

/** Parsed TypeScript value produced by {@link ClassificationRuleResponseSchema}. */
export type ClassificationRuleResponse = z.infer<typeof ClassificationRuleResponseSchema>;

/** Parsed TypeScript value produced by {@link ClassificationRuleListResponseSchema}. */
export type ClassificationRuleListResponse = z.infer<typeof ClassificationRuleListResponseSchema>;

/** Parsed TypeScript value produced by {@link SanctionInputSchema}. */
export type SanctionInput = z.infer<typeof SanctionInputSchema>;

/** Parsed TypeScript value produced by {@link SanctionResponseSchema}. */
export type SanctionResponse = z.infer<typeof SanctionResponseSchema>;

/** Parsed TypeScript value produced by {@link SanctionListResponseSchema}. */
export type SanctionListResponse = z.infer<typeof SanctionListResponseSchema>;

/** Parsed TypeScript value produced by {@link TeamCardsInputSchema}. */
export type TeamCardsInput = z.infer<typeof TeamCardsInputSchema>;

/** Parsed TypeScript value produced by {@link TeamCardsResponseSchema}. */
export type TeamCardsResponse = z.infer<typeof TeamCardsResponseSchema>;

/** Parsed TypeScript value produced by {@link TeamCardsListResponseSchema}. */
export type TeamCardsListResponse = z.infer<typeof TeamCardsListResponseSchema>;

/** Parsed TypeScript value produced by {@link StandingResponseSchema}. */
export type StandingResponse = z.infer<typeof StandingResponseSchema>;

/** Parsed TypeScript value produced by {@link StandingsGroupResponseSchema}. */
export type StandingsGroupResponse = z.infer<typeof StandingsGroupResponseSchema>;

/** Parsed TypeScript value produced by {@link PhaseStandingsResponseSchema}. */
export type PhaseStandingsResponse = z.infer<typeof PhaseStandingsResponseSchema>;

/** Parsed TypeScript value produced by {@link ScoringTableInputSchema}. */
export type ScoringTableInput = z.infer<typeof ScoringTableInputSchema>;

/** Parsed TypeScript value produced by {@link ScoringTableResponseSchema}. */
export type ScoringTableResponse = z.infer<typeof ScoringTableResponseSchema>;

/** Parsed TypeScript value produced by {@link ScoringRankingRowResponseSchema}. */
export type ScoringRankingRowResponse = z.infer<typeof ScoringRankingRowResponseSchema>;

/** Parsed TypeScript value produced by {@link PhaseScoringResponseSchema}. */
export type PhaseScoringResponse = z.infer<typeof PhaseScoringResponseSchema>;
