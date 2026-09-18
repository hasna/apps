# Reviewed plugin admission

`skills integration plugin` prepares a plugin before a coding agent discovers
it. The projection, target and binding contracts use schema version 1; admission
plans and receipts use schema version 2. Claude command sources use `copy` mode, certified against
Claude 2.1.274. It removes native skill and command prompts while preserving
reviewed agents, tools, MCP, LSP, hooks and assets. Prompt hooks enforce drift;
they do not clean an already loaded plugin catalog.

All packages and migration mappings belong in the owner's private Skills
instance. The public Skills package ships this software and synthetic tests;
it contains no operational plugin catalog or skill payloads. The Skills server
can use its supported storage backend. Plugin admission does not require S3.

## Private package contract

Publish migrated prompts through the normal versioned Skills authoring flow.
Then publish a separate instruction bundle containing `plugin-projection.json`
and the original regular-file plugin tree under `original/`. Keep its root
instruction and package metadata outside that tree. Select the integration
bundle and all its mapped payload versions in a dedicated integration profile.
These operations do not silently publish or change a selection profile.

The exported `PluginProjectionManifest` is the strict version 1 contract:

| Field | Meaning |
| --- | --- |
| `schemaVersion`, `agent` | `1`, `"claude"` |
| `pluginId` | Exact `plugin-name@marketplace-name` |
| `upstream` | Credential-free HTTPS source, revision, version, license, and original `treeDigest` |
| `review.hooks` | `"reviewed-no-skill-injection"` |
| `review.dependencies` | `"reviewed-no-retired-payload-dependency"` |
| `payloads` | Every original skill and command prompt, with source path, kind, source digest and exact hosted target slug/version/bundle digest |

`pluginTreeDigest(entries)` hashes sorted file witnesses: path, normalized mode,
size and SHA-256. A payload's `sourceDigest` is that function applied to its
single original file. The source is preserved byte-for-byte in the private
archive; the native projection is derived from it. Default and custom command
paths, dormant default commands, root skills and case-insensitive aliases are
covered. Custom skill trees are removed, including their support files. The
only rewritten ordinary file is the plugin manifest when its `skills` or
`commands` declarations need removal.

Overlapping ordinary components, references to removed files, native agent
skill preloads, unsupported manifest fields and upstream package installation
requirements refuse admission. Review must cover indirect/dynamic dependencies
as well as the direct references checked by software. Admission never executes
an upstream shell command or installation script. Preserved plugin tools and
hooks still run under the native agent's normal trust controls when used.

## Plan, admit and resolve

Prepare an owner-only JSON `PluginAdmissionTarget` with schema version 1,
plugin ID, exact `registrations` (user and/or canonical project paths), certified
native executable/version/digest, and the absolute Skills executable/digest.
One marketplace command serves that complete reviewed registration set.
Executable digests use `sha256:<hex>`; symlink aliases must be resolved to their
reviewed canonical file paths. No executable is invoked while planning.

```sh
skills integration plugin plan plugin-container --selection-profile integrations --target /absolute/private/target.json
skills integration plugin admit plugin-container --selection-profile integrations --target /absolute/private/target.json --plan-digest sha256:REVIEWED_DIGEST
skills integration plugin resolve --binding REVIEWED_BINDING_ID
```

Plan and admit emit JSON. Review the exact plan digest, retained/removed file
witnesses, provenance and hosted payload mappings. Admit refetches the profile
and exact bundles before accepting that digest. Its owner-only immutable receipt
binds authority, workspace, profile ID, exact canonical container and mapped
payload versions/digests, source and projection digests, scope set, executable
witnesses and resolver command. `planDigest` hashes that stable immutable
identity. `observation` separately records the freshly observed profile revision
and relevant resolved selections, including aliases and triggers. `evidenceDigest`
covers the complete plan and observation. Receipt reads validate both hashes,
strict field schemas and agreement between mapped and observed identities.
Schema version 1 review-candidate plans and receipts are refused. Originals remain in the
private hosted bundle; local native materializations contain only the projection.

