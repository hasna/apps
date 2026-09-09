import {
  completePointerCredential,
  resolveCredential,
  type CredentialChainOptions,
  type ResolvedCredential,
} from "@hasna/contracts/client";
import { resolveContactsClientTransport } from "../cloud/http-storage.js";
import { contactsResolverCredentials, type Env } from "../cloud/resolver-inputs.js";

/**
 * The fail-closed startup gate for `contacts-mcp` (hasna/apps#1720 validation,
 * round 2).
 *
 * A hosted-only client with no credential must fail LOUD before it serves:
 * non-zero exit before the stdio transport is connected or the HTTP port is
 * bound, so an agent that registered `contacts-mcp` on a station without the
 * fleet credential sees the refusal at startup instead of an `initialize`
 * answered by a server whose every tool call would fail. Previously main()
 * built the server and connected the transport without ever resolving the
 * credential: the negative control (empty HASNA_HOME, absent Keychain
 * account, no env key) printed "running on stdio", answered `initialize`,
 * and exited 0.
 *
 * The gate is ONE pass down the same @hasna/contracts chain the tools resolve
 * through per call (`resolveContactsClientTransport`): the live process
 * environment keeps its ambient Keychain/disk tiers, a caller-built env is the
 * hermetic seam. A DELIBERATE tier that cannot produce a key is a refusal,
 * never resolved around: `HASNA_PROFILE` naming a missing profile file, an
 * unsafe credentials file, a Keychain item that exists but cannot be read, and
 * the secrets-vault pointer `HASNA_CONTACTS_API_KEY_REF`. The chain validates
 * only the pointer's SHAPE, so the gate dereferences it once through the vault
 * exactly as the transport does at request time; a pointer that cannot be
 * completed (SDK absent, vault unconfigured or unreachable, item missing or
 * empty) refuses the start instead of answering `initialize` with a server
 * whose every call would fail.
 *
 * Nothing here opens, reads or creates a local store, and the message names
 * WHERE the credential should live (an item reference, a file path, an env key
 * name) — never a value. A dereferenced key is dropped on the spot: every tool
 * still re-resolves per call.
 */
export type McpStartupGate =
  | { ok: true; apiUrlSource: string | null; apiKeySource: string | null }
  | { ok: false; message: string };

/** The vault dereference, injectable so the pointer path is testable without a vault. */
export interface McpStartupGateOptions {
  completePointer?: (name: string, pointer: ResolvedCredential, env: Env) => Promise<ResolvedCredential>;
}

const MCP_REFUSAL_PREFIX = "contacts-mcp: refusing to start —";
const MCP_REFUSAL_HINT =
  "The MCP server never serves tools without a contacts credential and never reads or creates a local store; " +
  "configure the credential and restart contacts-mcp.";

export async function resolveMcpStartupGate(
  env: Env = process.env,
  credentials: CredentialChainOptions = {},
  options: McpStartupGateOptions = {},
): Promise<McpStartupGate> {
  let issue: string;
  try {
    const resolution = resolveContactsClientTransport("contacts", env, credentials);
    if (resolution.configured) {
      if (resolution.apiKeyTier !== "pointer") {
        return { ok: true, apiUrlSource: resolution.apiUrlSource, apiKeySource: resolution.apiKeySource };
      }
      // The pointer tier: the chain above only validated the pointer's shape.
      // Dereference it once, on the SAME chain options the tools use per call
      // (the ambient Keychain gate decided on the original env, #1788), and
      // let every failure surface as the TERMINAL refusal it is.
      const chainOptions = contactsResolverCredentials(env, credentials);
      const pointer = resolveCredential("contacts", env, chainOptions);
      if (!pointer || pointer.tier !== "pointer") {
        throw new Error(
          `${resolution.apiKeySource ?? "HASNA_CONTACTS_API_KEY_REF"} resolved as a vault pointer but produced no pointer credential; this is a defect in the resolver.`,
        );
      }
      const completed = await (options.completePointer ?? completePointerCredential)("contacts", pointer, env);
      return { ok: true, apiUrlSource: resolution.apiUrlSource, apiKeySource: completed.source };
    }
    // The same code the CLI and the store raise for this state, so the first
    // line reads identically on every surface.
    issue = `CONTACTS_API_NOT_CONFIGURED: ${resolution.issue ?? "The contacts API client is not configured."}`;
  } catch (error) {
    // Retired client selectors and terminal credential failures (a Keychain
    // item that exists but cannot be read, an unusable credentials file, a
    // profile or vault pointer that cannot be honoured) are refusals too —
    // never resolved around, never served, never a stack trace.
    issue = error instanceof Error ? error.message : String(error);
  }
  // First line: the refusal and the tiers, on ONE line, so the first stderr
  // line of the negative control names where the credential should live.
  return { ok: false, message: `${MCP_REFUSAL_PREFIX} ${issue}\n${MCP_REFUSAL_HINT}` };
}
