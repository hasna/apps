# Global Rules Provenance Import

`knowledge ingest rules` discovers global operating rules and agent instruction
sources, previews them safely, and can import approved records into the
Knowledge SQLite catalog through the same source-backed ingestion path used by
`knowledge ingest manifest`.

## Dry Run

Preview bounded evidence without creating `.hasna/knowledge`, `knowledge.db`,
or source records:

```bash
knowledge ingest rules \
  --workspace /home/hasna \
  --scope global \
  --dry-run \
  --max-items 100 \
  --limit 25 \
  --json
```

Dry-run output includes:

- `source_path_ref` and `source_ref`
- `owner`, `scope`, and `precedence`
- `source_hash` and `content_hash`
- `discovered_at`
- `tags`
- `redaction_status`
- `citations`
- bounded `preview` text only for importable records

If a source contains credential-like material, the workflow refuses that source
and emits `redaction_status: "refused"` with no preview text.

## Apply

Apply mode is the default when `--dry-run` is absent:

```bash
knowledge ingest rules \
  --workspace /home/hasna \
  --scope global \
  --owner global-agent-rules-standard \
  --max-items 100 \
  --json
```

Apply mode converts discovered sources into manifest items and calls the
existing Knowledge source ingestion path. It does not write ad hoc Markdown
under home directories.

## Discovery Scope

The workflow discovers bounded text sources from:

- root rule documents such as `CODEWITH.md`, `AGENTS.md`, `CLAUDE.md`,
  `RULES.md`, and `INSTRUCTIONS.md`
- `.codewith` rule, instruction, prompt, plan, config, and `SKILL.md` files
- `.claude/rules` and `.claude/CLAUDE.md`
- `.codex` rules, instructions, prompts, and config
- OpenCode config and `.opencode` instruction sources
- selected `.hasna/prompts` and `.hasna/plans`
- selected `docs` rule or instruction documents

Sensitive path names such as token, credential, password, private key, or secret
files are skipped before reading.

## Legacy JSON Notes

When the current Knowledge JSON store contains active rule-like notes, apply
mode promotes them into source-backed records using
`open-files://source/legacy-json/path/<note-id>`. After successful promotion,
the original JSON note is archived, not deleted, and receives
`metadata.knowledge_rules_import` evidence with hashes, source ref, timestamp,
and `data_loss: false`.

Dry-run mode reports matching legacy candidates but does not modify the JSON
store.

## Safety

The workflow never emits raw credential-like values in JSON evidence. Importable
content is redacted before it is passed to source ingestion. Refused sources are
not imported.
