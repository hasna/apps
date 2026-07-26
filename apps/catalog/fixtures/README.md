# fixtures

`apps.seed.jsonl` is a **synthetic** five-record sample of the `hasna.app.v1`
read model. Every value in it is invented: the names are `example-*`, the npm
scope is `@example`, and the repositories are under `github.com/example`, which
RFC 2606 reserves for documentation. Between them the records cover the shapes
the importer has to handle — HTTP and stdio MCP transports, an app with no bins,
a stub with no version, and a deprecated lifecycle.

It is here so `catalog import` and the store are demonstrable and testable from a
clean checkout. **It is not an inventory, and it must never become one.**

Through `@hasna/catalog@0.1.0` this file held 86 real application records — app
ids, npm names, GitHub URLs, checkout folders, project slugs, bin names, and
lifecycle state, stamped `"seededFrom":"opensource-scan"`. Nothing read it at <!-- artifact-check-ignore: quoting the marker while explaining the incident it caused; this line is the description, not the data -->
runtime. It was a committed cache of the output of the `catalog seed` scanner
that this same package ships, and because `fixtures` is listed in `files`, every
published tarball carried it to the public npm registry.

Real inventory is produced at runtime, never committed:

```bash
catalog seed --root <checkout-dir> --db <path>          # scan and populate the store
catalog seed --root <checkout-dir> --fixture out.jsonl  # ...and write the records out
```

Write that output somewhere the operator controls. `.gitignore` keeps stray
`*.seed.jsonl` files out of this repository, and `bun run check:artifact` fails
the release if real records reach a packed artifact.
