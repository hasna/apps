export type SecretAccess = "read" | "write" | "reveal";

const NATURAL_SEGMENT = /^[a-z0-9-]+$/;

/**
 * Build an unambiguous scope for keys containing characters (such as `_`) that
 * are not allowed by the @hasna/contracts dotted scope grammar.
 *
 * Example: secretScope("reveal", "openai/api_key") produces a valid
 * `secrets:reveal.encoded...` grant that targets only that key/subtree.
 */
export function secretScope(access: SecretAccess, keyOrNamespace: string): string {
  const parts = splitKey(keyOrNamespace);
  const natural = parts.every((part) => NATURAL_SEGMENT.test(part));
  const target = natural
    ? parts.join(".")
    : `encoded.${parts.map((part) => `x${Buffer.from(part, "utf8").toString("hex")}`).join(".")}`;
  return `secrets:${access}.${target}`;
}

/** Does a principal's grants allow this operation on this key? */
export function canAccessSecret(scopes: readonly string[], access: SecretAccess, key: string): boolean {
  const allowedActions = access === "read" ? ["read", "reveal"] : [access];
  const keyParts = splitKey(key);

  for (const scope of scopes) {
    if (scope === "*" || scope === "secrets:*") return true;
    for (const action of allowedActions) {
      if (scope === `secrets:${action}`) return true;
      const prefix = `secrets:${action}.`;
      if (!scope.startsWith(prefix)) continue;
      const target = decodeTarget(scope.slice(prefix.length));
      if (target && isPrefix(target, keyParts)) return true;
    }
  }
  return false;
}

/** True only for a vault-wide grant; useful for resources with no namespace. */
export function hasGlobalSecretAccess(scopes: readonly string[], access: SecretAccess): boolean {
  const allowedActions = access === "read" ? ["read", "reveal"] : [access];
  return scopes.some((scope) =>
    scope === "*" ||
    scope === "secrets:*" ||
    allowedActions.some((action) => scope === `secrets:${action}`)
  );
}

function splitKey(value: string): string[] {
  return value.split("/").filter(Boolean);
}

function decodeTarget(target: string): string[] | null {
  const parts = target.split(".");
  if (parts[0] !== "encoded") {
    return parts.length > 0 && parts.every((part) => NATURAL_SEGMENT.test(part)) ? parts : null;
  }
  if (parts.length < 2) return null;
  const decoded: string[] = [];
  for (const part of parts.slice(1)) {
    if (!/^x(?:[0-9a-f]{2})+$/.test(part)) return null;
    decoded.push(Buffer.from(part.slice(1), "hex").toString("utf8"));
  }
  return decoded;
}

function isPrefix(prefix: readonly string[], value: readonly string[]): boolean {
  return prefix.length <= value.length && prefix.every((part, index) => part === value[index]);
}
