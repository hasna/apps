import { afterAll, describe, expect, it } from "bun:test";
import "./setup";
import { closeDb } from "../src/lib/db";
import { DEFAULT_PROVIDER_PROFILE_SEEDS } from "../src/lib/provider-profile-seeds";
import {
  getProviderProfile,
  listProviderProfiles,
  removeProviderProfile,
  seedDefaultProviderProfiles,
} from "../src/lib/provider-profiles";

describe("default provider profile seeds", () => {
  afterAll(() => {
    closeDb();
  });

  it("defines Notion and Linear as the initial curated providers", () => {
    expect(DEFAULT_PROVIDER_PROFILE_SEEDS.map((profile) => profile.id)).toEqual(["notion", "linear"]);

    const notion = DEFAULT_PROVIDER_PROFILE_SEEDS.find((profile) => profile.id === "notion")!;
    expect(notion.endpoint).toBe("https://mcp.notion.com/mcp");
    expect(notion.transport).toBe("streamable-http");
    expect(notion.fallbackEndpoints).toEqual([
      {
        transport: "sse",
        url: "https://mcp.notion.com/sse",
        notes: "Fallback for clients that do not support Streamable HTTP.",
      },
    ]);
    expect(notion.authMetadata).toMatchObject({
      oauthVersion: "2.0",
      pkce: true,
      dynamicClientRegistration: true,
      bearerToken: "none",
    });

    const linear = DEFAULT_PROVIDER_PROFILE_SEEDS.find((profile) => profile.id === "linear")!;
    expect(linear.endpoint).toBe("https://mcp.linear.app/mcp");
    expect(linear.transport).toBe("streamable-http");
    expect(linear.authMetadata).toMatchObject({
      oauthVersion: "2.1",
      dynamicClientRegistration: true,
      bearerToken: "optional",
    });
  });

  it("auto-seeds the SQLite provider profile table on database initialization", () => {
    const profiles = listProviderProfiles();
    expect(profiles.map((profile) => profile.id)).toEqual(["linear", "notion"]);
    expect(getProviderProfile("notion")?.docsUrl).toBe("https://developers.notion.com/guides/mcp/build-mcp-client");
    expect(getProviderProfile("linear")?.docsUrl).toBe("https://linear.app/docs/mcp");
  });

  it("can restore default provider profiles after deletion", () => {
    removeProviderProfile("notion");
    expect(getProviderProfile("notion")).toBeNull();

    const seeded = seedDefaultProviderProfiles();
    expect(seeded.map((profile) => profile.id)).toEqual(["notion", "linear"]);
    expect(getProviderProfile("notion")?.endpoint).toBe("https://mcp.notion.com/mcp");
  });
});
