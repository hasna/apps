import { createHash } from "node:crypto";
import CronExpressionParser from "cron-parser";
import { z } from "zod";

/**
 * monitor v2 — declarative slug definition (design §3).
 *
 * Strict Zod schema. Commands use structured argv only; shell strings,
 * shell interpolation, and `sh -c` are not part of the v2 definition
 * schema. `envRefs` are opaque configuration references — raw credential
 * values are never stored in definitions.
 */

export const SLUG_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Executable must be a bare command name or path — no shell syntax. */
const SHELL_METACHARS = /[\s"'`$;&|<>()*?[\]{}~!\\]/;

const SHELL_EXECUTABLES = new Set([
  "sh",
  "bash",
  "dash",
  "zsh",
  "fish",
  "ksh",
  "csh",
  "tcsh",
  "cmd",
  "powershell",
  "pwsh",
]);

/** Cap on `env` wrapper nesting; a deeper chain is not resolvable safely. */
const MAX_ENV_NESTING = 8;

interface ResolvedCommand {
  executable: string;
  args: string[];
}

/**
 * Recursively resolve `env` wrappers down to the effective command, applying
 * the bare-argv contract at every level of the chain. A single-level check
 * lets `executable: env, args: [env, bash, -c, ...]` smuggle a shell past
 * validation: the inner `env` is itself a wrapper, so the chain must be
 * resolved until the first non-`env` executable and checked there.
 *
 * Returns null when the chain cannot be resolved safely: `env -S` /
 * `--split-string` anywhere in the chain (it re-splits into shell words), or
 * nesting deeper than MAX_ENV_NESTING.
 */
function resolveEnvChain(
  executable: string,
  args: string[],
  depth: number
): ResolvedCommand | null {
  const base = executable.split("/").pop()?.toLowerCase() ?? "";
  if (base !== "env") return { executable, args };
  if (depth >= MAX_ENV_NESTING) return null;
  if (args.includes("-S") || args.includes("--split-string")) return null;
  let i = 0;
  // env assignments: NAME=value
  while (i < args.length) {
    const assignment = args[i];
    if (
      assignment === undefined ||
      !/^[A-Za-z_][A-Za-z0-9_]*=/.test(assignment)
    )
      break;
    i++;
  }
  // env options: -i/--ignore-environment, -u/--unset NAME, -C DIR, then any
  // remaining -flag, then an explicit --
  for (;;) {
    const a = args[i];
    if (a === "-i" || a === "--ignore-environment") {
      i += 1;
      continue;
    }
    if (a === "-u" || a === "--unset" || a === "-C") {
      i += 2;
      continue;
    }
    if (a === "--") {
      i += 1;
      break;
    }
    if (a !== undefined && a.startsWith("-")) {
      i += 1;
      continue;
    }
    break;
  }
  if (i >= args.length) {
    // `env` with no command prints the environment — a benign, non-shell
    // invocation, identical to running `env` directly.
    return { executable, args };
  }
  const effective = args[i];
  if (effective === undefined) return null;
  return resolveEnvChain(effective, args.slice(i + 1), depth + 1);
}

export const commandSpecSchema = z
  .object({
    executable: z.string().min(1).max(4096),
    args: z.array(z.string()).max(1024).default([]),
    cwd: z.string().min(1).max(4096).optional(),
    timeoutSeconds: z.number().int().positive().max(86400 * 7),
    envRefs: z.array(z.string().min(1)).max(256).optional(),
  })
  .superRefine((cmd, ctx) => {
    if (SHELL_METACHARS.test(cmd.executable)) {
      ctx.addIssue({
        code: "custom",
        path: ["executable"],
        message:
          "executable must be a bare command name or path; shell strings and shell mode are not part of the v2 definition schema",
      });
    }
    const base = cmd.executable.split("/").pop()?.toLowerCase() ?? "";
    if (SHELL_EXECUTABLES.has(base)) {
      ctx.addIssue({
        code: "custom",
        path: ["executable"],
        message: `executable names a shell ('${cmd.executable}'); shell mode is not part of the v2 definition schema`,
      });
    }
    if (cmd.args[0] === "-c") {
      ctx.addIssue({
        code: "custom",
        path: ["args"],
        message: "args must not invoke a shell ('-c' is shell mode)",
      });
    }
    // `env` is a sanctioned wrapper that can prefix a real command with
    // assignments and options. Resolve the WHOLE wrapper chain recursively
    // (env env ... sh -c ... must not smuggle a shell past a single-level
    // check) and apply the same shell-mode rejections to the effective
    // command at the end of the chain.
    if (base === "env") {
      const resolved = resolveEnvChain(cmd.executable, cmd.args, 0);
      if (resolved === null) {
        ctx.addIssue({
          code: "custom",
          path: ["args"],
          message:
            "env wrapper chain is not resolvable (nesting limit, or env -S/--split-string anywhere in the chain); shell mode is not part of the v2 definition schema",
        });
        return;
      }
      const effectiveBase =
        resolved.executable.split("/").pop()?.toLowerCase() ?? "";
      if (SHELL_METACHARS.test(resolved.executable)) {
        ctx.addIssue({
          code: "custom",
          path: ["args"],
          message: `executable 'env' resolves to a command with shell syntax ('${resolved.executable}'); shell mode is not part of the v2 definition schema`,
        });
      }
      if (SHELL_EXECUTABLES.has(effectiveBase)) {
        ctx.addIssue({
          code: "custom",
          path: ["args"],
          message: `executable 'env' resolves to a shell ('${resolved.executable}'); shell mode is not part of the v2 definition schema`,
        });
      }
      if (resolved.args[0] === "-c") {
        ctx.addIssue({
          code: "custom",
          path: ["args"],
          message: "args must not invoke a shell ('-c' is shell mode)",
        });
      }
    }
  });

export const cadenceSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("interval"),
      seconds: z.number().int().positive().max(86400 * 7),
      jitterSeconds: z.number().int().nonnegative().max(86400 * 7).optional(),
    }),
    z.object({
      type: z.literal("cron"),
      expression: z.string().min(1).max(512),
      timezone: z.string().min(1).max(128),
    }),
  ])
  .superRefine((cadence, ctx) => {
    if (cadence.type !== "cron") return;
    try {
      CronExpressionParser.parse(cadence.expression, {
        tz: cadence.timezone,
        currentDate: new Date(),
      });
    } catch (err) {
      ctx.addIssue({
        code: "custom",
        path: ["expression"],
        message: `invalid cron schedule: ${(err as Error).message}`,
      });
    }
  });

