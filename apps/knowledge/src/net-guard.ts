/**
 * @hasna/knowledge — outbound request guard.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * THE control that keeps a test run off the live store: while `NODE_ENV=test`,
 * an outbound HTTP request made through this package's own `fetch` call sites
 * whose target is not loopback is refused before a socket is opened.
 *
 * SCOPE, stated precisely because a guard people believe covers more than it
 * does is worse than a narrow one. Covered: the HTTP item transport
 * (http-store.ts, via the contracts client's `fetchImpl`) and web source-ref
 * ingestion (source-ingest.ts). NOT covered: third-party SDK transports that
 * carry their own HTTP stacks — `@aws-sdk/client-s3` and the `ai` provider
 * clients. Those are credential-gated and the suite drives them with `--fake`,
 * so they are not the live-write path this defends; guarding them would mean
 * injecting a fetch into each SDK and is deliberately left out of this change.
 *
 * It guards the EGRESS, not the environment, and that distinction is the whole
 * design. Clearing transport variables at startup — a preload, a
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
 * transport, which is precisely how an egress bug hides. That allowance is not a
 * springboard: while armed, {@link guardedFetch} follows redirects itself and
 * checks EVERY hop, because a 302 followed internally by `fetch` never comes
 * back through a `fetchImpl` and so would leave the machine through a request
 * the guard had already approved.
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
export const NETWORK_GUARD_ENV = 'NODE_ENV';

export class KnowledgeNetworkGuardError extends Error {
  readonly scheme: string;
  readonly port: string;
  constructor(message: string, details: { scheme: string; port: string }) {
    super(message);
    this.name = 'KnowledgeNetworkGuardError';
    this.scheme = details.scheme;
    this.port = details.port;
  }
}

/**
 * True while outbound non-loopback requests must be refused.
 *
 * Read per request rather than captured once at import: a module that sets
 * `NODE_ENV` after this file loads must still be guarded, and the whole failure
 * class this defends against is state that arrives later than expected.
 */
export function isNetworkGuardActive(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[NETWORK_GUARD_ENV] ?? '').trim().toLowerCase() === 'test';
}

/** IPv4 dotted-quad in 127.0.0.0/8. */
function isIpv4Loopback(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  if (!parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return false;
  return parts[0] === '127';
}

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
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (host.length === 0) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (isIpv4Loopback(host)) return true;
  if (!host.startsWith('[') || !host.endsWith(']')) return false;
  const v6 = host.slice(1, -1);
  if (v6 === '::1' || /^(0:){7}1$/.test(v6)) return true;
  // IPv4-mapped/compatible loopback, e.g. ::ffff:127.0.0.1 -> ::ffff:7f00:1.
  const tail = v6.split(':').pop() ?? '';
  if (/^(::ffff:|::)/.test(v6) && isIpv4Loopback(tail)) return true;
  return /^::(ffff:)?7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(v6);
}

function targetUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Refuse the request unless it stays on this machine (or the guard is off).
 *
 * Fail-closed on an unparseable target: while the guard is armed, "we could not
 * tell where this was going" is not a reason to let it go.
 */
export function assertOutboundRequestAllowed(
  input: string | URL | Request,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isNetworkGuardActive(env)) return;
  const raw = targetUrl(input);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new KnowledgeNetworkGuardError(
      `knowledge: refused an outbound request with an unparseable target while ${NETWORK_GUARD_ENV}=test. `
        + 'Under test, only loopback requests are permitted.',
      { scheme: 'unknown', port: '' },
    );
  }
  if (isLoopbackHostname(url.hostname)) return;
  throw new KnowledgeNetworkGuardError(
    `knowledge: refused a non-loopback ${url.protocol.replace(':', '')} request while ${NETWORK_GUARD_ENV}=test `
      + '(target host withheld on purpose). This process selected the HTTP API under test, which means a '
      + 'read or write was about to leave the machine and reach the live store. Clear every credential tier '
      + 'from the test environment (the suite preload does this, and the Keychain tier is off while this '
      + 'guard is armed) to stay on the on-box store, or point HASNA_KNOWLEDGE_API_URL at 127.0.0.1 for a '
      + 'hermetic test.',
    { scheme: url.protocol.replace(':', ''), port: url.port },
  );
}

/** Statuses `fetch` treats as a redirect to follow. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** Hop ceiling while the guard follows redirects itself (`fetch`'s own limit is 20). */
const MAX_GUARDED_REDIRECTS = 5;

function requestMethod(input: string | URL | Request, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== 'string' && !(input instanceof URL)) return input.method.toUpperCase();
  return 'GET';
}

/**
 * `fetch` with the guard in front of it. Installed permanently at the transport
 * boundary rather than only when the guard is armed, so arming is decided per
 * request by the environment and never by whatever it happened to be at the
 * moment the client was constructed.
 *
 * REDIRECTS ARE FOLLOWED HERE, NOT BY `fetch`, while the guard is armed. Checking
 * only the first target is not enough: `fetch` follows a 3xx internally and an
 * internal hop never comes back through a `fetchImpl`, so a hermetic 127.0.0.1
 * server answering 302 with an off-box `Location` reached the network through a
 * request the guard had already approved — measured at 4 connect() calls to :443
 * and a real HTTP 200 from a public host. Every hop is now checked, and an
 * off-box hop is refused with the same host-withholding error as a first-hop
 * refusal, so the loopback allowance cannot be used as a springboard.
 *
 * Unarmed, this is plain `fetch` with plain `fetch` redirect handling: the
 * production path is untouched. A caller that sets `redirect` explicitly keeps
 * its own semantics — the manual walk only replaces the default `follow`.
 * Re-issuing a hop reuses `init.method`/`init.body`; a `Request` input's body is
 * not replayed, which is sound for this package because both real call sites
 * (the contracts transport and web source ingestion) pass a URL string plus an
 * init object.
 */
export async function guardedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  assertOutboundRequestAllowed(input);
  if (!isNetworkGuardActive() || init?.redirect !== undefined) {
    return fetch(input as Parameters<typeof fetch>[0], init);
  }

  let from = targetUrl(input);
  let method = requestMethod(input, init);
  let body = init?.body;
  let response = await fetch(input as Parameters<typeof fetch>[0], { ...(init ?? {}), redirect: 'manual' });

  for (let hop = 0; REDIRECT_STATUSES.has(response.status); hop++) {
    const location = response.headers.get('location');
    // A 3xx with no Location is not a redirect — hand it back as the answer.
    if (!location) return response;
    const next = new URL(location, from).href;
    assertOutboundRequestAllowed(next);
    if (hop >= MAX_GUARDED_REDIRECTS) {
      const url = new URL(next);
      throw new KnowledgeNetworkGuardError(
        `knowledge: refused to follow more than ${MAX_GUARDED_REDIRECTS} redirects while ${NETWORK_GUARD_ENV}=test `
          + '(target host withheld on purpose). Under test the guard follows redirects itself so every hop is '
          + 'checked, and a chain this long is a loop, not a route.',
        { scheme: url.protocol.replace(':', ''), port: url.port },
      );
    }
    // The downgrade `fetch` itself applies, so a followed hop behaves the same.
    if (
      response.status === 303
      || ((response.status === 301 || response.status === 302) && method !== 'GET' && method !== 'HEAD')
    ) {
      method = 'GET';
      body = undefined;
    }
    const hopInit: RequestInit = { ...(init ?? {}), method, redirect: 'manual' };
    if (body === undefined) delete hopInit.body;
    else hopInit.body = body;
    response = await fetch(next, hopInit);
    from = next;
  }

  return response;
}
