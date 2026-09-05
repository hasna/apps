import { afterEach, describe, expect, test } from "bun:test";
import {
  buildSkillsApiUrl,
  getConfiguredApiUrl,
  loadRemoteRegistry,
  loadRemoteSkill,
  mergeRemoteRegistry,
  parseRemoteRegistryPayload,
  parseRemoteSkillPayload,
} from "./remote-registry.js";
import type { SkillMeta } from "./registry.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("remote registry", () => {
  const originalSkillsApiUrl = process.env.SKILLS_API_URL;

  afterEach(() => {
    if (originalSkillsApiUrl === undefined) delete process.env.SKILLS_API_URL;
    else process.env.SKILLS_API_URL = originalSkillsApiUrl;
  });

  test("builds skills endpoint from a bare server origin", () => {
    expect(buildSkillsApiUrl("https://registry.example.com")).toBe("https://registry.example.com/api/v1/skills");
  });

  test("builds skills endpoint from explicit API base", () => {
    expect(buildSkillsApiUrl("https://registry.example.com/api/v1/")).toBe("https://registry.example.com/api/v1/skills");
    expect(buildSkillsApiUrl("http://localhost:3505/api")).toBe("http://localhost:3505/api/skills");
  });

  test("the default fleet authority is an app PREFIX, not a collection base", () => {
    // The gateway serves every app under https://api.hasna.com/<app>, so the
    // trailing `/skills` there is a path prefix. Read as "the base already names
    // the collection", the endpoint was never appended and every remote read
    // collapsed onto the gateway app root — a 404 — so a correctly credentialled
    // install on the default authority could not run `skills list` at all.
    expect(buildSkillsApiUrl("https://api.hasna.com/skills")).toBe(
      "https://api.hasna.com/skills/api/v1/skills",
    );
    expect(buildSkillsApiUrl("https://api.hasna.com/skills", "/skills/demo")).toBe(
      "https://api.hasna.com/skills/api/v1/skills/demo",
    );
  });

  test("composes the same URL RemoteSkillsClient does, from the same origin", () => {
    // The two composition sites are handed the same origin by the same
    // resolver; when they disagree, one of them 404s and the other does not.
    for (const origin of ["https://api.hasna.com/skills", "https://skills.example.com", "http://localhost:3505"]) {
      expect(buildSkillsApiUrl(origin)).toBe(`${origin}/api/v1/skills`);
      expect(buildSkillsApiUrl(origin, "/skills/demo")).toBe(`${origin}/api/v1/skills/demo`);
    }
  });

  test("a pasted collection base is still not doubled up", () => {
    expect(buildSkillsApiUrl("https://skills.example.com/api/v1/skills")).toBe(
      "https://skills.example.com/api/v1/skills",
    );
    expect(buildSkillsApiUrl("https://skills.example.com/api/v1/skills", "/skills/demo")).toBe(
      "https://skills.example.com/api/v1/skills/demo",
    );
  });

  test("reads the authority from the fleet ladder, not from this app's config", () => {
    // The env alias and the canonical name both work, and the API base an
    // operator pastes is normalized to the origin the client dials.
    expect(
      getConfiguredApiUrl({
        SKILLS_API_URL: "https://env.example.com/api/v1",
        SKILLS_API_KEY: "fixture-registry",
      }),
    ).toBe("https://env.example.com");
    expect(
      getConfiguredApiUrl({
        HASNA_SKILLS_API_URL: "https://canonical.example.com/api/v1/",
        HASNA_SKILLS_API_KEY: "fixture-registry",
      }),
    ).toBe("https://canonical.example.com");
  });

  test("a credential with no authority resolves the fleet gateway", () => {
    expect(getConfiguredApiUrl({ HASNA_SKILLS_API_KEY: "fixture-registry" })).toBe(
      "https://api.hasna.com/skills",
    );
  });

  test("nothing configured resolves nothing — the read path stays local", () => {
    expect(getConfiguredApiUrl({})).toBeUndefined();
  });

  test("parses remote array payload", () => {
    const skills = parseRemoteRegistryPayload([
      {
        name: "remote-demo",
        description: "Remote demo",
        category: "Remote Tools",
        tags: ["remote", "demo"],
      },
    ]);

    expect(skills).toEqual([
      {
        name: "remote-demo",
        displayName: "Remote Demo",
        description: "Remote demo",
        category: "Remote Tools",
        tags: ["remote", "demo"],
        dependencies: undefined,
        availability: { status: "available" },
        source: "remote",
      },
    ]);
  });

  test("preserves a remote-declared unavailability instead of inventing one", () => {
    // Availability is now purely a REMOTE assertion: the client ships no local
    // denylist, so a payload that omits the field is available, and a payload that
    // declares unavailability is carried through verbatim (after sanitization).
    const [omitted, declared] = parseRemoteRegistryPayload([
      {
        name: "seo-content-pack",
        description: "Hosted SEO content",
        category: "Business & Marketing",
        tags: ["seo"],
      },
      {
        name: "market-research-report",
        description: "Hosted market research",
        category: "Research & Writing",
        tags: ["research"],
        availability: {
          status: "unavailable",
          code: "HOSTED_PROVIDER_UNAVAILABLE",
          details: ["No balance was charged."],
        },
      },
    ]);

    expect(omitted).toMatchObject({
      name: "seo-content-pack",
      availability: { status: "available" },
    });
    expect(declared).toMatchObject({
      name: "market-research-report",
      availability: {
        status: "unavailable",
        code: "HOSTED_PROVIDER_UNAVAILABLE",
      },
    });
    expect(declared.availability?.details).toContain("No balance was charged.");
  });

  test("sanitizes remote-provided availability text before exposing it", () => {
    const skills = parseRemoteRegistryPayload([
      {
        name: "image",
        description: "Hosted image generation",
        category: "Media Processing",
        tags: ["image"],
        availability: {
          status: "unavailable",
          code: "HOSTED_PROVIDER_UNAVAILABLE",
          message: "OpenAI Sora backend is not enabled",
          details: ["OPENAI_API_KEY is not configured", "No balance was charged."],
        },
      },
    ]);

    const serialized = JSON.stringify(skills[0].availability);
    expect(skills[0].availability).toMatchObject({
      status: "unavailable",
      code: "HOSTED_PROVIDER_UNAVAILABLE",
      message: "hosted AI backend is not enabled",
    });
    expect(serialized).not.toContain("OpenAI");
    expect(serialized).not.toContain("Sora");
    expect(serialized).not.toContain("OPENAI_API_KEY");
    expect(serialized).toContain("No balance was charged.");
  });

  test("redacts secret-shaped availability values before exposing them", () => {
    const platformKey = `sk-${"live_abcdefghijklmnopqrstuvwxyz"}`;
    const githubToken = `gh${"p_"}${"abcdefghijklmnopqrstuvwxyz"}`;
    const githubPatToken = `github${"_pat_"}${"abcdefghijklmnopqrstuvwxyz"}`;
    const githubSessionToken = `gh${"s_"}${"abcdefghijklmnopqrstuvwxyz"}`;
    const githubUserToken = `gh${"u_"}${"abcdefghijklmnopqrstuvwxyz"}`;
    const githubRefreshToken = `gh${"r_"}${"abcdefghijklmnopqrstuvwxyz"}`;
    const npmToken = `np${"m_"}${"abcdefghijklmnopqrstuvwxyz"}`;
    const awsKey = `AKI${"A"}${"ABCDEFGHIJKLMNOP"}`;
    const aiKey = `AIz${"a"}${"abcdefghijklmnopqrstuvwxyz"}`;
    const headerToken = `secret${"-token:"} abcdefghijklmnopqrstuvwxyz`;
    const ctxToken = `ctx7${"sk-"}${"abcdefghijklmnopqrstuvwxyz"}`;
    const xaiToken = `x${"ai-"}${"abcdefghijklmnopqrstuvwxyz"}`;

    const skills = parseRemoteRegistryPayload([
      {
        name: "image",
        description: "Hosted image generation",
        category: "Media Processing",
        tags: ["image"],
        availability: {
          status: "unavailable",
          message: `backend token ${platformKey} is disabled`,
          details: [
            `github token ${githubToken}`,
            `github fine-grained token ${githubPatToken}`,
            `github session token ${githubSessionToken}`,
            `github user token ${githubUserToken}`,
            `github refresh token ${githubRefreshToken}`,
            `npm token ${npmToken}`,
            `aws key ${awsKey}`,
            `ai key ${aiKey}`,
            `header ${headerToken}`,
            `context token ${ctxToken}`,
            `xai token ${xaiToken}`,
          ],
        },
      },
    ]);

    const serialized = JSON.stringify(skills[0].availability);
    for (const token of [
      platformKey,
      githubToken,
      githubPatToken,
      githubSessionToken,
      githubUserToken,
      githubRefreshToken,
      npmToken,
      awsKey,
      aiKey,
      headerToken,
      ctxToken,
      xaiToken,
    ]) {
      expect(serialized).not.toContain(token);
    }
    expect(serialized).toContain("credential");
  });

  test("parses versioned remote skill metadata and drops server pricing", () => {
    const skills = parseRemoteRegistryPayload({
      data: [
        {
          slug: "remote-video",
          displayName: "Remote Video",
          description: "Generate remote videos",
          category: "Media Processing",
          tags: ["video", "remote"],
          version: "1.2.3",
          pricing: {
            tier: "premium",
            formattedCost: "$1.20 estimated",
          },
        },
      ],
    });

    expect(skills[0]).toMatchObject({
      name: "remote-video",
      displayName: "Remote Video",
      description: "Generate remote videos",
      category: "Media Processing",
      tags: ["video", "remote"],
      version: "1.2.3",
      source: "remote",
    });
    expect(skills[0]).not.toHaveProperty("pricing");
  });

  test("loads remote registry with injected fetch implementation", async () => {
    const skills = await loadRemoteRegistry({
      apiUrl: "https://skills.example.com",
      fetchImpl: async (input) => {
        expect(String(input)).toBe("https://skills.example.com/api/v1/skills");
        return Response.json({
          skills: [
            {
              name: "remote-image",
              displayName: "Remote Image",
              description: "Generate images remotely",
              category: "Media Processing",
              tags: ["image", "remote"],
            },
          ],
        });
      },
    });

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("remote-image");
    expect(skills[0].source).toBe("remote");
  });

  test("sends bearer auth when SKILLS_API_KEY is configured", async () => {
    process.env.SKILLS_API_URL = "https://skills.example.com/api/v1";
    process.env.SKILLS_API_KEY = "fixture-registry";
    try {
      await loadRemoteRegistry({
        fetchImpl: async (_input, init) => {
          const headers = new Headers(init?.headers);
          expect(headers.get("accept")).toBe("application/json");
          expect(headers.get("authorization")).toBe("Bearer fixture-registry");
          return Response.json([]);
        },
      });
    } finally {
      delete process.env.SKILLS_API_KEY;
    }
  });

  test("loads a single remote skill from the versioned detail endpoint", async () => {
    const skill = await loadRemoteSkill("remote-demo", {
      apiUrl: "https://skills.example.com/api/v1",
      authToken: "fixture-detail",
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe("https://skills.example.com/api/v1/skills/remote-demo");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-detail");
        return Response.json({
          slug: "remote-demo",
          displayName: "Remote Demo",
          description: "Demo from remote detail",
          category: "Remote Tools",
          tags: ["remote"],
          version: "0.2.0",
        });
      },
    });

    expect(skill).toMatchObject({
      name: "remote-demo",
      displayName: "Remote Demo",
      version: "0.2.0",
      source: "remote",
    });
  });

  test("reports remote registry HTTP failures clearly", async () => {
    await expect(loadRemoteRegistry({
      apiUrl: "https://skills.example.com/api/v1",
      fetchImpl: async () => new Response("nope", { status: 503, statusText: "Unavailable" }),
    })).rejects.toThrow("Remote registry request failed: 503 Unavailable");
  });

  test("reports invalid remote payloads with stable messages", () => {
    expect(() => parseRemoteRegistryPayload({ data: [{ displayName: "Missing slug" }] }))
      .toThrow("Remote registry payload did not match the expected skills contract");
    expect(() => parseRemoteSkillPayload({ skill: { displayName: "Missing slug" } }))
      .toThrow("Remote skill payload did not match the expected skills contract");
  });

  describe("mergeRemoteRegistry (default-read merge, R1 fail-closed)", () => {
    const originalSkillsApiKey = process.env.SKILLS_API_KEY;
    const originalSkillApiKey = process.env.SKILL_API_KEY;

    const localFixture: SkillMeta[] = [
      {
        name: "local-skill",
        displayName: "Local Skill",
        description: "Written on this machine",
        category: "Development Tools",
        tags: [],
        source: "custom",
      },
      {
        name: "bundled-skill",
        displayName: "Bundled Skill",
        description: "Ships with the CLI",
        category: "Development Tools",
        tags: [],
        source: "official",
      },
    ];

    afterEach(() => {
      if (originalSkillsApiKey === undefined) delete process.env.SKILLS_API_KEY;
      else process.env.SKILLS_API_KEY = originalSkillsApiKey;
      if (originalSkillApiKey === undefined) delete process.env.SKILL_API_KEY;
      else process.env.SKILL_API_KEY = originalSkillApiKey;
    });

    test("returns the local list unchanged when no origin is configured and never fetches", async () => {
      delete process.env.SKILLS_API_URL;
      let fetched = false;
      const result = await mergeRemoteRegistry(localFixture, {
        authToken: "fixture-key",
        fetchImpl: async () => {
          fetched = true;
          throw new Error("must not fetch without an origin");
        },
      });
      expect(result).toEqual(localFixture);
      expect(fetched).toBe(false);
    });

    test("an explicit null token still returns the local list, and never fetches", async () => {
      // An explicit `authToken: null` is a caller saying "unauthenticated read",
      // not a missing configuration — it stays the local list.
      let fetched = false;
      const result = await mergeRemoteRegistry(localFixture, {
        apiUrl: "https://skills.example.com/api/v1",
        authToken: null,
        fetchImpl: async () => {
          fetched = true;
          throw new Error("must not fetch without a credential");
        },
      });
      expect(result).toEqual(localFixture);
      expect(fetched).toBe(false);
    });

    test("an authority with no credential throws instead of serving the local half", async () => {
      // The false green removed by the 2026-09-04 ruling: an operator pointed
      // this CLI at an instance, the key went missing, and the merge answered
      // from the bundled corpus as though the instance had nothing to add.
      process.env.SKILLS_API_URL = "https://skills.example.com/api/v1";
      let fetched = false;
      await expect(
        mergeRemoteRegistry(localFixture, {
          fetchImpl: async () => {
            fetched = true;
            throw new Error("must not fetch without a credential");
          },
        }),
      ).rejects.toThrow(/no API key resolved/);
      expect(fetched).toBe(false);
    });

    test("merges the authenticated remote registry into the local list when configured", async () => {
      process.env.SKILLS_API_URL = "https://skills.example.com/api/v1";
      process.env["SKILLS_API_KEY"] = "fixture-registry-merge";
      const result = await mergeRemoteRegistry(localFixture, {
        fetchImpl: async (input, init) => {
          expect(String(input)).toBe("https://skills.example.com/api/v1/skills");
          expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-registry-merge");
          return Response.json({
            skills: [
              {
                name: "remote-only-skill",
                displayName: "Remote Only",
                description: "Lives on the hosted instance",
                category: "Remote Tools",
                tags: ["remote"],
              },
            ],
          });
        },
      });

      const names = result.map((skill) => skill.name);
      expect(names).toContain("local-skill");
      expect(names).toContain("bundled-skill");
      expect(names).toContain("remote-only-skill");
      expect(result.find((skill) => skill.name === "remote-only-skill")).toMatchObject({
        source: "remote",
        category: "Remote Tools",
      });
    });

    test("keeps local precedence over remote on collisions while remote beats official", async () => {
      process.env.SKILLS_API_URL = "https://skills.example.com/api/v1";
      process.env["SKILLS_API_KEY"] = "fixture-key";
      const result = await mergeRemoteRegistry(localFixture, {
        fetchImpl: async () => Response.json([
          {
            name: "local-skill",
            displayName: "Remote Local",
            description: "Remote copy of a local skill",
            category: "Remote Tools",
          },
          {
            name: "bundled-skill",
            displayName: "Remote Bundled",
            description: "Instance-published override of a bundled skill",
            category: "Remote Tools",
          },
        ]),
      });

      const localSkill = result.find((skill) => skill.name === "local-skill");
      const bundledSkill = result.find((skill) => skill.name === "bundled-skill");
      expect(localSkill).toMatchObject({ source: "custom", description: "Written on this machine" });
      expect(bundledSkill).toMatchObject({ source: "remote", description: "Instance-published override of a bundled skill" });
    });

    test("a vault pointer never degrades the merge to the local list", async () => {
      // The credential IS configured (tier 2, HASNA_SKILLS_API_KEY_REF), but its
      // value lives in the vault and resolves to "" synchronously. Reading the
      // credential here and returning `local` when it looked empty made a
      // configured install answer from the bundled corpus with a zero exit —
      // a silent false green that an unconfigured install does not produce.
      process.env.HASNA_SKILLS_API_KEY_REF = "hasna/skills/live/api_key";
      let fetched = false;
      try {
        await expect(
          mergeRemoteRegistry(localFixture, {
            fetchImpl: async () => {
              fetched = true;
              throw new Error("must not fetch with an uncompleted pointer");
            },
          }),
        ).rejects.toThrow(/HASNA_SKILLS_API_KEY_REF/);
      } finally {
        delete process.env.HASNA_SKILLS_API_KEY_REF;
      }
      expect(fetched).toBe(false);
    });

    test("surfaces an auth failure as a clear error instead of a silent local list", async () => {
      process.env.SKILLS_API_URL = "https://skills.example.com/api/v1";
      process.env["SKILLS_API_KEY"] = "fixture-expired-key";
      await expect(mergeRemoteRegistry(localFixture, {
        fetchImpl: async () => new Response("nope", { status: 401, statusText: "Unauthorized" }),
      })).rejects.toThrow("Remote registry request failed: 401 Unauthorized");
    });
  });
});
