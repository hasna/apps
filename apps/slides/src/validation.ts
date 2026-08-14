import { z } from "zod";
import type { DeckData } from "./types.js";

export const slideTransitionSchema = z.enum([
  "none",
  "fade",
  "slide",
  "convex",
  "concave",
  "zoom",
]);

export const slideBodyFormatSchema = z.enum(["markdown", "html"]);

/** A leaf slide (no children) — the shape of every vertical sub-slide. */
const leafSlideSchema = z.object({
  id: z.string().min(1),
  body: z.string(),
  format: slideBodyFormatSchema,
  notes: z.string().optional(),
  fragments: z.array(z.string()).optional(),
  transition: slideTransitionSchema.optional(),
  background: z.string().optional(),
  autoAnimate: z.boolean().optional(),
  attributes: z.record(z.string()).optional(),
});

/** A top-level slide may carry one level of vertical children. */
export const slideSchema = leafSlideSchema.extend({
  children: z.array(leafSlideSchema).optional(),
});

export const deckConfigSchema = z
  .object({
    transition: slideTransitionSchema.optional(),
    transitionSpeed: z.enum(["default", "fast", "slow"]).optional(),
    controls: z.boolean().optional(),
    progress: z.boolean().optional(),
    slideNumber: z.union([z.boolean(), z.string()]).optional(),
    center: z.boolean().optional(),
    loop: z.boolean().optional(),
    hash: z.boolean().optional(),
    autoSlide: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    margin: z.number().optional(),
  })
  .passthrough();

export const deckDataSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  theme: z.string().min(1),
  config: deckConfigSchema,
  slides: z.array(slideSchema),
  meta: z.record(z.unknown()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
});

/**
 * Validate and normalize an untrusted value into a {@link DeckData}. Throws a
 * `ZodError` if the value is not a well-formed deck.
 */
export function parseDeckData(value: unknown): DeckData {
  return deckDataSchema.parse(value) as DeckData;
}

/** Non-throwing variant of {@link parseDeckData}. */
export function safeParseDeckData(value: unknown) {
  return deckDataSchema.safeParse(value);
}
