import { describe, expect, test } from "bun:test";
import {
  DEFAULT_HEAL_CONFIG,
  decideAction,
  defaultHealState,
  evaluateHealth,
  type HealConfig,
  type HealState,
  type HealthProbe,
} from "../src/commands/heal.js";

function cfg(overrides: Partial<HealConfig> = {}): HealConfig {
  return {
    ...DEFAULT_HEAL_CONFIG,
    preferredSsid: "X81ND",
    fallbackSsid: "DIGI-s2N5",
    thresholds: { ...DEFAULT_HEAL_CONFIG.thresholds },
    ...overrides,
  };
}

function probe(overrides: Partial<HealthProbe> = {}): HealthProbe {
  return {
    associatedSsid: "X81ND",
    gatewayReachable: true,
    anchorsReachable: { spark02: true, apple03: true },
    internetReachable: true,
    ...overrides,
  };
}

function state(overrides: Partial<HealState> = {}): HealState {
  return { ...defaultHealState(), bootId: "boot-1", ...overrides };
}

describe("evaluateHealth", () => {
  test("healthy when on preferred SSID, gateway up, quorum met", () => {
    const r = evaluateHealth(probe(), cfg(), state());
    expect(r.healthy).toBe(true);
    expect(r.remoteScore).toBe(3);
  });

  test("unhealthy on the wrong SSID even if internet works", () => {
    const r = evaluateHealth(probe({ associatedSsid: "SomeGuestNet" }), cfg(), state());
    expect(r.healthy).toBe(false);
    expect(r.reasons.some((x) => x.startsWith("wrong-ssid"))).toBe(true);
  });

  test("CONFIRMED INCIDENT: locally fine but isolated from peers is unhealthy", () => {
    // On preferred SSID, gateway + internet OK, but no peer reachable (quorum 1/2).
    const r = evaluateHealth(
      probe({ anchorsReachable: { spark02: false, apple03: false }, internetReachable: true }),
      cfg(),
      state(),
    );
    expect(r.healthy).toBe(false);
    expect(r.remoteScore).toBe(1);
    expect(r.reasons).toContain("quorum:1/2");
  });

  test("fallback SSID only acceptable during a degraded window", () => {
    const onFallback = probe({ associatedSsid: "DIGI-s2N5" });
    expect(evaluateHealth(onFallback, cfg(), state({ degradedUntil: 0 })).healthy).toBe(false);
    expect(evaluateHealth(onFallback, cfg(), state({ degradedUntil: 9999999999 })).healthy).toBe(true);
  });
});

const NOW = 1_000_000;
function decide(s: HealState, healthy: boolean, opts: { now?: number; gpuBusy?: boolean; config?: HealConfig; boot?: string } = {}) {
  return decideAction({
    state: s,
    healthy,
    now: opts.now ?? NOW,
    gpuBusy: opts.gpuBusy ?? false,
    config: opts.config ?? cfg(),
    currentBootId: opts.boot ?? s.bootId,
  });
}

