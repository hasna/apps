import { describe, expect, test } from "bun:test";
import {
  createRelationshipRecord,
  isRelationshipActive,
  publicExternalRef,
  publicNodeRef,
} from "./index.js";

const startsAt = "2026-08-17T10:00:00.000Z";
const expiresAt = "2026-08-17T11:00:00.000Z";

function timedRelationship() {
  return createRelationshipRecord({
    id: "rel_boundary",
    kind: "delegates_to",
    source: { kind: "member", id: "member_source" },
    target: { kind: "member", id: "member_target" },
    validFrom: startsAt,
    expiresAt,
  });
}

describe("relationship activity boundaries", () => {
  test("starts inclusively and expires exclusively", () => {
    const relationship = timedRelationship();

    expect(isRelationshipActive(relationship, "2026-08-17T09:59:59.999Z")).toBe(false);
    expect(isRelationshipActive(relationship, startsAt)).toBe(true);
    expect(isRelationshipActive(relationship, "2026-08-17T10:59:59.999Z")).toBe(true);
    expect(isRelationshipActive(relationship, expiresAt)).toBe(false);
  });

  test("revocation wins even before the validity window begins", () => {
    const relationship = {
      ...timedRelationship(),
      revokedAt: "2026-08-17T09:00:00.000Z",
    };

    expect(isRelationshipActive(relationship, "2026-08-17T08:00:00.000Z")).toBe(false);
    expect(isRelationshipActive(relationship, "2026-08-17T10:30:00.000Z")).toBe(false);
  });
});

describe("public reference projection", () => {
  test("preserves public evidence fields while removing href and metadata", () => {
    const projected = publicExternalRef({
      system: "identities",
      kind: "agent",
      id: "agent_1",
      label: "Worker",
      observedAt: "2026-08-17T10:30:00.000Z",
      stale: true,
      href: "https://private.invalid/session",
      metadata: { private: "value" },
    });

    expect(projected).toEqual({
      system: "identities",
      kind: "agent",
      id: "agent_1",
      label: "Worker",
      observedAt: "2026-08-17T10:30:00.000Z",
      stale: true,
    });
    expect("href" in projected).toBe(false);
    expect("metadata" in projected).toBe(false);
  });

  test("sanitizes an external reference nested inside a node reference", () => {
    const projected = publicNodeRef({
      kind: "external",
      id: "external_1",
      external: {
        system: "projects",
        kind: "workspace",
        id: "workspace_1",
        href: "https://private.invalid/workspace",
        metadata: { private: "value" },
      },
    });

    expect(projected).toEqual({
      kind: "external",
      id: "external_1",
      external: {
        system: "projects",
        kind: "workspace",
        id: "workspace_1",
        label: undefined,
        observedAt: undefined,
        stale: undefined,
      },
    });
  });
});
