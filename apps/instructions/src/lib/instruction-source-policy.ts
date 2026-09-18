import type { Config } from "../types/index.js";

export function isRetiredInstructionSource(config: Pick<Config, "tags">): boolean {
  return config.tags.some((tag) => tag === "retired-global-source" || tag === "retired-instruction-source");
}

/** A stored application config is not necessarily prose suitable for a prompt. */
export function instructionSourceRejection(config: Config): string | null {
  if (isRetiredInstructionSource(config) || config.tags.includes("config-only")) {
    return "source is retired or explicitly configuration-only";
  }
  if (config.category !== "rules") return `category ${config.category} is not an instruction source; classify reviewed prose as rules`;
  if (config.format !== "markdown" && config.format !== "text") return `format ${config.format} is not instruction prose`;
  if (config.is_template) return "unresolved templates must be rendered and reviewed before prompt injection";
  if (!config.content.trim()) return "instruction source is empty";
  if (config.content.includes("\0")) return "instruction source contains binary content";
  const target = config.target_path?.split(/[\\/]/).pop() ?? "";
  if (/\.(?:json|toml|yaml|yml|ini|sh|bash|zsh|fish|js|ts|py|rules)$/i.test(target)) {
    return "target is an executable, provider policy, or settings file rather than a prompt";
  }
  return null;
}

export function assertInstructionSource(config: Config): void {
  const rejection = instructionSourceRejection(config);
  if (rejection) throw new Error(`Cannot inject ${config.slug}: ${rejection}.`);
}
