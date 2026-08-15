interface BunConfig {
  install?: {
    minimumReleaseAge?: number;
    minimumReleaseAgeExcludes?: string[];
  };
}

interface BunLock {
  packages?: Record<string, [string, ...unknown[]]>;
}

interface RegistryMetadata {
  time?: Record<string, string>;
}

const bunWithJsonc = Bun as typeof Bun & {
  JSONC: { parse: (text: string) => unknown };
};
const config = Bun.TOML.parse(
  await Bun.file("bunfig.toml").text(),
) as BunConfig;
const minimumReleaseAge = config.install?.minimumReleaseAge;

if (
  typeof minimumReleaseAge !== "number" ||
  !Number.isSafeInteger(minimumReleaseAge) ||
  minimumReleaseAge <= 0
) {
  throw new Error("bunfig.toml must configure a positive minimumReleaseAge");
}

const excludedPackages = new Set(
  config.install?.minimumReleaseAgeExcludes ?? [],
);
const lock = bunWithJsonc.JSONC.parse(
  await Bun.file("bun.lock").text(),
) as BunLock;
const lockedPackages = Object.values(lock.packages ?? {});
const cutoff = Date.now() - minimumReleaseAge * 1_000;

if (lockedPackages.length === 0) {
  throw new Error("bun.lock contains no registry packages to verify");
}

for (const [resolution] of lockedPackages) {
  const separator = resolution.lastIndexOf("@");
  if (separator <= 0 || separator === resolution.length - 1) {
    throw new Error(`Unsupported registry resolution in bun.lock: ${resolution}`);
  }

  const name = resolution.slice(0, separator);
  const version = resolution.slice(separator + 1);
  if (excludedPackages.has(name)) {
    console.log(`${name}@${version}: excluded by bunfig.toml`);
    continue;
  }

  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}`,
  );
  if (!response.ok) {
    throw new Error(
      `Registry metadata request failed for ${name}: HTTP ${response.status}`,
    );
  }

  const metadata = (await response.json()) as RegistryMetadata;
  const publishedAt = metadata.time?.[version];
  const publishedAtMs = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  if (!Number.isFinite(publishedAtMs)) {
    throw new Error(`Registry publish time missing for ${name}@${version}`);
  }
  if (publishedAtMs > cutoff) {
    const ageSeconds = Math.floor((Date.now() - publishedAtMs) / 1_000);
    throw new Error(
      `${name}@${version} is ${ageSeconds}s old; minimum is ${minimumReleaseAge}s`,
    );
  }

  console.log(`${name}@${version}: release age verified`);
}

export {};
