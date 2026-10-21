import { z } from 'zod';
import { BooleanFromIntegerSchema, IdSchema, NameSchema, TournamentTypeSchema } from './common';

/** Creates a tournament; active defaults to true. */
export const CreateTournamentInputSchema = z.object({
  name: NameSchema,
  active: z.boolean().default(true),
}).strict();

/** Updates a tournament's name, current phase and active flag (default true). */
export const UpdateTournamentInputSchema = z.object({
  name: NameSchema,
  currentPhaseId: IdSchema,
  active: z.boolean().default(true),
}).strict();

/** Tournament details; parses active to boolean and permits null current phase/legacy category. */
export const TournamentResponseSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  active: BooleanFromIntegerSchema,
  currentPhaseId: IdSchema.nullable(),
  legacyType: TournamentTypeSchema.nullable(),
}).strict();

/** List of tournament responses. */
export const TournamentListResponseSchema = z.array(TournamentResponseSchema);

/** Parsed TypeScript value produced by {@link CreateTournamentInputSchema}. */
export type CreateTournamentInput = z.infer<typeof CreateTournamentInputSchema>;

/** Parsed TypeScript value produced by {@link UpdateTournamentInputSchema}. */
export type UpdateTournamentInput = z.infer<typeof UpdateTournamentInputSchema>;

/** Parsed TypeScript value produced by {@link TournamentResponseSchema}. */
export type TournamentResponse = z.infer<typeof TournamentResponseSchema>;

/** Parsed TypeScript value produced by {@link TournamentListResponseSchema}. */
export type TournamentListResponse = z.infer<typeof TournamentListResponseSchema>;
