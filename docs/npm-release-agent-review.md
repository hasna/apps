# Signed independent-agent review for npm releases

The `@hasna/projects` tag release cannot publish unless the `npm-release`
environment provides a valid Ed25519-signed receipt using schema
`hasna.npm-release-agent-review.v1`. The matching private key is delivered only
to the fixed independent native Codewith reviewer after that reviewer reaches a
verdict. It never enters this repository or the release workflow.

This is not a human approval gate. The `npm-release` environment has no required
reviewers or wait timer. Its non-secret variables provide the fixed reviewer
lineage, deterministic key id, and Ed25519 public key:

- `RELEASE_REVIEWER_AGENT`, set to the exact `/root/...` reviewer lineage;
- `RELEASE_REVIEW_KEY_ID`;
- `RELEASE_REVIEW_PUBLIC_KEY`.

The capability-bearing `NPM_RELEASE_AGENT_REVIEW_RECEIPT` is an environment
secret so GitHub masks it before rendering the run-step environment. The
verifier applies the exact package, version, annotated tag, commit, workflow
blob, reviewer, publisher, blocker-count, and signature checks.

The public key is canonical base64 SPKI DER. Its key id is
`ed25519:sha256:<base64url SHA-256 of the SPKI DER bytes>`. The signed payload
binds:

- repository `hasna/projects`;
- the exact protected-main commit;
- `@hasna/projects` and its exact version;
- annotated tag `npm/projects/v<version>`;
- `.github/workflows/release.yml` and its exact Git blob;
- registry `https://registry.npmjs.org`;
- the fixed independent native Codewith reviewer lineage;
- the publisher agent named by the tag's single final `Agent:` trailer;
- verdict `GO`; and
- zero open concrete reachable in-scope P0/P1 findings.

Missing, malformed, unsigned, `NO_GO`, self-reviewed, stale, mismatched,
tampered, wrong-key, or replayed receipts fail before publication. The existing
tag/version, protected-main, immutable-version, typecheck, test, contracts,
no-cloud, build, OIDC, provenance, and registry-readback gates remain in place.

## Issuance and delivery

Fix the reviewer lineage and publisher before review begins. After the exact
release candidate is on protected main and the same reviewer returns `GO`, use
the package-owned issuer. The private key is consumed through Hasna Secrets and
the receipt is written directly to a new mode-0600 file; neither value is
printed.

```bash
receipt_dir="$(mktemp -d)"
receipt_file="${receipt_dir}/receipt.json"
reviewer_lineage=/root/<fixed-independent-codewith-reviewer>

RELEASE_REVIEWER_AGENT="${reviewer_lineage}" \
RELEASE_REVIEW_KEY_ID="<configured-key-id>" \
RELEASE_REVIEW_PUBLIC_KEY="<configured-public-key>" \
secrets exec <projects-review-private-key-vault-item> \
  --as RELEASE_REVIEW_PRIVATE_KEY -- \
  bun run issue:release-review -- \
    --release-commit <exact-release-commit-sha> \
    --publisher-agent <intended-publisher-agent> \
    --verdict GO \
    --open-p0 0 \
    --open-p1 0 \
    --output "${receipt_file}"

gh secret set NPM_RELEASE_AGENT_REVIEW_RECEIPT \
  --repo hasna/projects --env npm-release < "${receipt_file}"
```

Provision `RELEASE_REVIEWER_AGENT`, `RELEASE_REVIEW_KEY_ID`, and
`RELEASE_REVIEW_PUBLIC_KEY` through the environment's supported configuration
route and verify metadata readback. GitHub does not expose secret-value
readback; the real acceptance proof is the tag workflow passing the package-
owned verifier while logs contain no receipt or key material.

Any change to the commit, package version, workflow blob, registry, fixed
reviewer/key, or publisher makes the receipt stale. Only the same fixed reviewer
may issue a replacement after focused verification of the affected lane.
