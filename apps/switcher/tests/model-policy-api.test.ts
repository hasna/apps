import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { modelPolicySchema, routingEventSchema } from "../src/model-policy-schema";
import { readModelPolicy } from "../src/cli";
import { ensureLaunchProfile } from "../src/direct-launch";
import { SwitcherError, type SwitcherClient, type Profile, type Provider } from "../src/sdk";

describe("model policy contract", () => {
  test("reuses the same direct profile when policy object keys are reordered", async () => {
    let saved:Profile|undefined;
    const client={getProfile:async()=>{if(!saved)throw new SwitcherError(404,"not_found","Missing");return saved;},createProfile:async(input:any)=>saved={...input,version:1,updatedAt:new Date().toISOString()}} as unknown as SwitcherClient;
    const provider={id:"provider"} as Provider;
    const first=await ensureLaunchProfile(client,provider,"claude","main",{version:1,aliases:{a:"main",b:"main"}});
    const second=await ensureLaunchProfile(client,provider,"claude","main",{version:1,aliases:{b:"main",a:"main"}});
    expect(second).toEqual(first);
  });

  test("historical run responses may omit policy evidence while new runs require version 1", async () => {
    const spec=await Bun.file(new URL('../openapi.json',import.meta.url)).json();
    expect(spec.components.schemas.RunInput.required).toContain("modelPolicyVersion");
    expect(spec.components.schemas.Run.required).not.toContain("modelPolicyVersion");
  });

  test("accepts bounded role aliases and fallback references, rejects control-bearing IDs", () => {
    const policy = modelPolicySchema.parse({
      roles: {subagent: "provider/subagent", summary: "provider/summary"},
      allowedModels: ["provider/main", "provider/subagent"],
      aliases: {fast: "provider/main"},
      fallbacks: {"provider/main": ["provider/backup"]},
    });
    expect(policy.version).toBe(1);
    expect(() => modelPolicySchema.parse({roles: {fast: "provider/model\nforged"}})).toThrow();
    expect(() => modelPolicySchema.parse({allowedModels: Array.from({length: 1001}, (_, i) => `provider/${i}`)})).toThrow();
  });

  test("keeps routing evidence bounded and redacted to safe fields", () => {
    const event = routingEventSchema.parse({at: "2026-09-06T19:00:00.000Z", requestId: "req-1", requestedModel: "provider/main", resolvedModel: "provider/main", decision: "allow", role: "main", reason: "policy_allow", upstreamStatus: 200});
    expect(event.reportedModel).toBeUndefined();
    expect(() => routingEventSchema.parse({...event, reason: "upstream error"})).toThrow();
  });

  test("parses ergonomic repeated role flags and rejects ambiguous policy sources", async () => {
    expect(await readModelPolicy(undefined, ["fast=provider/fast", "review=provider/review"])).toEqual({version: 1, roles: {fast: "provider/fast", review: "provider/review"}});
    await expect(readModelPolicy(undefined, ["unknown=provider/model"])).rejects.toMatchObject({code: "invalid_request"});
    const root = await mkdtemp(join(homedir(), "Workspace/scratch/switcher-tests/model-policy-"));
    try {
      const file = join(root, "policy.json"); await writeFile(file, JSON.stringify({roles: {fast: "provider/fast"}}));
      await expect(readModelPolicy(file, ["review=provider/review"])).rejects.toMatchObject({code: "conflicting_options"});
      expect(await readModelPolicy(file, undefined)).toEqual({version: 1, roles: {fast: "provider/fast"}});
    } finally { await rm(root, {recursive: true, force: true}); }
  });
});
