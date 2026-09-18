import type { NpmReleaseAgentReviewFailure } from "./npm-release-agent-review";

type Environment = Readonly<Record<string, string | undefined>>;
export type NpmReleaseContext = {
  mode: "github-actions" | "vault-token";
  releaseCommit: string;
  tag: string;
  failures: NpmReleaseAgentReviewFailure[];
};

/** Select a real delivery context; local publication never manufactures Actions metadata. */
export function resolveNpmReleaseContext(env: Environment): NpmReleaseContext {
  const failures: NpmReleaseAgentReviewFailure[] = [];
  const explicit = env.HASNA_TODOS_RELEASE_CONTEXT;
  const mode = explicit === "vault-token" ? "vault-token" : "github-actions";
  const add = (condition: boolean, check: string, message: string) => {
    if (condition) failures.push({ check, message });
  };
  add(explicit !== undefined && explicit !== "vault-token" && explicit !== "github-actions",
    "release-agent-review-context-mode", "HASNA_TODOS_RELEASE_CONTEXT must be vault-token or github-actions");
  const releaseCommit = mode === "vault-token" ? env.HASNA_TODOS_EXPECTED_COMMIT ?? "" : env.GITHUB_SHA ?? "";
  const tag = mode === "vault-token" ? env.HASNA_TODOS_RELEASE_TAG ?? "" : env.GITHUB_REF_NAME ?? "";
  if (mode === "vault-token") {
    add(["GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_REF_TYPE", "GITHUB_REF_NAME"]
      .some((key) => Boolean(env[key])), "release-agent-review-mixed-context", "vault-token publication must not include GitHub Actions context");
    add(env.RELEASE_PUBLISH_MODE !== "vault-token", "release-agent-review-delivery-mode",
      "RELEASE_PUBLISH_MODE must explicitly select vault-token for local publication");
  } else {
    add(env.GITHUB_ACTIONS !== "true", "release-agent-review-actions", "github-actions context requires an actual Actions runner");
    add(env.GITHUB_EVENT_NAME !== "push", "release-agent-review-event", "agent review authority requires a tag push event");
    add(env.GITHUB_REPOSITORY !== "hasna/apps", "release-agent-review-context-repository", "GITHUB_REPOSITORY must be hasna/apps");
    add(env.GITHUB_REF_TYPE !== "tag", "release-agent-review-ref-type", "the release ref must be a tag");
    add(env.HASNA_TODOS_RELEASE_TAG !== undefined, "release-agent-review-mixed-context", "Actions context must derive its release tag from the push event");
    add(env.HASNA_TODOS_EXPECTED_COMMIT !== undefined && env.HASNA_TODOS_EXPECTED_COMMIT !== releaseCommit,
      "release-agent-review-expected-commit", "HASNA_TODOS_EXPECTED_COMMIT must equal GITHUB_SHA");
  }
  add(!/^[0-9a-f]{40}$/.test(releaseCommit), "release-agent-review-context-commit", "the release context must identify an exact 40-hex release commit");
  add(!/^npm\/todos(?:-ai)?\/v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(tag),
    "release-agent-review-ref-name", "the release context must identify an allowed versioned npm tag");
  return { mode, releaseCommit, tag, failures };
}

export function resolveNpmReleasePublishMode(value: string | undefined): "vault-token" | "oidc" {
  if (value === undefined || value === "") return "vault-token";
  if (value === "vault-token" || value === "oidc") return value;
  throw new Error("RELEASE_PUBLISH_MODE must be vault-token or oidc");
}

/** One immutable annotated-tag choice is shared by local and Actions publishers. */
export function parseNpmReleaseLane(message: string): "vault-token" | "oidc" {
  const lines = message.split(/\r?\n/).filter((line) => /^Release-Lane:/i.test(line.trimStart()));
  if (lines.length !== 1 || !/^Release-Lane: (vault-token|oidc)$/.test(lines[0]!)) {
    throw new Error("the annotated todos release tag must contain exactly one Release-Lane: vault-token or Release-Lane: oidc trailer");
  }
  return lines[0]!.slice("Release-Lane: ".length) as "vault-token" | "oidc";
}
