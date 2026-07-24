export type ExactMetadataInvocation = "help" | "version" | null;

/** Shared metadata grammar: flags are valid only as the complete invocation. */
export function exactMetadataInvocation(args: readonly string[]): ExactMetadataInvocation {
  if (args.length !== 1) return null;
  if (args[0] === "--help" || args[0] === "-h") return "help";
  if (args[0] === "--version" || args[0] === "-V") return "version";
  return null;
}

export function hasMixedMetadataFlag(args: readonly string[]): boolean {
  return args.some((arg) => arg === "--help" || arg === "-h" || arg === "--version" || arg === "-V");
}
