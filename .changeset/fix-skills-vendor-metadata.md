---
"@hasna/skills": patch
---

Allow vendor skill discovery to ignore symlinks to regular plugin metadata files and direct sibling cache aliases whose real targets were fully scanned and contain no discoverable skills. Hook planning can then disable neighboring cached skills while symlinked skill directories, skill contents, unsafe or incomplete aliases, dangling links, and special files remain refused.
