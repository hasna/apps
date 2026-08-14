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

const EXPECTED_PROVIDER_IDS = [
  "notion",
  "linear",
  "github",
  "slack",
  "gmail",
  "google-drive",
  "google-calendar",
  "stripe",
  "cloudflare",
  "postgres",
  "filesystem",
  "browser",
];

function idsSortedByDisplayName() {
  return [...DEFAULT_PROVIDER_PROFILE_SEEDS]
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map((profile) => profile.id);
}

describe("default provider profile seeds", () => {
  afterAll(() => {
    closeDb();
  });

  it("defines the initial common curated provider catalog", () => {
    expect(DEFAULT_PROVIDER_PROFILE_SEEDS.map((profile) => profile.id)).toEqual(EXPECTED_PROVIDER_IDS);

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

    const github = DEFAULT_PROVIDER_PROFILE_SEEDS.find((profile) => profile.id === "github")!;
    expect(github.endpoint).toBe("https://api.githubcopilot.com/mcp/");
    expect(github.authMetadata).toMatchObject({
      oauthVersion: "2.0",
      pkce: true,
      bearerToken: "optional",
    });

    const slack = DEFAULT_PROVIDER_PROFILE_SEEDS.find((profile) => profile.id === "slack")!;
    expect(slack.endpoint).toBe("https://mcp.slack.com/mcp");
    expect(slack.authMetadata).toMatchObject({
      oauthVersion: "2.0",
      pkce: true,
      dynamicClientRegistration: false,
      bearerToken: "none",
    });

    const googleProfiles = ["gmail", "google-drive", "google-calendar"].map((id) =>
      DEFAULT_PROVIDER_PROFILE_SEEDS.find((profile) => profile.id === id)!,
    );
    expect(googleProfiles.every((profile) => profile.installFallback?.command === "uvx")).toBe(true);
    expect(googleProfiles.every((profile) => profile.transport === "stdio")).toBe(true);

    const stripe = DEFAULT_PROVIDER_PROFILE_SEEDS.find((profile) => profile.id === "stripe")!;
    expect(stripe.endpoint).toBe("https://mcp.stripe.com");
    expect(stripe.authMetadata.bearerToken).toBe("optional");

    const cloudflare = DEFAULT_PROVIDER_PROFILE_SEEDS.find((profile) => profile.id === "cloudflare")!;
    expect(cloudflare.endpoint).toBe("https://mcp.cloudflare.com/mcp");

    const postgres = DEFAULT_PROVIDER_PROFILE_SEEDS.find((profile) => profile.id === "postgres")!;
    expect(postgres.transport).toBe("stdio");
    expect(postgres.installFallback?.packageName).toBe("@modelcontextprotocol/server-postgres");

    const filesystem = DEFAULT_PROVIDER_PROFILE_SEEDS.find((profile) => profile.id === "filesystem")!;
    expect(filesystem.authType).toBe("none");
    expect(filesystem.installFallback?.packageName).toBe("@modelcontextprotocol/server-filesystem");

    const browser = DEFAULT_PROVIDER_PROFILE_SEEDS.find((profile) => profile.id === "browser")!;
    expect(browser.installFallback?.packageName).toBe("@playwright/mcp");
  });

  it("keeps every curated provider actionable with source, auth, transport, install, and safety metadata", () => {
    for (const profile of DEFAULT_PROVIDER_PROFILE_SEEDS) {
      expect(profile.displayName.trim()).toBeTruthy();
      expect(profile.description?.trim()).toBeTruthy();
      expect(["stdio", "sse", "streamable-http"]).toContain(profile.transport);
      expect(["none", "oauth2", "api_key", "bearer_token", "custom"]).toContain(profile.authType);
      expect(profile.authMetadata).toBeDefined();
      expect(profile.tokenMode).toBeTruthy();
      expect(profile.endpoint || profile.installFallback).toBeTruthy();
      expect(profile.docsUrl ?? profile.provenance.sourceUrl).toMatch(/^https:\/\//);
      expect(profile.provenance.sourceUrl ?? profile.provenance.repositoryUrl).toMatch(/^https:\/\//);
      expect(profile.provenance.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(profile.safety?.dataClasses?.length).toBeGreaterThan(0);
    }
  });

  it("auto-seeds the SQLite provider profile table on database initialization", () => {
    const profiles = listProviderProfiles();
    expect(profiles.map((profile) => profile.id)).toEqual(idsSortedByDisplayName());
    expect(getProviderProfile("notion")?.docsUrl).toBe("https://developers.notion.com/guides/mcp/build-mcp-client");
    expect(getProviderProfile("linear")?.docsUrl).toBe("https://linear.app/docs/mcp");
    expect(getProviderProfile("github")?.endpoint).toBe("https://api.githubcopilot.com/mcp/");
    expect(getProviderProfile("browser")?.installFallback?.packageName).toBe("@playwright/mcp");
  });

  it("can restore default provider profiles after deletion", () => {
    removeProviderProfile("notion");
    expect(getProviderProfile("notion")).toBeNull();

    const seeded = seedDefaultProviderProfiles();
    expect(seeded.map((profile) => profile.id)).toEqual(EXPECTED_PROVIDER_IDS);
    expect(getProviderProfile("notion")?.endpoint).toBe("https://mcp.notion.com/mcp");
  });
});
