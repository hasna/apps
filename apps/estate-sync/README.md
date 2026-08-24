# @hasna/estate-sync

Shared cloud-sync engine for the apps estate store bucket. The estate store is a
single shared S3 bucket per estate family (the apps bucket is
`hasna-apps-prod-store-<ACCOUNT_ID>` in `hasna-xyz-infra`); every app holds a
prefix tenant under it — `skills/`, `loops/`, `deliverables/`.

The engine is parameterized by **(estate bucket, app prefix)** and implements the
Fable-verdict sync protocol (task `O15-00627`):

- **push(name, bytes)** — computes the sha256 digest, writes
  `{prefix}/bundles/{digest}` (append-only, content-addressed), then writes a
  **signed index pointer** `{prefix}/index/{name}.json` (HMAC-SHA256 over the
  canonical index entry when a signing key is configured).
- **pull(name)** — resolves the signed index, fetches `{prefix}/bundles/{digest}`,
  **always verifies sha256(bytes) === digest**, and hydrates **atomically**
  (stage + rename; a reader never sees a torn artifact).

## Install

```bash
bun add @hasna/estate-sync
```

## SDK usage

```ts
import { createEstateSync } from "@hasna/estate-sync";

const sync = createEstateSync({
  bucket: "hasna-apps-prod-store-<ACCOUNT_ID>",
  prefix: "skills", // app prefix tenant
  region: "us-east-1",
  signingKey: process.env.ESTATE_SYNC_SIGNING_KEY, // HMAC key; pushes sign when set
  // credentials resolve from AWS_* env or the ECS task role; inject for tests
});

await sync.push({ name: "pdf-generate", body: bytes, contentType: "application/gzip" });

const pulled = await sync.pull({
  name: "pdf-generate",
  hydrateTo: "/abs/path/bundle", // atomic hydrate
  requireSignature: true, // fail closed when the index signature cannot verify
});
```

## CLI

```bash
estate-sync push pdf-generate ./pdf-generate.tar.gz --bucket hasna-apps-prod-store-<ACCOUNT_ID> --prefix skills
estate-sync pull pdf-generate ./out.tar.gz --bucket hasna-apps-prod-store-<ACCOUNT_ID> --prefix skills
```

Configuration from flags first, then `ESTATE_SYNC_BUCKET` / `ESTATE_SYNC_PREFIX` /
`ESTATE_SYNC_SIGNING_KEY` / `AWS_REGION`.

## Safety properties

- **Prefix tenancy is structural.** Every key is composed by the store under the
  configured prefix; traversal keys are rejected, so a name can never escape its
  tenant.
- **Digest verification is always on.** A pull that fetches bytes whose sha256
  does not match the digest named by the index throws `BUNDLE_DIGEST_MISMATCH`.
- **Signature verification is fail-closed.** A signature that does not verify is
  never a pass. A puller without the signing key cannot verify and records
  `signatureNotChecked: true` rather than pretending.
- **Append-only bundles.** Bundle objects are content-addressed by digest and are
  delete-denied at the bucket-policy layer (`*/bundles/*`); pushing the same
  digest again is a no-op.