describe("decideAction escalation", () => {
  test("healthy resets failCount and stamps bootHealthySince", () => {
    const d = decide(state({ failCount: 5 }), true);
    expect(d.action).toBe("none");
    expect(d.state.failCount).toBe(0);
    expect(d.state.bootHealthySince).toBe(NOW);
  });

  test("sustained healthy window clears loop-prevention bookkeeping", () => {
    const s = state({ bootHealthySince: NOW - 400, failedBootRecoveries: 2, rebootSuppressUntil: NOW + 999, pendingRebootRecovery: true });
    const d = decide(s, true); // healthyWindowSec default 300, 400 >= 300
    expect(d.state.failedBootRecoveries).toBe(0);
    expect(d.state.rebootSuppressUntil).toBe(0);
    expect(d.state.pendingRebootRecovery).toBe(false);
  });

  test("below reconnect threshold takes no action", () => {
    const d = decide(state({ failCount: 1 }), false);
    expect(d.action).toBe("none");
    expect(d.state.failCount).toBe(2);
  });

  test("reconnect fires at threshold, then is rate-limited", () => {
    const d1 = decide(state({ failCount: 2, lastReconnect: 0 }), false); // ->3
    expect(d1.action).toBe("reconnect_wifi");
    expect(d1.state.lastReconnect).toBe(NOW);
    const d2 = decide(d1.state, false, { now: NOW + 30 }); // within 120s window
    expect(d2.action).toBe("none");
  });

  test("NetworkManager restart fires at its threshold", () => {
    const d = decide(state({ failCount: 6, lastNmRestart: 0 }), false); // ->7
    expect(d.action).toBe("restart_nm");
    expect(d.state.lastNmRestart).toBe(NOW);
  });

  test("fallback SSID fires at its threshold and opens a degraded window", () => {
    const d = decide(state({ failCount: 11, lastFallback: 0 }), false); // ->12
    expect(d.action).toBe("fallback_ssid");
    expect(d.state.degradedUntil).toBe(NOW + DEFAULT_HEAL_CONFIG.fallbackWindowSec);
  });

  test("restore_preferred after the degraded window once healthy again", () => {
    const d = decide(state({ degradedUntil: NOW - 1 }), true);
    expect(d.action).toBe("restore_preferred");
    expect(d.state.degradedUntil).toBe(0);
  });

  test("reboot fires at threshold and marks a pending recovery", () => {
    const d = decide(state({ failCount: 14, lastRebootAttempt: 0 }), false); // ->15
    expect(d.action).toBe("reboot");
    expect(d.state.pendingRebootRecovery).toBe(true);
    expect(d.state.lastRebootAttempt).toBe(NOW);
  });
});

describe("decideAction reboot gates", () => {
  test("GPU job guard withholds reboot and falls back to reconnect", () => {
    const d = decide(state({ failCount: 14, lastReconnect: 0 }), false, { gpuBusy: true });
    expect(d.action).not.toBe("reboot");
    expect(d.suppressedReason).toBe("gpu");
  });

  test("allowReboot=false never reboots", () => {
    const d = decide(state({ failCount: 14 }), false, { config: cfg({ allowReboot: false }) });
    expect(d.action).not.toBe("reboot");
    expect(d.suppressedReason).toBe("disabled");
  });

  test("reboot rate-limit withholds a too-soon reboot", () => {
    const d = decide(state({ failCount: 14, lastRebootAttempt: NOW - 10 }), false);
    expect(d.action).not.toBe("reboot");
    expect(d.suppressedReason).toBe("rate");
  });

  test("loop prevention: after max failed recoveries, reboots are suppressed with backoff", () => {
    // pendingRebootRecovery means the previous reboot never reached a healthy window.
    const s = state({ failCount: 14, pendingRebootRecovery: true, failedBootRecoveries: 1, lastRebootAttempt: 0 });
    const d = decide(s, false); // failedBootRecoveries -> 2 >= max(2)
    expect(d.action).not.toBe("reboot");
    expect(d.suppressedReason).toBe("loop");
    expect(d.state.rebootSuppressUntil).toBe(NOW + DEFAULT_HEAL_CONFIG.bootBackoffSec);
  });

  test("active suppression window blocks reboot", () => {
    const d = decide(state({ failCount: 14, rebootSuppressUntil: NOW + 100 }), false);
    expect(d.action).not.toBe("reboot");
    expect(d.suppressedReason).toBe("loop");
  });
});

describe("decideAction boot transition", () => {
  test("a new boot id resets per-boot failCount", () => {
    const d = decide(state({ failCount: 9, bootId: "old-boot" }), false, { boot: "new-boot" });
    // failCount reset to 0 by boot transition, then +1 for this unhealthy tick
    expect(d.state.failCount).toBe(1);
    expect(d.state.bootId).toBe("new-boot");
  });
});
