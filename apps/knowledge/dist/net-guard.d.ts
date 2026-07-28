/**
 * @hasna/knowledge — outbound request guard.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * THE control that keeps a test run off the live store: while `NODE_ENV=test`,
 * every knowledge-owned outbound HTTP request whose target is not loopback is
 * refused before a socket is opened.
 *
 * It guards the EGRESS, not the environment, and that distinction is the whole
 * design. Clearing the selector variables at startup — a preload, a
 * `beforeAll`, a wrapper script — cannot work: a test file that assigns those
 * variables at module scope runs AFTER any one-shot clear, `bun test` executes
 * many files in one process with one preload, so a single file's leak reaches
 * every later file, and a `bunfig.toml` preload resolves from the cwd and is
 * simply absent when the suite is invoked from a subdirectory. Each of those
 * produced a GREEN run with writes going out over HTTP. A check at the point of
 * egress has none of those escape routes, because by then it does not matter
 * which layer decided to make the request or when the variable was set.
 *
 * Loopback is allowed on purpose. Tests that stand up a `Bun.serve` on
 * 127.0.0.1 and exercise the real HTTP transport against it are the good case —
 * they are hermetic. Refusing them would push the suite toward stubbing the
 * transport, which is precisely how an egress bug hides.
 *
 * There is NO opt-out. Every in-repo script that legitimately talks to a real
 * endpoint (`scripts/smoke-*.mjs`) runs outside `bun test` and so is never
 * under the guard; an escape hatch would only exist to be used by the next test
 * that "just needs one real call".
 *
 * Messages never include the target host. The repo already refuses cloud
 * configuration "without leaking the URL", and a refusal message is exactly the
 * text that ends up pasted into a task comment or a CI log.
 */
/** Env var whose value `test` arms the guard. Set automatically by `bun test`. */
export declare const NETWORK_GUARD_ENV = "NODE_ENV";
export declare class KnowledgeNetworkGuardError extends Error {
    readonly scheme: string;
    readonly port: string;
    constructor(message: string, details: {
        scheme: string;
        port: string;
    });
}
/**
 * True while outbound non-loopback requests must be refused.
 *
 * Read per request rather than captured once at import: a module that sets
 * `NODE_ENV` after this file loads must still be guarded, and the whole failure
 * class this defends against is state that arrives later than expected.
 */
export declare function isNetworkGuardActive(env?: NodeJS.ProcessEnv): boolean;
/**
 * True for every hostname that cannot leave this machine.
 *
 * Covers what `new URL()` actually produces, which is not always what was
 * typed: `http://127.1` normalizes to `127.0.0.1`, IPv6 hostnames keep their
 * brackets (`[::1]`), and an IPv4-mapped IPv6 address is compressed to
 * `[::ffff:7f00:1]` rather than staying readable. `0.0.0.0` and `[::]` are NOT
 * accepted — they are bind-any addresses, not loopback, and treating a
 * wildcard as safe is how a guard gets talked past.
 */
export declare function isLoopbackHostname(hostname: string): boolean;
/**
 * Refuse the request unless it stays on this machine (or the guard is off).
 *
 * Fail-closed on an unparseable target: while the guard is armed, "we could not
 * tell where this was going" is not a reason to let it go.
 */
export declare function assertOutboundRequestAllowed(input: string | URL | Request, env?: NodeJS.ProcessEnv): void;
/**
 * `fetch` with the guard in front of it. Installed permanently at the transport
 * boundary rather than only when the guard is armed, so arming is decided per
 * request by the environment and never by whatever it happened to be at the
 * moment the client was constructed.
 */
export declare function guardedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
