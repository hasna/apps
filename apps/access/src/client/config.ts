import { isIP } from "node:net";

export type ClientEnv = Readonly<Record<string, string | undefined>>;

/** Explicit authority only. No fleet default, disk database, or placement selector. */
export function httpsBaseUrl(raw: string): string {
  const fail = () => { throw new Error("Access API URL must be an explicit canonical HTTPS URL without credentials, query, or fragment."); };
  if (!raw || raw !== raw.trim() || /[\s\\?#]|[^\x21-\x7e]/.test(raw)) return fail();
  const match = /^https:\/\/([^/]+)(\/.*)?$/.exec(raw);
  if (!match || /[@%]/.test(match[1]!)) return fail();
  let url: URL;
  try { url = new URL(raw); } catch { return fail(); }
  const authority = match[1]!;
  const hostMatch = /^(\[[^\]]+\]|[^:]+)(?::([0-9]+))?$/.exec(authority);
  if (!hostMatch) return fail();
  const hostname = hostMatch[1]!.toLowerCase();
  const port = hostMatch[2];
  if (port && (!/^[1-9][0-9]*$/.test(port) || Number(port) > 65535)) return fail();
  if (hostname !== url.hostname || hostname.endsWith(".")) return fail();
  if (hostname.startsWith("[")) {
    if (isIP(hostname.slice(1, -1)) !== 6) return fail();
  } else if (isIP(hostname) !== 4) {
    if (hostname.length > 253 || hostname.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) || label.startsWith("xn--"))) return fail();
    if (hostname.split(".").every(label => /^(0x[0-9a-f]+|[0-9]+)$/.test(label))) return fail();
  }
  const path = match[2] ?? "";
  if (/%|\/\/|(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) return fail();
  const base = url.toString().replace(/\/+$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

function declaration(env: ClientEnv, names: readonly string[], validate: (value: string) => string): string {
  const values = names.filter(name => env[name] !== undefined).map(name => {
    const value = env[name]!;
    if (!value || value !== value.trim()) throw new Error(`Access configuration ${name} is blank or invalid.`);
    return validate(value);
  });
  if (!values.length) throw new Error(`Access requires ${names[0]}.`);
  if (new Set(values).size !== 1) throw new Error(`Access configuration conflicts: ${names.join(", ")}.`);
  return values[0]!;
}

export function resolveClientConfig(env: ClientEnv = process.env): { baseUrl: string; apiKey: string } {
  for (const name of ["HASNA_ACCESS_DATABASE_URL", "ACCESS_DATABASE_URL", "HASNA_ACCESS_DATABASE_URL_FILE", "ACCESS_DATABASE_URL_FILE", "HASNA_ACCESS_DB_PATH", "ACCESS_DB_PATH"]) {
    if (env[name] !== undefined) throw new Error(`Access clients cannot consume ${name}; configure the HTTPS API instead.`);
  }
  for (const prefix of ["HASNA_ACCESS", "ACCESS"]) {
    for (const suffix of ["MODE", "STORAGE_MODE", "BACKEND", "LOCAL", "SELF_HOSTED", "CLOUD"]) {
      if (env[`${prefix}_${suffix}`] !== undefined) throw new Error(`Retired selector ${prefix}_${suffix}; configure the HTTPS API instead.`);
    }
  }
  return {
    baseUrl: declaration(env, ["HASNA_ACCESS_API_URL", "ACCESS_API_URL"], httpsBaseUrl),
    apiKey: declaration(env, ["HASNA_ACCESS_API_KEY", "ACCESS_API_KEY"], value => {
      if (/[\s\x00-\x1f\x7f]/.test(value)) throw new Error("Access API credential is invalid.");
      return value;
    }),
  };
}
