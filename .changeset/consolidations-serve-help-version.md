---
"@hasna/consolidations": patch
---

fix(serve): answer `--version`/`-V` and `--help`/`-h` before binding a socket

The serve bin used to ignore argv and go straight to `Bun.serve`, so
`consolidations-serve --help` hung with no output. It now prints usage or the
version and exits 0 without binding (recordings pattern), with regression tests
covering all four flags.
