#!/usr/bin/env bun

export const MINIMUM_NPM_VERSION = "11.5.1";

type ParsedVersion = readonly [major: number, minor: number, patch: number];

export function supportsTrustedPublishing(version: string): boolean {
  const parsed = parseVersion(version);
  if (!parsed) return false;

  const minimum = parseVersion(MINIMUM_NPM_VERSION);
  if (!minimum) throw new Error(`Invalid configured minimum npm version: ${MINIMUM_NPM_VERSION}`);

  for (let index = 0; index < parsed.length; index += 1) {
    const currentPart = parsed[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;
    if (currentPart > minimumPart) return true;
    if (currentPart < minimumPart) return false;
  }
  return true;
}

export function assertTrustedPublishingVersion(version: string): void {
  const normalized = version.trim();
  if (!normalized) {
    throw new Error(
      `Cannot verify npm trusted publishing support: version was empty; requires npm >= ${MINIMUM_NPM_VERSION}.`,
    );
  }
  if (!parseVersion(normalized)) {
    throw new Error(
      `Cannot verify npm trusted publishing support: invalid npm version "${normalized}"; requires npm >= ${MINIMUM_NPM_VERSION}.`,
    );
  }
  if (!supportsTrustedPublishing(normalized)) {
    throw new Error(
      `npm ${normalized} is too old for trusted publishing; requires npm >= ${MINIMUM_NPM_VERSION}.`,
    );
  }
}

function parseVersion(version: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\+.*)?$/.exec(version.trim());
  if (!match) return null;

  const parsed = match.slice(1, 4).map(Number);
  if (parsed.some((part) => !Number.isSafeInteger(part) || part < 0)) return null;
  return [parsed[0] ?? 0, parsed[1] ?? 0, parsed[2] ?? 0];
}

if (import.meta.main) {
  const version = process.argv[2] ?? "";
  try {
    assertTrustedPublishingVersion(version);
    console.log(`npm ${version.trim()} satisfies trusted publishing minimum ${MINIMUM_NPM_VERSION}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
