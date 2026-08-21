// Provider-name migration. 0.0.35 and earlier persisted, dispatched and
// accepted the provider spelling "thinker-labs". The provider was renamed to
// "tinker" (c59f2bfad). Legacy persisted rows, CLI callers and MCP clients
// must keep working, so every surface that accepts a provider name normalizes
// the legacy spelling to the canonical one at the boundary.
export const LEGACY_TINKER_PROVIDER = "thinker-labs" as const;

export function normalizeProviderName(value: string): string {
  return value === LEGACY_TINKER_PROVIDER ? "tinker" : value;
}
