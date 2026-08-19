---
"@hasna/loops": patch
---

Fix `loops list` pagination failing on a duplicate/no-progress page (BUG 3d3521a4). The loops table is ordered by `next_run_at`, which the daemon mutates as loops run, so the ordering can shift between page fetches and the offset window can land entirely on already-seen rows; the CLI then failed the whole read with LOOP_LIST_PAGINATION_FAILED ("a page contained no new loop ids"), blocking loop enumeration. A no-progress page (exact repeat, zero new ids, or frozen offset) now terminates pagination and returns the deduplicated population gathered so far, with a stderr warning naming the reason; the page/items safety ceilings and unusable-id checks remain hard errors.
