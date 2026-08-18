/**
 * MON-V2-04 — strict Zod schema for the slug definitions the daemon accepts,
 * embodying the MON-V2-01 definition contract (design.md section 3):
 *
 * - commands are structured argv only: `{ executable, args }`; shell strings,
 *   `sh -c` mode, and shell interpolation are rejected at registration, so
 *   the shell-rejection guarantee holds at runtime;
 * - cadence is `{ type: "interval", seconds }` or
 *   `{ type: "cron", expression, timezone }` — the legacy `every: "5m"`
 *   string-unit shape is not part of the v2 schema;
 * - retry policy lives under `execution` (maxAttempts, retryBackoffSeconds);
 * - every check carries at least one expectation.
 *
 * This is the daemon-consumed subset of the MON-V2-01 schema module
 * (`src/slugs/schema.ts`, PR 480); predicate/output/action semantics belong
 * to that lane. The CommandSpec rules below are identical to that module's.
 */

import { z } from "zod";

// ── Slug name ─────────────────────────────────────────────────────────────────

export const SLUG_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const SlugNameSchema = z
  .string()
  .min(1, "name must not be empty")
  .max(64, "name too long (max 64 chars)")
  .regex(
    SLUG_NAME_PATTERN,
    "name must match ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$ (lowercase letters, digits, single hyphens)",
  );

// ── Command execution ─────────────────────────────────────────────────────────

/**
 * A single program path: no whitespace and no shell metacharacters. The v2
 * schema executes commands through Bun.spawn with an argv array only.
 */
export const EXECUTABLE_PATTERN = /^[^\s"'`$;&|><()*?#~[\]{}]+$/;

/** Basenames of known shells. Invoking one with a -c-style flag is shell mode. */
const SHELL_BASENAMES = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "ksh",
  "csh",
  "tcsh",
  "ash",
  "cmd",
  "powershell",
  "pwsh",
]);

const SHELL_EXEC_FLAGS = new Set(["-c", "-command", "-Command", "/c", "/k", "/K"]);

