/**
 * Skills integration — invoke an existing executable skill by stable skill
 * identifier through the exact `@hasna/skills` SDK surface (root `runSkill`).
 *
 * MON-V2-10 gate contract:
 *
 * - The invocation uses exactly `runSkill(skillId, [], { stdio: "pipe" })`.
 *   No CLI, HTTP, or MCP surface is chosen at runtime, and no `env` is passed
 *   to the SDK: credential resolution stays package-owned by `@hasna/skills`.
 * - Instruction-only skills are rejected. The SDK refuses to execute them
 *   (`is an instruction skill (kind: instruction) and is not runnable`); the
 *   adapter classifies that refusal as `rejected` with reason
 *   `instruction-only` and never stores it as a success.
 * - The stored invocation result is bounded: `stdout`, `stderr`, and `error`
 *   are truncated to `MAX_OUTPUT_BYTES` each, and the record carries only the
 *   documented fields — never environment, arguments, skill paths, or other
 *   private payloads.
 *
 * Failure behavior: non-fatal by default. A `required: true` integration
 * flags `requiredFailed` on the outcome so a confirmed failure can affect
 * the run outcome.
 */
import { runSkill } from "@hasna/skills";

export const MAX_OUTPUT_BYTES = 8192;
export const OUTPUT_TRUNCATION_MARKER = "\n…[output truncated]";

export interface SkillsIntegrationConfig {
  /** Stable skill identifier resolved by the @hasna/skills SDK. */
  skillId: string;
  /** When true, a confirmed failure affects the run outcome. Default false. */
  required?: boolean;
}

export type SkillInvocationStatus = "succeeded" | "rejected" | "failed";

export interface SkillInvocationRecord {
  skillId: string;
  status: SkillInvocationStatus;
  /** Rejection/failure reason: `instruction-only` | `not-found` | `non-zero-exit`. */
  reason?: string;
  exitCode: number;
  /** Bounded stdout from the invocation. */
  stdout?: string;
  /** Bounded stderr from the invocation. */
  stderr?: string;
  /** Bounded error text from the SDK. */
  error?: string;
}

export interface SkillInvocationOutcome {
  /** True when the invocation succeeded. */
  ok: boolean;
  /** True when the integration is required and the invocation confirmed-failed. */
  requiredFailed: boolean;
  /** Bounded, private-payload-free record of the invocation. */
  record: SkillInvocationRecord;
}

/** Exact surface type of the `@hasna/skills` root `runSkill` export. */
export type RunSkill = typeof runSkill;

/**
 * Truncate a string to `MAX_OUTPUT_BYTES` UTF-8 bytes, appending a marker on
 * truncation. Splits only at code-point boundaries so the stored text is
 * never a broken multi-byte sequence.
 */
function boundOutput(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Buffer.byteLength(value, "utf8") <= MAX_OUTPUT_BYTES) return value;
  let bytes = 0;
  let index = 0;
  for (const ch of value) {
    const chBytes = Buffer.byteLength(ch, "utf8");
    if (bytes + chBytes > MAX_OUTPUT_BYTES) break;
    bytes += chBytes;
    index += ch.length;
  }
  return value.slice(0, index) + OUTPUT_TRUNCATION_MARKER;
}

/**
 * Classify a `runSkill` result into a bounded, private-payload-free record.
 * The exact SDK refusal messages are matched so the rejection classes stay
 * distinguishable from ordinary failures.
 */
function classify(
  result: Awaited<ReturnType<RunSkill>>,
  skillId: string,
): SkillInvocationRecord {
  const exitCode = result.exitCode;
  const error = boundOutput(result.error);
  if (exitCode === 0) {
    return {
      skillId,
      status: "succeeded",
      exitCode,
      stdout: boundOutput(result.stdout),
      stderr: boundOutput(result.stderr),
    };
  }
  if (error !== undefined && error.includes("is an instruction skill")) {
    return { skillId, status: "rejected", reason: "instruction-only", exitCode, error };
  }
  if (error === `Skill '${skillId}' not found`) {
    return { skillId, status: "rejected", reason: "not-found", exitCode, error };
  }
  return {
    skillId,
    status: "failed",
    reason: "non-zero-exit",
    exitCode,
    stdout: boundOutput(result.stdout),
    stderr: boundOutput(result.stderr),
    error,
  };
}

/**
 * Invoke a skill by its stable identifier.
 *
 * `runner` defaults to the root `runSkill` export of `@hasna/skills` and is
 * injectable for tests; the injected runner is typed as the exact SDK
 * surface. No arguments and no environment are forwarded to the skill, and
 * the returned record is bounded and carries no private payloads.
 */
export async function invokeSkill(
  config: SkillsIntegrationConfig,
  runner: RunSkill = runSkill,
): Promise<SkillInvocationOutcome> {
  const result = await runner(config.skillId, [], { stdio: "pipe" });
  const record = classify(result, config.skillId);
  return {
    ok: record.status === "succeeded",
    requiredFailed: record.status !== "succeeded" && config.required === true,
    record,
  };
}
