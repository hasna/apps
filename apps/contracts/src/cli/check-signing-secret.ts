// `contracts check-signing-secret` — the provisioning check for hasna/apps#1543.
//
// THE DEFECT IT REFUSES. `hasna/oss/projects/api-key-signing-secret` is 65 bytes:
// 64 hex characters and a trailing newline, written that way by the provisioning
// tooling. Every reader that trims agrees with every other reader that trims —
// and disagrees, silently, with any reader that does not. That disagreement cost
// the fleet a run of `unknown_key` rejections and an orphan `api_keys` row, and
// it is invisible in every log and dashboard because both values render
// identically.
//
// `@hasna/contracts` now trims on read everywhere (../auth/signing-secret.ts), so
// the fleet no longer depends on any single reader remembering to. That fix makes
// the stored byte harmless; it does not make it CORRECT, and the issue's second
// acceptance bullet asks for a check that fails on it — the whitespace must stop
// being written, not merely be tolerated. This command is that check: the
// deploy/provision lane pipes the stored value in and gets a non-zero exit for a
// secret that needs trimming.
//
// SAFETY. The value is never printed, logged, or embedded in an error or in the
// JSON payload. What comes back is the env key NAME, the byte lengths of the raw
// and trimmed values, and a sha256 PREFIX of the trimmed bytes — enough to match
// a report against a secret without disclosing one, and the shape the station
// rules already permit.
//
// USE (never as an argument — an argv is world-readable in `ps`):
//   HASNA_PROJECTS_API_SIGNING_KEY="$(aws secretsmanager get-secret-value \
//     --secret-id hasna/oss/projects/api-key-signing-secret \
//     --query SecretString --output text)" \
//     contracts check-signing-secret --app projects

import { createHash } from "node:crypto";
import {
  SigningSecretError,
  signingSecretEnvKeys,
  signingSecretHasSurroundingWhitespace,
} from "../auth/signing-secret";

export interface CheckSigningSecretOptions {
  app?: unknown;
  signingSecretEnv?: unknown;
  json?: unknown;
}

export interface CheckSigningSecretDeps {
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  errorLog?: (line: string) => void;
}

export interface CheckSigningSecretResult {
  /** Process exit code: 0 clean, 1 a secret that needs trimming, 2 a usage error. */
  exitCode: number;
  payload: Record<string, unknown>;
}

/** An OWN string option, trimmed; never a value inherited from the prototype. */
function own(options: CheckSigningSecretOptions, key: keyof CheckSigningSecretOptions): string {
  if (!Object.hasOwn(options, key)) return "";
  const value = options[key];
  return typeof value === "string" ? value.trim() : "";
}

/** A stable, non-reversible tag for the trimmed bytes. Never the secret. */
function fingerprint(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12)}`;
}

/**
 * Check one app's signing secret as the environment presents it.
 *
 * Fails (exit 1) when the stored value carries leading or trailing whitespace,
 * and (exit 2) when no key holds a usable value at all: a provisioning lane that
 * cannot see the secret has not verified anything, and reporting that as a pass
 * is the failure mode this command exists to remove.
 */
export function checkSigningSecret(
  options: CheckSigningSecretOptions,
  deps: CheckSigningSecretDeps = {},
): CheckSigningSecretResult {
  const env = deps.env ?? process.env;
  // Commander omits a flag the operator did not type rather than defining it as
  // `undefined`, so a bare `options.app` read is a prototype lookup. Reading only
  // OWN properties keeps a polluted `Object.prototype` from choosing which app —
  // and therefore which env key — this check reports on. Same reasoning as
  // tests/issue-key-option-pollution.test.ts, on a surface whose whole output is
  // a claim about a specific secret.
  const app = own(options, "app");
  if (!app) {
    return { exitCode: 2, payload: { ok: false, code: "app_required", error: "--app is required" } };
  }
  const envName = own(options, "signingSecretEnv");
  const keys = envName ? [envName] : signingSecretEnvKeys(app);

  for (const key of keys) {
    const raw = env[key];
    if (raw === undefined) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const untrimmed = signingSecretHasSurroundingWhitespace(raw);
    return {
      exitCode: untrimmed ? 1 : 0,
      payload: {
        ok: !untrimmed,
        app,
        source: key,
        raw_bytes: Buffer.byteLength(raw, "utf8"),
        trimmed_bytes: Buffer.byteLength(trimmed, "utf8"),
        fingerprint: fingerprint(trimmed),
        ...(untrimmed
          ? {
              code: "signing_secret_untrimmed",
              error:
                `${key} carries leading or trailing whitespace. Rewrite the stored ` +
                `api-key-signing-secret without it (hasna/apps#1543): every reader ` +
                `that does not trim signs with different bytes than the server verifies.`,
            }
          : {}),
      },
    };
  }

  const error = new SigningSecretError(
    `No signing secret found. Set ${keys.join(" or ")} (openssl rand -hex 32).`,
    keys,
  );
  return {
    exitCode: 2,
    payload: { ok: false, code: "signing_secret_missing", error: error.message, app, attempted: keys },
  };
}

/** CLI entry point: prints the report (never the value) and returns the exit code. */
export function runCheckSigningSecret(
  options: CheckSigningSecretOptions,
  deps: CheckSigningSecretDeps = {},
): number {
  const log = deps.log ?? ((line: string) => console.log(line));
  const errorLog = deps.errorLog ?? ((line: string) => console.error(line));
  const { exitCode, payload } = checkSigningSecret(options, deps);
  if (Object.hasOwn(options, "json") && options.json) {
    log(JSON.stringify(payload, null, 2));
    return exitCode;
  }
  if (exitCode === 0) {
    log(`${payload["source"]}: no surrounding whitespace (${payload["trimmed_bytes"]} bytes, ${payload["fingerprint"]})`);
    return exitCode;
  }
  errorLog(String(payload["error"] ?? "signing secret check failed"));
  return exitCode;
}
