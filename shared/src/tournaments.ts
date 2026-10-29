import { z } from 'zod';
import { BooleanFromIntegerSchema, IdSchema, NameSchema, TournamentTypeSchema } from './common';

/** Creates a tournament; active defaults to true. */
export const CreateTournamentInputSchema = z.object({
  name: NameSchema,
  active: z.boolean().default(true),
}).strict();

/** Updates both category selections; accepts the legacy single-phase payload for older callers. */
export const UpdateTournamentInputSchema = z.object({
  name: NameSchema,
  currentPhaseId: IdSchema.optional(),
  currentMalePhaseId: IdSchema.nullable().optional(),
  currentFemalePhaseId: IdSchema.nullable().optional(),
  active: z.boolean().default(true),
}).strict().refine(value => value.currentPhaseId !== undefined ? value.currentMalePhaseId === undefined && value.currentFemalePhaseId === undefined : value.currentMalePhaseId !== undefined && value.currentFemalePhaseId !== undefined, { message: 'Indica las fases actuales por categoría.' });

/** Tournament details; parses active to boolean and permits null current phase/legacy category. */
export const TournamentResponseSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  active: BooleanFromIntegerSchema,
  currentPhaseId: IdSchema.nullable(),
  currentMalePhaseId: IdSchema.nullable(),
  currentFemalePhaseId: IdSchema.nullable(),
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
