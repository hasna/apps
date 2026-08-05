/**
 * @hasna/knowledge — the description field and the governance taxonomy.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * ONE definition of the vocabulary, imported by every layer that validates it:
 * the CLI flag parser, the item Store (local transport), the serve handler
 * (cloud transport), and the tests. The Postgres CHECK constraints in
 * db/pg-migrations.ts restate these values in SQL because a database constraint
 * cannot import TypeScript — a test in tests/knowledge-description-taxonomy.test.ts
 * asserts the two stay in step, so the duplication cannot drift silently.
 *
 * WHY A DESCRIPTION IS REQUIRED AND THE TAXONOMY AXES ARE NOT
 * ----------------------------------------------------------
 * The description is REQUIRED at write time. Owner directive 2026-08-05 asks
 * that every agent be notified of new/updated knowledge with a title and a
 * brief description; a notification cannot carry a field the store does not
 * hold. It is required rather than encouraged because the sibling package
 * already ran the experiment: mementos' `when_to_use` is exactly this kind of
 * optional human-guidance field and is populated on ZERO rows, while its
 * optional `summary` sits at 6.4% and is falling. An optional guidance field
 * lands at zero — measured, not predicted.
 *
 * `reach` and `consequence` are OPTIONAL, and that asymmetry is deliberate
 * rather than an inconsistency. Their defaults are the values a monitor
 * DE-PRIORITISES, so a lazy write lands quiet and searchable and only a
 * deliberate write escalates. Requiring them would make them 100% populated and
 * worthless as a signal — which is exactly what happened to mementos'
 * `importance`, `category` and `scope`: all three are populated on 400 of 400
 * sampled rows and carry almost no information, because a default did the work.
 * On mementos' own data the discriminator is deliberateness: rows left at the
 * default importance carry a summary 0.1% of the time, rows at importance 10
 * carry one 83.6% of the time. Coverage is not the measurement; distribution is.
 *
 * So: the field the notification cannot work without is forced, and the fields
 * whose value is their selectivity are left free and measured.
 */
/** Who a knowledge item binds. Ordered widest to narrowest. */
export declare const REACH_VALUES: readonly ['fleet', 'project', 'seat', 'self'];
export type KnowledgeReach = (typeof REACH_VALUES)[number];
/** What happens to a reader who has not read it. Ordered most to least urgent. */
export declare const CONSEQUENCE_VALUES: readonly ['blocking', 'standing', 'reference'];
export type KnowledgeConsequence = (typeof CONSEQUENCE_VALUES)[number];
/**
 * The value a monitor treats an UNMARKED item as. Deliberately not written to
 * the row on create — see the header. An absent axis and an axis explicitly set
 * to the default mean the same thing to a reader, and keeping absence absent is
 * what lets anyone measure how often an author actually chose.
 */
export declare const DEFAULT_REACH: KnowledgeReach;
export declare const DEFAULT_CONSEQUENCE: KnowledgeConsequence;
/**
 * Length bounds. The floor exists because "notes", "fix", and "wip" are
 * descriptions that satisfy a presence check and tell a reader nothing — a
 * required field with no floor degrades into a required keystroke. The ceiling
 * keeps the field renderable on one line of a notification, which is the whole
 * reason it exists rather than being read out of `content`.
 */
export declare const DESCRIPTION_MIN_LENGTH = 24;
export declare const DESCRIPTION_MAX_LENGTH = 280;
/**
 * Raised when a write carries no usable description.
 *
 * The message names the flag, because the agent that hits this is mid-write and
 * needs the remedy rather than a diagnosis — a guard whose message does not say
 * what to do produces an agent that debugs the store.
 */
export declare class KnowledgeDescriptionRequiredError extends Error {
    readonly code = "description_required";
    constructor(reason: string);
}
/** Raised when a taxonomy axis is given a value outside its closed vocabulary. */
export declare class KnowledgeTaxonomyValueError extends Error {
    readonly code = "taxonomy_value_invalid";
    constructor(field: string, received: unknown, allowed: readonly string[]);
}
/**
 * Validate and normalise a description, returning the trimmed value.
 *
 * Throws {@link KnowledgeDescriptionRequiredError} when absent, blank, or out of
 * bounds. Trimming happens BEFORE the length check so that padding cannot buy a
 * caller past the floor.
 */
export declare function validateDescription(raw: unknown): string;
/** Validate a `reach` value against the closed vocabulary. */
export declare function normalizeReach(raw: unknown): KnowledgeReach;
/** Validate a `consequence` value against the closed vocabulary. */
export declare function normalizeConsequence(raw: unknown): KnowledgeConsequence;
/**
 * Normalise the optional axes on a write. Absent stays absent — see the header
 * for why this does not stamp the defaults.
 */
export declare function normalizeTaxonomyInput(input: {
    reach?: unknown;
    consequence?: unknown;
}): {
    reach?: KnowledgeReach;
    consequence?: KnowledgeConsequence;
};
/**
 * The effective axes a reader/monitor should apply to an item, filling absence
 * with the quiet defaults. Read-side only — never written back to the row.
 */
export declare function effectiveTaxonomy(item: {
    reach?: string | null;
    consequence?: string | null;
}): {
    reach: KnowledgeReach;
    consequence: KnowledgeConsequence;
};
