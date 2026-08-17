# Signed independent-agent review for npm releases

The `@hasna/todos` and `@hasna/todos-ai` package-owned release procedures will not publish unless the
`npm-release` environment contains a valid Ed25519-signed receipt using schema
`hasna.npm-release-agent-review.v2`. The matching private key is the fixed
package release-review authority and is supplied only to the one independent
native Codewith sub-agent lineage fixed before reviewing that candidate. It
never enters this repository or a release procedure, and it is not attributed
to a standing Fable persona.

This is not a human approval gate. The `npm-release` environment has no required
reviewers or wait timer. Its non-secret variables provide the fixed reviewer
identity, deterministic key id, and Ed25519 public key consumed by the
package-owned verifier:

- `RELEASE_REVIEWER_AGENT`, set to the candidate's exact native Codewith
  sub-agent lineage such as `/root/review_todos_release_01522`;
- `RELEASE_REVIEW_KEY_ID`;
- `RELEASE_REVIEW_PUBLIC_KEY`.

The capability-bearing `NPM_RELEASE_AGENT_REVIEW_RECEIPT` is an environment
secret. GitHub masks secrets before rendering a run-step environment preamble;
an Actions variable would expose the complete receipt before the shell body
could register a mask. The verifier still receives the exact secret value in
process and applies the same package, version, tag, commit, procedure, reviewer,
and signature checks.

The public key is canonical base64 SPKI DER. Its key id is
`ed25519:sha256:<base64url SHA-256 of the SPKI DER bytes>`. The verifier rejects
a configured key id that does not derive from the configured key, a receipt
that names another key id, and a signature made by any other key.

## Strict signed receipt

The environment receipt is an exact JSON object with no additional fields:

```json
{
  "schema": "hasna.npm-release-agent-review.v2",
  "payload": "<canonical base64 of the exact UTF-8 JSON payload>",
  "signature": {
    "algorithm": "ed25519",
    "key_id": "ed25519:sha256:<fixed reviewer key digest>",
    "value": "<canonical base64 Ed25519 signature over decoded payload bytes>"
  }
}
```

The v2 payload binds its signed package name and tag through one closed mapping:
`@hasna/todos` plus `npm/todos/v*` selects `apps/todos`, while `@hasna/todos-ai` plus
`npm/todos-ai/v*` selects `apps/todos/ai`. The issuer and verifier reject every other
package path, package name, tag prefix, or cross-package combination; no path is
accepted from receipt data or arbitrary workflow input.

The decoded, signed payload is also exact and has no additional fields:

```json
{
  "schema": "hasna.npm-release-agent-review.v2",
  "repository": "hasna/apps",
  "commit": "<exact 40-hex release commit>",
  "package": {
    "name": "@hasna/todos",
    "version": "0.15.20"
  },
  "tag": "npm/todos/v0.15.20",
  "procedure": {
    "path": "apps/todos/scripts/verify-public-release.ts",
    "revision": "<Git blob object for this package procedure at the release commit>"
  },
  "registry": "https://registry.npmjs.org",
  "reviewer": {
    "type": "coding-agent",
    "agent": "/root/<fixed-independent-codewith-reviewer>"
  },
  "publisher": {
    "type": "coding-agent",
    "agent": "<intended publisher agent>"
  },
  "verdict": "GO",
  "openReachableInScopeBlockers": {
    "p0": 0,
    "p1": 0
  }
}
```

The publisher identity must differ from the reviewer lineage and must match the
annotated tag's single final `Agent:` trailer. The reviewer must be the
canonical native Codewith lineage `/root/<task-name>` (nested sub-agent
lineages remain slash-separated). Persona names such as `Anscombe`, Fable
reviewers, root coordinators, and arbitrary coding-agent labels are rejected.
Missing, unsigned, malformed, `NO_GO`, non-zero P0/P1, self-reviewed, stale,
mismatched, tampered, wrong-key, or replayed receipts fail before publication.
A valid receipt from an earlier commit or version is still a replay and fails
the live commit, package, tag, and procedure-revision comparisons.

The package-owned release procedure verifies the receipt again through
`prepublishOnly` immediately before npm receives the package. For
`@hasna/todos-ai`, `prepublishOnly` invokes
`../scripts/verify-npm-release-agent-review.ts` directly; the
`verify:release-review` script is only a convenience alias and changing it
cannot bypass the package-owned gate. Its package checks remain the
authoritative release gate.

