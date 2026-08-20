import { type ApiKeyVerifier } from "@hasna/contracts/auth";
import { MachineRegistry } from "./registry.js";
export interface StartServerOptions {
    host?: string;
    port?: number;
}
export interface StationsServer {
    stop(): void;
    port: number;
    hostname: string;
    url: string;
}
/**
 * Build the request handler. Isolated from Bun.serve so tests can call it with
 * a synthetic Request and injected registry/verifier.
 */
export declare function createHandler(deps: {
    registry: () => MachineRegistry;
    verifier: ApiKeyVerifier;
    ensureAuthSchema: () => Promise<void>;
}): (req: Request) => Promise<Response>;
/** Start the stations-serve HTTP server backed by Postgres (PURE REMOTE). */
export declare function startServer(options?: StartServerOptions): StationsServer;
