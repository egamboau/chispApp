import { z } from 'zod';
import { CoercedIdSchema, IdSchema, NameSchema, TournamentTypeSchema } from './common';

/** Phase format: standings table or elimination. */
export const PhaseTypeSchema = z.enum(['TABLE', 'ELIMINATION']);

/** Creates a phase under the route's tournament; type defaults to TABLE and order to 1. */
export const CreatePhaseInputSchema = z.object({
  name: NameSchema,
  type: z.preprocess(value => value || undefined, PhaseTypeSchema.default('TABLE')),
  tournamentType: TournamentTypeSchema.optional(),
  sortOrder: z.preprocess(value => value || undefined, CoercedIdSchema.default(1)),
}).strict();

/** Replaces phase settings; its independently configurable category is optional. */
export const UpdatePhaseInputSchema = z.object({
  name: NameSchema,
  type: PhaseTypeSchema,
  tournamentType: TournamentTypeSchema.optional(),
  sortOrder: CoercedIdSchema,
}).strict();

/** Phase details including parent tournament, format, category and order. */
export const PhaseResponseSchema = z.object({
  id: IdSchema,
  tournamentId: IdSchema,
  name: NameSchema,
  type: PhaseTypeSchema,
  sortOrder: IdSchema,
  tournamentType: TournamentTypeSchema,
}).strict();

/** List of phases belonging to a tournament. */
export const PhaseListResponseSchema = z.array(PhaseResponseSchema);

/** Parsed TypeScript value produced by {@link PhaseTypeSchema}. */
export type PhaseType = z.infer<typeof PhaseTypeSchema>;

/** Parsed TypeScript value produced by {@link CreatePhaseInputSchema}. */
export type CreatePhaseInput = z.infer<typeof CreatePhaseInputSchema>;

/** Parsed TypeScript value produced by {@link UpdatePhaseInputSchema}. */
export type UpdatePhaseInput = z.infer<typeof UpdatePhaseInputSchema>;

/** Parsed TypeScript value produced by {@link PhaseResponseSchema}. */
export type PhaseResponse = z.infer<typeof PhaseResponseSchema>;

/** Parsed TypeScript value produced by {@link PhaseListResponseSchema}. */
export type PhaseListResponse = z.infer<typeof PhaseListResponseSchema>;
