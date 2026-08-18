---
"@hasna/skills": patch
---

fix(skills): refuse to replace a content-bearing managed home with an executable pointer stub. A corpus skill without `kind: instruction` renders as a pointer stub, and `skills sync` previously replaced an adopted full-content home with that 15-line stub at rc=0 with no warning, silently discarding the content. The write path now refuses (action `skip`, reason naming the fix) unless `--force` is passed, and the drift census plus `skills diff` label which side of a divergence is a pointer stub so content-vs-stub state is readable.
