import { z } from 'zod';
import { IdSchema, NameSchema } from './common';

/** Creates a named group; the parent phase ID comes from the route. */
export const CreateGroupSchema = z.object({ name: NameSchema }).strict();

/** Replaces a group's name. */
export const UpdateGroupSchema = CreateGroupSchema;

/** Group returned by the API with its ID, parent phase ID and name. */
export const GroupResponseSchema = z.object({
  id: IdSchema,
  phaseId: IdSchema,
  name: NameSchema,
}).strict();

/** List of groups belonging to a phase. */
export const GroupListResponseSchema = z.array(GroupResponseSchema);

/** Parsed TypeScript value produced by {@link CreateGroupSchema}. */
export type CreateGroup = z.infer<typeof CreateGroupSchema>;

/** Parsed TypeScript value produced by {@link UpdateGroupSchema}. */
export type UpdateGroup = z.infer<typeof UpdateGroupSchema>;

/** Parsed TypeScript value produced by {@link GroupResponseSchema}. */
export type GroupResponse = z.infer<typeof GroupResponseSchema>;

/** Parsed TypeScript value produced by {@link GroupListResponseSchema}. */
export type GroupListResponse = z.infer<typeof GroupListResponseSchema>;
