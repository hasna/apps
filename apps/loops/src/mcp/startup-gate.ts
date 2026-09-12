import { completePointerCredential, resolveCredential, type ResolvedCredential } from "@hasna/contracts/client";
import {
  loopsResolverInputs,
  resolveCloudStorage,
  type Env,
  type LoopsCredentialChainOptions,
} from "../lib/cloud/resolve.js";
import { LOOPS_LOCAL_OPT_IN_HINT } from "../lib/local-opt-in.js";

/**
 * The fail-closed startup gate for `loops-mcp` (owner ruling 2026-09-07,
 * hasna/apps#1720 validation, round 3).
 *
 * A client with no connection configured must fail LOUD before it serves:
 * non-zero exit before the stdio transport is connected or the Streamable
 * HTTP port is bound, so an agent that registered `loops-mcp` on a station
 * without the fleet credential sees the refusal at startup instead of an
 * `initialize` answered by a server whose every tool call would fail. On
 * 0.7.0 `main()` selected the transport without ever resolving the
 * connection: the negative control (empty `HASNA_HOME`, an absent Keychain
 * account, no env key) printed "Streamable HTTP listening on
 * http://127.0.0.1:8890/mcp" and answered `initialize` in HTTP mode, and
 * answered `initialize` then exited 0 on EOF under `--stdio`. The HTTP
 * harness builds a server per session, so without this gate a misconfigured
 * long-lived process would sit listening and refuse every session.
 *
 * The gate is ONE pass down the same chain every tool resolves through per
 * call (`resolveCloudStorage`, i.e. `getStore()`): the live process
 * environment keeps its ambient Keychain and disk tiers, a caller-built env
 * is the hermetic seam, and the explicit `HASNA_LOOPS_LOCAL=1` opt-in still
 * selects the on-box store (announcing "LOCAL mode" once on stderr from the
 * resolver). A DELIBERATE tier that cannot produce a key is a refusal, never
 * resolved around: `HASNA_PROFILE` naming a missing profile file, an unsafe
 * credentials file, a Keychain item that exists but cannot be read, the
 * retired `HASNA_LOOPS_CONNECTION` selector (any value), and the
 * secrets-vault pointer `HASNA_LOOPS_API_KEY_REF`. The chain validates only
 * the pointer's SHAPE, so the gate dereferences it once through the vault
 * exactly as the transport does at request time; a pointer that cannot be
 * completed (SDK absent, vault unconfigured or unreachable, item missing or
 * empty) refuses the start instead of answering `initialize`.
 *
 * Nothing here opens, reads or creates a local store, and the message names
 * WHERE the credential should live (an env key NAME, the Keychain item, the
 * credentials-file path, the local opt-in) — never a value. A dereferenced
 * key is dropped on the spot: every tool still re-resolves per call, so a
 * rotation heals the long-lived process without a restart.
 */
export type LoopsMcpStartupGate =
  | { ok: true; transport: "file" | "api"; apiKeySource: string | null }
  | { ok: false; message: string };

/** The vault dereference, injectable so the pointer path is testable without a vault. */
export interface LoopsMcpStartupGateOptions {
  completePointer?: (name: string, pointer: ResolvedCredential, env: Env) => Promise<ResolvedCredential>;
}

const APP = "loops";
export const LOOPS_MCP_REFUSAL_PREFIX = "loops-mcp: refusing to start —";
const LOOPS_MCP_REFUSAL_HINT =
  `The MCP server never serves tools without a loops credential or the explicit ${LOOPS_LOCAL_OPT_IN_HINT} opt-in, ` +
  "and never reads or creates a local store on its own; configure the connection and restart loops-mcp.";

export async function resolveLoopsMcpStartupGate(
  env: Env = process.env,
  credentials: LoopsCredentialChainOptions = {},
  options: LoopsMcpStartupGateOptions = {},
): Promise<LoopsMcpStartupGate> {
  let issue: string;
  try {
    const resolution = resolveCloudStorage(APP, env, { credentials });
    if (resolution.transport === "file") return { ok: true, transport: "file", apiKeySource: null };
    // The hosted transport is wired. Ask the SAME chain (normalised env, the
    // ambient Keychain gate decided on the original env, #1788) which tier
    // supplied the key: every tier but the pointer is already complete.
    const inputs = loopsResolverInputs(env, credentials);
    const credential = resolveCredential(APP, inputs.env, inputs.credentials);
    if (!credential) {
      throw new Error(
        "the hosted loops transport was wired but the credential chain produced no credential; this is a defect in the resolver.",
      );
    }
    if (credential.tier !== "pointer") return { ok: true, transport: "api", apiKeySource: credential.source };
    // The pointer tier: the chain above only validated the pointer's shape.
    // Dereference it once, exactly as the transport does per request, and let
    // every failure surface as the TERMINAL refusal it is.
    const completed = await (options.completePointer ?? completePointerCredential)(APP, credential, inputs.env);
    return { ok: true, transport: "api", apiKeySource: completed.source };
  } catch (error) {
    // The no-connection refusal, retired client selectors and terminal
    // credential failures (a Keychain item that exists but cannot be read, an
    // unusable credentials file, a profile or vault pointer that cannot be
    // honoured) are refusals too — never resolved around, never served,
    // never a stack trace.
    issue = error instanceof Error ? error.message : String(error);
  }
  // First line: the refusal and the tiers, on ONE line, so the first stderr
  // line of the negative control names where the credential should live.
  return { ok: false, message: `${LOOPS_MCP_REFUSAL_PREFIX} ${issue.replace(/\s*\n\s*/g, " ")}\n${LOOPS_MCP_REFUSAL_HINT}` };
}
