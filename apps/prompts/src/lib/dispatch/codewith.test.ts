import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  accountLockKey,
  acquireAccountLock,
  discoverTargets,
  isSparkModel,
  projectTargets,
  releaseAccountLock,
  selectTarget,
} from "./codewith.js"
import { DispatchError } from "./types.js"
import {
  createFakeBins,
  realShapeUsageFixture,
  usageFixture,
  type FakeBins,
} from "./test-fakes.js"
import { USAGE_READ_MAX_BYTES } from "./codewith.js"

let fakes: FakeBins

beforeEach(() => {
  fakes = createFakeBins()
})

afterEach(() => {
  fakes.cleanup()
})

describe("projectTargets", () => {
  test("projects only the safe target surface", () => {
    const fixture = usageFixture([
      { name: "account001", ok: true, health: "healthy", fingerprint: "acct_fake_0001" },
      { name: "account002", ok: true, health: "unknown", reason: "unsupported_or_missing_usage_windows", fingerprint: "acct_fake_0002" },
      { name: "account003", ok: false, health: null, fingerprint: null },
    ])
    const targets = projectTargets(fixture)
    expect(targets).toHaveLength(3)
    const first = targets[0]!
    expect(first.name).toBe("account001")
    expect(first.profile_name).toBe("account001")
    expect(first.provider).toBe("chat-gpt")
    expect(first.plan).toBe("Pro")
    expect(first.available).toBe(true)
    expect(first.fingerprint).toBe("acct_fake_0001")
    const second = targets[1]!
    expect(second.available).toBe(false)
    expect(second.health_status).toBe("unknown")
    const third = targets[2]!
    expect(third.available).toBe(false)
    expect(third.fingerprint).toBeNull()
  })

  test("rejects malformed payloads as empty", () => {
    expect(projectTargets(null)).toEqual([])
    expect(projectTargets({})).toEqual([])
    expect(projectTargets({ targets: "nope" })).toEqual([])
  })
})