/** Shell interpolation forms that are never allowed, even inside argv entries. */
const SHELL_INTERPOLATION_PATTERN = /[$]{[^}]*}|[`]|\$\(/;

/** Opaque configuration references: identifiers only, never values. */
export const ENV_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function executableBasename(executable: string): string {
  const parts = executable.split("/");
  const last = parts[parts.length - 1] ?? "";
  return last.endsWith(".exe") ? last.slice(0, -4) : last;
}

export const CommandSpecSchema = z
  .object({
    executable: z
      .string()
      .max(512, "executable too long")
      .regex(
        EXECUTABLE_PATTERN,
        "executable must be a single program path without whitespace or shell metacharacters",
      ),
    args: z
      .array(
        z
          .string()
          .min(1, "args entries must not be empty")
          .max(4096, "args entry too long")
          .refine(
            (arg) => !SHELL_INTERPOLATION_PATTERN.test(arg),
            "shell interpolation is not part of the v2 definition schema",
          ),
      )
      .max(256, "too many args")
      .default([]),
    cwd: z.string().min(1, "cwd must not be empty").max(1024, "cwd too long").optional(),
    timeoutSeconds: z
      .number()
      .int("timeoutSeconds must be an integer")
      .positive("timeoutSeconds must be > 0")
      .max(86_400, "timeoutSeconds too large (max 86400)"),
    envRefs: z
      .array(
        z.string().regex(
          ENV_REF_PATTERN,
          "envRefs must be opaque identifiers (letters, digits, underscores), never values",
        ),
      )
      .max(32, "too many envRefs")
      .optional(),
  })
  .strict()
  .superRefine((command, ctx) => {
    const bin = executableBasename(command.executable);
    const firstArg = command.args[0];
    if (SHELL_BASENAMES.has(bin) && firstArg !== undefined && SHELL_EXEC_FLAGS.has(firstArg)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["executable"],
        message:
          "shell mode (sh -c and equivalents) is not part of the v2 definition schema",
      });
    }
  });

export type CommandSpec = z.infer<typeof CommandSpecSchema>;

// ── Cadence ───────────────────────────────────────────────────────────────────

export const CadenceSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("interval"),
      seconds: z
        .number()
        .int("seconds must be an integer")
        .positive("seconds must be > 0")
        .max(604_800, "interval too large (max 7 days in seconds)"),
      jitterSeconds: z
        .number()
        .int("jitterSeconds must be an integer")
        .nonnegative("jitterSeconds must be >= 0")
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("cron"),
      expression: z.string().min(1, "expression must not be empty"),
      timezone: z.string().min(1, "timezone must not be empty"),
    })
    .strict(),
]);

// ── Execution policy ──────────────────────────────────────────────────────────

export const RETRY_ON_VALUES = ["failed", "timeout", "unknown", "worker_lost"] as const;

export const ExecutionSchema = z
  .object({
    timeoutSeconds: z.number().int().positive().max(86_400).default(60),
    maxConcurrency: z.number().int().positive().max(64).default(1),
    overlap: z.enum(["allow", "skip", "queue"]).default("skip"),
    maxAttempts: z.number().int().positive().max(16).default(1),
    retryBackoffSeconds: z
      .array(z.number().int().nonnegative())
      .max(16)
      .default([]),
    retryOn: z.array(z.enum(RETRY_ON_VALUES)).max(8).default([]),
  })
  .strict();

// ── Checks ────────────────────────────────────────────────────────────────────

/** Per-check expectations — shape only; predicate semantics belong to MON-V2-01. */
const ExpectSchema = z
  .object({
    exit: z.union([z.number().int(), z.array(z.number().int()).min(1)]).optional(),
    stdout: z.array(z.unknown()).max(32).optional(),
    stderr: z.array(z.unknown()).max(32).optional(),
    json: z.array(z.unknown()).max(32).optional(),
  })
  .strict()
  .superRefine((expect, ctx) => {
    if (
      expect.exit === undefined &&
      (expect.stdout === undefined || expect.stdout.length === 0) &&
      (expect.stderr === undefined || expect.stderr.length === 0) &&
      (expect.json === undefined || expect.json.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expect"],
        message:
          "a check must carry at least one expectation (exit, stdout, stderr, or json); an empty expect accepts any outcome",
      });
    }
  });

export const CheckDefinitionSchema = z
  .object({
    id: z.string().min(1, "check id must not be empty").max(64, "check id too long"),
    command: CommandSpecSchema,
    expect: ExpectSchema,
    required: z.boolean().optional(),
  })
  .strict();

export const ChecksAggregateSchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("all") }).strict(),
    z.object({ mode: z.literal("any") }).strict(),
    z
      .object({ mode: z.literal("threshold"), minPass: z.number().int().positive() })
      .strict(),
  ])
  .default({ mode: "all" });

// ── Slug definition ───────────────────────────────────────────────────────────

export const SlugDefinitionSchema = z
  .object({
    schemaVersion: z.literal(2, {
      errorMap: () => ({ message: "schemaVersion must be exactly 2" }),
    }),
    name: SlugNameSchema,
    description: z.string().max(1024, "description too long").optional(),
    tags: z.array(z.string().min(1)).max(64).optional(),
    cadence: CadenceSchema,
    execution: ExecutionSchema.optional(),
    checks: z.array(CheckDefinitionSchema),
    checksAggregate: ChecksAggregateSchema,
  })
  .strict()
  .superRefine((definition, ctx) => {
    if (definition.checks.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checks"],
        message: "checks must contain at least one check",
      });
    }
    const seen = new Set<string>();
    for (const check of definition.checks) {
      if (seen.has(check.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["checks"],
          message: `duplicate check id: ${check.id}`,
        });
      }
      seen.add(check.id);
    }
  });

export type SlugDefinition = z.infer<typeof SlugDefinitionSchema>;

export type ValidationResult = { ok: true; definition: SlugDefinition } | { ok: false; errors: string[] };

/** Validate a raw definition; on success returns the parsed (defaulted) form. */
export function validateSlugDefinition(input: unknown): ValidationResult {
  const parsed = SlugDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "definition"}: ${i.message}`) };
  }
  return { ok: true, definition: parsed.data };
}
