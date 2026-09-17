---
"@hasna/skills": patch
---

Reject unsupported `docs --file` aliases before local or hosted reads, and reject
missing explicitly requested documentation instead of returning another file.
Text and JSON now share the same selection logic. The root SDK's
`getSkillBestDoc(name, file?)` accepts the same optional `skill`, `readme`, and
`claude` aliases; omitting the file preserves the existing documentation priority.
