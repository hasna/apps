const TRIPWIRE_PREFIX = "STAGE_A_IMPORT_TRIPWIRE";

Bun.plugin({
  name: "stage-a-authority-import-tripwire",
  setup(builder) {
    if (process.env.STAGE_A_TRIPWIRE_IMPORTS !== "1") return;
    builder.onResolve({ filter: /^bun:sqlite$/ }, () => {
      throw new Error(`${TRIPWIRE_PREFIX}:bun:sqlite`);
    });
    builder.onLoad({
      filter: /(?:\/db\/|\/lib\/local-backups\.ts$|\/mcp\/runtime\.ts$|\/mcp\/tools\/|\/storage\/(?:cloud-client|comment-redaction-backfill|hybrid|local-sqlite|postgres-adapter|postgres-sync|s3-artifact-sync|s3-artifacts|shadow|shadow-outbox|shadow-runtime|sqlite-snapshot-runtime|stage-a-public-helper-runtime)\.ts$|@modelcontextprotocol\/sdk\/dist\/esm\/server\/(?:mcp|stdio|webStandardStreamableHttp)\.js$)/,
    }, ({ path }) => {
      throw new Error(`${TRIPWIRE_PREFIX}:module:${path}`);
    });
  },
});

globalThis.fetch = (async () => {
  throw new Error(`${TRIPWIRE_PREFIX}:fetch`);
}) as typeof fetch;

Bun.serve = (() => {
  throw new Error(`${TRIPWIRE_PREFIX}:serve`);
}) as typeof Bun.serve;