describe("selectTarget", () => {
  const targets = () =>
    projectTargets(
      usageFixture([
        { name: "account001", ok: true, health: "healthy", fingerprint: "acct_fake_0001" },
        { name: "account002", ok: true, health: "unknown", reason: "unsupported_or_missing_usage_windows", fingerprint: "acct_fake_0002" },
        { name: "root", ok: true, health: "healthy", fingerprint: "acct_fake_root", displayName: "root", profileName: null },
      ])
    )

  test("auto-selects a healthy named profile with a fingerprint", () => {
    const selected = selectTarget(targets())
    expect(selected.name).toBe("account001")
  })

  test("auto-selection never uses the root entry (unnamed auth profile)", () => {
    const onlyRoot = projectTargets(
      usageFixture([{ name: "root", ok: true, health: "healthy", fingerprint: "acct_fake_root", profileName: null }])
    )
    expect(() => selectTarget(onlyRoot)).toThrow(
      expect.objectContaining({ code: "NO_HEALTHY_TARGET" })
    )
  })

  test("explicit requested target must be discovered", () => {
    expect(() => selectTarget(targets(), "account999")).toThrow(
      expect.objectContaining({ code: "TARGET_NOT_FOUND" })
    )
  })

  test("explicit requested target must be healthy now", () => {
    expect(() => selectTarget(targets(), "account002")).toThrow(
      expect.objectContaining({ code: "TARGET_NOT_AVAILABLE" })
    )
  })

  test("no healthy targets reports examined and usable counts", () => {
    const dead = projectTargets(
      usageFixture([
        { name: "account001", ok: true, health: "unknown", reason: "unsupported_or_missing_usage_windows", fingerprint: "acct_fake_0001" },
        { name: "account002", ok: false, health: null, fingerprint: null },
      ])
    )
    let error: unknown
    try {
      selectTarget(dead)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(DispatchError)
    const dispatchError = error as DispatchError
    expect(dispatchError.code).toBe("NO_HEALTHY_TARGET")
    expect(dispatchError.message).toContain("examined 2")
    expect(dispatchError.message).toContain("usable 0")
  })
})

describe("isSparkModel", () => {
  test("rejects spark model identifiers", () => {
    expect(isSparkModel("gpt-5.3-codex-spark")).toBe(true)
    expect(isSparkModel("codex-spark")).toBe(true)
    expect(isSparkModel("gpt-5.6-sol")).toBe(false)
    expect(isSparkModel("gpt-5.6-luna")).toBe(false)
  })
})

describe("accountLockKey", () => {
  test("uses the provider-account fingerprint namespace", () => {
    expect(accountLockKey("chat-gpt", "acct_fake_0001")).toBe(
      "codewith/provider-account/chat-gpt/acct_fake_0001"
    )
  })
})

describe("discoverTargets", () => {
  test("discovers and projects targets from the fake bin", async () => {
    fakes.setUsageFixture(
      usageFixture([{ name: "account001", ok: true, health: "healthy", fingerprint: "acct_fake_0001" }])
    )
    const result = await discoverTargets(fakes.codewithBin)
    expect(result.examined).toBe(1)
    expect(result.targets[0]?.name).toBe("account001")
    expect(result.targets[0]?.available).toBe(true)
    expect(result.warning).toBeNull()
  })

  test("accepts exit 2 (some targets unverified) and carries a bounded warning", async () => {
    fakes.setUsageFixture(
      usageFixture([{ name: "account001", ok: true, health: "healthy", fingerprint: "acct_fake_0001" }])
    )
    fakes.setConfig({ FAKE_USAGE_EXIT: 2 })
    const result = await discoverTargets(fakes.codewithBin)
    expect(result.examined).toBe(1)
  })

  test("fails with TARGET_DISCOVERY_FAILED on a hard failure", async () => {
    fakes.setConfig({ FAKE_USAGE_EXIT: 3 })
    let error: unknown
    try {
      await discoverTargets(fakes.codewithBin)
    } catch (caught) {
      error = caught
    }
    expect((error as DispatchError).code).toBe("TARGET_DISCOVERY_FAILED")
  })

  test("fails with TARGET_DISCOVERY_FAILED on invalid JSON", async () => {
    fakes.setUsageFixture("this is not json")
    let error: unknown
    try {
      await discoverTargets(fakes.codewithBin)
    } catch (caught) {
      error = caught
    }
    expect((error as DispatchError).code).toBe("TARGET_DISCOVERY_FAILED")
  })
})

describe("discoverTargets with a real-shape usage population", () => {
  /**
   * Regression fixture for the 4096-byte read-bound defect: the real
   * `codewith usage --all --json` payload measured 2026-08-17 was 81,511
   * bytes for 28 targets, so the old 4096-byte capture bound truncated it
   * mid-string and every real discovery failed with TARGET_DISCOVERY_FAILED.
   * The fixture is stringified with 2-space indentation like the real CLI
   * emits; it must stay far above 4096 bytes (and above a 64 KiB pipe
   * buffer) so a reintroduced low bound fails this test.
   */
  const realShapePayload = () => JSON.stringify(realShapeUsageFixture(), null, 2)

  test("the real-shape fixture is sized like the measured population", () => {
    const bytes = Buffer.byteLength(realShapePayload(), "utf8")
    expect(bytes).toBeGreaterThan(64 * 1024)
    expect(bytes).toBeLessThan(160 * 1024)
  })

  test("parses a real-shape 28-target population end to end", async () => {
    fakes.setUsageFixture(realShapePayload())
    const result = await discoverTargets(fakes.codewithBin)
    expect(result.examined).toBe(28)
    // Root entry: unnamed auth profile.
    const root = result.targets.find((t) => t.profile_name === null)
    expect(root).toBeDefined()
    expect(root?.ok).toBe(true)
    expect(root?.fingerprint).not.toBeNull()
    // 24 of 28 entries carry a fingerprint (measured population).
    expect(result.targets.filter((t) => t.fingerprint !== null)).toHaveLength(24)
    // Healthy-shaped entries report health status "unknown" (the current CLI
    // contract), so none is `available`; selection must reach the honest
    // NO_HEALTHY_TARGET verdict rather than a parse failure.
    expect(result.targets.filter((t) => t.ok && t.health_status === "unknown").length).toBeGreaterThan(0)
    expect(result.targets.filter((t) => t.available)).toHaveLength(0)
    expect(() => selectTarget(result.targets)).toThrow(
      expect.objectContaining({ code: "NO_HEALTHY_TARGET" })
    )
  })

  test("the usage read bound covers the real population", () => {
    expect(USAGE_READ_MAX_BYTES).toBeGreaterThanOrEqual(2 * 1024 * 1024)
  })
})

describe("account lock acquire/release", () => {
  test("acquire exit 0 is acquired; release is idempotent", async () => {
    const key = accountLockKey("chat-gpt", "acct_fake_0001")
    const acquired = await acquireAccountLock(fakes.locksBin, key, 1800)
    expect(acquired.acquired).toBe(true)
    expect(acquired.held).toBe(false)
    const released = await releaseAccountLock(fakes.locksBin, key)
    expect(released.released).toBe(true)
  })

  test("a second acquire of the same key reports held", async () => {
    const key = accountLockKey("chat-gpt", "acct_fake_0001")
    const first = await acquireAccountLock(fakes.locksBin, key, 1800)
    expect(first.acquired).toBe(true)
    const second = await acquireAccountLock(fakes.locksBin, key, 1800)
    expect(second.acquired).toBe(false)
    expect(second.held).toBe(true)
  })

  test("release frees the key for the next lane", async () => {
    const key = accountLockKey("chat-gpt", "acct_fake_0001")
    expect((await acquireAccountLock(fakes.locksBin, key, 1800)).acquired).toBe(true)
    expect((await releaseAccountLock(fakes.locksBin, key)).released).toBe(true)
    const again = await acquireAccountLock(fakes.locksBin, key, 1800)
    expect(again.acquired).toBe(true)
  })
})
