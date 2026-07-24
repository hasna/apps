const ENTRYPOINT_TRIPWIRE = "STAGE_A_ENTRYPOINT_TRIPWIRE";

let serveCalls = 0;

Bun.serve = ((..._args: unknown[]) => {
  serveCalls += 1;
  throw new Error(`${ENTRYPOINT_TRIPWIRE}:serve`);
}) as typeof Bun.serve;

globalThis.fetch = (async () => {
  throw new Error(`${ENTRYPOINT_TRIPWIRE}:fetch`);
}) as typeof fetch;

process.on("exit", () => {
  process.stderr.write(`STAGE_A_SYNTHETIC_SERVE_CALLS=${serveCalls}\n`);
});