The owner-local store is `~/.hasna/skills/plugin-admission/`: `bindings/` holds
content-addressed bindings, `receipts/<binding>/` holds approved plans, and
`objects/<binding>/<plan-digest>/` holds complete immutable projections. The
resolver freshly authenticates through normal owner credential configuration
on every call, including exact payload bundle reads. It refuses environment
authority/local-storage overrides. No `--cached`, API URL/key or local fallback
option exists. Valid unrelated profile additions/removals, revision increments,
selection ordering and alias/trigger routing edits preserve admission. These
changes remain subject to normal Skills profile and session rules. Missing
canonical selections, changed versions/digests, authority/workspace/profile
changes, revoked API access, changed package content or executable witnesses
still refuse or require renewed admission. A mapped canonical slug cannot be
replaced through an alias, even with identical content. Human plan/admit input
may use an integration alias; the resulting binding uses its canonical slug.

Re-admitting an unchanged immutable identity returns its original receipt
without rewriting that receipt's observed revision. A new plan reports the
current evidence. Resolver calls remain write-free. Canonical object keys and
registration-set ordering keep binding IDs, plan digests and persisted binding
bytes stable.

Configure the private marketplace source using the receipt's exact
`sourceCommand`, `source: "command"`, `mode: "copy"` and `timeout: 30`.
The resolver has a 25-second API deadline and prints exactly one absolute
directory path on success. Errors produce sanitized stderr and a nonzero exit.
Only explicit admission writes artifacts; resolve cannot publish or materialize
an unapproved revision. Concurrent admission uses a nonwaiting publication lock.
Interrupted attempts cannot expose partial directories as successful results.

Registration and activation remain explicit operations. Review the command
shown by Claude's JSON install/update response and pass its exact
`--accept-command` hash; never substitute blanket approval. Command-source
support begins at 2.1.229 and exact CLI acceptance at 2.1.271, but version 1
certifies 2.1.274 only. Claude invokes the source during installation and updates;
this does not imply a resolver invocation on every agent startup. This command does not upgrade Claude, register a
marketplace, change native settings, disable other plugins or restart agents.

## Discovery transition contract

After explicit native registration, use `captureManagedPluginRegistry()` in a
reviewed discovery input. It emits a `claude-plugin-registry` source witness with
the registry path and exact admission bindings. Keep the normal full witnesses
for native settings, marketplace catalog/source configuration and other loader
inputs. Do not retain a competing whole-registry byte witness when intentionally
admitting receipt-backed transitions; unmanaged entries remain covered by the
structured registry witness itself.

Only these managed row fields can vary after validation: `version`,
`installPath`, `sourceProducerPath`, `previousProducerPaths`, `lastUpdated`.
Every current row must match its own producer receipt and exact reviewed scope.
All retained native cache versions must match approved immutable projections,
including their command files, ordinary components, paths, modes and membership.
The native 2.1.274 adapter separately validates root `.in_use/<pid>` process
markers and `.orphaned_at` epoch-millisecond pruning markers. These bounded
metadata records cannot authorize content, and cannot come from the original
package. Links, unknown keys, payload files and nested directories still refuse.
Every unmanaged row and every unknown field remains in the witness. New
registrations, changed commands, cross-scope substitutions or modified caches
refuse. Old receipts and projections remain until separately reviewed retirement.

Project plugin enablement requires a full reviewed settings-file witness and
matching admitted project registration. Other project discovery overrides and
new loaders still require their dedicated review. API failure refuses an update; it does not report a
stale projection as synchronized. Claude may retain its previous installation
after a refused update, whose existing local drift checks continue to apply.

## Verification and limits

Unit tests cover provenance and mapping failures, offline/revoked authorities,
timeouts, concurrent publication, symlinks/special files, cache mutation, retained
history, and exact unmanaged registry coverage. Synthetic native tests exercise
actual Claude with a disposable home and loopback mock authority in a separate
network namespace. They contact no real provider and require explicit opt-in:
`SKILLS_TEST_CLAUDE_BIN`, `SKILLS_TEST_CLAUDE_SHA256` (reviewed native executable
digest) and `SKILLS_TEST_NETWORK_ISOLATED=1`. Before native execution, the test
checks the source before/after copying, complete copied digest, size and ELF
format, then atomically publishes its private executable fixture.

The initial implementation is a reviewed admission boundary, not an upstream
ingestion scheduler or a general plugin execution sandbox. MacOS runtime proof,
additional native versions and providers require their own canary evidence.
Package data is bounded to 1,024 files, 64 MiB total and 16 MiB per file. Native
cache history is bounded to 128 entries and an aggregate 256 MiB per witness.

Primary runtime references: [command sources](https://code.claude.com/docs/en/plugin-marketplaces#command-sources),
[plugin components](https://code.claude.com/docs/en/plugins-reference), and
[exact command acceptance](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21271).
