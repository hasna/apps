// b27cc4a0: the per-machine auth-status probe. `accounts auth-status <name>`
// probes THIS machine through the existing runtime probes and stores the
// result in the profile's `authStatus` map (machineId -> entry).
//
// Rule: a status computed at read/refresh time is the STORED value; display
// never fabricates a fresh probe without writing it. This module is the probe;
// the write goes through the ordinary store update path (per-machine merge).

import { existsSync } from "node:fs";
import type { Profile, ProfileAuthStatusEntry } from "../types.js";
import { getTool } from "./tools.js";
import { claudeProfileAuthHealth, profileHasAuth } from "./claude-auth.js";

/**
 * Probe this machine for the profile's authentication state, reusing the
 * existing per-machine runtime probes:
 *  - Claude profiles: `claudeProfileAuthHealth` (ok/missing/expired/invalid/
 *    unknown) — `authenticated` is the health verdict's `valid` flag;
 *  - other tools: `profileHasAuth` (OAuth account + credential payload
 *    present), with `not-locally-verifiable` recorded for a present-but-unproven
 *    dir and `profile-dir-missing` for an absent one.
 *
 * The returned entry is meant to be STORED by the caller under
 * `currentMachineId()`; the `checkedAt` timestamp is when this probe ran.
 */
export function probeProfileAuthStatus(profile: Profile): ProfileAuthStatusEntry {
  const checkedAt = new Date().toISOString();
  const tool = getTool(profile.tool);
  if (tool.id === "claude") {
    const health = claudeProfileAuthHealth(profile.dir, tool);
    return { authenticated: health.valid, checkedAt, detail: health.status };
  }
  const authenticated = profileHasAuth(profile.dir, tool);
  const detail = !existsSync(profile.dir)
    ? "profile-dir-missing"
    : authenticated
      ? undefined
      : "not-locally-verifiable";
  return { authenticated, checkedAt, ...(detail ? { detail } : {}) };
}
