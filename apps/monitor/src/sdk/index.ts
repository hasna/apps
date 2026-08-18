/**
 * @hasna/monitor — SDK entry point (`@hasna/monitor/sdk`)
 *
 * The programmatic surface of monitor, contract-declared as the supported
 * `./sdk` export (hasna.contract.json serviceSurfaces.sdk). MON-V2-15 grows
 * this into the full MonitorService facade with CLI/SDK/MCP parity; today it
 * exposes the package's library surface so the contract-supported export
 * resolves to a real, importable module.
 */
export * from "../index.js";
export { MONITOR_VERSION } from "../version.js";