const checkSchema = z
  .object({
    id: z.string().min(1).optional(),
    command: commandSpecSchema.optional(),
  })
  .passthrough();

const outputSchema = z
  .object({
    id: z.string().min(1),
    kind: z
      .enum(["stdout", "stderr", "summary", "artifact", "table"])
      .optional(),
    path: z.string().optional(),
    format: z.string().optional(),
  })
  .passthrough();

const actionSchema = z
  .object({
    id: z.string().min(1),
    integration: z.string().min(1),
    operation: z.string().min(1),
    target: z.string().optional(),
    params: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const slugDefinitionSchema = z.object({
  schemaVersion: z.literal(2),
  name: z
    .string()
    .regex(
      SLUG_NAME_PATTERN,
      "slug name must match ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"
    ),
  description: z.string().max(4096).optional(),
  tags: z.array(z.string().min(1)).max(256).optional(),
  cadence: cadenceSchema,
  targets: z
    .object({
      machineIds: z.array(z.string().min(1)).max(4096).optional(),
      labels: z.record(z.string()).optional(),
    })
    .optional(),
  execution: z
    .object({
      timeoutSeconds: z.number().int().positive().max(86400 * 7),
      maxConcurrency: z.number().int().positive().max(1024),
      overlap: z.enum(["allow", "skip", "queue"]),
      maxAttempts: z.number().int().positive().max(100),
      retryBackoffSeconds: z.array(z.number().int().nonnegative()).max(100).optional(),
      retryOn: z.array(z.enum(["failed", "timeout", "unknown", "worker_lost"])).optional(),
    })
    .optional(),
  checks: z.array(checkSchema).min(1),
  outputs: z.array(outputSchema).max(256).optional(),
  actions: z.array(actionSchema).max(256).optional(),
  integrations: z
    .record(
      z
        .object({
          required: z.boolean().optional(),
          config: z.record(z.unknown()).optional(),
        })
        .passthrough()
    )
    .optional(),
});

export type SlugDefinition = z.infer<typeof slugDefinitionSchema>;
export type Cadence = z.infer<typeof cadenceSchema>;

export type ValidateResult = {
  valid: boolean;
  errors: string[];
};

/**
 * Validates an arbitrary parsed JSON value against the strict schema.
 * Returns a flat, human-readable error list (never raw Zod internals).
 */
export function validateDefinition(value: unknown): ValidateResult {
  const parsed = slugDefinitionSchema.safeParse(value);
  if (parsed.success) {
    return { valid: true, errors: [] };
  }
  const errors: string[] = [];
  for (const issue of parsed.error.issues) {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    errors.push(`${path}: ${issue.message}`);
  }
  return { valid: false, errors };
}

/**
 * Canonical JSON serialization: object keys are sorted recursively, arrays
 * keep their order, primitives serialize exactly. Two definitions that differ
 * only in key ordering (or in fields a strict schema would have defaulted)
 * serialize identically.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Canonical definition digest: sha256 of the canonical JSON re-serialization
 * of the validated definition. Immutable per definition content; key
 * reordering or omitted defaulted fields cannot mint a new revision.
 */
export function definitionDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
