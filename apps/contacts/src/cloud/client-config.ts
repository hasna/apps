/** Strict ambiguity checks around the published credential resolver, not a replacement resolver. */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { clientTransportEnvKeys, credentialDiskSourceList, toV1BaseUrl } from "@hasna/contracts/client";

type Env = Record<string, string | undefined>;

function invalid(): never {
  throw new Error("CONTACTS_CLIENT_CONFIG_INVALID: blank, conflicting, or unstable client configuration; no request was sent.");
}

function checkAliases(values: Env): void {
  const keys = clientTransportEnvKeys("contacts");
  for (const group of [keys.apiUrlKeys, keys.apiKeyKeys]) {
    const defined = group.filter((key) => values[key] !== undefined);
    const normalized = defined.map((key) => {
      const value = values[key]!.trim();
      if (!value) invalid();
      if (group === keys.apiUrlKeys) {
        try { return toV1BaseUrl(value); } catch { invalid(); }
      }
      return value;
    });
    if (new Set(normalized).size > 1) invalid();
  }
}

/** Values never leave this check or enter diagnostics. Preserve blanks the older kit ignores. */
function checkDiskAliases(text: string): void {
  const values: Env = {};
  const wanted = new Set(Object.values(clientTransportEnvKeys("contacts")).flat());
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match || !wanted.has(match[1]!)) continue;
    let value = match[2]!.trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      if (value.length < 2 || value.at(-1) !== value[0]) invalid();
      value = value.slice(1, -1);
    }
    if (values[match[1]!] !== undefined && values[match[1]!] !== value) invalid();
    values[match[1]!] = value;
  }
  checkAliases(values);
}

/** A private change detector spanning every source the shared resolver may consult. */
export function clientConfigurationStamp(env: Env): string {
  checkAliases(env);
  const digest = createHash("sha256");
  digest.update(JSON.stringify(Object.entries(env).sort(([a], [b]) => a.localeCompare(b))));
  const profile = env.HASNA_PROFILE?.trim();
  if (profile && !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(profile)) invalid();
  const paths = [
    ...credentialDiskSourceList("contacts", env),
    ...(profile ? credentialDiskSourceList("contacts", env, profile) : []),
  ];
  for (const { path } of paths) {
    digest.update(path);
    try {
      const before = statSync(path, { bigint: true });
      if (!before.isFile() || before.size > 65536n) invalid();
      const contents = readFileSync(path);
      const after = statSync(path, { bigint: true });
      const identity = (s: typeof before) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
      if (identity(before) !== identity(after)) invalid();
      checkDiskAliases(contents.toString("utf8"));
      digest.update(identity(after)).update(contents);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") invalid();
      digest.update("absent");
    }
  }
  return digest.digest("hex");
}

export function assertConfigurationUnchanged(env: Env, expected: string): void {
  if (clientConfigurationStamp(env) !== expected) invalid();
}
