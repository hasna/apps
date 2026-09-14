---
"@hasna/emails": patch
---

Reject literal newline escapes inside HTTP(S) body URL tokens before send or scheduled enqueue, with the same generic diagnostic in CLI dry runs, controlled sends, and SDK sends. Preserve body bytes, real line breaks, percent-encoded URL data, and unrelated prose backslashes; document body-file authoring.
