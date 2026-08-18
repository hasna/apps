/**
 * MON-V2-01 — strict Zod schema for declarative slug definitions (design
 * section 3, `apps/monitor/src/slugs/schema.ts`).
 *
 * A slug definition is immutable by revision. It carries structured argv
 * commands only: shell strings, shell interpolation, `sh -c`, and arbitrary
 * shell mode are not part of the v2 definition schema and are rejected here.
 * Pass/fail semantics are machine-checkable: every check carries at least one
 * expectation and the aggregate pass condition is explicit (`all`, `any`, or
 * `threshold: N of M`) — no prose-only pass or fail condition is accepted.
 */

import { z } from "zod";
import { CronExpressionParser } from "cron-parser";

// ── Slug name ─────────────────────────────────────────────────────────────────

/**
 * ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$
 */
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
 * schema executes commands through `Bun.spawn` with an argv array only.
 */
export const EXECUTABLE_PATTERN = /^[^\s"'`$;&|><()*?#~[\]{}]+$/;

/**
 * Basenames of known shells. Invoking one of these with a `-c`-style flag is
 * shell mode and is rejected even though each token passes the pattern check.
 */
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

// ── Predicates ────────────────────────────────────────────────────────────────

export const STRING_PREDICATE_OPS = ["equals", "contains", "not_contains", "regex"] as const;
export type StringPredicateOp = (typeof STRING_PREDICATE_OPS)[number];

function isValidRegExp(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export const StringPredicateSchema = z
  .object({
    op: z.enum(STRING_PREDICATE_OPS, {
      errorMap: () => ({
        message: `unsupported string predicate; supported: ${STRING_PREDICATE_OPS.join(", ")}`,
      }),
    }),
    expected: z.string().min(1, "expected must not be empty").max(1024, "expected too long"),
  })
  .strict()
  .superRefine((predicate, ctx) => {
    if (predicate.op === "regex" && !isValidRegExp(predicate.expected)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expected"],
        message: "regex predicate requires a valid regular expression",
      });
    }
  });

export type StringPredicate = z.infer<typeof StringPredicateSchema>;

export const JSON_PREDICATE_OPS = [
  "exists",
  "type",
  "equals",
  "not_equals",
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
  "matches",
] as const;
export type JsonPredicateOp = (typeof JSON_PREDICATE_OPS)[number];

export const JSON_TYPES = ["string", "number", "boolean", "null", "array", "object"] as const;
type JsonTypeName = (typeof JSON_TYPES)[number];

const JSON_NUMERIC_OPS: ReadonlySet<JsonPredicateOp> = new Set<JsonPredicateOp>([
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
]);

export const JsonPredicateSchema = z
  .object({
    op: z.enum(JSON_PREDICATE_OPS, {
      errorMap: () => ({
        message: `unsupported json predicate; supported: ${JSON_PREDICATE_OPS.join(", ")}`,
      }),
    }),
    path: z.string().min(1, "path must not be empty").max(256, "path too long"),
    expected: z.unknown().optional(),
  })
  .strict()
  .superRefine((predicate, ctx) => {
    if (predicate.op === "type") {
      const t = predicate.expected as JsonTypeName | undefined;
      if (typeof t !== "string" || !(JSON_TYPES as readonly string[]).includes(t)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["expected"],
          message: `type predicate requires one of: ${JSON_TYPES.join(", ")}`,
        });
      }
    } else if (JSON_NUMERIC_OPS.has(predicate.op)) {
      if (typeof predicate.expected !== "number" || Number.isNaN(predicate.expected)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["expected"],
          message: `${predicate.op} predicate requires a numeric expected value`,
        });
      }
    } else if (predicate.op === "matches") {
      if (
        typeof predicate.expected !== "string" ||
        predicate.expected.length === 0 ||
        !isValidRegExp(predicate.expected)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["expected"],
          message: "matches predicate requires a valid non-empty regular expression",
        });
      }
    } else if (
      (predicate.op === "equals" || predicate.op === "not_equals") &&
      predicate.expected === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expected"],
        message: `${predicate.op} predicate requires an expected value`,
      });
    }
  });

export type JsonPredicate = z.infer<typeof JsonPredicateSchema>;

// ── Checks ────────────────────────────────────────────────────────────────────

export const CheckDefinitionSchema = z
  .object({
    id: z.string().min(1, "check id must not be empty").max(64, "check id too long"),
    command: CommandSpecSchema,
    expect: z
      .object({
        exit: z
          .union([z.number().int(), z.array(z.number().int()).min(1)])
          .optional(),
        stdout: z.array(StringPredicateSchema).max(32).optional(),
        stderr: z.array(StringPredicateSchema).max(32).optional(),
        json: z.array(JsonPredicateSchema).max(32).optional(),
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
      }),
    required: z.boolean().optional(),
  })
  .strict();

export type CheckDefinition = z.infer<typeof CheckDefinitionSchema>;

