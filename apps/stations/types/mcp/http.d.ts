import { type IncomingMessage, type Server } from "node:http";
export declare const DEFAULT_HTTP_PORT = 8821;
export declare const HTTP_NAME = "stations";
export declare const DEFAULT_MAX_BODY_BYTES: number;
export interface StartHttpServerOptions {
    port?: number;
    host?: string;
    name?: string;
    security?: StationsHttpSecurityConfig;
}
export interface StationsHttpSecurityConfig {
    apiKey?: string;
    allowUnauthenticated: boolean;
    allowedOrigins: string[];
    maxBodyBytes: number;
}
export declare function isHttpMode(args?: string[]): boolean;
export declare function resolveHttpPort(args?: string[]): number;
export declare function isLoopbackHost(host: string): boolean;
export declare function resolveHttpSecurityConfig(env?: NodeJS.ProcessEnv, host?: string): StationsHttpSecurityConfig;
export declare function isTrustedHttpOrigin(origin: string | undefined, host: string, allowedOrigins?: string[]): boolean;
export declare function authorizeHttpOrigin(req: IncomingMessage, host: string, security: StationsHttpSecurityConfig): {
    ok: true;
} | {
    ok: false;
    status: 403;
    reason: string;
};
export declare function authorizeHttpRequest(req: IncomingMessage, security: StationsHttpSecurityConfig): {
    ok: true;
} | {
    ok: false;
    status: 401;
    reason: string;
};
export declare function startHttpServer(options?: StartHttpServerOptions): Server;
