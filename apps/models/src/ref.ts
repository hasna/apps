import type { EntityKind, ProviderRef } from "./types.js";

const ENTITY_KINDS = new Set<EntityKind>(["model", "dataset", "space"]);
const PROVIDER_ALIASES = new Map<string, string>([
  ["hf", "huggingface"],
  ["huggingface", "huggingface"],
]);

export function parseEntityKind(value: string): EntityKind {
  if (ENTITY_KINDS.has(value as EntityKind)) return value as EntityKind;
  throw new Error(`Unsupported entity kind: ${value}. Expected one of: ${[...ENTITY_KINDS].join(", ")}`);
}

export function parseProviderRef(input: string, defaultKind: EntityKind = "model"): ProviderRef {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("model or dataset ref is required");

  let provider = "huggingface";
  let entityKind = parseEntityKind(defaultKind);
  let rest = trimmed;

  const prefixMatch = rest.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/);
  if (prefixMatch && !prefixMatch[1].includes("/")) {
    const alias = PROVIDER_ALIASES.get(prefixMatch[1]);
    if (alias) {
      provider = alias;
      rest = prefixMatch[2];
    } else if (["model", "dataset", "space"].includes(prefixMatch[1])) {
      entityKind = parseEntityKind(prefixMatch[1]);
      rest = prefixMatch[2];
    } else {
      throw new Error(`Unsupported provider: ${prefixMatch[1]}`);
    }
  }

  if (rest.startsWith("model:")) {
    entityKind = parseEntityKind("model");
    rest = rest.slice("model:".length);
  } else if (rest.startsWith("dataset:")) {
    entityKind = parseEntityKind("dataset");
    rest = rest.slice("dataset:".length);
  } else if (rest.startsWith("space:")) {
    entityKind = parseEntityKind("space");
    rest = rest.slice("space:".length);
  }

  if (rest.includes(":")) {
    throw new Error(`Unsupported ref prefix in: ${input}`);
  }

  let revision = "main";
  const atIndex = rest.lastIndexOf("@");
  if (atIndex > 0) {
    revision = rest.slice(atIndex + 1);
    rest = rest.slice(0, atIndex);
    if (!revision.trim()) throw new Error(`Revision cannot be empty in ref: ${input}`);
  } else if (rest.endsWith("@")) {
    throw new Error(`Revision cannot be empty in ref: ${input}`);
  }

  if (!rest.includes("/")) {
    throw new Error(`Expected a namespaced repo id such as owner/name, got ${input}`);
  }

  return { provider, entityKind, repoId: rest, revision };
}

export function formatProviderRef(ref: ProviderRef): string {
  const prefix = ref.provider === "huggingface" ? "hf" : ref.provider;
  const kind = ref.entityKind === "model" ? "" : `${ref.entityKind}:`;
  return `${prefix}:${kind}${ref.repoId}@${ref.revision}`;
}

export function encodeRepoId(repoId: string): string {
  return repoId.split("/").map(encodeURIComponent).join("/");
}

export function safePathSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "__").replace(/^_+|_+$/g, "");
  if (!sanitized || sanitized === "." || sanitized === "..") return "unnamed";
  return sanitized;
}
