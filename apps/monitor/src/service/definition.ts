import { createHash } from "node:crypto";
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
  });

export const cadenceSchema = z.discriminatedUnion("type", [
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
]);

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
 * Canonical definition digest: sha256 of the JSON re-serialization of the
 * validated definition. Immutable per revision.
 */
export function definitionDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
