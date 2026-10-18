import { z } from 'zod';
import { IdSchema, PlayerStatusSchema } from './common';

/** Creates or updates a player; preserves jersey-number leading zeros and normalizes blank/missing names to null. */
export const PlayerInputSchema = z.object({
  number: z.string().trim().regex(/^\d+$/),
  name: z.preprocess(value => value ?? '', z.string().trim().max(100)).transform(value => value || null),
}).strict();

/** Changes a player's registration status; player ID comes from the route. */
export const UpdatePlayerStatusInputSchema = z.object({ status: PlayerStatusSchema }).strict();

/** Player details with the server-computed display name. */
export const PlayerResponseSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  number: z.string().regex(/^\d+$/),
  name: z.string().nullable(),
  status: PlayerStatusSchema,
  displayName: z.string().min(1),
}).strict();

/** List of players belonging to a team. */
export const PlayerListResponseSchema = z.array(PlayerResponseSchema);

/** Parsed TypeScript value produced by {@link PlayerInputSchema}. */
export type PlayerInput = z.infer<typeof PlayerInputSchema>;

/** Parsed TypeScript value produced by {@link UpdatePlayerStatusInputSchema}. */
export type UpdatePlayerStatusInput = z.infer<typeof UpdatePlayerStatusInputSchema>;

/** Parsed TypeScript value produced by {@link PlayerResponseSchema}. */
export type PlayerResponse = z.infer<typeof PlayerResponseSchema>;

/** Parsed TypeScript value produced by {@link PlayerListResponseSchema}. */
export type PlayerListResponse = z.infer<typeof PlayerListResponseSchema>;
