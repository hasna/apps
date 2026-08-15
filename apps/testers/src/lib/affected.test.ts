import { describe, it, expect } from "bun:test";
import { matchFilesToScenarios } from "./affected.js";
import type { Scenario } from "../types/index.js";

function makeScenario(overrides: Partial<Scenario>): Scenario {
  return {
    id: overrides.id ?? "id-" + Math.random().toString(36).slice(2),
    shortId: overrides.shortId ?? "sc-1",
    projectId: null,
    name: overrides.name ?? "Test scenario",
    description: "",
    steps: [],
    tags: overrides.tags ?? [],
    priority: "medium",
    model: null,
    timeoutMs: null,
    targetPath: overrides.targetPath ?? null,
    requiresAuth: false,
    authConfig: null,
    metadata: null,
    assertions: [],
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("matchFilesToScenarios", () => {
  it("returns all scenarios when filePaths is empty", () => {
    const scenarios = [makeScenario({ id: "a" }), makeScenario({ id: "b" })];
    expect(matchFilesToScenarios([], scenarios)).toEqual(scenarios);
  });

  it("returns empty when no scenarios match", () => {
    const scenarios = [makeScenario({ name: "Login page", tags: ["auth"] })];
    const result = matchFilesToScenarios(["src/dashboard/chart.ts"], scenarios);
    expect(result).toHaveLength(0);
  });

  // Strategy 1: explicit glob → tag mappings
  it("matches via explicit glob→tag mapping (*)", () => {
    const chat = makeScenario({ id: "chat", tags: ["chat"] });
    const auth = makeScenario({ id: "auth", tags: ["auth"] });
    const result = matchFilesToScenarios(
      ["src/hooks/use-chat.ts"],
      [chat, auth],
      [{ glob: "src/hooks/use-chat*", tags: ["chat"] }],
    );
    expect(result.map((s) => s.id)).toEqual(["chat"]);
  });

  it("matches via explicit glob→tag mapping (**)", () => {
    const s = makeScenario({ id: "s1", tags: ["billing"] });
    const result = matchFilesToScenarios(
      ["src/features/billing/invoice.ts"],
      [s],
      [{ glob: "src/features/billing/**", tags: ["billing"] }],
    );
    expect(result).toHaveLength(1);
  });

  it("does not match when glob matches but scenario lacks the tag", () => {
    const s = makeScenario({ id: "s1", tags: ["unrelated"] });
    const result = matchFilesToScenarios(
      ["src/hooks/use-chat.ts"],
      [s],
      [{ glob: "src/hooks/use-chat*", tags: ["chat"] }],
    );
    expect(result).toHaveLength(0);
  });

  // Strategy 2: targetPath segments
  it("matches via targetPath segment", () => {
    const s = makeScenario({ id: "s1", targetPath: "/chat/rooms" });
    const result = matchFilesToScenarios(["src/components/chat/ChatRoom.tsx"], [s]);
    expect(result).toHaveLength(1);
  });

  it("does not match short targetPath segments (<= 2 chars)", () => {
    const s = makeScenario({ id: "s1", targetPath: "/ab" });
    const result = matchFilesToScenarios(["src/ab/foo.ts"], [s]);
    expect(result).toHaveLength(0);
  });

  // Strategy 3: tag keywords
  it("matches via tag keyword in file path", () => {
    const s = makeScenario({ id: "s1", tags: ["dashboard"] });
    const result = matchFilesToScenarios(["src/pages/dashboard/index.tsx"], [s]);
    expect(result).toHaveLength(1);
  });

  it("does not match tags <= 2 chars", () => {
    const s = makeScenario({ id: "s1", tags: ["ab"] });
    const result = matchFilesToScenarios(["src/ab/foo.ts"], [s]);
    expect(result).toHaveLength(0);
  });

  // Strategy 4: name keywords
  it("matches via scenario name keyword in file path", () => {
    const s = makeScenario({ id: "s1", name: "Checkout flow" });
    const result = matchFilesToScenarios(["src/pages/checkout/summary.tsx"], [s]);
    expect(result).toHaveLength(1);
  });

  it("does not match name words <= 3 chars", () => {
    const s = makeScenario({ id: "s1", name: "Log in" });
    const result = matchFilesToScenarios(["src/log/in.ts"], [s]);
    expect(result).toHaveLength(0);
  });

  // Union behaviour
  it("returns union of all matching strategies", () => {
    const byTag = makeScenario({ id: "byTag", tags: ["profile"] });
    const byPath = makeScenario({ id: "byPath", targetPath: "/settings" });
    const neither = makeScenario({ id: "neither", name: "Unrelated test" });

    const result = matchFilesToScenarios(
      ["src/features/profile/avatar.ts", "src/pages/settings/account.tsx"],
      [byTag, byPath, neither],
    );
    expect(result.map((s) => s.id).sort()).toEqual(["byPath", "byTag"]);
  });

  // Normalisation
  it("is case-insensitive for file paths and tags", () => {
    const s = makeScenario({ id: "s1", tags: ["Login"] });
    const result = matchFilesToScenarios(["src/pages/login/page.tsx"], [s]);
    expect(result).toHaveLength(1);
  });

  it("handles Windows-style backslash paths", () => {
    const s = makeScenario({ id: "s1", tags: ["checkout"] });
    const result = matchFilesToScenarios(["src\\pages\\checkout\\index.tsx"], [s]);
    expect(result).toHaveLength(1);
  });

  it("deduplicates: scenario matched by multiple strategies appears once", () => {
    const s = makeScenario({ id: "s1", name: "Cart checkout", tags: ["checkout"], targetPath: "/checkout" });
    const result = matchFilesToScenarios(["src/features/checkout/Cart.tsx"], [s]);
    expect(result).toHaveLength(1);
  });
});
