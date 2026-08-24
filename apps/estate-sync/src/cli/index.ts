#!/usr/bin/env node
/**
 * `estate-sync` CLI — push and pull named artifacts against an estate store
 * bucket, prefix-tenant scoped.
 *
 *   estate-sync push <name> <file>      --bucket B --prefix P
 *   estate-sync pull <name> <out>       --bucket B --prefix P
 *
 * Configuration comes from flags first, then the environment:
 *   --bucket / ESTATE_SYNC_BUCKET
 *   --prefix / ESTATE_SYNC_PREFIX
 *   signing key: ESTATE_SYNC_SIGNING_KEY (optional; pushes sign when set)
 *   region: AWS_REGION (default us-east-1)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import { createEstateSync, EstateSyncError } from "../index.js";

function requireString(value: string | undefined, name: string, env: string): string {
  if (value) return value;
  const fromEnv = process.env[env];
  if (fromEnv) return fromEnv;
  throw new EstateSyncError(`Missing required ${name}; pass --${name} or set ${env}`, "MISSING_CONFIG");
}

function buildClient(opts: { bucket?: string; prefix?: string; signingKey?: string }) {
  const bucket = requireString(opts.bucket, "bucket", "ESTATE_SYNC_BUCKET");
  const prefix = requireString(opts.prefix, "prefix", "ESTATE_SYNC_PREFIX");
  const signingKey = opts.signingKey ?? process.env.ESTATE_SYNC_SIGNING_KEY;
  return createEstateSync({
    bucket,
    prefix,
    ...(signingKey ? { signingKey } : {}),
  });
}

async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program.name("estate-sync").description("Estate store bucket sync: push/pull prefix-tenant artifacts");

  program
    .command("push")
    .description("push a file as a digest bundle plus a signed index pointer")
    .argument("<name>", "artifact name")
    .argument("<file>", "path to the file to push")
    .option("--bucket <bucket>", "estate store bucket")
    .option("--prefix <prefix>", "app prefix tenant")
    .option("--content-type <type>", "content type of the artifact")
    .action(async (name: string, file: string, opts: { bucket?: string; prefix?: string; contentType?: string }) => {
      const client = buildClient(opts);
      const body = readFileSync(file);
      const result = await client.push({
        name,
        body,
        ...(opts.contentType ? { contentType: opts.contentType } : {}),
      });
      console.log(
        JSON.stringify(
          {
            name: result.name,
            digest: result.digest,
            sizeBytes: result.sizeBytes,
            bundleKey: result.bundleKey,
            indexKey: result.indexKey,
            bundleAlreadyExisted: result.bundleAlreadyExisted,
          },
          null,
          2,
        ),
      );
    });

  program
    .command("pull")
    .description("pull a named artifact: resolve the signed index, fetch by digest, verify sha256, hydrate")
    .argument("<name>", "artifact name")
    .argument("<out>", "path to atomically hydrate the verified bytes to")
    .option("--bucket <bucket>", "estate store bucket")
    .option("--prefix <prefix>", "app prefix tenant")
    .option("--require-signature", "fail when the index signature cannot be verified")
    .action(
      async (name: string, out: string, opts: { bucket?: string; prefix?: string; requireSignature?: boolean }) => {
        const client = buildClient(opts);
        const result = await client.pull({
          name,
          hydrateTo: out,
          ...(opts.requireSignature ? { requireSignature: true } : {}),
        });
        writeFileSync(out, result.bytes);
        console.log(
          JSON.stringify(
            {
              name: result.name,
              digest: result.digest,
              sizeBytes: result.sizeBytes,
              signatureVerified: result.signatureVerified,
              ...(result.signatureNotChecked ? { signatureNotChecked: true } : {}),
              hydratedTo: result.hydratedTo,
            },
            null,
            2,
          ),
        );
      },
    );

  await program.parseAsync(argv);
}

main(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`estate-sync: ${message}`);
  process.exit(1);
});
