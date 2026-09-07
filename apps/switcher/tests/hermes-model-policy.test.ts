import { expect, test } from "bun:test";
import { compileHermesModelPolicy } from "../src/hermes-model-policy";

test("pins Hermes auxiliary tasks and delegation to selected custom endpoint", () => {
  const fragment = compileHermesModelPolicy("main", { subagent: "sub", summary: "summary", fast: "fast" }, "https://127.0.0.1:9443/v1");
  expect(fragment.delegation).toEqual({ model: "sub", provider: "custom", base_url: "https://127.0.0.1:9443/v1" });
  expect(fragment.auxiliary.compression.model).toBe("main");
  expect(fragment.auxiliary.title_generation.model).toBe("summary");
  expect(fragment.auxiliary.skills_hub.model).toBe("fast");
  expect(fragment.auxiliary.web_extract.fallback_chain).toEqual([]);
  expect(JSON.stringify(fragment)).not.toContain("secret");
  expect(fragment.env.apiKeyEnv).toBe("SWITCHER_HERMES_AUX_API_KEY");
});

test("defaults every auxiliary route to the selected main model", () => {
  const fragment = compileHermesModelPolicy("main", {}, "https://aux.example.test");
  expect(new Set(Object.values(fragment.auxiliary).map(route => route.model))).toEqual(new Set(["main"]));
  expect(fragment.delegation.model).toBe("main");
});

test("rejects unsafe endpoints and malformed models without echoing secrets", () => {
  expect(() => compileHermesModelPolicy("main", {}, "https://user:secret@example.test")).toThrow(/endpoint/);
  expect(() => compileHermesModelPolicy("", {}, "https://aux.example.test")).toThrow(/model/);
  expect(() => compileHermesModelPolicy("main", { summary: "bad\nmodel" }, "https://aux.example.test")).toThrow(/roles.summary/);
});