## Exact issuance procedure for the later reviewer

Fix the native Codewith reviewer lineage and publisher identity before review
begins. The reviewer checks out the exact clean release commit already on
protected main, records its canonical `/root/...` lineage and durable review-run
id on the release task, and independently evaluates that candidate. Fable may
support a decision or adjudication but cannot perform this review or issue this
receipt. The same Codewith reviewer may perform at most two focused remediation
checks for concrete reachable in-scope P0/P1 defects. It issues `GO` only when
both blocking counts are zero.

The fixed reviewer lineage uses the package release-review vault item containing
a canonical base64 PKCS8 DER Ed25519 private key. That key is delivered only to
the same native Codewith sub-agent process after its review verdict is final.
Replace the five bracketed values below with the actual reviewer lineage, vault
item, exact release SHA, intended publisher agent, and task evidence directory.
No private-key value is printed or stored in the repository.

```bash
evidence_dir=<task-evidence-directory>
reviewer_lineage=/root/<fixed-independent-codewith-reviewer>
reviewer_agent_file="$(mktemp)"
reviewer_key_id_file="$(mktemp)"
reviewer_public_key_file="$(mktemp)"
receipt_file="$(mktemp)"

printf '%s\n' "${reviewer_lineage}" | gh variable set RELEASE_REVIEWER_AGENT \
  --repo hasna/apps --env npm-release
gh variable get RELEASE_REVIEWER_AGENT \
  --repo hasna/apps --env npm-release > "${reviewer_agent_file}"
test "$(sed -n '1p' "${reviewer_agent_file}")" = "${reviewer_lineage}"
gh variable get RELEASE_REVIEW_KEY_ID \
  --repo hasna/apps --env npm-release > "${reviewer_key_id_file}"
gh variable get RELEASE_REVIEW_PUBLIC_KEY \
  --repo hasna/apps --env npm-release > "${reviewer_public_key_file}"

RELEASE_REVIEWER_AGENT="$(sed -n '1p' "${reviewer_agent_file}")" \
RELEASE_REVIEW_KEY_ID="$(sed -n '1p' "${reviewer_key_id_file}")" \
RELEASE_REVIEW_PUBLIC_KEY="$(sed -n '1p' "${reviewer_public_key_file}")" \
secrets exec <fixed-reviewer-private-key-vault-item> \
  --as RELEASE_REVIEW_PRIVATE_KEY -- \
  bun run issue:release-review -- \
    --release-commit <exact-release-commit-sha> \
    --package-path <apps-todos-or-apps-todos-ai> \
    --publisher-agent <intended-publisher-agent> \
    --verdict GO \
    --open-p0 0 \
    --open-p1 0 > "${receipt_file}"

gh secret set NPM_RELEASE_AGENT_REVIEW_RECEIPT \
  --repo hasna/apps --env npm-release < "${receipt_file}"
test "$(gh secret list --repo hasna/apps --env npm-release --json name \
  --jq '[.[] | select(.name == "NPM_RELEASE_AGENT_REVIEW_RECEIPT")] | length')" = "1"
sha256sum "${receipt_file}" > "${evidence_dir}/npm-release-agent-review.sha256"
```

GitHub does not permit secret-value readback. The metadata check proves the
named environment secret exists; the real negative/positive workflow test is
the acceptance proof that the exact value reaches the verifier while the log
contains only GitHub's masked placeholder.

The issuer refuses a private key that does not derive the configured public key
and key id. It derives the package version, tag, package-procedure blob revision, and
registry from the exact release commit rather than accepting those values as
free-form arguments. `--package-path` defaults to `apps/todos` and accepts only
`apps/todos` or `apps/todos/ai`.

The reviewer records the command result, receipt digest, readback result, exact
release SHA, native Codewith lineage, review-run id, verdict, and blocker counts
on the release task. It does not create or push the tag and does not publish.

The later publisher creates one annotated tag on the receipt's exact commit.
Its message must end with exactly one registered agent trailer:

```text
Agent: <intended-publisher-agent>
```

Any change to the commit, selected package path/name/version, package procedure blob, registry, fixed
reviewer/key, or intended publisher makes the receipt stale. The fixed reviewer
must issue a replacement only after verification of the affected lane.
