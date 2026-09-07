/**
 * The root package's runtime re-exports of the shared project-resource-link
 * zod schemas.
 *
 * The VALUES are literally the @hasna/contracts schema objects (see
 * `client-types.test.ts`, which asserts identity) — only the published TYPE
 * annotation is local. The root `index.ts` must not re-export them straight
 * from `@hasna/contracts/schemas`: that would put a `@hasna/contracts` import
 * into the emitted `dist/index.d.ts` and break every strict `nodenext`
 * consumer (`TS2835` in contracts' own distribution, hasna/apps#1782). The
 * annotation here re-states each schema's output type through the structural
 * spellings in `./client-types.js`, which the conformance suite pins to the
 * real contracts declarations in both directions.
 *
 * Runtime note: the zod imports below are type-only positions; the contract
 * schema objects themselves are the values. zod stays a plain dependency.
 */

import { z } from "zod";
import type {
  ProjectResourceAuthority,
  ProjectResourceLink,
  ProjectResourceLinkCollectionV1,
  ProjectResourceLinkInput,
  ProjectResourceLinkLabels,
  ProjectResourceLinkLocator,
  ProjectResourceTargetKind,
} from "./client-types.js";
import {
  ProjectResourceAuthoritySchema as ContractsProjectResourceAuthoritySchema,
  ProjectResourceLinkCollectionV1Schema as ContractsProjectResourceLinkCollectionV1Schema,
  ProjectResourceLinkInputSchema as ContractsProjectResourceLinkInputSchema,
  ProjectResourceLinkLabelsSchema as ContractsProjectResourceLinkLabelsSchema,
  ProjectResourceLinkLocatorSchema as ContractsProjectResourceLinkLocatorSchema,
  ProjectResourceLinkSchema as ContractsProjectResourceLinkSchema,
  ProjectResourceTargetKindSchema as ContractsProjectResourceTargetKindSchema,
} from "@hasna/contracts/schemas";

// The two enums keep the exact generic shape contracts declares. The
// object/effect schemas are stated as the plain zod type over the local
// output spellings: every one of these schemas has identical input and output
// shapes, so a single type parameter is faithful (pinned by the conformance
// suite).
export const ProjectResourceAuthoritySchema: z.ZodEnum<
  ["todos", "conversations", "knowledge", "mementos", "orgs", "contacts"]
> = ContractsProjectResourceAuthoritySchema;

export const ProjectResourceTargetKindSchema: z.ZodEnum<
  ["contact", "org", "project", "task", "task_list", "plan", "channel", "collection", "item"]
> = ContractsProjectResourceTargetKindSchema;

export const ProjectResourceLinkLabelsSchema: z.ZodType<ProjectResourceLinkLabels> =
  ContractsProjectResourceLinkLabelsSchema;

export const ProjectResourceLinkLocatorSchema: z.ZodType<ProjectResourceLinkLocator> =
  ContractsProjectResourceLinkLocatorSchema;

export const ProjectResourceLinkInputSchema: z.ZodType<ProjectResourceLinkInput> =
  ContractsProjectResourceLinkInputSchema;

export const ProjectResourceLinkSchema: z.ZodType<ProjectResourceLink> =
  ContractsProjectResourceLinkSchema;

export const ProjectResourceLinkCollectionV1Schema: z.ZodType<ProjectResourceLinkCollectionV1> =
  ContractsProjectResourceLinkCollectionV1Schema;