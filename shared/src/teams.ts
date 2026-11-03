import { z } from 'zod';
import { CoercedIdSchema, IdSchema, NameSchema, TournamentTypeSchema } from './common';

export { TournamentTypeSchema } from './common';

/** Creates a team with an optional category; legacy callers retain the server default. */
export const CreateTeamInputSchema = z.object({
  name: NameSchema,
  tournamentId: CoercedIdSchema,
  tournamentType: TournamentTypeSchema.optional(),
}).strict();

/** Replaces a team's name. */
export const UpdateTeamInputSchema = z.object({ name: NameSchema }).strict();

/** Team details; tournamentId may be null in legacy API responses. */
export const TeamResponseSchema = z.object({
  id: IdSchema,
  tournamentType: TournamentTypeSchema,
  tournamentId: IdSchema.nullable(),
  name: NameSchema,
}).strict();

/** List of team responses. */
export const TeamListResponseSchema = z.array(TeamResponseSchema);

/** Parsed TypeScript value produced by {@link CreateTeamInputSchema}. */
export type CreateTeamInput = z.infer<typeof CreateTeamInputSchema>;

/** Parsed TypeScript value produced by {@link UpdateTeamInputSchema}. */
export type UpdateTeamInput = z.infer<typeof UpdateTeamInputSchema>;

/** Parsed TypeScript value produced by {@link TeamResponseSchema}. */
export type TeamResponse = z.infer<typeof TeamResponseSchema>;

/** Parsed TypeScript value produced by {@link TeamListResponseSchema}. */
export type TeamListResponse = z.infer<typeof TeamListResponseSchema>;
