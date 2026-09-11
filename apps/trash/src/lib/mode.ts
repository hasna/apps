/**
 * Mode is DERIVED, never selected (§5).
 *
 * The fleet deliberately removed mode selectors (`hasna/apps#1570`;
 * `apps/emails/src/lib/mode.ts:14-17`), so nothing here reads a deployment
 * word. Mode is a consequence of what resolves:
 *
 *   data plane  `HASNA_TRASH_API_URL` → api mode; absent → local-only.
 *   placement   `HASNA_TRASH_BUCKET` set → the bucket IS the configuration.
 *   opt-in      `HASNA_TRASH_LOCAL=1` means local-only ONLY when nothing
 *               configured an authority; otherwise it FAILS CLOSED.
 *
 * That last row is the one that matters (§5's correction): a failed, rotated or
 * typo'd credential must never silently reclassify a hosted instance as
 * local-only, because §6's local-only arm is exactly the arm permitted to
 * expire un-uploaded payloads with no remote copy. A credential loss that
 * becomes a data loss is the failure this refuses to have.
 *
 * Credentials themselves are NOT read here. §5 requires resolving them through
 * `@hasna/contracts/client` (`resolveClientTransport`/`resolveCredential`) —
 * reading `HASNA_TRASH_API_KEY` out of `process.env` by hand is what the
 * credential-seam conformance rule is about. Phase 3 wires the seam; phase 1
 * needs only to know whether an authority was configured at all.
 */

export interface TrashLocalMode {
  kind: "local";
  reason: "nothing_configured" | "explicit_local_flag";
  /** True when the operator set `HASNA_TRASH_LOCAL=1`; callers announce it on stderr. */
  announced: boolean;
}

export interface TrashHostedMode {
  kind: "hosted";
  apiUrl: string | null;
  bucket: string | null;
}

export type TrashMode = TrashLocalMode | TrashHostedMode;

export class TrashModeConflictError extends Error {
  constructor(detail: string) {
    super(
      `trash mode conflict: ${detail}. Refusing to fall back to local-only while an authority is configured — ` +
        "a failed or rotated credential must never reclassify a hosted instance as local-only (§5).",
    );
    this.name = "TrashModeConflictError";
  }
}

function configured(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name];
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  return raw.trim();
}

/**
 * Resolve the mode. Throws `TrashModeConflictError` when an authority is
 * configured and the local flag is also set — the fail-closed branch.
 */
export function resolveTrashMode(env: NodeJS.ProcessEnv = process.env): TrashMode {
  const apiUrl = configured(env, "HASNA_TRASH_API_URL");
  const bucket = configured(env, "HASNA_TRASH_BUCKET");
  const explicitLocal = configured(env, "HASNA_TRASH_LOCAL");
  const localFlag = explicitLocal === "1" || explicitLocal === "true";

  if (apiUrl || bucket) {
    if (localFlag) {
      throw new TrashModeConflictError(
        `HASNA_TRASH_LOCAL is set while ${apiUrl ? "HASNA_TRASH_API_URL" : "HASNA_TRASH_BUCKET"} is configured`,
      );
    }
    return { kind: "hosted", apiUrl, bucket };
  }

  return {
    kind: "local",
    reason: localFlag ? "explicit_local_flag" : "nothing_configured",
    announced: localFlag,
  };
}

export function describeMode(mode: TrashMode): string {
  if (mode.kind === "hosted") {
    const parts: string[] = [];
    if (mode.apiUrl) parts.push(`api=${mode.apiUrl}`);
    if (mode.bucket) parts.push(`bucket=${mode.bucket}`);
    return `hosted (${parts.join(", ")})`;
  }
  return mode.reason === "explicit_local_flag"
    ? "local-only (HASNA_TRASH_LOCAL=1, nothing configured)"
    : "local-only (nothing configured)";
}
