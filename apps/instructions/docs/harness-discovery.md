# Portable harness discovery

`instructions harness discover --json` inventories Claude Code, Codex, OpenCode,
and Sumi without running a harness, reading prompt bodies or credentials, opening
an application store, installing software, or changing any file. The same
`discoverHarnesses(options)` function is exported from `@hasna/instructions` and
`@hasna/instructions/sdk`.

Owner-home precedence is explicit `ownerHome`/`--owner-home`, `HOME`,
`USERPROFILE`, then the OS home. Resolve the actual owner's launcher environment
on each station; do not send the controller station's environment to every host.
Explicit executable overrides win over absolute entries in that station's PATH.
A missing explicit executable stays absent; discovery does not choose another
installation. Relative and empty PATH entries are ignored. `executable-found`
means an executable file was found; `versionEvidence: "not-probed"` explicitly
does not prove its version, native loading behavior, or a running session.

Config precedence is an explicit `configDir`/`--config-dir` override, then:

| Harness | Native selectors and defaults |
| --- | --- |
| Claude Code | `CLAUDE_CONFIG_DIR`, then `~/.claude` |
| Codex | `CODEX_HOME`, then `~/.codex` |
| OpenCode | `OPENCODE_CONFIG_DIR`, then `$XDG_CONFIG_HOME/opencode`, then `~/.config/opencode` |
| Sumi | `SUMI_CONFIG_DIR`, then `$XDG_CONFIG_HOME/sumi`, then `$SUMI_HOME/config` |

Sumi's default home may depend on its launcher's legacy adoption. When no
selector is present, its config root remains unresolved. Supply the actual
`sumi debug paths config` result as an explicit override after reviewing the
native runtime. Discovery never triggers home adoption. Overrides are reviewed
inputs, not proof that a launcher consumes the chosen directory.

```sh
instructions harness discover --json \
  --config-dir 'sumi=~/reviewed-sumi-config' \
  --project-root '~/repositories/example'
```

Paths accept absolute paths, `~/`, `{{HOME}}/`, `{{HOME_DIR}}/`, or `${HOME}/`.
There is no arbitrary environment substitution or shell expansion. Quote these
forms in a shell. Relative paths depending on the controller's current directory
are refused.

The result preserves the lexical path and separately reports its real path,
existence and symlink state. Global prompt or config symlinks require scope
review: a link may point to a project-specific prompt. A project root produces a
separate `projectPrompt`; it never changes the global root or emits a Sumi global
environment assignment. Discovery neither follows a link to overwrite it nor
grants permission to replace it.

`templateVariables` declares `HOME_DIR`, optional `PROJECT_ROOT`, and
`<HARNESS>_EXECUTABLE` / `<HARNESS>_CONFIG_DIR` for found harnesses with resolved
paths. Use those names in canonical templates, then resolve them per station
through the existing strict template renderer. Missing variables must fail
closed. A missing workspace no longer invents `~/Workspace` or `~/workspace`;
declare a project's workspace explicitly. Scratch storage is not a repository.

For fleet rollout, collect this receipt separately on each reachable station,
skip absent harnesses, and review unresolved roots and symlink scope. Bind the
exact executable, provider version, target root, hosted profile and current
file preimages into that station's existing session plan. Run the dry-run and
ownership/drift checks before apply; recheck discovery if its inputs change.
Do not use this inventory as an apply receipt, a deployment authorization,
or proof that an active native session adopted the rendered instructions.
