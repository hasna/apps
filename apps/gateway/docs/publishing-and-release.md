# Publishing And Release

## Release Targets

- npm package: `@hasna/gateway`
- CLI binary: `gateway`
- GitHub repository: `hasna/open-gateway`
- License: Apache-2.0

## Public Release Gate

Before publishing:

```bash
bun install
bun run typecheck
bun run build
bun test
bun dist/cli/index.js smoke --config gateway.config.example.json --all
```

Build before test on purpose: the no-cloud boundary guard inspects `dist`, and skips that
assertion when no build is present. `bun run check` runs the first four in this order.

The release must keep meeting these:

- No private URLs in public defaults.
- No bundled API keys.
- No hosted calls during tests.
- No requirement for a Hasna account in self-hosted mode.

## No-Cloud Boundary Check

Implemented as `tests/no-cloud-boundary.test.ts` and part of `bun test`. It asserts the
retired shared cloud runtime appears in no manifest field, not in `bun.lock`, in no tracked
file (`git ls-files`, the guard itself excepted) and — when a build is present — nowhere in
`dist`.

The built-output assertion permits exactly one occurrence: the line declaring
`FORBIDDEN_SHARED_CLOUD_RUNTIMES`. `@hasna/contracts` is a direct dependency whose own
denylist is a literal array of the forbidden names, and `bun build` inlines it into
`dist/index.js` and `dist/cli/index.js`. Any other occurrence is a real bundled edge and
fails the test.

That inlined constant is also why the external scanner cannot be a hard release gate yet.
`contracts no-cloud-scan` (measured with 0.8.1) returns exit 0 on this repo's tracked tree,
but exit 1 on a built tree, and exit 1 with the same findings escalated to `critical` on the
packed publishable tarball — all of them that one vendored declaration, reported as
`packed_artifact`. Two consequences, both deliberate:

- Do not gate the release on `no-cloud-scan` against `dist` or against an `npm pack`
  tarball until the scanner skips a repo's own build output or exempts that declaration.
  Run it against the tracked tree, where it is meaningful, and rely on
  `tests/no-cloud-boundary.test.ts` for built output.
- Do not wave off a built-output finding as "just the vendored constant" without reading
  it. The excuse is now true for one specific line and false for everything else; the test
  above encodes that distinction so nobody has to make the call by eye.

## Required Examples

Add these examples before first release:

- `examples/basic-openai-compatible`
- `examples/deepseek`
- `examples/qwen-dashscope`
- `examples/kimi`
- `examples/openrouter`
- `examples/fallback-routing`
- `examples/no-china-policy`
- `examples/china-allowed-policy`

## Required Config Files

Add:

- `.env.example`
- `gateway.config.example.json`
- `gateway.config.china.example.json`
- `gateway.config.no-china.example.json`

## Versioning

Use semver:

- Patch: bug fixes and docs.
- Minor: new providers, routes, config fields with backward compatibility.
- Major: breaking API, config, or adapter contract changes.

## First Public Version

The first useful version should not be a placeholder. It should include:

- Running CLI server.
- OpenAI-compatible chat endpoint.
- Streaming.
- At least three providers.
- Routing aliases.
- Fallbacks.
- Tests.
- Clear docs.

Do not publish a package that only contains types and docs.
