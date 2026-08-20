---
"@hasna/conversations": patch
---

fix: archived channels reject new posts with a usable error

A send to an archived channel used to succeed (rc=0, message stored) even
though archived channels are meant to be read-only history — an archived
#strategy accepted a test post. Both send implementations now select
`archived_at` and refuse a non-reply send to an archived channel inside the
same transaction as the existence check, with an error naming the archived
state and the remedy (`conversations channel list --archived` /
`conversations channel unarchive <name>`). Replies to messages already
sitting in an archived channel keep the existing reply-exempt carve-out on
both backends. Fixes the archived-writes bug (todos 9b502ed8).