// ── Aggregate pass condition ──────────────────────────────────────────────────

export const ChecksAggregateSchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("all") }).strict(),
    z.object({ mode: z.literal("any") }).strict(),
    z
      .object({ mode: z.literal("threshold"), minPass: z.number().int().positive() })
      .strict(),
  ])
  .default({ mode: "all" });

export type ChecksAggregate = z.infer<typeof ChecksAggregateSchema>;

// ── Cadence ───────────────────────────────────────────────────────────────────

function isValidCronExpression(expr: string): boolean {
  try {
    CronExpressionParser.parse(expr);
    return true;
  } catch {
    return false;
  }
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format();
    return true;
  } catch {
    return false;
  }
}

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
      expression: z.string().min(1, "expression must not be empty").refine(isValidCronExpression, {
        message: "expression must be a valid cron expression",
      }),
      timezone: z.string().min(1, "timezone must not be empty").refine(isValidTimezone, {
        message: "timezone must be a valid IANA timezone name",
      }),
    })
    .strict(),
]);

export type Cadence = z.infer<typeof CadenceSchema>;

// ── Targets and execution policy ──────────────────────────────────────────────

export const TargetsSchema = z
  .object({
    machineIds: z.array(z.string().min(1)).max(256).optional(),
    labels: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type Targets = z.infer<typeof TargetsSchema>;

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

export type Execution = z.infer<typeof ExecutionSchema>;

// ── Outputs ───────────────────────────────────────────────────────────────────

export const OutputDefinitionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("stdout"),
      maxBytes: z.number().int().positive().max(16_777_216),
      retain: z.enum(["excerpt", "full"]),
      redact: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("stderr"),
      maxBytes: z.number().int().positive().max(16_777_216),
      retain: z.enum(["excerpt", "full"]),
      redact: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal("exit") }).strict(),
  z
    .object({
      type: z.literal("artifact"),
      pathGlob: z.string().min(1).max(1024),
      maxBytes: z.number().int().positive().max(1_073_741_824),
      store: z.literal("files"),
    })
    .strict(),
]);

export type OutputDefinition = z.infer<typeof OutputDefinitionSchema>;

// ── Actions ───────────────────────────────────────────────────────────────────

export const INTEGRATION_NAMES = [
  "todos",
  "conversations",
  "mementos",
  "knowledge",
  "skills",
  "hooks",
  "loops",
  "files",
] as const;
export type IntegrationName = (typeof INTEGRATION_NAMES)[number];

export const ActionEventSchema = z.enum(["on_failure", "on_recovery", "on_success", "on_change"]);

export const ActionDefinitionSchema = z
  .object({
    event: ActionEventSchema,
    integration: z.enum(INTEGRATION_NAMES, {
      errorMap: () => ({
        message: `unsupported integration; supported: ${INTEGRATION_NAMES.join(", ")}`,
      }),
    }),
    operation: z.string().min(1, "operation must not be empty").max(128, "operation too long"),
    required: z.boolean().optional(),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type ActionDefinition = z.infer<typeof ActionDefinitionSchema>;

// ── Integration configuration ─────────────────────────────────────────────────

export const IntegrationMapSchema = z
  .object({
    todos: z
      .object({
        projectId: z.string().min(1, "projectId is required"),
        taskTemplate: z.string().max(512).optional(),
      })
      .strict()
      .optional(),
    conversations: z
      .object({
        channelId: z.string().min(1, "channelId is required"),
      })
      .strict()
      .optional(),
    mementos: z
      .object({
        bucket: z.string().min(1, "bucket is required"),
        keyTemplate: z.string().min(1, "keyTemplate is required"),
      })
      .strict()
      .optional(),
    knowledge: z
      .object({
        collectionId: z.string().min(1).optional(),
        tags: z.array(z.string().min(1)).max(32).optional(),
      })
      .strict()
      .optional(),
    skills: z
      .object({
        skillId: z.string().min(1, "skillId is required"),
      })
      .strict()
      .optional(),
    hooks: z
      .object({
        hookId: z.string().min(1, "hookId is required"),
      })
      .strict()
      .optional(),
    loops: z
      .object({
        ownerScope: z.string().min(1, "ownerScope is required"),
      })
      .strict()
      .optional(),
    files: z
      .object({
        artifactCollection: z.string().min(1, "artifactCollection is required"),
      })
      .strict()
      .optional(),
  })
  .strict();

export type IntegrationMap = z.infer<typeof IntegrationMapSchema>;

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
    targets: TargetsSchema.optional(),
    execution: ExecutionSchema.optional(),
    checks: z.array(CheckDefinitionSchema),
    checksAggregate: ChecksAggregateSchema,
    outputs: z.array(OutputDefinitionSchema).max(32).optional(),
    actions: z.array(ActionDefinitionSchema).max(64).optional(),
    integrations: IntegrationMapSchema.optional(),
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
