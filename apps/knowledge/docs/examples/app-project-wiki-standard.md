# App Project Wiki Standard

Use this workflow when an app needs its own durable project wiki.

## 1. Open The Project Scope

```bash
knowledge app-wiki init --scope project --json
```

This creates only the project workspace:

```text
<repo>/.hasna/knowledge/
```

Do not create loose Markdown under `~/.hasna`, `~/.husna`, or a repo-local
`.husna` folder. Durable app knowledge must go through the Knowledge CLI, SDK,
or MCP server so SQLite catalog rows, artifacts, citations, and audit events
stay together.

## 2. Add Source Refs

```bash
knowledge app-wiki source add file:///absolute/path/to/spec.md --scope project --json
```

Prefer `open-files://...` refs in production. File, S3, and web refs are useful
for local smoke tests, but raw source ownership still belongs outside
`open-knowledge`.

## 3. Add A Scoped Note

```bash
knowledge app-wiki note add \
  --title "Billing Import Decision" \
  --content "Use source refs and cite the import spec." \
  --source-ref "open-files://file/file_billing/revision/rev_20260701" \
  --tag billing \
  --scope project \
  --json
```

Notes are written as generated artifacts under
`.hasna/knowledge/artifacts/wiki/notes/` and cataloged in
`.hasna/knowledge/knowledge.db`. The command does not write `db.json` or loose
global Markdown.

## 4. Search Or Query

```bash
knowledge app-wiki search "billing import" --scope project --json
knowledge app-wiki query "billing import" --scope project --json
```

Search reads source chunks, app wiki notes, generated wiki pages, and index
rows from the scoped project catalog.

## 5. Use The SDK

```ts
import { openProjectWiki } from '@hasna/knowledge';

const wiki = openProjectWiki({ cwd: process.cwd() });
await wiki.init();
await wiki.sources.add({ sourceRef: 'file:///absolute/path/to/spec.md' });
await wiki.notes.add({
  title: 'Billing Import Decision',
  content: 'Use source refs and cite the import spec.',
  sourceRefs: ['file:///absolute/path/to/spec.md'],
});
const results = await wiki.search({ query: 'billing import' });
```

`openProjectWiki()` defaults to project scope. Global app-wiki writes require an
explicit opt-in:

```bash
knowledge app-wiki note add --scope global --allow-global ...
```

Use that only for reviewed global knowledge. Do not run live/global writes in
tests or smokes.
