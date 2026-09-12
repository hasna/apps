/**
 * MCP authority decision — made BEFORE any transport connects (hasna/apps#1720
 * fail-closed ruling; todos #1942 `resolveTodosMcpAuthority` pattern).
 *
 * Three outcomes, decided once per server process:
 *   - LOCAL   — the explicit opt-in (HASNA_HOOKS_LOCAL=1 / HOOKS_LOCAL=1) with
 *               nothing else configured: the on-box store is allowed and the
 *               transport seam has already said "hooks: LOCAL mode" on stderr.
 *   - HOSTED  — a registry credential resolved (env pair, Keychain item, or
 *               credentials file): `refuseLocalStore()` is installed so every
 *               local-only tool (hooks_log_*, storage_*, send_feedback, the
 *               event writer) refuses instead of answering from hooks.db.
 *   - nothing — `resolveHooksTransport` throws the REMOTE_API_* diagnostic
 *               naming the tiers and the opt-in; the caller prints it and exits
 *               1 before `initialize` is ever answered, and no file is created.
 */
import { refuseLocalStore } from "../db/index.js";
import { hooksHostedRouteLocalStoreRefusal } from "../lib/local-opt-in.js";
import type { HooksLocalOptInEnv } from "../lib/resolver-types.js";
import { resolveHooksTransport } from "../lib/transport.js";

export type HooksMcpAuthority =
  | { route: "local"; source: "local-opt-in" }
  | { route: "hosted"; v1BaseUrl: string; source: string };

/** Resolve the route. Throws (never returns a local default) when nothing resolves. */
export function resolveHooksMcpAuthority(env: HooksLocalOptInEnv = process.env): HooksMcpAuthority {
  const transport = resolveHooksTransport(env);
  if (transport.mode === "local" || !transport.authority) {
    return { route: "local", source: "local-opt-in" };
  }
  return { route: "hosted", v1BaseUrl: transport.authority.v1BaseUrl, source: transport.source };
}

/**
 * Resolve the route AND apply it to this process: on the hosted route the
 * on-box store is refused process-wide. Throws when nothing resolves — the
 * bin / CLI wrapper turns that into a one-line stderr diagnostic and exit 1.
 */
export function decideHooksMcpAuthority(env: HooksLocalOptInEnv = process.env): HooksMcpAuthority {
  const authority = resolveHooksMcpAuthority(env);
  if (authority.route === "hosted") {
    refuseLocalStore(hooksHostedRouteLocalStoreRefusal(authority.v1BaseUrl));
  }
  return authority;
}
