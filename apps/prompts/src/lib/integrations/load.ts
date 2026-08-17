/**
 * Dynamic import of an owning package. Prompts never declares the five owning
 * apps as hard dependencies (they are optional runtime peers, like the
 * existing mementos integration); when a package is not installed the resolver
 * must fail closed with the app's UNAVAILABLE code rather than a raw module
 * error.
 */

import { IntegrationResolutionError, unavailableCodeFor, type IntegrationKind } from "./types.js"

export async function loadOwningPackage(kind: IntegrationKind, specifier: string): Promise<Record<string, unknown>> {
  try {
    return (await import(specifier)) as Record<string, unknown>
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const lower = msg.toLowerCase()
    if (lower.includes("cannot find module") || lower.includes("cannot resolve") || lower.includes("not defined in esm scope")) {
      throw new IntegrationResolutionError(
        unavailableCodeFor(kind),
        kind,
        "",
        `owning package ${specifier} is not installed; install it to resolve ${kind} integrations`,
      )
    }
    throw new IntegrationResolutionError(
      unavailableCodeFor(kind),
      kind,
      "",
      `failed to load owning package ${specifier}: ${msg}`,
    )
  }
}
