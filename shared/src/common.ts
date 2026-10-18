import { z } from 'zod';

/** Positive integer ID in an API response; numeric strings are rejected. */
export const IdSchema = z.number().int().positive();

/** Request ID parsed as a positive integer, accepting numeric strings. */
export const CoercedIdSchema = z.coerce.number().int().positive();

/** Entity name trimmed to 1–100 characters. */
export const NameSchema = z.string().trim().min(1).max(100);

/** API date in YYYY-MM-DD format accepted by Date.parse; calendar round trips are not enforced. */
export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
  'Fecha inválida.',
);

/** Nonempty API timestamp string, preserving the server's format. */
export const TimestampSchema = z.string().min(1);

/** Parses an HTTP boolean or 0/1 into a boolean. */
export const BooleanFromIntegerSchema = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(Boolean);

/** Player registration status. */
export const PlayerStatusSchema = z.enum(['REGISTERED', 'UNREGISTERED']);

/** Match session: morning or afternoon. */
export const MatchTimeSchema = z.enum(['MORNING', 'AFTERNOON']);

/** Competition category: male or female. */
export const TournamentTypeSchema = z.enum(['MALE', 'FEMALE']);

/** API error body; the HTTP status is handled separately. */
export const ApiErrorResponseSchema = z.object({ error: z.string() }).strict();

/** Parsed TypeScript value produced by {@link PlayerStatusSchema}. */
export type PlayerStatus = z.infer<typeof PlayerStatusSchema>;

/** Parsed TypeScript value produced by {@link MatchTimeSchema}. */
export type MatchTime = z.infer<typeof MatchTimeSchema>;

/** Parsed TypeScript value produced by {@link TournamentTypeSchema}. */
export type TournamentType = z.infer<typeof TournamentTypeSchema>;

/** Parsed TypeScript value produced by {@link ApiErrorResponseSchema}. */
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

/** Legacy alias of CoercedIdSchema. */
export const idSchema = CoercedIdSchema;

/** Legacy alias of DateSchema. */
export const dateSchemas = DateSchema;

/** Legacy value alias of MatchTimeSchema. */
export const MatchTime = MatchTimeSchema;
