/** Canonical client boundary. Never reads local application data or a DSN. */
export function validateClientConfig(url: string, key: string): { url: string; key: string } {
  if (typeof url !== "string" || !url.trim() || typeof key !== "string" || !key.trim()) {
    throw new Error("Attachments requires an explicit HTTPS API URL and API key.");
  }
  if (url !== url.trim() || /[\x00-\x20\x7f]/.test(url) || key !== key.trim() || /[\s\x00-\x1f\x7f]/.test(key)) {
    throw new Error("Attachments API configuration contains invalid whitespace.");
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Attachments requires a valid HTTPS API URL."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Attachments requires an HTTPS API URL without credentials, query, or fragment.");
  }
  return { url: parsed.href.replace(/\/+$/, ""), key };
}

/** Read relevant own data properties once; never execute environment accessors. */
export function snapshotClientEnvironment(env: NodeJS.ProcessEnv, names: readonly string[]): NodeJS.ProcessEnv {
  const snapshot: NodeJS.ProcessEnv = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(env, name);
    if (!descriptor) continue;
    if (!("value" in descriptor) || (descriptor.value !== undefined && typeof descriptor.value !== "string")) {
      throw new Error(`${name} must be an own string or undefined data property; executable configuration is not supported.`);
    }
    snapshot[name] = descriptor.value;
  }
  return snapshot;
}

export function resolveClientConfig(input: NodeJS.ProcessEnv) {
  const retired = ["HASNA_ATTACHMENTS_STORAGE_MODE", "HASNA_ATTACHMENTS_MODE", "ATTACHMENTS_CLIENT_MODE", "ATTACHMENTS_STORAGE_MODE", "ATTACHMENTS_MODE", "HASNA_ATTACHMENTS_DATABASE_URL", "ATTACHMENTS_DATABASE_URL", "HASNA_ATTACHMENTS_DB_PATH"];
  const env = snapshotClientEnvironment(input, [...retired, "HASNA_ATTACHMENTS_API_URL", "ATTACHMENTS_API_URL", "HASNA_ATTACHMENTS_API_KEY", "ATTACHMENTS_API_KEY"]);
  for (const name of retired) {
    if (env[name] !== undefined) throw new Error(`${name} is not supported by the HTTPS client; configure HASNA_ATTACHMENTS_API_URL and HASNA_ATTACHMENTS_API_KEY.`);
  }
  const read = (canonical: string, alias: string): string => {
    const values = [env[canonical], env[alias]].filter((v): v is string => v !== undefined);
    if (!values.length || values.some(v => !v.trim()) || new Set(values).size > 1) {
      throw new Error(`Missing, blank, or conflicting ${canonical} configuration.`);
    }
    return values[0]!;
  };
  return validateClientConfig(read("HASNA_ATTACHMENTS_API_URL", "ATTACHMENTS_API_URL"), read("HASNA_ATTACHMENTS_API_KEY", "ATTACHMENTS_API_KEY"));
}
