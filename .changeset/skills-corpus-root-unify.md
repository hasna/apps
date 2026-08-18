---
"@hasna/skills": patch
---

Fix split corpus root: list/search/info/push now read the migrated corpus cache (<app folder>/skills) through the one canonical resolver instead of resolving <app folder>/installed. After `skills storage migrate`, local discovery was silently blind to the real corpus — `skills list --all --json` returned 87 entries while the migrated corpus held 688, and `skills search` missed migrated skills. getPortableSkillsRoot() now applies the canonical precedence (rootDir -> migrated skills/ cache when the layout-migration record exists -> installed/), resolveCorpusRoot() delegates to it, and pull's local mirror is removed. The pre-migration layout is unchanged: without the record, every path still resolves installed/. Regression tests cover both states across resolver, list, registry, search, info, push --dry-run, and sync (bug 170b0e9b, todos 50229cf1).
