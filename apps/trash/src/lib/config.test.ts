/**
 * Configuration: the defaults, the merge, the validation gates, and the
 * `config set|unset` surface.
 *
 * The two things pinned hardest here are the ones that decide whether bytes may
 * be deleted: `dryRun`/`requireExplicitApply` default to the safe posture, and
 * the cloud window must OUTLIVE the local one (§15.11.1/11.2 — the correction
 * that reverses §6's "keep the local clock ≥ cloud").
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { createSandbox, type Sandbox } from "../testing/sandbox.js";
import {
  CONFIG_KEYS,
  DEFAULT_TRASH_CONFIG,
  loadTrashConfig,
  mergeTrashConfig,
  saveTrashConfig,
  setConfigValue,
  unsetConfigValue,
  validateTrashConfig,
  type TrashConfig,
} from "./config.js";

let sandbox: Sandbox;

beforeEach(() => {
  sandbox = createSandbox();
});

afterEach(() => {
  sandbox.cleanup();
});

describe("defaults — the safe posture", () => {
  test("a sweep is a dry run that needs an explicit apply, and the floor is real", () => {
    expect(DEFAULT_TRASH_CONFIG.retention.dryRun).toBe(true);
    expect(DEFAULT_TRASH_CONFIG.retention.requireExplicitApply).toBe(true);
    expect(DEFAULT_TRASH_CONFIG.retention.minUnuploadedKeep).toBeGreaterThan(0);
    expect(DEFAULT_TRASH_CONFIG.version).toBe(1);
  });

  test("the local clock is 30 days and the cloud clock OUTLIVES it", () => {
    const { retention, cloud } = DEFAULT_TRASH_CONFIG;
    expect(retention.retentionDays).toBe(30);
    expect(cloud.retentionDays).toBe(90);
    expect(cloud.retentionDays! >= retention.retentionDays!).toBe(true);
  });

  test("the default exclude list is exactly the not-precious class", () => {
    expect([...DEFAULT_TRASH_CONFIG.capture.excludeGlobs]).toEqual([
      "**/node_modules/**",
      "**/.git/objects/**",
      "**/target/**",
      "**/dist/**",
      "**/.venv/**",
      "**/__pycache__/**",
    ]);
    expect(DEFAULT_TRASH_CONFIG.capture.onRefuse).toBe("record");
  });
});

describe("validateTrashConfig — fail closed", () => {
  const patch = (p?: Parameters<typeof mergeTrashConfig>[0]): TrashConfig => mergeTrashConfig(p);

  test("a cloud window shorter than the local one is REFUSED", () => {
    // The last-copy failure: the local payload is evicted on a remote
    // confirmation, then the remote object's own lifecycle rule expires it.
    expect(() => validateTrashConfig(patch({ retention: { retentionDays: 90 }, cloud: { retentionDays: 30 } }))).toThrow(
      /cloud.retentionDays must be >= retention.retentionDays/,
    );
    expect(() => validateTrashConfig(patch({ retention: { retentionDays: 90 }, cloud: { retentionDays: 90 } }))).not.toThrow();
  });

  test("`never` on either clock is not a violation of the invariant", () => {
    expect(() => validateTrashConfig(patch({ retention: { retentionDays: null } }))).not.toThrow();
    expect(() => validateTrashConfig(patch({ cloud: { retentionDays: null } }))).not.toThrow();
  });

  test("a wrong version, a negative number and a bad flag are all refused", () => {
    expect(() => validateTrashConfig({ ...patch(), version: 2 as unknown as 1 })).toThrow(/unsupported version/);
    expect(() => validateTrashConfig(patch({ retention: { maxTotalBytes: -1 } }))).toThrow(/non-negative/);
    expect(() => validateTrashConfig(patch({ retention: { maxEntries: 1.5 } }))).toThrow(/integer/);
    expect(() => validateTrashConfig(patch({ retention: { minUnuploadedKeep: -3 } }))).toThrow(/non-negative/);
    expect(() => validateTrashConfig(patch({ retention: { dryRun: "yes" as unknown as boolean } }))).toThrow(/dryRun must be a boolean/);
    expect(() => validateTrashConfig(patch({ capture: { linkWhenSameDevice: 1 as unknown as boolean } }))).toThrow(/must be a boolean/);
  });

  test("refusals can never be silenced: onRefuse is always `record`", () => {
    expect(() => validateTrashConfig({ ...patch(), capture: { ...patch().capture, onRefuse: "ignore" as unknown as "record" } })).toThrow(
      /onRefuse must be "record"/,
    );
  });

  test("excludeGlobs must be a real array of real globs", () => {
    expect(() => validateTrashConfig(patch({ capture: { excludeGlobs: [] } }))).not.toThrow();
    expect(() => validateTrashConfig(patch({ capture: { excludeGlobs: "**/dist/**" as unknown as string[] } }))).toThrow(/non-empty string array/);
    expect(() => validateTrashConfig(patch({ capture: { excludeGlobs: [""] } }))).toThrow(/non-empty string array/);
    expect(() => validateTrashConfig(patch({ capture: { excludeGlobs: ["  "] } }))).toThrow(/non-empty string array/);
  });
});

describe("mergeTrashConfig — a partial patch can never erase a sibling", () => {
  test("overriding ONE capture field keeps excludeGlobs (and with it §11.7)", () => {
    // The footgun this exists to prevent: a shallow `{...DEFAULT, ...patch}`
    // drops `excludeGlobs`, which flips the boundary between "refuse the
    // delete" and "the delete proceeds".
    const merged = mergeTrashConfig({ capture: { maxEntryBytes: 16 } });
    expect(merged.capture.maxEntryBytes).toBe(16);
    expect(merged.capture.excludeGlobs).toEqual(DEFAULT_TRASH_CONFIG.capture.excludeGlobs);
    expect(merged.capture.minFreeBytes).toBe(DEFAULT_TRASH_CONFIG.capture.minFreeBytes);
    expect(merged.capture.onRefuse).toBe("record");
  });

  test("a patch never carries `version`", () => {
    const merged = mergeTrashConfig({ version: 7 } as unknown as Parameters<typeof mergeTrashConfig>[0]);
    expect(merged.version).toBe(1);
  });

  test("the merge never mutates the defaults", () => {
    const before = structuredClone(DEFAULT_TRASH_CONFIG);
    const merged = mergeTrashConfig({ retention: { dryRun: false } });
    merged.capture.excludeGlobs.push("**/oops/**");
    expect(DEFAULT_TRASH_CONFIG).toEqual(before);
  });

  test("a null/absent patch is the defaults, section by section", () => {
    expect(mergeTrashConfig()).toEqual(DEFAULT_TRASH_CONFIG);
    expect(mergeTrashConfig(null)).toEqual(DEFAULT_TRASH_CONFIG);
  });
});

describe("the config file", () => {
  test("an absent file loads the defaults; a written file round-trips and is 0600", () => {
    const path = sandbox.path("hasna/config/trash/config.json");
    expect(loadTrashConfig(path)).toEqual(DEFAULT_TRASH_CONFIG);

    const next = setConfigValue(loadTrashConfig(path), "retention.dryRun", "false");
    saveTrashConfig(path, next);
    expect(loadTrashConfig(path).retention.dryRun).toBe(false);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("a config file that fails validation is refused on LOAD, not on write", () => {
    const path = sandbox.path("trash/config.json");
    sandbox.file("trash/config.json", JSON.stringify({ version: 1, retention: { retentionDays: 90 }, cloud: { retentionDays: 30 } }));
    // Loading merges over the defaults (so a partial file is usable), and the
    // merged document is validated — a file that would make eviction unsafe
    // cannot be loaded by a sweeper that trusts it.
    expect(() => loadTrashConfig(path)).toThrow(/cloud.retentionDays must be/);
  });

  test("a config file that is not JSON is a hard error, never a silent default", () => {
    const path = sandbox.path("trash/config.json");
    sandbox.file("trash/config.json", "{ this is not json");
    expect(() => loadTrashConfig(path)).toThrow(/not valid JSON/);
  });
});

describe("config set / unset", () => {
  test("a dotted key round-trips through set and unset", () => {
    const base = mergeTrashConfig();
    const set = setConfigValue(base, "retention.retentionDays", "45d");
    expect(set.retention.retentionDays).toBe(45);
    expect(unsetConfigValue(set, "retention.retentionDays").retention.retentionDays).toBe(30);
  });

  test("`never` is meaningful only for the two clocks", () => {
    const base = mergeTrashConfig();
    expect(setConfigValue(base, "retention.retentionDays", "never").retention.retentionDays).toBeNull();
    expect(setConfigValue(base, "cloud.retentionDays", "never").cloud.retentionDays).toBeNull();
    expect(() => setConfigValue(base, "retention.maxEntries", "never")).toThrow(/only meaningful for/);
  });

  test("a TTL suffix is accepted for the clocks and refused for anything else", () => {
    const base = mergeTrashConfig();
    expect(setConfigValue(base, "retention.retentionDays", "12h").retention.retentionDays).toBe(0.5);
    expect(setConfigValue(base, "cloud.retentionDays", "45d").cloud.retentionDays).toBe(45);
    expect(() => setConfigValue(base, "cloud.retentionDays", "0d")).toThrow(/invalid TTL/);
    expect(() => setConfigValue(base, "retention.remoteVerificationHorizonMs", "30d")).toThrow(/cannot parse value/);
  });

  test("a TTL that would shorten the cloud window below the local one is refused", () => {
    // 12h on the cloud clock against a 30-day local clock: the remote copy would
    // expire first, and the local eviction after it would destroy the last copy.
    expect(() => setConfigValue(mergeTrashConfig(), "cloud.retentionDays", "12h")).toThrow(/cloud.retentionDays must be/);
  });

  test("excludeGlobs accepts a JSON array or a comma-separated list", () => {
    const base = mergeTrashConfig();
    expect(setConfigValue(base, "capture.excludeGlobs", '["**/a/**","**/b/**"]').capture.excludeGlobs).toEqual(["**/a/**", "**/b/**"]);
    expect(setConfigValue(base, "capture.excludeGlobs", "**/a/**, **/b/**").capture.excludeGlobs).toEqual(["**/a/**", "**/b/**"]);
    expect(setConfigValue(base, "capture.excludeGlobs", "[]").capture.excludeGlobs).toEqual([]);
  });

  test("an unknown key is refused rather than silently stored", () => {
    expect(() => setConfigValue(mergeTrashConfig(), "retention.everything", "true")).toThrow(/unknown config key/);
    expect(() => unsetConfigValue(mergeTrashConfig(), "capture.oops")).toThrow(/unknown config key/);
    expect(CONFIG_KEYS.length).toBeGreaterThan(0);
    for (const key of CONFIG_KEYS) expect(key.includes(".")).toBe(true);
  });

  test("a set that would break the invariant is refused BEFORE it is stored", () => {
    const base = mergeTrashConfig({ retention: { retentionDays: 60 } });
    expect(() => setConfigValue(base, "cloud.retentionDays", "30")).toThrow(/cloud.retentionDays must be/);
  });
});
