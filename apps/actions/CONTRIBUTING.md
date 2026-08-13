# Contributing

Use Bun for local development.

```sh
bun install
bun run typecheck
bun test
bun run build
```

Work on a feature branch and open a pull request rather than pushing directly to
`main`. Use Conventional Commit subjects such as `docs: clarify CLI pagination`
so release history remains machine-readable.

Keep contract changes backward compatible unless the manifest schema version is
explicitly changed and documented.
